import type { WorkerEvent, WorkerRequest } from './worker.protocol';
import { loadLlamaWasmEngine, type WasmEngine } from './wasm.engine';

type GenerateResult = {
  text: string;
  tokens_predicted: number;
  tokens_evaluated: number;
  finish_reason: 'stop' | 'length' | 'error';
};

type EmbedResult = {
  vectors: number[][];
};

const state = {
  initialized: false,
  loadedModels: new Set<string>(),
  engine: null as WasmEngine | null,
};

const postEvent = (evt: WorkerEvent): void => {
  (self as DedicatedWorkerGlobalScope).postMessage(evt);
};

const postError = (id: string, code: string, message: string, meta?: Record<string, unknown>): void => {
  postEvent({ id, type: 'ERROR', code, message, meta });
};

const ensureEngine = (): WasmEngine => {
  if (!state.engine) {
    throw new Error('WASM engine is not initialized. Send INIT first.');
  }
  return state.engine;
};

const splitTokenFallback = (text: string): string[] => {
  if (!text) return [];
  const parts: string[] = [];
  let chunk = '';
  for (const ch of text) {
    chunk += ch;
    if (ch === ' ' || ch === '\n' || chunk.length >= 16) {
      parts.push(chunk);
      chunk = '';
    }
  }
  if (chunk) parts.push(chunk);
  return parts;
};

const tryLoadEngine = async (): Promise<WasmEngine> => {
  const engine = await loadLlamaWasmEngine();
  if (!engine || typeof engine.loadModel !== 'function' || typeof engine.generate !== 'function' || typeof engine.embed !== 'function') {
    throw new Error('Loaded wasm engine does not expose required methods.');
  }
  return engine;
};

self.onmessage = async (evt: MessageEvent<WorkerRequest>) => {
  const req = evt.data;

  try {
    switch (req.type) {
      case 'INIT': {
        if (!state.initialized) {
          state.engine = await tryLoadEngine();
          await state.engine.init?.();
          state.initialized = true;
        }
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: { ok: true, initialized: state.initialized },
        });
        return;
      }
      case 'LOAD_MODEL': {
        if (!state.initialized) {
          postError(req.id, 'WASM_INIT_FAILED', 'Worker is not initialized. Send INIT first.');
          return;
        }
        const engine = ensureEngine();
        await engine.loadModel(req.modelId, req.modelBuffer, req.opts);
        state.loadedModels.add(req.modelId);
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: { ok: true, modelId: req.modelId },
        });
        return;
      }
      case 'UNLOAD_MODEL': {
        if (!state.loadedModels.has(req.modelId)) {
          postEvent({
            id: req.id,
            type: 'RESULT',
            payload: { ok: true, modelId: req.modelId, alreadyUnloaded: true },
          });
          return;
        }
        const engine = ensureEngine();
        await engine.unloadModel(req.modelId);
        state.loadedModels.delete(req.modelId);
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: { ok: true, modelId: req.modelId },
        });
        return;
      }
      case 'GENERATE': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        let emitted = 0;
        const onToken = req.req.stream
          ? (token: string, index: number) => {
              emitted++;
              postEvent({
                id: req.id,
                type: 'TOKEN',
                modelId: req.modelId,
                token,
                index,
              });
            }
          : undefined;

        const result = await engine.generate(req.modelId, req.req, onToken);
        if (req.req.stream && emitted === 0 && result?.text) {
          const fallbackTokens = splitTokenFallback(result.text);
          fallbackTokens.forEach((token, index) => {
            postEvent({
              id: req.id,
              type: 'TOKEN',
              modelId: req.modelId,
              token,
              index,
            });
          });
        }
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: result,
        });
        return;
      }
      case 'EMBED': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const result = await engine.embed(req.modelId, req.input);
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: result,
        });
        return;
      }
      case 'HEALTH': {
        const details = state.engine ? await state.engine.health?.() : undefined;
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: {
            ok: state.initialized,
            initialized: state.initialized,
            loadedModels: state.loadedModels.size,
            details: details ?? {},
          },
        });
        return;
      }
      case 'MEMORY': {
        const details = state.engine ? await state.engine.memory?.() : undefined;
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: {
            pressure: 'unknown',
            ...(details ?? {}),
          },
        });
        return;
      }
      default: {
        const unknownReq = req as any;
        postError(
          typeof unknownReq?.id === 'string' ? unknownReq.id : 'unknown',
          'INVALID_REQUEST',
          `Unknown worker request type '${unknownReq?.type}'.`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = req.type === 'INIT' ? 'WASM_INIT_FAILED' : 'INFERENCE_FAILED';
    postError(req.id, code, message, { requestType: req.type });
  }
};

