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

// ── 1c. Verify WASM memory section: initial pages must cover 832 MB ──────────
// INITIAL_MEMORY=872415232 / 65536 bytes/page = 13312 pages.
// Pthread builds use IMPORTED_MEMORY=1 — memory is supplied by the JS shim via
// SharedArrayBuffer, so there is no Memory section in the wasm binary.
{
  const MIN_WASM_PAGES = 13312; // 872_415_232 / 65_536
  if (BUILD_PTHREAD) {
    console.log(
      '[package-embed-wasm] WASM memory: pthread build uses IMPORTED_MEMORY ' +
      `(832 MB SharedArrayBuffer from shim, min ${MIN_WASM_PAGES} pages) ✓`,
    );
  } else {
  const wasmBytes = new Uint8Array(emscriptenWasmBuf.buffer);
  // Scan for the Memory section (id = 5) in the WASM binary.
  // Layout: magic(4) + version(4) + sections...
  // Each section: [id:u8][size:uleb128][...payload]
  // Memory section payload: [count:uleb128][{flags:u8, initial:uleb128, ...}]
  let foundPages = null;
  let pos = 8; // skip magic + version
  while (pos < wasmBytes.length) {
    const sectionId = wasmBytes[pos++];
    let sectionSize = 0, shift = 0, b;
    do { b = wasmBytes[pos++]; sectionSize |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    if (sectionId === 5) { // Memory section
      let p = pos;
      // count (uleb128) — number of memory definitions
      let count = 0; shift = 0;
      do { b = wasmBytes[p++]; count |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      if (count > 0) {
        const flags = wasmBytes[p++]; // 0=no max, 1=has max, 2=shared+max, 4=memory64
        let initial = 0; shift = 0;
        do { b = wasmBytes[p++]; initial |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
        foundPages = initial;
      }
      break;
    }
    pos += sectionSize;
  }
  if (foundPages === null) {
    fail('Could not find WASM Memory section in llama_engine_emscripten.wasm — binary may be malformed.');
  }
  if (foundPages < MIN_WASM_PAGES) {
    fail(
      `WASM Memory section has only ${foundPages} initial pages (${(foundPages * 65536 / 1024 / 1024).toFixed(0)} MB). ` +
      `Expected at least ${MIN_WASM_PAGES} pages (832 MB) for 700+ MB model support. ` +
      `Rebuild with: -sINITIAL_MEMORY=872415232 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648`,
    );
  }
  console.log(`[package-embed-wasm] WASM memory: ${foundPages} initial pages (${(foundPages * 65536 / 1024 / 1024).toFixed(0)} MB) ✓`);
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
const LLAMA_WASM_JSPI = ${BUILD_JSPI};
const LLAMA_WASM_PTHREAD = ${BUILD_PTHREAD};

/** Shared WASM memory for pthread builds (wllama-style). Requires COOP/COEP. */
function trySharedWasmMemory() {
  if (!LLAMA_WASM_PTHREAD) return null;
  if (globalThis.crossOriginIsolated !== true || typeof SharedArrayBuffer === 'undefined') {
    return null;
  }
  const minBytes = 872415232;
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
  const pthreadPoolSize = sharedMem && navigator.hardwareConcurrency
    ? Math.max(2, Math.floor(navigator.hardwareConcurrency / 2))
    : 4;

  const modulePromise = createLlamaModule({
    ...(sharedMem ? {
      wasmMemory: sharedMem,
      pthreadPoolSize,
      mainScriptUrlOrBlob: new URL('./${engineName}_emscripten.mjs', import.meta.url),
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

        // instance.exports is a sealed object — we cannot add properties to it.
        // The emscripten MAIN_MODULE does not export the wasm-bindgen ABI shims
        // that library_bindgen.js expects under these names.  Proxy the instance
        // so that wasmExports = instance.exports inside receiveInstance picks
        // up a patched view that adds the missing symbols transparently.
        const sp = exports.__stack_pointer; // mutable i32 global (shadow stack)
        let cachedExportsProxy = null;
        const patchedInstance = new Proxy(result.instance, {
          get(target, prop) {
            if (prop !== 'exports') return target[prop];
            if (!cachedExportsProxy) {
              cachedExportsProxy = new Proxy(target.exports, {
                get(ex, p) {
                  switch (p) {
                    // Shadow-stack allocator used by wasm-bindgen ABI
                    case '__wbindgen_add_to_stack_pointer':
                      return (delta) => {
                        const v = (sp.value + delta) | 0;
                        sp.value = v;
                        return v;
                      };
                    // wasm-bindgen canonical export aliases → actual WASM exports
                    case '__wbindgen_export2': return ex.__wbindgen_malloc;
                    case '__wbindgen_export3': return ex.__wbindgen_realloc;
                    case '__wbindgen_export4': return ex.__wbindgen_free;
                    // handleError in wasm-bindgen emscripten glue calls
                    // wasm.__wbindgen_export(heapIdx) to store a caught JS
                    // exception so Rust can retrieve it via the error out-ptr.
                    // The actual WASM export is __wbindgen_exn_store.
                    case '__wbindgen_export': return ex.__wbindgen_exn_store;
                    default: return ex[p];
                  }
                },
              });
            }
            return cachedExportsProxy;
          },
        });

        successCallback(patchedInstance, result.module);
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
  _mod.__llamaWasmJspi = LLAMA_WASM_JSPI;
  _mod.__llamaWasmPthread = LLAMA_WASM_PTHREAD && !!sharedMem;
  return _mod;
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
  return _mod.unload_model(model_id);
}

/** Run text generation. Returns JSON GenerateResponse. */
export function generate(model_id, req_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.generate(model_id, req_json);
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

// ── VFS streaming API (preferred over load_model for large models) ────────────
// These allow writing the GGUF in chunks via Emscripten MEMFS, which keeps
// peak WASM heap usage at ~1.4 GB instead of ~2.1 GB for a 697 MB model.

/** Begin streaming a model into MEMFS. Returns the temp VFS path. */
export function model_vfs_begin() {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.model_vfs_begin();
}

/** Append a chunk to an in-progress VFS model write. */
export function model_vfs_write(vfs_path, chunk) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.model_vfs_write(vfs_path, chunk);
}

/** Abort a partial VFS write and remove the temp file. */
export function model_vfs_abort(vfs_path) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.model_vfs_abort(vfs_path);
}

/** Finish a streamed VFS write and load the model (deletes the VFS file). */
export function load_model_from_vfs(model_id, vfs_path, opts_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.load_model_from_vfs(model_id, vfs_path, opts_json);
}

/** Load from an existing VFS path (HeapFS — zero-copy mmap). */
export function load_model_from_path(model_id, vfs_path, opts_json) {
  if (!_mod) throw new Error('llama_engine not ready — await init() first');
  return _mod.load_model_from_path(model_id, vfs_path, opts_json);
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

/** Generate text embeddings. Returns JSON-serialised EmbedResponse. */
export function embed(model_id: string, req_json: string): string;

/** Engine health status as a JSON string. */
export function health(): string;

/** Current memory usage as a JSON string. */
export function memory_snapshot(): string;

/** Begin streaming a model into MEMFS. Returns the temp VFS path. */
export function model_vfs_begin(): string;
/** Append a chunk to an in-progress VFS model write. */
export function model_vfs_write(vfs_path: string, chunk: Uint8Array): void;
/** Abort a partial VFS write and remove the temp file. */
export function model_vfs_abort(vfs_path: string): void;
/** Finish a streamed VFS write and load the model (deletes the VFS file). */
export function load_model_from_vfs(model_id: string, vfs_path: string, opts_json: string): void;
/** Load from an existing VFS path (HeapFS zero-copy mmap). */
export function load_model_from_path(model_id: string, vfs_path: string, opts_json: string): void;
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

console.log('[package-embed-wasm] Wasm package ready:');
console.log(`  Shim : ${jsOutPath}`);
console.log(`  Wasm : ${wasmOutPath}  (${emscriptenWasmBytes.toLocaleString()} bytes)`);
console.log(`  ESM  : ${emscriptenMjs}`);
console.log(`  d.ts : ${dtsOutPath}`);
