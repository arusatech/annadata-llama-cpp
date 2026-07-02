type GenerateRequest = {
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
};

type GenerateResult = {
  text: string;
  tokens_predicted: number;
  tokens_evaluated: number;
  finish_reason: 'stop' | 'length' | 'error';
};

type EmbedResult = {
  vectors: number[][];
};

export type TokenizeResult = { tokens: number[]; has_media?: boolean };
export type DetokenizeResult = { text: string };

import {
  canUseAsyncFileRead,
  asyncReaderFromBytes,
} from './async-file';
import {
  ensureWasmTmpDir,
  heapfsAlloc,
  heapfsModelPath,
  heapfsWrite,
  patchHeapFS,
  supportsHeapFS,
  type EmscriptenModule,
} from './heapfs';

export type WasmEngine = {
  init?: () => Promise<void> | void;
  loadModel: (modelId: string, modelBuffer: ArrayBuffer, opts?: Record<string, unknown>) => Promise<void> | void;
  /** Stream from OPFS sync handle without holding full model in JS heap (#9). */
  loadModelFromOpfsReader?: (
    modelId: string,
    reader: { sizeBytes: number; readChunk: (offset: number, length?: number) => Uint8Array; close: () => void },
    opts?: Record<string, unknown>,
  ) => Promise<void> | void;
  unloadModel: (modelId: string) => Promise<void> | void;
  generate: (
    modelId: string,
    req: GenerateRequest,
    onToken?: (token: string, index: number) => void,
  ) => Promise<GenerateResult> | GenerateResult;
  embed: (modelId: string, input: string | string[]) => Promise<EmbedResult> | EmbedResult;
  /** Tokenize text using the loaded model vocabulary. */
  tokenize?: (modelId: string, text: string) => Promise<TokenizeResult> | TokenizeResult;
  /** Detokenize a token ID array back to text. */
  detokenize?: (modelId: string, tokens: number[]) => Promise<DetokenizeResult> | DetokenizeResult;
  /** Convert a JSON Schema to a GBNF grammar string for constrained sampling. */
  convertJsonSchemaToGrammar?: (schemaJson: string) => Promise<string> | string;
  rerank?: (modelId: string, query: string, documents: string[]) => Promise<Array<{ index: number; score: number }>>;
  bench?: (modelId: string, pp: number, tg: number, pl: number, nr: number) => Promise<string>;
  saveSession?: (modelId: string, filepath: string, tokenSize: number) => Promise<{ tokens_saved: number }>;
  loadSession?: (modelId: string, filepath: string) => Promise<{ tokens_loaded: number; prompt: string }>;
  applyLoraAdapters?: (modelId: string, loraAdapters: Array<{ path: string; scaled?: number }>) => Promise<void>;
  removeLoraAdapters?: (modelId: string) => Promise<void>;
  getLoadedLoraAdapters?: (modelId: string) => Promise<Array<{ path: string; scaled?: number }>>;
  initMultimodal?: (modelId: string, path: string, useGpu?: boolean) => Promise<boolean>;
  multimodalStatus?: (modelId: string) => Promise<{ enabled: boolean; vision: boolean; audio: boolean }>;
  releaseMultimodal?: (modelId: string) => Promise<void>;
  initVocoder?: (modelId: string, path: string, nBatch?: number) => Promise<boolean>;
  vocoderEnabled?: (modelId: string) => Promise<boolean>;
  releaseVocoder?: (modelId: string) => Promise<void>;
  formattedAudioCompletion?: (
    modelId: string,
    speakerJson: string,
    textToSpeak: string,
  ) => Promise<{ prompt: string; grammar?: string }>;
  audioGuideTokens?: (modelId: string, textToSpeak: string) => Promise<number[]>;
  decodeAudioTokens?: (modelId: string, tokens: number[]) => Promise<number[]>;
  health?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  memory?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};

type WasmModule = {
  /** Default export: loads and initialises the .wasm binary. */
  default?: (moduleOrPath?: string | URL | Request | Response | BufferSource | WebAssembly.Module) => Promise<unknown>;
  getEmscriptenModule?: () => EmscriptenModule | null;
  /**
   * Engine-level init (wasm_bindgen export named `init` in Rust).
   * Exported as `init_engine` / `wasm_init` in the ES module wrapper to avoid
   * colliding with the wasm-module-load default export.
   */
  init_engine?: () => void;
  /** @deprecated use init_engine — kept for backwards compat with older builds */
  init?: () => void;
  load_model?: (modelId: string, bytes: Uint8Array, optsJson: string) => void;
  model_vfs_begin?: (totalBytes?: number, optsJson?: string) => string;
  model_vfs_write?: (vfsPath: string, chunk: Uint8Array) => void;
  model_vfs_abort?: (vfsPath: string) => void;
  load_model_from_vfs?: (modelId: string, vfsPath: string, optsJson: string) => void;
  load_model_from_path?: (modelId: string, vfsPath: string, optsJson: string) => void;
  async_model_bind?: (
    vfsPath: string,
    sizeBytes: number,
    readFn: (offset: number, length: number) => Uint8Array | Promise<Uint8Array>,
  ) => void;
  can_use_async_file?: () => boolean;
  unload_model?: (modelId: string) => void;
  generate?: (modelId: string, reqJson: string) => string;
  // generate_stream is the real streaming export from Rust/wasm-bindgen (#3).
  generate_stream?: (modelId: string, reqJson: string, onToken: (token: string, index: number) => void) => string;
  embed?: (modelId: string, reqJson: string) => string;
  tokenize?: (modelId: string, text: string) => string;
  detokenize?: (modelId: string, tokensJson: string) => string;
  convert_json_schema_to_grammar?: (schemaJson: string) => string;
  rerank?: (modelId: string, query: string, documentsJson: string) => string;
  bench?: (modelId: string, pp: number, tg: number, pl: number, nr: number) => string;
  save_session?: (modelId: string, filepath: string, tokenSize: number) => string;
  load_session?: (modelId: string, filepath: string) => string;
  apply_lora_adapters?: (modelId: string, loraListJson: string) => void;
  remove_lora_adapters?: (modelId: string) => void;
  get_loaded_lora_adapters?: (modelId: string) => string;
  init_multimodal?: (modelId: string, path: string, useGpu: boolean) => string;
  multimodal_status?: (modelId: string) => string;
  release_multimodal?: (modelId: string) => void;
  init_vocoder?: (modelId: string, path: string, nBatch: number) => string;
  vocoder_enabled?: (modelId: string) => string;
  release_vocoder?: (modelId: string) => void;
  formatted_audio_completion?: (modelId: string, speakerJson: string, textToSpeak: string) => string;
  audio_guide_tokens?: (modelId: string, textToSpeak: string) => string;
  decode_audio_tokens?: (modelId: string, tokensJson: string) => string;
  health?: () => string;
  memory_snapshot?: () => string;
};

const safeJsonParse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** Models above this use VFS streaming first (HeapFS/mmap can overflow JS stack). */
const LARGE_MODEL_BYTES = 500 * 1024 * 1024;

/** Legacy MEMFS streaming — use_mmap=false (full file copied into WASM VFS). */
const wasmLoadOptsJson = (
  opts: Record<string, unknown> | undefined,
  overrides?: Record<string, unknown>,
): string => JSON.stringify({ use_mmap: false, ...(opts ?? {}), ...overrides });

/** JSPI async fread — model stays in JS; C++ reads on demand (use_mmap=false). */
const wasmAsyncLoadOptsJson = (
  opts: Record<string, unknown> | undefined,
  overrides?: Record<string, unknown>,
): string => JSON.stringify({ use_mmap: false, ...(opts ?? {}), ...overrides });

const loadViaAsyncFile = (
  mod: WasmModule,
  modelId: string,
  sizeBytes: number,
  readChunk: (offset: number, length: number) => Uint8Array,
  opts?: Record<string, unknown>,
): void => {
  const begin = mod.model_vfs_begin;
  const bind = mod.async_model_bind;
  const finish = mod.load_model_from_vfs;
  const abort = mod.model_vfs_abort;
  if (!begin || !bind || !finish) {
    throw new Error('Wasm module missing JSPI async file exports — rebuild with: npm run build:wasm:jspi');
  }
  const optsJson = wasmAsyncLoadOptsJson(opts);
  const vfsPath = begin(sizeBytes, optsJson);
  if (!vfsPath) throw new Error('model_vfs_begin returned empty path');
  try {
    bind(vfsPath, sizeBytes, (offset, length) => readChunk(offset, length));
    finish(modelId, vfsPath, optsJson);
  } catch (err) {
    abort?.(vfsPath);
    throw err;
  }
};

const isStackOverflowError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return /maximum call stack size exceeded/i.test(msg);
};

const wasmMemoryDiagnostics = (em: EmscriptenModule | null): Record<string, unknown> => {
  if (!em) {
    return { wasmMemoryAccessible: false };
  }
  const wasmMem = (em as { wasmMemory?: WebAssembly.Memory }).wasmMemory;
  const buffer = wasmMem?.buffer ?? em.HEAPU8?.buffer;
  if (!buffer) {
    return { wasmMemoryAccessible: false };
  }
  return {
    wasmMemoryAccessible: true,
    wasmLinearBytes: buffer.byteLength,
    wasmLinearMb: +(buffer.byteLength / 1024 / 1024).toFixed(1),
    wasmMemoryShared: wasmMem?.buffer instanceof SharedArrayBuffer,
  };
};

// Fix #15: worker URL resolution is now explicit and bundler-friendly.
// - First try the global escape hatch (__LLAMA_WORKER_URL__) set by the app.
// - Then try the canonical package-relative path using import.meta.url so
//   Vite / Rollup / Webpack can detect it as a static asset and bundle it.
// - Fall back to a same-origin relative path for legacy setups.
const resolveModuleCandidates = (): string[] => {
  const candidates: string[] = [];

  const customUrl = (globalThis as any)?.__LLAMA_WORKER_URL__;
  if (typeof customUrl === 'string' && customUrl.length > 0) {
    candidates.push(customUrl);
  }

  try {
    // Static import.meta.url reference — detected correctly by bundlers.
    const base = new URL('../../wasm/llama_engine.js', import.meta.url).href;
    candidates.push(base);
    candidates.push(new URL('../../dist/wasm/llama_engine.js', import.meta.url).href);
  } catch {
    // import.meta.url unavailable (CommonJS transform or test runner).
  }

  const origin = (globalThis as any)?.location?.origin ?? '';
  if (origin) {
    candidates.push(`${origin}/dist/wasm/llama_engine.js`);
    candidates.push(`${origin}/wasm/llama_engine.js`);
  }

  return [...new Set(candidates)];
};

const loadWasmModule = async (): Promise<WasmModule> => {
  let lastError: unknown;
  for (const url of resolveModuleCandidates()) {
    try {
      const mod = (await import(/* @vite-ignore */ url)) as WasmModule;
      if (mod && typeof mod.default === 'function') {
        await mod.default();
      }
      if (typeof mod.load_model === 'function' && typeof mod.generate === 'function' && typeof mod.embed === 'function') {
        return mod;
      }
      lastError = new Error(`Module loaded but missing required exports at ${url}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Unable to load wasm wrapper module (llama_engine.js). ` +
    `Set window.__LLAMA_WORKER_URL__ to the correct path. ` +
    `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
};

export const loadLlamaWasmEngine = async (): Promise<WasmEngine> => {
  const mod = await loadWasmModule();
  const emscripten = (): EmscriptenModule | null => mod.getEmscriptenModule?.() ?? null;

  const ensureHeapFS = (): EmscriptenModule => {
    const em = emscripten();
    if (!em || !supportsHeapFS(em)) {
      throw new Error('Wasm build missing HeapFS runtime (mmapAlloc/MEMFS/FS) — rebuild with npm run build:wasm');
    }
    patchHeapFS(em);
    return em;
  };

  const ensureVfsReady = (): void => {
    const em = emscripten();
    if (em && supportsHeapFS(em)) {
      ensureWasmTmpDir(em);
    }
  };

  return {
    init: async () => {
      (mod.init_engine ?? mod.init)?.();
      const em = emscripten();
      if (em && supportsHeapFS(em)) {
        patchHeapFS(em);
        ensureWasmTmpDir(em);
      }
    },

    loadModel: async (modelId, modelBuffer, opts) => {
      const bytes = new Uint8Array(modelBuffer);
      const em = emscripten() as { __llamaWasmJspi?: boolean; __llamaWasmAsyncFile?: boolean } | null;
      const asyncReady =
        typeof mod.can_use_async_file === 'function'
          ? mod.can_use_async_file()
          : canUseAsyncFileRead(em?.__llamaWasmJspi ?? false);

      // JSPI async fread: register JS reader — no full-model copy into WASM linear memory.
      if (asyncReady) {
        const reader = asyncReaderFromBytes(bytes);
        loadViaAsyncFile(mod, modelId, reader.sizeBytes, reader.readChunk, opts);
        return;
      }

      // HeapFS fallback: mmapAlloc places GGUF in WASM heap (wllama fallback when no JSPI).
      const begin = mod.model_vfs_begin;
      const write = mod.model_vfs_write;
      const finish = mod.load_model_from_vfs;
      const abort = mod.model_vfs_abort;

      if (begin && write && finish) {
        ensureVfsReady();
        const optsJson = wasmLoadOptsJson(opts);
        const vfsPath = begin(bytes.length, optsJson);
        if (!vfsPath) throw new Error('model_vfs_begin returned empty path');
        try {
          const CHUNK = 32 * 1024 * 1024;
          for (let offset = 0; offset < bytes.length; offset += CHUNK) {
            write(vfsPath, bytes.subarray(offset, offset + CHUNK));
          }
          finish(modelId, vfsPath, optsJson);
        } catch (err) {
          abort?.(vfsPath);
          throw err;
        }
        return;
      }

      const loadModelFn = mod.load_model;
      if (!loadModelFn) throw new Error('Wasm module missing load_model export');
      loadModelFn(modelId, bytes, JSON.stringify(opts ?? {}));
    },

    loadModelFromOpfsReader: async (modelId, reader, opts) => {
      const loadFromPath = mod.load_model_from_path;
      const begin = mod.model_vfs_begin;
      const write = mod.model_vfs_write;
      const finish = mod.load_model_from_vfs;
      const abort = mod.model_vfs_abort;
      const chunkSize = 4 * 1024 * 1024;
      const em = emscripten() as { __llamaWasmJspi?: boolean } | null;
      const asyncReady =
        typeof mod.can_use_async_file === 'function'
          ? mod.can_use_async_file()
          : canUseAsyncFileRead(em?.__llamaWasmJspi ?? false);

      const loadViaAsyncOpfs = (): void => {
        loadViaAsyncFile(
          mod,
          modelId,
          reader.sizeBytes,
          (offset, length) => reader.readChunk(offset, length),
          opts,
        );
      };

      const streamOpfsToVfs = (useMmap: boolean): void => {
        if (!begin || !write || !finish) {
          throw new Error('Wasm module missing OPFS streaming exports (model_vfs_* / load_model_from_path)');
        }
        ensureVfsReady();
        const vfsPath = begin(reader.sizeBytes, wasmLoadOptsJson(opts, { use_mmap: useMmap }));
        if (!vfsPath) {
          throw new Error('model_vfs_begin returned empty path');
        }
        const optsJson = wasmLoadOptsJson(opts, { use_mmap: useMmap });
        try {
          for (let offset = 0; offset < reader.sizeBytes; ) {
            const chunk = reader.readChunk(offset, chunkSize);
            if (chunk.byteLength === 0) {
              break;
            }
            write(vfsPath, chunk);
            offset += chunk.byteLength;
          }
          finish(modelId, vfsPath, optsJson);
        } catch (error) {
          abort?.(vfsPath);
          throw error;
        }
      };

      const tryHeapFSLoad = (): void => {
        if (!loadFromPath) {
          throw new Error('Wasm module missing load_model_from_path');
        }
        const emMod = ensureHeapFS();
        const basename = `${modelId.replace(/[^\w.-]/g, '_')}.gguf`;
        const vfsPath = heapfsModelPath(basename);
        emMod.FS.createDataFile('/models', basename, new ArrayBuffer(0), true, true, true);
        const fileId = heapfsAlloc(emMod, basename, reader.sizeBytes, true);
        for (let offset = 0; offset < reader.sizeBytes; ) {
          const chunk = reader.readChunk(offset, chunkSize);
          if (chunk.byteLength === 0) break;
          heapfsWrite(emMod, fileId, chunk, offset);
          offset += chunk.byteLength;
        }
        loadFromPath(modelId, vfsPath, wasmLoadOptsJson(opts, { use_mmap: true }));
      };

      try {
        if (asyncReady) {
          loadViaAsyncOpfs();
          return;
        }

        const preferVfs =
          reader.sizeBytes >= LARGE_MODEL_BYTES || opts?.preferVfsStreaming === true;

        if (preferVfs) {
          streamOpfsToVfs(false);
          return;
        }

        if (loadFromPath) {
          try {
            tryHeapFSLoad();
            return;
          } catch (heapErr) {
            const reason = isStackOverflowError(heapErr)
              ? 'HeapFS/mmap caused stack overflow'
              : 'HeapFS load failed';
            console.warn(`[llama-cpp] ${reason}; falling back to VFS streaming:`, heapErr);
          }
        }

        streamOpfsToVfs(false);
      } finally {
        reader.close();
      }
    },

    unloadModel: async (modelId) => {
      const unloadModel = mod.unload_model;
      if (!unloadModel) throw new Error('Wasm module missing unload_model export');
      unloadModel(modelId);
    },

    generate: async (modelId, req, onToken) => {
      if (onToken && typeof mod.generate_stream === 'function') {
        const em = emscripten() as (EmscriptenModule & {
          __llamaWasmJspi?: boolean;
          __llamaStreamOnToken?: (token: string, index: number) => void | Promise<void>;
        }) | null;

        // JSPI build: tokens delivered incrementally via EM_ASYNC_JS in C++.
        if (em?.__llamaWasmJspi) {
          em.__llamaStreamOnToken = async (token: string, index: number) => {
            onToken(token, index);
          };
          try {
            const raw = mod.generate_stream(modelId, JSON.stringify(req ?? {}), () => {});
            return safeJsonParse<GenerateResult>(raw, {
              text: '',
              tokens_predicted: 0,
              tokens_evaluated: 0,
              finish_reason: 'error',
            });
          } finally {
            em.__llamaStreamOnToken = undefined;
          }
        }

        const raw = mod.generate_stream(modelId, JSON.stringify(req ?? {}), onToken);
        return safeJsonParse<GenerateResult>(raw, {
          text: '',
          tokens_predicted: 0,
          tokens_evaluated: 0,
          finish_reason: 'error',
        });
      }

      const generate = mod.generate;
      if (!generate) throw new Error('Wasm module missing generate export');
      const raw = generate(modelId, JSON.stringify(req ?? {}));
      return safeJsonParse<GenerateResult>(raw, {
        text: '',
        tokens_predicted: 0,
        tokens_evaluated: 0,
        finish_reason: 'error',
      });
    },

    embed: async (modelId, input) => {
      const embed = mod.embed;
      if (!embed) throw new Error('Wasm module missing embed export');
      const raw = embed(modelId, JSON.stringify({ input }));
      return safeJsonParse<EmbedResult>(raw, { vectors: [] });
    },

    tokenize: async (modelId, text) => {
      if (!mod.tokenize) {
        throw new Error('Wasm module missing tokenize export — rebuild with npm run build:wasm');
      }
      const raw = mod.tokenize(modelId, text);
      const parsed = safeJsonParse<Record<string, unknown>>(raw, {});
      const tokens = Array.isArray(parsed['tokens'])
        ? (parsed['tokens'] as number[])
        : [];
      return { tokens, has_media: Boolean(parsed['has_media']) };
    },

    detokenize: async (modelId, tokens) => {
      if (!mod.detokenize) {
        throw new Error('Wasm module missing detokenize export — rebuild with npm run build:wasm');
      }
      const raw = mod.detokenize(modelId, JSON.stringify(tokens));
      const parsed = safeJsonParse<{ text?: string }>(raw, {});
      return { text: parsed.text ?? raw };
    },

    convertJsonSchemaToGrammar: async (schemaJson) => {
      if (!mod.convert_json_schema_to_grammar) {
        throw new Error('Wasm module missing convert_json_schema_to_grammar export — rebuild with npm run build:wasm');
      }
      return mod.convert_json_schema_to_grammar(schemaJson);
    },

    rerank: async (modelId, query, documents) => {
      if (!mod.rerank) {
        throw new Error('Wasm module missing rerank export — rebuild with npm run build:wasm');
      }
      const raw = mod.rerank(modelId, query, JSON.stringify(documents));
      const parsed = safeJsonParse<Array<{ index: number; score: number }>>(raw, []);
      if (!Array.isArray(parsed)) {
        throw new Error(typeof parsed === 'object' && parsed && 'error' in (parsed as object)
          ? String((parsed as { error?: string }).error)
          : 'Invalid rerank response');
      }
      return parsed;
    },

    bench: async (modelId, pp, tg, pl, nr) => {
      if (!mod.bench) {
        throw new Error('Wasm module missing bench export — rebuild with npm run build:wasm');
      }
      return mod.bench(modelId, pp, tg, pl, nr);
    },

    saveSession: async (modelId, filepath, tokenSize) => {
      if (!mod.save_session) {
        throw new Error('Wasm module missing save_session export — rebuild with npm run build:wasm');
      }
      const raw = mod.save_session(modelId, filepath, tokenSize);
      const parsed = safeJsonParse<{ tokens_saved?: number; error?: string }>(raw, {});
      if (parsed.error) throw new Error(parsed.error);
      return { tokens_saved: parsed.tokens_saved ?? 0 };
    },

    loadSession: async (modelId, filepath) => {
      if (!mod.load_session) {
        throw new Error('Wasm module missing load_session export — rebuild with npm run build:wasm');
      }
      const raw = mod.load_session(modelId, filepath);
      const parsed = safeJsonParse<{ tokens_loaded?: number; prompt?: string; error?: string }>(raw, {});
      if (parsed.error) throw new Error(parsed.error);
      return {
        tokens_loaded: parsed.tokens_loaded ?? 0,
        prompt: parsed.prompt ?? '',
      };
    },

    applyLoraAdapters: async (modelId, loraAdapters) => {
      if (!mod.apply_lora_adapters) {
        throw new Error('Wasm module missing apply_lora_adapters export — rebuild with npm run build:wasm');
      }
      mod.apply_lora_adapters(modelId, JSON.stringify(loraAdapters));
    },

    removeLoraAdapters: async (modelId) => {
      if (!mod.remove_lora_adapters) {
        throw new Error('Wasm module missing remove_lora_adapters export — rebuild with npm run build:wasm');
      }
      mod.remove_lora_adapters(modelId);
    },

    getLoadedLoraAdapters: async (modelId) => {
      if (!mod.get_loaded_lora_adapters) {
        throw new Error('Wasm module missing get_loaded_lora_adapters export — rebuild with npm run build:wasm');
      }
      const raw = mod.get_loaded_lora_adapters(modelId);
      return safeJsonParse<Array<{ path: string; scaled?: number }>>(raw, []);
    },

    initMultimodal: async (modelId, path, useGpu = false) => {
      if (!mod.init_multimodal) {
        throw new Error('Wasm module missing init_multimodal export — rebuild with npm run build:wasm');
      }
      const raw = mod.init_multimodal(modelId, path, useGpu);
      const parsed = safeJsonParse<{ ok?: boolean; error?: string }>(raw, {});
      if (parsed.error) throw new Error(parsed.error);
      return !!parsed.ok;
    },

    multimodalStatus: async (modelId) => {
      if (!mod.multimodal_status) {
        throw new Error('Wasm module missing multimodal_status export — rebuild with npm run build:wasm');
      }
      const raw = mod.multimodal_status(modelId);
      return safeJsonParse<{ enabled: boolean; vision: boolean; audio: boolean }>(raw, {
        enabled: false,
        vision: false,
        audio: false,
      });
    },

    releaseMultimodal: async (modelId) => {
      mod.release_multimodal?.(modelId);
    },

    initVocoder: async (modelId, path, nBatch = 512) => {
      if (!mod.init_vocoder) {
        throw new Error('Wasm module missing init_vocoder export — rebuild with npm run build:wasm');
      }
      const raw = mod.init_vocoder(modelId, path, nBatch);
      const parsed = safeJsonParse<{ ok?: boolean; error?: string }>(raw, {});
      if (parsed.error) throw new Error(parsed.error);
      return !!parsed.ok;
    },

    vocoderEnabled: async (modelId) => {
      if (!mod.vocoder_enabled) {
        return false;
      }
      const raw = mod.vocoder_enabled(modelId);
      const parsed = safeJsonParse<{ enabled?: boolean }>(raw, {});
      return !!parsed.enabled;
    },

    releaseVocoder: async (modelId) => {
      mod.release_vocoder?.(modelId);
    },

    formattedAudioCompletion: async (modelId, speakerJson, textToSpeak) => {
      if (!mod.formatted_audio_completion) {
        throw new Error('Wasm module missing formatted_audio_completion export — rebuild with npm run build:wasm');
      }
      const raw = mod.formatted_audio_completion(modelId, speakerJson, textToSpeak);
      const parsed = safeJsonParse<{ prompt?: string; grammar?: string; error?: string }>(raw, {});
      if (parsed.error) throw new Error(parsed.error);
      return { prompt: parsed.prompt ?? '', grammar: parsed.grammar };
    },

    audioGuideTokens: async (modelId, textToSpeak) => {
      if (!mod.audio_guide_tokens) {
        throw new Error('Wasm module missing audio_guide_tokens export — rebuild with npm run build:wasm');
      }
      const raw = mod.audio_guide_tokens(modelId, textToSpeak);
      const parsed = safeJsonParse<number[] | { error?: string }>(raw, []);
      if (!Array.isArray(parsed)) {
        throw new Error(typeof parsed === 'object' && parsed && 'error' in parsed
          ? String(parsed.error)
          : 'Invalid audio guide tokens response');
      }
      return parsed;
    },

    decodeAudioTokens: async (modelId, tokens) => {
      if (!mod.decode_audio_tokens) {
        throw new Error('Wasm module missing decode_audio_tokens export — rebuild with npm run build:wasm');
      }
      const raw = mod.decode_audio_tokens(modelId, JSON.stringify(tokens));
      const parsed = safeJsonParse<number[] | { error?: string }>(raw, []);
      if (!Array.isArray(parsed)) {
        throw new Error(typeof parsed === 'object' && parsed && 'error' in parsed
          ? String(parsed.error)
          : 'Invalid decode audio response');
      }
      return parsed;
    },

    health: async () => {
      const base = mod.health
        ? safeJsonParse<Record<string, unknown>>(mod.health(), {})
        : {};
      const em = emscripten() as (EmscriptenModule & {
        __llamaWasmJspi?: boolean;
        __llamaWasmAsyncFile?: boolean;
        __llamaWasmPthread?: boolean;
      }) | null;
      return {
        ...base,
        ...wasmMemoryDiagnostics(em),
        wasmJspi: em?.__llamaWasmJspi ?? false,
        wasmAsyncFile: em?.__llamaWasmAsyncFile ?? mod.can_use_async_file?.() ?? false,
        wasmPthread: em?.__llamaWasmPthread ?? false,
      };
    },

    memory: async () => {
      const em = emscripten();
      return { pressure: 'unknown', ...wasmMemoryDiagnostics(em) };
    },
  };
};
