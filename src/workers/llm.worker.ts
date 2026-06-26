import type { WorkerEvent, WorkerRequest } from './worker.protocol';
import { loadLlamaWasmEngine, type WasmEngine } from './wasm.engine';
import {
  openOpfsModelSyncReader,
  readModelBufferFromOpfs,
} from '../storage/opfs.store';

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

const tryLoadEngine = async (): Promise<WasmEngine> => {
  const engine = await loadLlamaWasmEngine();
  if (
    !engine ||
    typeof engine.loadModel !== 'function' ||
    typeof engine.generate !== 'function' ||
    typeof engine.embed !== 'function'
  ) {
    throw new Error('Loaded wasm engine does not expose required methods.');
  }
  return engine;
};

const loadModelFromOpfs = async (
  engine: WasmEngine,
  modelId: string,
  opts: Record<string, unknown> | undefined,
): Promise<void> => {
  // Choice 3 (primary): OPFS sync access handle → chunked stream → WASM MEMFS.
  // Never materialises the full model in the JS heap (required for 2GB+ models).
  if (typeof engine.loadModelFromOpfsReader !== 'function') {
    throw new Error(
      'WASM module is missing OPFS streaming exports (model_vfs_*). ' +
        'Rebuild with: npm run build:wasm',
    );
  }

  try {
    const reader = await openOpfsModelSyncReader(modelId);
    await engine.loadModelFromOpfsReader(modelId, reader, opts);
    return;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);
    const syncUnavailable =
      code === 'STORAGE_UNAVAILABLE' || /sync access handle/i.test(message);
    if (!syncUnavailable) {
      throw error;
    }
  }

  // Legacy fallback (choice 1): only when sync handles are unavailable (older browsers).
  console.warn(
    `[llama-cpp] OPFS sync access handle unavailable for '${modelId}'; ` +
      'falling back to full-buffer load (not suitable for models >2GB).',
  );
  const { buffer, sizeBytes } = await readModelBufferFromOpfs(modelId);
  await engine.loadModel(modelId, buffer, { ...(opts ?? {}), modelBytes: sizeBytes });
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

        // Fix #9: read from OPFS in the worker via sync-handle streaming when
        // available; never on the main thread.
        try {
          await loadModelFromOpfs(engine, req.modelId, req.opts);
        } catch (readErr) {
          postError(req.id, 'STORAGE_IO_FAILED', `Failed to read model '${req.modelId}' from OPFS in worker: ${readErr instanceof Error ? readErr.message : String(readErr)}`);
          return;
        }
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

        // Fix #3: use the real streaming callback when stream=true so tokens
        // arrive from the WASM generation loop, not as a post-hoc string split.
        const onToken = req.req.stream
          ? (token: string, index: number) => {
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
