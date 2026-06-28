/**
 * package-embed-wasm.mjs
 *
 * Stage 5 of the wasm build pipeline.  Called by build-wasm.sh after the
 * emcc MAIN_MODULE re-link (Stage 4) has produced:
 *   src-rust/pkg/llama_engine_emscripten.mjs   — Emscripten JS runtime
 *   src-rust/pkg/llama_engine_emscripten.wasm  — compiled wasm (llama.cpp + Rust)
 *
 * This script synthesises the public-facing pkg/ files:
 *   llama_engine.wasm    → rename of llama_engine_emscripten.wasm
 *   llama_engine.js      → thin ESM shim (imports createLlamaModule and re-exports)
 *   llama_engine.d.ts    → TypeScript declarations
 *   package.json         → sub-package manifest
 *
 * The shim pattern is required because wasm.engine.ts dynamic-imports
 * llama_engine.js and expects:
 *   mod.default()         — async, initialises the wasm module
 *   mod.init()            — Rust-level engine init  (set by initBindgen/addOnInit)
 *   mod.load_model(...)   — synchronous after init
 *   mod.generate(...)     — synchronous after init
 *   mod.embed(...)        — synchronous after init
 *   mod.health()          — synchronous after init
 *   mod.memory_snapshot() — synchronous after init
 *   mod.unload_model(...) — synchronous after init
 */

import { readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root        = resolve(process.cwd());
const engineName  = 'llama_engine';
const wasmPkgDir  = resolve(root, 'src-rust', 'pkg');
const BUILD_JSPI  = process.env.LLAMA_WASM_JSPI === '1';
const BUILD_PTHREAD = process.env.LLAMA_WASM_PTHREAD === '1';

// ── Inputs (produced by Stage 4 emcc MAIN_MODULE link) ─────────────────────
const emscriptenMjs  = resolve(wasmPkgDir, `${engineName}_emscripten.mjs`);
const emscriptenWasm = resolve(wasmPkgDir, `${engineName}_emscripten.wasm`);

// ── Outputs ─────────────────────────────────────────────────────────────────
const wasmOutPath   = resolve(wasmPkgDir, `${engineName}.wasm`);
const jsOutPath     = resolve(wasmPkgDir, `${engineName}.js`);
const dtsOutPath    = resolve(wasmPkgDir, `${engineName}.d.ts`);
const pkgJsonPath   = resolve(wasmPkgDir, 'package.json');

const fail = (msg) => { console.error(`[package-embed-wasm] ERROR: ${msg}`); process.exit(1); };

const requireFile = async (path, label) => {
  try {
    const buf = await readFile(path);
    if (buf.byteLength === 0) fail(`${label} is empty at ${path}`);
  } catch (err) {
    if (err.code === 'ENOENT') fail(`Missing ${label} at ${path}`);
    throw err;
  }
};

// ── 1. Verify emcc outputs exist ─────────────────────────────────────────────
await requireFile(emscriptenMjs,  'emcc ESM runtime (llama_engine_emscripten.mjs)');
await requireFile(emscriptenWasm, 'emcc wasm binary (llama_engine_emscripten.wasm)');

const emscriptenWasmBuf   = await readFile(emscriptenWasm);
const emscriptenWasmBytes = emscriptenWasmBuf.byteLength;
const MIN_EMBEDDED_BYTES  = 1_000_000;
if (emscriptenWasmBytes < MIN_EMBEDDED_BYTES) {
  fail(
    `llama_engine_emscripten.wasm is only ${emscriptenWasmBytes} bytes — ` +
    `expected at least ${MIN_EMBEDDED_BYTES} for a build with embedded llama.cpp. ` +
    `Ensure Stage 4 (emcc MAIN_MODULE re-link) succeeded.`,
  );
}

// ── 1c. WASM memory mode ─────────────────────────────────────────────────────
// wllama: single-thread → Emscripten-owned memory (grow via mmapAlloc/malloc).
// Pthread builds import shared WebAssembly.Memory from JS (getWasmMemory).
{
  if (BUILD_PTHREAD) {
    console.log('[package-embed-wasm] WASM memory: IMPORTED_MEMORY (pthread shared, wllama getWasmMemory) ✓');
  } else {
    console.log('[package-embed-wasm] WASM memory: Emscripten-owned (832 MB initial, grow via mmapAlloc) ✓');
  }
}

// ── 1b. Patch emcc ESM runtime: optional-chain __wbindgen_start ──────────────
// The emscripten MAIN_MODULE target does not export __wbindgen_start (unlike
// wasm32-unknown-unknown builds). library_bindgen.js calls it unconditionally,
// so we patch the mjs here to avoid a TypeError at module init time.
{
  let mjsSrc = await readFile(emscriptenMjs, 'utf8');
  const ORIG = 'wasmExports.__wbindgen_start();';
  const PATCHED = 'wasmExports.__wbindgen_start?.();';
  if (mjsSrc.includes(ORIG)) {
    mjsSrc = mjsSrc.replace(ORIG, PATCHED);
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Patched __wbindgen_start → optional chain');
  }
  // JSPI: Asyncify.instrumentWasmExports copies exports via Object.entries and drops
  // Proxy-only shims. Inject wasm-bindgen ABI helpers onto wasmExports after
  // instrumentation (origExports retains real WASM exports for updateGOT).
  const ASYNCIFY_INSTR = 'wasmExports=Asyncify.instrumentWasmExports(wasmExports);';
  const WBGEN_SHIM = `${ASYNCIFY_INSTR}{const __sp=origExports.__stack_pointer;if(__sp){Object.assign(wasmExports,{__wbindgen_add_to_stack_pointer:(d)=>{const v=(__sp.value+d)|0;__sp.value=v;return v},__wbindgen_export2:origExports.__wbindgen_malloc,__wbindgen_export3:origExports.__wbindgen_realloc,__wbindgen_export4:origExports.__wbindgen_free,__wbindgen_export:origExports.__wbindgen_exn_store})}}`;
  if (mjsSrc.includes(ASYNCIFY_INSTR) && !mjsSrc.includes('__wbindgen_add_to_stack_pointer:(d)=>')) {
    mjsSrc = mjsSrc.replace(ASYNCIFY_INSTR, WBGEN_SHIM);
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Patched wasm-bindgen shims after Asyncify.instrumentWasmExports');
  }
  // wasm-bindgen finally blocks call __wbindgen_export3 even when the try body
  // threw before deferredN_0 was set (e.g. fopen("/tmp/...") failed). Passing
  // undefined ptr/len into realloc aborts the whole module with "unreachable".
  const FINALLY_DEALLOC_RE = /wasm\.__wbindgen_export3\(deferred(\d)_0,deferred\1_1,1\)/g;
  if (FINALLY_DEALLOC_RE.test(mjsSrc) && !mjsSrc.includes('deferred2_0!=null&&deferred2_0!==0')) {
    mjsSrc = mjsSrc.replace(
      FINALLY_DEALLOC_RE,
      '(deferred$1_0!=null&&deferred$1_0!==0&&wasm.__wbindgen_export3(deferred$1_0,deferred$1_1,1))',
    );
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Patched wasm-bindgen finally dealloc guards');
  }
  // JSPI asyncifyStubs leave most wasm exports undefined; sync calls from cwrap /
  // bindgen (e.g. llama_load_context_from_path → common_init_from_params) fail
  // with "asyncifyStubs._Z… is not a function". Mirror all origExports into stubs.
  const ASSIGN_WASM = 'assignWasmExports(wasmExports);updateGOT(origExports)';
  const ASYNCIFY_STUB_MARKER = 'asyncifyStubs[__k]=origExports[__k]';
  const MERGE_ORIG_MARKER = 'mergeLibSymbols(origExports,"main")';
  const ASYNCIFY_STUBS =
    'assignWasmExports(wasmExports);mergeLibSymbols(origExports,"main");if(typeof asyncifyStubs!=="undefined"){for(const __k in origExports){if(typeof origExports[__k]==="function"){asyncifyStubs[__k]=origExports[__k]}}const __capCi=origExports["cap_wasm_dylink_common_init_from_params"];if(typeof __capCi==="function"){asyncifyStubs["_Z23common_init_from_paramsR13common_params"]=__capCi}const __desc=origExports["__wbindgen_describe"];asyncifyStubs["__wbindgen_describe"]=function(ptr){return __desc?__desc(ptr):0};const __descCast=origExports["__wbindgen_describe_cast"];asyncifyStubs["__wbindgen_describe_cast"]=function(ptr){return __descCast?__descCast(ptr):0}}updateGOT(origExports)';
  const OLD_DESCRIBE_LOOP = 'if(__k.startsWith("__wbindgen_describe_")&&typeof origExports[__k]==="function")';
  if (mjsSrc.includes(ASYNCIFY_STUB_MARKER) && !mjsSrc.includes('cap_wasm_dylink_common_init_from_params')) {
    mjsSrc = mjsSrc.replace(
      'for(const __k in origExports){if(typeof origExports[__k]==="function"){asyncifyStubs[__k]=origExports[__k]}}const __desc=origExports',
      'for(const __k in origExports){if(typeof origExports[__k]==="function"){asyncifyStubs[__k]=origExports[__k]}}const __capCi=origExports["cap_wasm_dylink_common_init_from_params"];if(typeof __capCi==="function"){asyncifyStubs["_Z23common_init_from_paramsR13common_params"]=__capCi}const __desc=origExports',
    );
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Added cap_wasm_dylink common_init asyncifyStub wire');
  } else if (mjsSrc.includes(ASYNCIFY_STUB_MARKER) && !mjsSrc.includes(MERGE_ORIG_MARKER)) {
    mjsSrc = mjsSrc.replace(
      'assignWasmExports(wasmExports);if(typeof asyncifyStubs',
      'assignWasmExports(wasmExports);mergeLibSymbols(origExports,"main");if(typeof asyncifyStubs',
    );
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Added mergeLibSymbols(origExports) before asyncifyStubs fill');
  } else if (mjsSrc.includes(OLD_DESCRIBE_LOOP) && !mjsSrc.includes(ASYNCIFY_STUB_MARKER)) {
    mjsSrc = mjsSrc.replace(
      'for(const __k in origExports){if(__k.startsWith("__wbindgen_describe_")&&typeof origExports[__k]==="function"){asyncifyStubs[__k]=origExports[__k]}}',
      'for(const __k in origExports){if(typeof origExports[__k]==="function"){asyncifyStubs[__k]=origExports[__k]}}',
    );
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Upgraded asyncifyStubs to mirror all origExports');
  } else if (mjsSrc.includes(ASSIGN_WASM) && !mjsSrc.includes(ASYNCIFY_STUB_MARKER)) {
    mjsSrc = mjsSrc.replace(ASSIGN_WASM, ASYNCIFY_STUBS);
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Patched asyncifyStubs to mirror all origExports');
  }
  // Remove recursive lazy-fallback patch (wasmExports[sym] === stub → stack overflow).
  const LAZY_STUB = /\{var _f=asyncifyStubs\["([^"]+)"\];if\(typeof _f!=="function"&&typeof wasmExports!=="undefined"&&typeof wasmExports\["\1"\]==="function"\)\{_f=asyncifyStubs\["\1"\]=wasmExports\["\1"\]\}return _f\((\.\.\.args)\)\}/g;
  if (mjsSrc.includes('_f=asyncifyStubs[')) {
    mjsSrc = mjsSrc.replace(LAZY_STUB, 'return asyncifyStubs["$1"]($2)');
    await writeFile(emscriptenMjs, mjsSrc);
    console.log('[package-embed-wasm] Removed recursive dylink stub lazy fallback');
  }
}

// ── 2. llama_engine.wasm = the emcc-produced wasm ────────────────────────────
await copyFile(emscriptenWasm, wasmOutPath);

// ── 3. Synthesise ESM shim (llama_engine.js) ─────────────────────────────────
//
// The shim:
//   a) Imports createLlamaModule from the emcc runtime (llama_engine_emscripten.mjs).
//   b) Resolves the .wasm URL relative to import.meta.url so bundlers and CDNs
//      can relocate the asset directory.
//   c) Exposes export default init() which awaits the module and stores it in _mod.
//   d) Re-exports each named function as a thin synchronous wrapper over the
//      corresponding Module.* property that library_bindgen.js/initBindgen sets up.
//
// Timing guarantee:
//   Emscripten's addOnInit() callback (initBindgen inside library_bindgen.js)
//   fires after the main module wasm is instantiated and after preRun hooks
//   have completed.  With MODULARIZE=1 the returned Promise resolves only when
//   addOnInit callbacks are done, so all Module.* properties are set by the time
//   `await createLlamaModule()` returns.
//
const shimSrc = `/* @ts-self-types="./llama_engine.d.ts" */
/* Auto-generated by package-embed-wasm.mjs — do not edit */
import createLlamaModule from './${engineName}_emscripten.mjs';

let _mod = null;
let _lastWasmStderr = '';
const LLAMA_WASM_JSPI = ${BUILD_JSPI};
const LLAMA_WASM_PTHREAD = ${BUILD_PTHREAD};

// JSPI polyfill for token streaming only (generate_stream). Model load uses sync EM_JS fread.
if (LLAMA_WASM_JSPI && typeof WebAssembly !== 'undefined' && !WebAssembly.Suspending) {
  WebAssembly.Suspending = function (fn) { return fn; };
  WebAssembly.promising = function (fn) {
    return function (...args) {
      try { return Promise.resolve(fn(...args)); }
      catch (e) { return Promise.reject(e); }
    };
  };
}

/** External file read (OPFS/JS handler → sync fread hook). Does not require native JSPI. */
export function can_use_async_file() {
  return LLAMA_WASM_JSPI;
}

/** Most recent llama stderr (error messages must use tail — head is stale load_tensors lines). */
function tailWasmStderr(maxLen = 1200) {
  if (!_lastWasmStderr) return '';
  return _lastWasmStderr.length > maxLen
    ? _lastWasmStderr.slice(-maxLen)
    : _lastWasmStderr;
}

/** Shared WASM memory for pthread builds (wllama getWasmMemory). Requires COOP/COEP. */
function trySharedWasmMemory() {
  if (!LLAMA_WASM_PTHREAD) return null;
  if (globalThis.crossOriginIsolated !== true || typeof SharedArrayBuffer === 'undefined') {
    return null;
  }
  // wllama: 128 MB initial, step down max (4096 → 128 MB) on iOS OOM
  const minBytes = 128 * 1024 * 1024;
  let maxBytes = 4096 * 1024 * 1024;
  const stepBytes = 128 * 1024 * 1024;
  while (maxBytes >= minBytes) {
    try {
      return new WebAssembly.Memory({
        initial: minBytes / 65536,
        maximum: maxBytes / 65536,
        shared: true,
      });
    } catch {
      maxBytes -= stepBytes;
    }
  }
  return null;
}

/** Single-thread: Emscripten owns memory (wllama passes wasmMemory: null). */
function tryWasmMemory() {
  return null;
}

/** Raw Emscripten Module — used by HeapFS helpers in wasm.engine.ts. */
export function getEmscriptenModule() {
  return _mod;
}

// ── Default export: loads and instantiates the WebAssembly module ─────────────
// wasm.engine.ts calls: await mod.default()
// Named "initWasm" internally so the "init" named export (below) can remain
// unambiguously the Rust-level engine initialiser (mod.init).
export default async function initWasm(_pathHint) {
  if (_mod) return _mod;

  // Emscripten's instantiateWasm hook has no failure callback — if instantiation
  // fails we must reject this outer promise via Promise.race (never throw from
  // the async chain inside instantiateWasm or the module hangs forever).
  let rejectWasmInstantiate;
  const wasmInstantiateFailed = new Promise((_, reject) => {
    rejectWasmInstantiate = reject;
  });

  const sharedMem = trySharedWasmMemory();
  if (LLAMA_WASM_PTHREAD && !sharedMem) {
    throw new Error(
      'Cannot allocate shared WebAssembly.Memory for llama pthread build. ' +
        'Ensure COOP/COEP headers (crossOriginIsolated) or disable pthreads.',
    );
  }
  const importedMem = sharedMem;
  const pthreadPoolSize = sharedMem && navigator.hardwareConcurrency
    ? Math.max(2, Math.floor(navigator.hardwareConcurrency / 2))
    : 4;

  const modulePromise = createLlamaModule({
    preRun: [() => {
      if (can_use_async_file()) {
        if (typeof Module !== 'undefined') {
          Module.ENV = Module.ENV || {};
          Module.ENV['USE_ASYNC_FILE'] = '1';
        }
      }
    }],
    printErr: (text) => {
      const line = String(text);
      _lastWasmStderr = (_lastWasmStderr ? _lastWasmStderr + '\\n' : '') + line;
      if (_lastWasmStderr.length > 4096) _lastWasmStderr = _lastWasmStderr.slice(-4096);
      if (typeof console !== 'undefined') {
        if (line.includes('@@WASM_LOAD@@') || line.includes('@@WASM_GEN@@')) {
          console.error('[llama-wasm-load]', line);
        } else {
          console.error('[llama.cpp]', line);
        }
      }
    },
    onAbort: (reason) => {
      _lastWasmStderr = 'Aborted: ' + String(reason);
      if (typeof console !== 'undefined') console.error('[llama.cpp]', _lastWasmStderr);
    },
    ...(importedMem ? { wasmMemory: importedMem } : {}),
    ...(sharedMem ? {
      pthreadPoolSize,
      mainScriptUrlOrBlob: new URL('./${engineName}_emscripten.mjs', import.meta.url).href,
    } : {}),
    // Resolve assets relative to this JS file so the module works regardless
    // of where the dist/wasm/ directory is served from.
    // Emscripten requests 'llama_engine_emscripten.wasm' but we ship the
    // MAIN_MODULE binary under the stable name 'llama_engine.wasm'.
    locateFile: (filename) => {
      const name = filename === '${engineName}_emscripten.wasm' ? '${engineName}.wasm' : filename;
      return new URL(name, import.meta.url).href;
    },
    // The WASM binary imports wasm-bindgen helpers from "__wbindgen_placeholder__"
    // but Emscripten's addToLibrary places them all under the "env" key.
    // Alias the module so WebAssembly.instantiate receives the expected key.
    instantiateWasm: (imports, successCallback) => {
      const wasmUrl = new URL('${engineName}.wasm', import.meta.url).href;
      // wasm-bindgen externref xform: manages a growable JS-side index space
      // for externref table slots. Indices are tracked with a monotonic counter;
      // the Emscripten runtime's heap handles actual JS object storage.
      let _extRefNextIdx = 128; // skip wasm-bindgen's pre-filled reserved slots
      const extRefXform = {
        __wbindgen_externref_table_grow: (delta) => {
          const prev = _extRefNextIdx;
          _extRefNextIdx += delta;
          return prev;
        },
        __wbindgen_externref_table_set_null: (_idx) => {},
      };

      // The MAIN_MODULE binary was originally a SIDE_MODULE: it imports ggml
      // quantisation functions via GOT.func even though those functions are
      // compiled into the same binary (as "_generic" suffixed exports).
      // Emscripten's reportUndefinedSymbols crashes when GOT entries that are
      // marked "required" cannot be resolved.  We fix this in two steps:
      //
      // 1. Wrap GOT.func/GOT.mem so every entry is marked weak (required=false).
      //    This stops the GL/AL/console stubs (never called by llama inference)
      //    from crashing reportUndefinedSymbols.
      //
      // 2. After instantiation, grow __indirect_function_table by one slot per
      //    ggml symbol, store the "_generic" function there, and write that slot
      //    index into the GOT global before calling successCallback.
      //    Emscripten's updateGOT sees value != -1 and leaves them untouched.
      const gotGlobals = {};
      const weakenGOT = (proxy) => new Proxy({}, {
        get(_, symName) {
          if (typeof symName !== 'string') return undefined;
          const global = proxy[symName];
          if (global instanceof WebAssembly.Global) {
            global.required = false;
            gotGlobals[symName] = global;
          }
          return global;
        },
      });

      // GOT.func symbol → exported "_generic" implementation present in the binary.
      const FUNC_ALIASES = {
        'lm_ggml_vec_dot_q4_0_q8_0': 'lm_ggml_vec_dot_q4_0_q8_0_generic',
        'lm_ggml_vec_dot_q5_0_q8_0': 'lm_ggml_vec_dot_q5_0_q8_0_generic',
        'lm_ggml_vec_dot_q5_1_q8_1': 'lm_ggml_vec_dot_q5_1_q8_1_generic',
        'quantize_row_q8_0':          'quantize_row_q8_0_generic',
        'lm_ggml_vec_dot_q8_0_q8_0': 'lm_ggml_vec_dot_q8_0_q8_0_generic',
        'quantize_row_q8_1':          'quantize_row_q8_1_generic',
        'lm_ggml_vec_dot_q2_K_q8_K': 'lm_ggml_vec_dot_q2_K_q8_K_generic',
        'lm_ggml_vec_dot_q3_K_q8_K': 'lm_ggml_vec_dot_q3_K_q8_K_generic',
        'lm_ggml_vec_dot_q4_K_q8_K': 'lm_ggml_vec_dot_q4_K_q8_K_generic',
        'lm_ggml_vec_dot_q5_K_q8_K': 'lm_ggml_vec_dot_q5_K_q8_K_generic',
        'lm_ggml_vec_dot_q6_K_q8_K': 'lm_ggml_vec_dot_q6_K_q8_K_generic',
        'quantize_row_q8_K':          'quantize_row_q8_K_generic',
      };

      const patchedImports = {
        ...imports,
        '__wbindgen_placeholder__': imports['env'] ?? {},
        '__wbindgen_externref_xform__': extRefXform,
        'GOT.func': weakenGOT(imports['GOT.func']),
        'GOT.mem':  weakenGOT(imports['GOT.mem']),
      };

      const patchGOTAndCall = (result) => {
        const exports = result.instance.exports;
        const table = exports.__indirect_function_table;
        if (table) {
          for (const [gotSym, exportSym] of Object.entries(FUNC_ALIASES)) {
            const fn = exports[exportSym];
            if (fn && gotGlobals[gotSym]) {
              const idx = table.grow(1);
              table.set(idx, fn);
              gotGlobals[gotSym].value = idx;
            }
          }
        }

        // Pass the real Instance — updateGOT(origExports) requires authentic WASM
        // export objects. wasm-bindgen shims are injected in llama_engine_emscripten.mjs
        // after Asyncify.instrumentWasmExports (see package-embed-wasm Stage 1b).
        successCallback(result.instance, result.module);
      };

      const reportInstantiateFailure = (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        rejectWasmInstantiate(error);
      };
      WebAssembly.instantiateStreaming(fetch(wasmUrl), patchedImports)
        .catch(() =>
          fetch(wasmUrl)
            .then((r) => {
              if (!r.ok) {
                throw new Error(\`Failed to fetch wasm: \${r.status} \${r.statusText}\`);
              }
              return r.arrayBuffer();
            })
            .then((bytes) => WebAssembly.instantiate(bytes, patchedImports))
        )
        .then(patchGOTAndCall)
        .catch(reportInstantiateFailure);
      return {}; // Emscripten requires a synchronous {} return
    },
  });

  _mod = await Promise.race([modulePromise, wasmInstantiateFailed]);
  installAsyncFileBridge(_mod);
  ensureMemfsTmp();
  patchHeapFS();
  _mod.__llamaWasmJspi = LLAMA_WASM_JSPI;
  _mod.__llamaWasmAsyncFile = can_use_async_file();
  _mod.__llamaWasmPthread = LLAMA_WASM_PTHREAD && !!sharedMem;
  return _mod;
}

/**
 * wasm-bindgen + JSPI: Rust load_model_from_path reads wasm ptr2 as vfs_path (not ptr1).
 * JS glue still maps arg2→ptr1, arg3→ptr2 — pass (model_id, opts_json, vfs_path).
 */
function wasmBindgenLoadModelFromPath(model_id, vfs_path, opts_json) {
  const fn = _mod?.load_model_from_path;
  if (!fn) throw new Error('load_model_from_path not on Emscripten module');
  fn(model_id, opts_json, vfs_path);
}

// ── Named exports (synchronous; safe to call after await initWasm()) ─────────
// These match the wasm-bindgen function names that initBindgen assigns to Module.*

/** Rust-level engine init — must be called once after the default export resolves. */
export function init() {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.init();
}

/** Load a GGUF model from bytes. */
export function load_model(model_id, bytes, opts_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.load_model(model_id, bytes, opts_json);
}

/** Unload a loaded model and release resources. */
export function unload_model(model_id) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  _modelContextIds.delete(String(model_id));
  _mod.unload_model(model_id);
  const kept = _loadedHeapfsModels.get(model_id);
  if (kept) {
    heapfsReleaseEntry(kept.path, { mode: 'heapfs', basename: kept.basename, heapId: kept.heapId });
    _loadedHeapfsModels.delete(model_id);
  }
  const asyncPath = _loadedAsyncModels.get(model_id);
  if (asyncPath) {
    asyncFileRelease(asyncPath);
    _loadedAsyncModels.delete(model_id);
  }
}

/** model_id → C++ context id (cwrap path — same pattern as llama_load_context_from_path). */
const _modelContextIds = new Map();
let _cwrapCompletion = null;

/** Emscripten 3.x / WASM i64 — cwrap and wasm-bindgen expect bigint for int64_t. */
function wasmI64Arg(value) {
  const n = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
  return n;
}

function wasmI64ToNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

function registerModelContext(model_id, context_id) {
  const id = wasmI64ToNumber(context_id);
  if (model_id && id > 0) {
    _modelContextIds.set(String(model_id), id);
  }
  const reg = _mod?.register_model_context;
  if (typeof reg === 'function') {
    try {
      try {
        reg(model_id, wasmI64Arg(id));
      } catch (_) {
        reg(model_id, id);
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.error('[llama-wasm] register_model_context failed (JS context map still set):', err);
      }
    }
  }
}

function buildCompletionParamsJson(req_json) {
  let req = {};
  try {
    req = JSON.parse(req_json || '{}');
  } catch (e) {
    throw new Error('Invalid generate request JSON: ' + (e && e.message ? e.message : String(e)));
  }
  const prompt = req.prompt != null
    ? String(req.prompt)
    : Array.isArray(req.messages)
      ? req.messages.map((m) => m.role + ': ' + m.content).join('\\n')
      : '';
  if (!prompt.trim()) {
    throw new Error('No prompt or messages provided');
  }
  return JSON.stringify({
    prompt,
    n_predict: req.max_tokens ?? req.n_predict ?? 128,
    temperature: req.temperature ?? 0.7,
    top_p: req.top_p ?? 0.95,
    top_k: req.top_k ?? 40,
    stop: req.stop ?? [],
  });
}

function resolveCompletionFn() {
  if (_cwrapCompletion) return _cwrapCompletion;
  const name = 'llama_completion';
  const wrapCall = (raw, useBigintArg) => (ctxId, paramsJson) =>
    raw(useBigintArg ? wasmI64Arg(ctxId) : Number(ctxId), paramsJson);
  if (typeof _mod.cwrap === 'function') {
    for (const argType of ['bigint', 'number']) {
      try {
        const raw = _mod.cwrap(name, 'string', [argType, 'string']);
        if (typeof raw === 'function') {
          _cwrapCompletion = wrapCall(raw, argType === 'bigint');
          return _cwrapCompletion;
        }
      } catch (_) {}
    }
  }
  const rawFn = _mod['_' + name] ?? _mod.wasmExports?.[name];
  if (typeof rawFn === 'function') {
    _cwrapCompletion = (ctxId, paramsJson) => {
      try {
        return rawFn(wasmI64Arg(ctxId), paramsJson);
      } catch (e1) {
        return rawFn(Number(ctxId), paramsJson);
      }
    };
    return _cwrapCompletion;
  }
  throw new Error('llama_completion not exported — rebuild wasm (EXPORTED_FUNCTIONS)');
}

/** Inference via C cwrap (avoids wasm-bindgen trap/undefined throw on llama_decode). */
function wasmGenerateViaCwrap(model_id, req_json) {
  const ctxId = _modelContextIds.get(String(model_id));
  if (!ctxId || ctxId <= 0) {
    throw new Error('Model not loaded (no WASM context id for ' + model_id + ')');
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (typeof console !== 'undefined') {
    console.error(
      '[llama-wasm] cwrap generate: model=' + model_id + ' ctxId=' + ctxId +
      ' wasmMB=' + wasmLinearMb(),
    );
  }
  const compJson = buildCompletionParamsJson(req_json);
  const raw = resolveCompletionFn()(ctxId, compJson);
  const elapsedMs = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  );
  if (typeof raw !== 'string') {
    throw new TypeError('llama_completion returned ' + typeof raw + ' (' + String(raw) + ')');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error('llama_completion returned non-JSON: ' + raw.slice(0, 160));
  }
  if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
    throw new Error(parsed.error);
  }
  if (typeof console !== 'undefined') {
    console.error(
      '[llama-wasm] cwrap generate ok chars=' + (parsed.text?.length ?? 0) +
      ' ms=' + elapsedMs + ' tokens=' + (parsed.tokens_predicted ?? '?'),
    );
  }
  return raw;
}

/** Run text generation. Returns JSON GenerateResponse. */
export function generate(model_id, req_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  try {
    return wasmGenerateViaCwrap(model_id, req_json);
  } catch (err) {
    throw wasmThrowToError(err, 'generate failed');
  }
}

/** Streaming generation — calls on_token(token, index) per token (JSPI when available). */
export function generate_stream(model_id, req_json, on_token) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  const fn = _mod.generate_stream;
  if (typeof fn !== 'function') {
    throw new Error('generate_stream not exported — rebuild with LLAMA_WASM_JSPI=1');
  }
  try {
    return fn(model_id, req_json, on_token);
  } catch (err) {
    throw wasmThrowToError(err, 'generate_stream failed');
  }
}

/** Generate embeddings. Returns JSON EmbedResponse. */
export function embed(model_id, req_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.embed(model_id, req_json);
}

/** Return engine health as a JSON string. */
export function health() {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.health();
}

/** Return memory usage as a JSON string. */
export function memory_snapshot() {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.memory_snapshot();
}

// ── JSPI async file read (wllama USE_ASYNC_FILE / cap-wasm-fs.cpp) ───────────
// Model bytes stay in JS (Blob / OPFS reader). C++ fread → _cap_js_file_read.
const _asyncFileHandlers = new Map();
const _loadedAsyncModels = new Map();

function stripModelsPrefix(path) {
  return String(path).replace(/^\\/?models\\//, '');
}

function enableAsyncFileEnv() {
  if (!_mod) return;
  _mod.ENV = _mod.ENV || {};
  _mod.ENV['USE_ASYNC_FILE'] = '1';
  try {
    if (typeof _mod._cap_wasm_set_use_async_file === 'function') {
      _mod._cap_wasm_set_use_async_file(1);
    } else if (typeof _mod.cwrap === 'function') {
      const setFn = _mod.cwrap('cap_wasm_set_use_async_file', null, ['number']);
      if (typeof setFn === 'function') setFn(1);
    }
  } catch (_) {}
}

function installAsyncFileBridge(mod) {
  const bridge = (path, offset, req_size, out_ptr) => {
    const name = stripModelsPrefix(path);
    const handler = _asyncFileHandlers.get(name);
    if (!handler) {
      throw new Error('async file handler missing for ' + name);
    }
    const off = Number(offset);
    const req = Number(req_size);
    const raw = handler.readSync(off, req);
    if (raw != null && typeof raw.then === 'function') {
      throw new Error(
        'async file readFn returned a Promise — use synchronous OPFS SyncAccessHandle reads',
      );
    }
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    getHeapU8().set(bytes.subarray(0, Math.min(bytes.byteLength, req)), Number(out_ptr));
    return bytes.byteLength;
  };
  globalThis._cap_js_file_read = bridge;
  if (mod) mod._cap_js_file_read = bridge;
}

function asyncFilePlaceholder(vfs_path, sizeBytes) {
  patchHeapFS();
  enableAsyncFileEnv();
  const basename = stripModelsPrefix(vfs_path);
  if (!_mod.FS.analyzePath(vfs_path).exists) {
    _mod.FS.createDataFile('/models', basename, new ArrayBuffer(0), true, true, true);
  }
  try {
    const node = _mod.FS.lookupPath(vfs_path).node;
    node.usedBytes = sizeBytes;
  } catch (_) {}
}

function asyncFileRegister(vfs_path, sizeBytes, readFn) {
  const basename = stripModelsPrefix(vfs_path);
  asyncFilePlaceholder(vfs_path, sizeBytes);
  _asyncFileHandlers.set(basename, {
    size: sizeBytes,
    readSync: (offset, len) => readFn(Number(offset), Number(len)),
  });
}

function asyncFileRelease(vfs_path) {
  const basename = stripModelsPrefix(vfs_path);
  _asyncFileHandlers.delete(basename);
  try { _mod.FS.unlink(vfs_path); } catch (_) {}
}

/**
 * Bind a JS-side reader for an async VFS path (no WASM heap copy of the full GGUF).
 * readFn(offset, length) must return Uint8Array (may be shorter at EOF).
 */
export function async_model_bind(vfs_path, size_bytes, readFn) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  if (!can_use_async_file()) {
    throw new Error('async_model_bind requires JSPI build + crossOriginIsolated (COOP/COEP)');
  }
  if (typeof size_bytes === 'number' && size_bytes > 0) {
    ensureWasmMemoryHeadroom(size_bytes);
  }
  asyncFileRegister(vfs_path, size_bytes, readFn);
  try {
    const probe = readFn(0, 4);
    if (probe != null && typeof probe.then === 'function') {
      throw new Error('async_model_bind readFn must be synchronous (use OPFS SyncAccessHandle)');
    }
    const b = probe instanceof Uint8Array ? probe : new Uint8Array(probe);
    const magic = b.byteLength >= 4
      ? String.fromCharCode(b[0], b[1], b[2], b[3])
      : '';
    if (magic !== 'GGUF' && typeof console !== 'undefined') {
      console.error(
        '[llama-wasm] async_model_bind: GGUF magic mismatch at offset 0 for ' +
        vfs_path + ': ' + JSON.stringify(magic) + ' (check OPFS reader)',
      );
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error('[llama-wasm] async_model_bind: probe read failed for ' + vfs_path, err);
    }
    throw err;
  }
}

// ── VFS streaming API (wllama HeapFS pattern) ─────────────────────────────────
// Ref: ref-code/wllama/src/workers-code/llama-cpp.js
// - mmapAlloc places GGUF bytes in WASM linear memory (not JS heap MEMFS)
// - patchHeapFS redirects MEMFS mmap/read to those bytes (zero-copy for llama)
// - Targeted mem.grow() before model init reserves headroom for vocab/KV (after HeapFS stream)

let _heapfsPatched = false;
const _heapfsNameToFile = {};
const _heapfsIdToFile = {};
let _heapfsFileId = 0;

/** Fresh HEAP view after mmapAlloc growth (wllama getHeapU8). */
function getHeapU8() {
  const buf = _mod.wasmMemory?.buffer ?? _mod.HEAPU8?.buffer;
  if (!buf) throw new Error('WASM heap not ready');
  return new Uint8Array(buf);
}

function supportsHeapFS() {
  return typeof _mod?.mmapAlloc === 'function' && _mod?.MEMFS && _mod?.FS;
}

function patchHeapFS() {
  if (_heapfsPatched || !supportsHeapFS()) return;
  _heapfsPatched = true;
  const m = _mod;
  const ops = m.MEMFS.stream_ops;
  ops._read = ops._read ?? ops.read;
  ops._write = ops._write ?? ops.write;
  ops._llseek = ops._llseek ?? ops.llseek;
  ops._allocate = ops._allocate ?? ops.allocate;
  ops._mmap = ops._mmap ?? ops.mmap;
  ops._msync = ops._msync ?? ops.msync;

  const patchStream = (stream) => {
    const name = stream.node.name;
    const f = _heapfsNameToFile[name];
    if (!f) return;
    const ptr = Number(f.ptr);
    stream.node.contents = getHeapU8().subarray(ptr, ptr + f.size);
    stream.node.usedBytes = f.size;
  };

  ops.read = function (stream, buffer, offset, length, position) {
    patchStream(stream);
    return ops._read(stream, buffer, offset, length, position);
  };
  m.MEMFS.ops_table.file.stream.read = ops.read;

  ops.llseek = function (stream, off, whence) {
    patchStream(stream);
    return ops._llseek(stream, off, whence);
  };
  m.MEMFS.ops_table.file.stream.llseek = ops.llseek;

  ops.mmap = function (stream, length, position, prot, flags) {
    patchStream(stream);
    const name = stream.node.name;
    const f = _heapfsNameToFile[name];
    if (f) {
      return { ptr: Number(f.ptr) + Number(position), allocated: false };
    }
    return ops._mmap(stream, length, position, prot, flags);
  };
  m.MEMFS.ops_table.file.stream.mmap = ops.mmap;

  try {
    if (!m.FS.analyzePath('/models').exists) {
      if (m.FS.createPath) {
        m.FS.createPath('/', 'models', true, true);
      } else {
        m.FS.mkdir('/models');
      }
    }
    m.FS.mount(m.MEMFS, { root: '.' }, '/models');
  } catch (_) {}
}

function heapfsAlloc(name, size) {
  const ptr = _mod.mmapAlloc(size);
  const file = { ptr: Number(ptr), size, id: _heapfsFileId++ };
  _heapfsIdToFile[file.id] = file;
  _heapfsNameToFile[name] = file;
  return file.id;
}

function heapfsWrite(id, buffer, offset) {
  const f = _heapfsIdToFile[id];
  if (!f) throw new Error('HeapFS file id ' + id + ' not found');
  const after = offset + buffer.byteLength;
  if (after > f.size) {
    throw new Error('HeapFS write out of bounds: ' + after + ' > ' + f.size);
  }
  getHeapU8().set(buffer, Number(f.ptr) + offset);
  return buffer.byteLength;
}

/** Ensure MEMFS /tmp exists (legacy fallback path). */
function ensureMemfsTmp() {
  const fs = _mod?.FS;
  if (!fs) {
    throw new Error('Emscripten FS not ready — cannot create /tmp for model streaming');
  }
  if (!fs.analyzePath('/tmp').exists) {
    if (typeof fs.createPath === 'function') {
      fs.createPath('/', 'tmp', true, true);
    } else {
      fs.mkdir('/tmp');
    }
  }
  if (!fs.analyzePath('/tmp').exists) {
    throw new Error('Failed to create MEMFS /tmp for model VFS streaming');
  }
}

const _jsVfsStreams = new Map();
/** Keep HeapFS mmap alive for loaded models (wllama never unlinks until exit). */
const _loadedHeapfsModels = new Map();
let _jsVfsCounter = 0;

function effectiveNctx(modelBytes, opts_json) {
  let n_ctx = 1024;
  try {
    const opts = JSON.parse(opts_json || '{}');
    if (typeof opts.n_ctx === 'number' && opts.n_ctx > 0) n_ctx = opts.n_ctx;
  } catch (_) {}
  if (modelBytes > 500 * 1024 * 1024) {
    n_ctx = Math.min(n_ctx, 512);
  }
  if (modelBytes > 600 * 1024 * 1024) {
    // Recurrent/hybrid models (e.g. LFM2) use tiny KV — keep n_ctx high enough for chat templates.
    n_ctx = Math.min(n_ctx, 512);
  } else if (modelBytes > 500 * 1024 * 1024) {
    n_ctx = Math.min(n_ctx, 256);
  }
  return n_ctx;
}

function heapfsReleaseEntry(vfs_path, entry) {
  if (!entry || entry.mode !== 'heapfs') return;
  if (entry.basename) {
    delete _heapfsNameToFile[entry.basename];
    if (entry.heapId != null) delete _heapfsIdToFile[entry.heapId];
  }
  try {
    _mod.FS.unlink(vfs_path);
  } catch (_) {}
}

/** Re-attach MEMFS node views after wasmMemory.grow() (old TypedArrays are detached). */
function heapfsResyncViews() {
  if (!supportsHeapFS()) return;
  patchHeapFS();
  const heap = getHeapU8();
  for (const name in _heapfsNameToFile) {
    const f = _heapfsNameToFile[name];
    if (!f) continue;
    const ptr = Number(f.ptr);
    const slice = heap.subarray(ptr, ptr + f.size);
    try {
      const node = _mod.FS.lookupPath('/models/' + name).node;
      node.contents = slice;
      node.usedBytes = f.size;
    } catch (_) {}
  }
}

/** Sync MEMFS node size + verify GGUF magic before C++ fopen/mmap (wllama pattern). */
function heapfsFinalizeForLoad(vfs_path, basename, expectedBytes) {
  const f = _heapfsNameToFile[basename];
  if (!f) {
    throw new Error('heapfs finalize: missing entry for ' + basename);
  }
  patchHeapFS();
  const ptr = Number(f.ptr);
  const heap = getHeapU8();
  if (heap.byteLength < ptr + 4) {
    throw new Error('heapfs finalize: ptr out of heap bounds ' + ptr);
  }
  const magic = String.fromCharCode(heap[ptr], heap[ptr + 1], heap[ptr + 2], heap[ptr + 3]);
  if (magic !== 'GGUF') {
    throw new Error('heapfs GGUF magic mismatch at ' + vfs_path + ': ' + JSON.stringify(magic));
  }
  const node = _mod.FS.lookupPath(vfs_path).node;
  node.contents = heap.subarray(ptr, ptr + f.size);
  node.usedBytes = f.size;
  const st = _mod.FS.stat(vfs_path);
  const fd = _mod.FS.open(vfs_path, 'r');
  const endPos = _mod.FS.llseek(fd, 0, 2);
  _mod.FS.close(fd);
  if (typeof console !== 'undefined') {
    console.error(
      '[llama-wasm] heapfs finalize: path=' + vfs_path +
      ' stat=' + st.size + ' llseek=' + endPos +
      ' expected=' + expectedBytes,
    );
  }
  if (endPos !== expectedBytes) {
    throw new Error(
      'heapfs file size mismatch at ' + vfs_path + ': llseek=' + endPos + ' expected=' + expectedBytes,
    );
  }
}

let _cwrapLoadContextFromPath = null;

function resolveLoadContextFromPathFn() {
  if (_cwrapLoadContextFromPath) return _cwrapLoadContextFromPath;
  const name = 'llama_load_context_from_path';
  const tryFns = [];
  if (typeof _mod.cwrap === 'function') {
    tryFns.push(() => _mod.cwrap(name, 'bigint', ['string', 'string']));
    tryFns.push(() => _mod.cwrap(name, 'number', ['string', 'string']));
  }
  if (_mod.wasmExports?.[name]) {
    tryFns.push(() => _mod.wasmExports[name]);
  }
  if (typeof _mod['_' + name] === 'function') {
    tryFns.push(() => _mod['_' + name]);
  }
  for (const get of tryFns) {
    try {
      const raw = get();
      if (typeof raw === 'function') {
        _cwrapLoadContextFromPath = (path, opts) => wasmI64ToNumber(raw(path, opts));
        return _cwrapLoadContextFromPath;
      }
    } catch (_) {}
  }
  throw new Error('llama_load_context_from_path not exported (cwrap/wasmExports)');
}

/** Load via C bridge (avoids bindgen throw on trap) + register context in Rust. */
function wasmLoadContextFromPath(model_id, vfs_path, opts_json) {
  enableAsyncFileEnv();
  const loadFn = resolveLoadContextFromPathFn();
  if (typeof console !== 'undefined') {
    console.error('[llama-wasm] cwrap load: path=' + vfs_path + ' wasmMB=' + wasmLinearMb());
  }
  const ctxId = loadFn(vfs_path, opts_json);
  if (typeof console !== 'undefined') {
    console.error('[llama-wasm] cwrap load result: ctxId=' + ctxId + ' wasmMB=' + wasmLinearMb());
  }
  if (ctxId <= 0) {
    throw new Error(
      'llama_load_context_from_path returned ' + ctxId + ' for ' + vfs_path +
      ' wasmMB=' + wasmLinearMb() +
      (tailWasmStderr() ? ' | llama: ' + tailWasmStderr() : ''),
    );
  }
  registerModelContext(model_id, ctxId);
  return;
}

function wasmThrowToError(err, context) {
  const WasmException = typeof WebAssembly !== 'undefined' && WebAssembly.Exception;
  const stderrTail = tailWasmStderr();
  const memNote = ' wasmMB=' + wasmLinearMb();
  if (WasmException && err instanceof WasmException) {
    let msg = 'WebAssembly.Exception (likely OOM during model/context init — try closing other tabs)';
    try {
      if (err.message) msg = String(err.message);
    } catch (_) {}
    if (stderrTail) msg += ' | llama: ' + stderrTail;
    return new Error(context + ': ' + msg + memNote);
  }
  if (err instanceof WebAssembly.RuntimeError) {
    const msg = err.message || 'WebAssembly runtime error (likely OOM during model load)';
    let suffix = msg;
    if (stderrTail) suffix += ' | llama: ' + stderrTail;
    return new Error(context + ': ' + suffix + memNote);
  }
  if (err instanceof Error && err.message && err.message !== 'undefined') {
    if (stderrTail) err.message += ' | llama: ' + stderrTail;
    err.message += memNote;
    return err;
  }
  const detail =
    typeof err === 'string' ? err :
    err instanceof Error ? err.message :
    err == null ? '' : String(err);
  let suffix = detail && detail !== 'undefined' ? detail :
    'WASM trap during inference (OOM/stack in llama_decode — close other tabs and reload model)';
  if (stderrTail) suffix += ' | llama: ' + stderrTail;
  return new Error(context + ': ' + suffix + memNote);
}

function vfsStatBytes(path) {
  try {
    const st = _mod.FS.stat(path);
    return typeof st.size === 'number' ? st.size : 0;
  } catch (_) {
    return -1;
  }
}

function wasmLinearMb() {
  try {
    const buf = _mod.wasmMemory?.buffer ?? _mod.HEAPU8?.buffer;
    return buf ? +(buf.byteLength / 1024 / 1024).toFixed(1) : 0;
  } catch (_) {
    return 0;
  }
}

const WASM_MAX_BYTES = 2147483648;

function wasmMemoryTarget(modelBytes) {
  // Large GGUF: grow to the 2GB cap so load_tensors has peak headroom (697MB file + mmap metadata + KV).
  if (modelBytes > 600 * 1024 * 1024) {
    return WASM_MAX_BYTES;
  }
  if (modelBytes > 400 * 1024 * 1024) {
    return Math.min(modelBytes + 1024 * 1024 * 1024, WASM_MAX_BYTES);
  }
  // Small embed models: context init can spike past modelBytes+512MB; grow to 1GB when heap is still 832MB.
  if (modelBytes < 100 * 1024 * 1024) {
    return Math.min(Math.max(modelBytes + 512 * 1024 * 1024, 1024 * 1024 * 1024), WASM_MAX_BYTES);
  }
  return Math.min(modelBytes + 512 * 1024 * 1024, WASM_MAX_BYTES);
}

/** Reserve headroom for vocab, BPE ranks, and KV cache after HeapFS stream (avoids OOB on malloc). */
function ensureWasmMemoryHeadroom(modelBytes) {
  if (!_mod || !(modelBytes > 0)) return;
  const current = _mod.HEAPU8?.length ?? _mod.wasmMemory?.buffer?.byteLength ?? 0;
  const target = wasmMemoryTarget(modelBytes);
  if (current >= target) return;

  let grown = false;
  if (typeof _mod.growMemory === 'function') {
    grown = _mod.growMemory(target) === 1;
  } else if (typeof _mod.emscripten_resize_heap === 'function') {
    grown = !!_mod.emscripten_resize_heap(target);
  }
  if (!grown) {
    throw new Error('[llama-wasm] failed to grow wasm memory to ' + target + ' bytes (have ' + current + ')');
  }
  heapfsResyncViews();
  const after = _mod.HEAPU8?.length ?? _mod.wasmMemory?.buffer?.byteLength ?? 0;
  if (typeof console !== 'undefined') {
    console.error(
      '[llama-wasm] memory grow: ' + (current / 1048576).toFixed(0) + 'MB -> ' +
      (after / 1048576).toFixed(0) + 'MB (model=' + (modelBytes / 1048576).toFixed(0) + 'MB)',
    );
  }
}

/** Begin HeapFS stream — mmapAlloc grows Emscripten memory (wllama fs.alloc). */
function heapfsStreamBegin(totalBytes, opts_json) {
  patchHeapFS();
  if (typeof console !== 'undefined') {
    console.error(
      '[llama-wasm] HeapFS begin: modelMB=' + (totalBytes / 1048576).toFixed(1) +
      ' wasmMB=' + wasmLinearMb() + ' (mmapAlloc will grow as needed)',
    );
  }
  const basename = 'wasm_stream_' + (_jsVfsCounter++) + '.gguf';
  _mod.FS.createDataFile('/models', basename, new ArrayBuffer(0), true, true, true);
  const heapId = heapfsAlloc(basename, totalBytes);
  const path = '/models/' + basename;
  _jsVfsStreams.set(path, { mode: 'heapfs', heapId, basename, offset: 0, size: totalBytes });
  return path;
}

/** Begin streaming a model into WASM VFS. Pass total_bytes + opts_json for HeapFS pre-grow. */
function asyncFileStreamBegin(totalBytes) {
  patchHeapFS();
  enableAsyncFileEnv();
  if (typeof totalBytes === 'number' && totalBytes > 0) {
    ensureWasmMemoryHeadroom(totalBytes);
  }
  const basename = 'wasm_async_' + (_jsVfsCounter++) + '.gguf';
  const path = '/models/' + basename;
  asyncFilePlaceholder(path, totalBytes);
  _jsVfsStreams.set(path, { mode: 'async', basename, size: totalBytes, bound: false });
  if (typeof console !== 'undefined') {
    console.error(
      '[llama-wasm] JSPI async begin: modelMB=' + (totalBytes / 1048576).toFixed(1) +
      ' wasmMB=' + wasmLinearMb() + ' (no full-model heap copy)',
    );
  }
  return path;
}

function jsModelVfsBegin(totalBytes, opts_json) {
  if (can_use_async_file() && typeof totalBytes === 'number' && totalBytes > 0) {
    return asyncFileStreamBegin(totalBytes);
  }
  if (typeof totalBytes === 'number' && totalBytes > 0 && supportsHeapFS()) {
    return heapfsStreamBegin(totalBytes, opts_json);
  }
  ensureMemfsTmp();
  const path = '/tmp/wasm_stream_' + (_jsVfsCounter++) + '.gguf';
  const stream = _mod.FS.open(path, 'w');
  _jsVfsStreams.set(path, { mode: 'memfs', stream, offset: 0 });
  return path;
}

function jsModelVfsWrite(path, chunk) {
  const entry = _jsVfsStreams.get(path);
  if (!entry) {
    throw new Error('model_vfs_write: no open stream for ' + path);
  }
  if (!chunk || chunk.byteLength === 0) return;
  const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  if (entry.mode === 'async') {
    throw new Error(
      'model_vfs_write on async path: use async_model_bind() instead of streaming into WASM heap',
    );
  }
  try {
    if (entry.mode === 'heapfs') {
      heapfsWrite(entry.heapId, buf, entry.offset);
    } else {
      _mod.FS.write(entry.stream, buf, 0, buf.byteLength, entry.offset);
    }
    entry.offset += buf.byteLength;
  } catch (err) {
    throw wasmThrowToError(err, 'VFS write failed at offset ' + entry.offset + ' for ' + path);
  }
}

function jsModelVfsClose(path) {
  const entry = _jsVfsStreams.get(path);
  if (!entry) return;
  if (entry.mode === 'memfs' && entry.stream) {
    _mod.FS.close(entry.stream);
  }
}

function jsModelVfsAbort(path) {
  const entry = _jsVfsStreams.get(path);
  jsModelVfsClose(path);
  _jsVfsStreams.delete(path);
  if (entry?.mode === 'heapfs' && entry.basename) {
    delete _heapfsNameToFile[entry.basename];
    if (entry.heapId != null) delete _heapfsIdToFile[entry.heapId];
  } else if (entry?.mode === 'async') {
    asyncFileRelease(path);
  }
  try {
    _mod.FS.unlink(path);
  } catch (_) {}
}

function vfsLoadOptsJson(opts_json, mode, modelBytes) {
  let opts = {};
  try {
    opts = JSON.parse(opts_json || '{}');
  } catch (_) {}
  opts.n_threads = 1;
  const embedding = opts.embedding === true || opts.embedding === 'true';
  if (embedding) {
    if (opts.n_ctx == null || opts.n_ctx > 256) {
      opts.n_ctx = 256;
    }
    if (opts.n_batch == null || opts.n_batch > 32) {
      opts.n_batch = 32;
    }
  } else if (modelBytes < 100 * 1024 * 1024) {
    if (opts.n_ctx == null || opts.n_ctx > 256) {
      opts.n_ctx = 256;
    }
    if (opts.n_batch == null || opts.n_batch > 32) {
      opts.n_batch = 32;
    }
  }
  if (mode === 'heapfs') {
    opts.use_mmap = true;
    opts.n_ctx = effectiveNctx(modelBytes, opts_json);
    if (opts.n_batch == null || opts.n_batch > 128) {
      opts.n_batch = 128;
    }
    if (modelBytes > 600 * 1024 * 1024 && (opts.n_batch == null || opts.n_batch > 64)) {
      opts.n_batch = 64;
    }
  } else if (mode === 'async') {
    opts.use_mmap = false;
    opts.n_ctx = effectiveNctx(modelBytes, opts_json);
    if (modelBytes > 600 * 1024 * 1024) {
      // 65536 vocab × n_batch logits buffer — keep small at 2GB heap after full weight copy.
      if (opts.n_batch == null || opts.n_batch > 16) {
        opts.n_batch = 16;
      }
    } else if (opts.n_batch == null || opts.n_batch > 128) {
      opts.n_batch = 128;
    }
    if (modelBytes > 500 * 1024 * 1024 && modelBytes <= 600 * 1024 * 1024 &&
        (opts.n_batch == null || opts.n_batch > 64)) {
      opts.n_batch = 64;
    }
  } else if (opts.use_mmap == null) {
    opts.use_mmap = false;
  }
  return JSON.stringify(opts);
}

/** Begin streaming a model into WASM VFS. Pass total_bytes + opts_json for HeapFS pre-grow. */
export function model_vfs_begin(total_bytes, opts_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return jsModelVfsBegin(total_bytes, opts_json);
}

/** Append a chunk to an in-progress VFS model write. */
export function model_vfs_write(vfs_path, chunk) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  jsModelVfsWrite(vfs_path, chunk);
}

/** Abort a partial VFS write and remove the temp file. */
export function model_vfs_abort(vfs_path) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  jsModelVfsAbort(vfs_path);
}

/** Finish a streamed VFS write and load the model. HeapFS mmap stays alive until unload. */
export function load_model_from_vfs(model_id, vfs_path, opts_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  const entry = _jsVfsStreams.get(vfs_path);
  const mode = entry?.mode ?? 'memfs';
  jsModelVfsClose(vfs_path);
  const bytes = mode === 'heapfs' || mode === 'async'
    ? (entry?.size ?? 0)
    : vfsStatBytes(vfs_path);
  if (bytes <= 0) {
    throw new Error('VFS model file missing or empty after stream: ' + vfs_path + ' (bytes=' + bytes + ')');
  }
  if (mode === 'async') {
    const basename = entry?.basename ?? stripModelsPrefix(vfs_path);
    if (!_asyncFileHandlers.has(basename)) {
      throw new Error(
        'async VFS path not bound — call async_model_bind() before load_model_from_vfs: ' + vfs_path,
      );
    }
  }
  const loadOpts = vfsLoadOptsJson(opts_json, mode, bytes);
  if (typeof console !== 'undefined') {
    console.error(
      '[llama-wasm] load_model_from_vfs: mode=' + mode +
      ' wasmMB=' + wasmLinearMb() + ' opts=' + loadOpts,
    );
  }
  _jsVfsStreams.delete(vfs_path);
  try {
    if (mode === 'heapfs') {
      ensureWasmMemoryHeadroom(bytes);
      heapfsFinalizeForLoad(vfs_path, entry.basename, bytes);
    } else if (mode === 'async') {
      enableAsyncFileEnv();
      ensureWasmMemoryHeadroom(bytes);
    }
    wasmLoadContextFromPath(model_id, vfs_path, loadOpts);
    if (mode === 'heapfs' && entry?.basename) {
      _loadedHeapfsModels.set(model_id, {
        path: vfs_path,
        basename: entry.basename,
        heapId: entry.heapId,
      });
    } else if (mode === 'async') {
      _loadedAsyncModels.set(model_id, vfs_path);
    }
  } catch (err) {
    if (mode === 'heapfs') {
      heapfsReleaseEntry(vfs_path, entry);
    } else if (mode === 'async') {
      asyncFileRelease(vfs_path);
    } else {
      try {
        _mod.FS.unlink(vfs_path);
      } catch (_) {}
    }
    throw wasmThrowToError(
      err,
      'load_model_from_vfs failed for ' + vfs_path + ' (' + bytes + ' bytes, mode=' + mode + ', wasmMb=' + wasmLinearMb() + ')',
    );
  }
}

/** Load from an existing VFS path (HeapFS — zero-copy mmap). */
export function load_model_from_path(model_id, vfs_path, opts_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  wasmBindgenLoadModelFromPath(model_id, vfs_path, opts_json);
}
`;
await writeFile(jsOutPath, shimSrc);

// ── 4. TypeScript declarations ────────────────────────────────────────────────
const dtsSrc = `/* @ts-self-types="./llama_engine.d.ts" */
/* eslint-disable */
/* tslint:disable */

/**
 * Public API of the llama_engine Wasm module.
 * Consumed by src/workers/wasm.engine.ts.
 */

/** Rust-level engine initialiser — call once after the default export resolves. */
export function init(): void;

/** Load a GGUF model from raw bytes. */
export function load_model(model_id: string, bytes: Uint8Array, opts_json: string): void;

/** Unload a loaded model and free resources. */
export function unload_model(model_id: string): void;

/** Run text generation. Returns JSON-serialised GenerateResponse. */
export function generate(model_id: string, req_json: string): string;

/** Streaming generation with per-token callback (JSPI build). */
export function generate_stream(
  model_id: string,
  req_json: string,
  on_token: (token: string, index: number) => void,
): string;

/** Generate text embeddings. Returns JSON-serialised EmbedResponse. */
export function embed(model_id: string, req_json: string): string;

/** Engine health status as a JSON string. */
export function health(): string;

/** Current memory usage as a JSON string. */
export function memory_snapshot(): string;

/** Begin streaming a model into MEMFS. Returns the temp VFS path. */
export function model_vfs_begin(total_bytes?: number, opts_json?: string): string;
/** Append a chunk to an in-progress VFS model write. */
export function model_vfs_write(vfs_path: string, chunk: Uint8Array): void;
/** Abort a partial VFS write and remove the temp file. */
export function model_vfs_abort(vfs_path: string): void;
/** Finish a streamed VFS write and load the model (deletes the VFS file). */
export function load_model_from_vfs(model_id: string, vfs_path: string, opts_json: string): void;
/** Load from an existing VFS path (HeapFS zero-copy mmap). */
export function load_model_from_path(model_id: string, vfs_path: string, opts_json: string): void;
/** Bind JS-side reader for JSPI async load (no full-model WASM heap copy). */
export function async_model_bind(
  vfs_path: string,
  size_bytes: number,
  readFn: (offset: number, length: number) => Uint8Array,
): void;
/** True when this build includes sync external fread (cap-wasm-fs). Does not require native JSPI. */
export function can_use_async_file(): boolean;
/** Raw Emscripten module (for HeapFS helpers). */
export function getEmscriptenModule(): unknown;

/**
 * Default export — loads and instantiates the WebAssembly module.
 * Resolves the .wasm binary relative to import.meta.url when called without arguments.
 */
export default function initWasm(
  pathHint?: string | URL,
): Promise<unknown>;
`;
await writeFile(dtsOutPath, dtsSrc);

// ── 5. package.json ───────────────────────────────────────────────────────────
const pkgJson = {
  name: engineName,
  type: 'module',
  description: 'Embedded llama.cpp Wasm runtime for llama-cpp-capacitor (web/PWA)',
  version: '0.1.0',
  license: 'MIT',
  files: [
    `${engineName}.wasm`,
    `${engineName}.js`,
    `${engineName}.d.ts`,
    `${engineName}_emscripten.mjs`,
  ],
  main: `${engineName}.js`,
  types: `${engineName}.d.ts`,
  sideEffects: [],
};
await writeFile(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);

// ── 6. Clean up wasm-bindgen side files we no longer ship ────────────────────
// Note: llama_engine.d.ts is NOT in this list — we already wrote our own above.
const stale = [
  resolve(wasmPkgDir, 'library_bindgen.js'),
  resolve(wasmPkgDir, `${engineName}_bg.wasm`),
  resolve(wasmPkgDir, `${engineName}_bg.wasm.d.ts`),
];
for (const p of stale) { await rm(p, { force: true }); }

// ── 7. Final validation ───────────────────────────────────────────────────────
await requireFile(jsOutPath,      'ESM shim (llama_engine.js)');
await requireFile(wasmOutPath,    'wasm binary (llama_engine.wasm)');
await requireFile(dtsOutPath,     'TypeScript declarations (llama_engine.d.ts)');
await requireFile(pkgJsonPath,    'package manifest (package.json)');
await requireFile(emscriptenMjs,  'emcc runtime (llama_engine_emscripten.mjs)');

const finalJs = await readFile(jsOutPath, 'utf8');
if (/import\s+\*\s+as\s+import\d+\s+from\s+["']env["']/m.test(finalJs.slice(0, 4096))) {
  fail('Generated JS contains broken Emscripten import lines — Stage 4 may have failed.');
}
if (!finalJs.includes('export default') || !finalJs.includes('export function init') || !finalJs.includes('export function load_model')) {
  fail('Generated JS is missing expected ES module exports.');
}
if (!finalJs.includes(`${engineName}_emscripten.mjs`)) {
  fail(`Generated JS does not import ${engineName}_emscripten.mjs`);
}
{
  const mjsCheck = await readFile(emscriptenMjs, 'utf8');
  if (!mjsCheck.includes('__wbindgen_add_to_stack_pointer:(d)=>')) {
    fail('Emscripten mjs missing wasm-bindgen shim patch after Asyncify.instrumentWasmExports');
  }
  if (!mjsCheck.includes('deferred2_0!=null&&deferred2_0!==0')) {
    fail('Emscripten mjs missing wasm-bindgen finally dealloc guards');
  }
  if (!mjsCheck.includes('cap_wasm_dylink_common_init_from_params')) {
    fail('Emscripten mjs missing cap_wasm_dylink common_init stub wire');
  }
  if (mjsCheck.includes('_f=asyncifyStubs[')) {
    fail('Emscripten mjs must not use recursive dylink stub lazy fallback');
  }
}

console.log('[package-embed-wasm] Wasm package ready:');
console.log(`  Shim : ${jsOutPath}`);
console.log(`  Wasm : ${wasmOutPath}  (${emscriptenWasmBytes.toLocaleString()} bytes)`);
console.log(`  ESM  : ${emscriptenMjs}`);
console.log(`  d.ts : ${dtsOutPath}`);
