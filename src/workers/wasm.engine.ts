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

export type WasmEngine = {
  init?: () => Promise<void> | void;
  loadModel: (modelId: string, modelBuffer: ArrayBuffer, opts?: Record<string, unknown>) => Promise<void> | void;
  unloadModel: (modelId: string) => Promise<void> | void;
  generate: (
    modelId: string,
    req: GenerateRequest,
    onToken?: (token: string, index: number) => void,
  ) => Promise<GenerateResult> | GenerateResult;
  embed: (modelId: string, input: string | string[]) => Promise<EmbedResult> | EmbedResult;
  health?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  memory?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};

type WasmModule = {
  /** Default export: loads and initialises the .wasm binary. */
  default?: (moduleOrPath?: string | URL | Request | Response | BufferSource | WebAssembly.Module) => Promise<unknown>;
  /**
   * Engine-level init (wasm_bindgen export named `init` in Rust).
   * Exported as `init_engine` / `wasm_init` in the ES module wrapper to avoid
   * colliding with the wasm-module-load default export.
   */
  init_engine?: () => void;
  /** @deprecated use init_engine — kept for backwards compat with older builds */
  init?: () => void;
  load_model?: (modelId: string, bytes: Uint8Array, optsJson: string) => void;
  unload_model?: (modelId: string) => void;
  generate?: (modelId: string, reqJson: string) => string;
  // generate_stream is the real streaming export from Rust/wasm-bindgen (#3).
  generate_stream?: (modelId: string, reqJson: string, onToken: (token: string, index: number) => void) => string;
  embed?: (modelId: string, reqJson: string) => string;
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

  return {
    init: async () => {
      // init_engine is the Rust #[wasm_bindgen] pub fn init() export.
      // Older builds may still expose it as `init`; fall back gracefully.
      (mod.init_engine ?? mod.init)?.();
    },

    loadModel: async (modelId, modelBuffer, opts) => {
      const loadModel = mod.load_model;
      if (!loadModel) {
        throw new Error('Wasm module missing load_model export');
      }
      // Pass the full ArrayBuffer (read from OPFS inside the worker — #9).
      loadModel(modelId, new Uint8Array(modelBuffer), JSON.stringify(opts ?? {}));
    },

    unloadModel: async (modelId) => {
      const unloadModel = mod.unload_model;
      if (!unloadModel) throw new Error('Wasm module missing unload_model export');
      unloadModel(modelId);
    },

    generate: async (modelId, req, onToken) => {
      // Fix #3: use generate_stream when a streaming callback is provided so
      // tokens arrive incrementally from the C++ generation loop, not as a
      // post-hoc split of the completed string.
      if (onToken && typeof mod.generate_stream === 'function') {
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

    health: async () => {
      if (!mod.health) return {};
      return safeJsonParse<Record<string, unknown>>(mod.health(), {});
    },

    memory: async () => {
      if (!mod.memory_snapshot) return { pressure: 'unknown' };
      return safeJsonParse<Record<string, unknown>>(mod.memory_snapshot(), { pressure: 'unknown' });
    },
  };
};
