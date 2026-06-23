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
  default?: (moduleOrPath?: string | URL | Request | Response | BufferSource | WebAssembly.Module) => Promise<unknown>;
  init?: () => void;
  load_model?: (modelId: string, bytes: Uint8Array, optsJson: string) => void;
  unload_model?: (modelId: string) => void;
  generate?: (modelId: string, reqJson: string) => string;
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

const resolveModuleCandidates = (): string[] => {
  const candidates = [
    // Package/runtime path when assets are copied beside dist/esm output.
    new URL('../../wasm/llama_engine.js', import.meta.url).href,
    // Local repo runtime path.
    new URL('../../dist/wasm/llama_engine.js', import.meta.url).href,
  ];

  if (typeof self !== 'undefined' && (self as any).location?.origin) {
    candidates.push(`${(self as any).location.origin}/dist/wasm/llama_engine.js`);
    candidates.push(`${(self as any).location.origin}/wasm/llama_engine.js`);
  }

  return [...new Set(candidates)];
};

const loadWasmModule = async (): Promise<WasmModule> => {
  let lastError: unknown = undefined;
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
    `Unable to load wasm wrapper module (llama_engine.js). Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
};

export const loadLlamaWasmEngine = async (): Promise<WasmEngine> => {
  const mod = await loadWasmModule();

  return {
    init: async () => {
      mod.init?.();
    },
    loadModel: async (modelId, modelBuffer, opts) => {
      const loadModel = mod.load_model;
      if (!loadModel) {
        throw new Error('Wasm module missing load_model export');
      }
      loadModel(modelId, new Uint8Array(modelBuffer), JSON.stringify(opts ?? {}));
    },
    unloadModel: async (modelId) => {
      const unloadModel = mod.unload_model;
      if (!unloadModel) {
        throw new Error('Wasm module missing unload_model export');
      }
      unloadModel(modelId);
    },
    generate: async (modelId, req, _onToken) => {
      const generate = mod.generate;
      if (!generate) {
        throw new Error('Wasm module missing generate export');
      }
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
      if (!embed) {
        throw new Error('Wasm module missing embed export');
      }
      const raw = embed(modelId, JSON.stringify({ input }));
      return safeJsonParse<EmbedResult>(raw, { vectors: [] });
    },
    health: async () => {
      const health = mod.health;
      if (!health) return {};
      return safeJsonParse<Record<string, unknown>>(health(), {});
    },
    memory: async () => {
      const memory = mod.memory_snapshot;
      if (!memory) return { pressure: 'unknown' };
      return safeJsonParse<Record<string, unknown>>(memory(), { pressure: 'unknown' });
    },
  };
};

