import type { WorkerEvent, WorkerRequest } from './worker.protocol';
import { loadLlamaWasmEngine, type WasmEngine, type TokenizeResult, type DetokenizeResult } from './wasm.engine';
import {
  openOpfsModelSyncReader,
  readModelBufferFromOpfs,
} from '../storage/opfs.store';
import { WASM_MAX_CONCURRENT_MODELS } from '../isomorphic/wasmMemoryPolicy';

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
  wasmEngineContextInitialized: false,
  loadedModels: new Set<string>(),
  modelLoadOutcomes: new Map<string, 'loaded' | 'failed'>(),
  modelLoadFailureReasons: new Map<string, string>(),
  modelLoadInflight: new Map<string, Promise<void>>(),
  engine: null as WasmEngine | null,
};

const isModelReadyInWorker = (modelId: string): boolean =>
  state.wasmEngineContextInitialized &&
  state.engine != null &&
  state.loadedModels.has(modelId);

const clearModelLoadMemo = (modelId: string): void => {
  state.loadedModels.delete(modelId);
  state.modelLoadOutcomes.delete(modelId);
  state.modelLoadFailureReasons.delete(modelId);
  state.modelLoadInflight.delete(modelId);
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
          state.wasmEngineContextInitialized = true;
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

        const requestModelId = req.modelId;

        if (isModelReadyInWorker(requestModelId)) {
          postEvent({
            id: req.id,
            type: 'RESULT',
            payload: { ok: true, modelId: requestModelId, alreadyLoaded: true, ready: true },
          });
          return;
        }

        const cachedFailure = state.modelLoadFailureReasons.get(requestModelId);
        if (state.modelLoadOutcomes.get(requestModelId) === 'failed' && cachedFailure) {
          postError(req.id, 'INSUFFICIENT_MEMORY', cachedFailure, {
            modelId: requestModelId,
            cachedFailure: true,
          });
          return;
        }

        let inflight = state.modelLoadInflight.get(requestModelId);
        if (!inflight) {
          const engine = ensureEngine();
          inflight = (async () => {
            try {
              await loadModelFromOpfs(engine, requestModelId, req.opts);
              state.loadedModels.add(requestModelId);
              state.modelLoadOutcomes.set(requestModelId, 'loaded');
              state.modelLoadFailureReasons.delete(requestModelId);
            } catch (readErr) {
              const reason =
                readErr instanceof Error ? readErr.message : String(readErr);
              state.modelLoadOutcomes.set(requestModelId, 'failed');
              state.modelLoadFailureReasons.set(requestModelId, reason);
              throw readErr;
            }
          })().finally(() => {
            state.modelLoadInflight.delete(requestModelId);
          });
          state.modelLoadInflight.set(requestModelId, inflight);
        }

        try {
          await inflight;
          let measuredFootprintBytes: number | undefined;
          let wasmLinearBytes: number | undefined;
          try {
            const engine = ensureEngine();
            const mem = engine ? await engine.memory?.() : undefined;
            if (mem && typeof mem.wasmLinearBytes === 'number') {
              wasmLinearBytes = mem.wasmLinearBytes;
            }
            if (Array.isArray(mem?.loadedModels)) {
              const row = mem.loadedModels.find(
                (m: { modelId?: string }) => m?.modelId === requestModelId,
              );
              if (row && typeof row.measuredFootprintBytes === 'number' && row.measuredFootprintBytes > 0) {
                measuredFootprintBytes = row.measuredFootprintBytes;
              }
            }
          } catch {
            /* optional calibration read */
          }
          postEvent({
            id: req.id,
            type: 'RESULT',
            payload: {
              ok: true,
              modelId: requestModelId,
              ready: true,
              wasmLinearBytes,
              measuredFootprintBytes,
            },
          });
        } catch (readErr) {
          const reason =
            state.modelLoadFailureReasons.get(requestModelId) ??
            (readErr instanceof Error ? readErr.message : String(readErr));
          postError(
            req.id,
            'STORAGE_IO_FAILED',
            `Failed to read model '${requestModelId}' from OPFS in worker: ${reason}`,
            { modelId: requestModelId, cachedFailure: true },
          );
        }
        return;
      }

      case 'UNLOAD_MODEL': {
        if (!state.loadedModels.has(req.modelId)) {
          clearModelLoadMemo(req.modelId);
          postEvent({
            id: req.id,
            type: 'RESULT',
            payload: { ok: true, modelId: req.modelId, alreadyUnloaded: true },
          });
          return;
        }
        const engine = ensureEngine();
        await engine.unloadModel(req.modelId);
        clearModelLoadMemo(req.modelId);
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

      case 'TOKENIZE': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        if (typeof engine.tokenize !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'tokenize is not supported by this WASM build — rebuild with npm run build:wasm');
          return;
        }
        const result: TokenizeResult = await engine.tokenize(req.modelId, req.text);
        postEvent({ id: req.id, type: 'RESULT', payload: result });
        return;
      }

      case 'DETOKENIZE': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        if (typeof engine.detokenize !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'detokenize is not supported by this WASM build — rebuild with npm run build:wasm');
          return;
        }
        const result: DetokenizeResult = await engine.detokenize(req.modelId, req.tokens);
        postEvent({ id: req.id, type: 'RESULT', payload: result });
        return;
      }

      case 'CONVERT_GRAMMAR': {
        const engine = ensureEngine();
        if (typeof engine.convertJsonSchemaToGrammar !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'convertJsonSchemaToGrammar is not supported by this WASM build — rebuild with npm run build:wasm');
          return;
        }
        const grammar: string = await engine.convertJsonSchemaToGrammar(req.schemaJson);
        postEvent({ id: req.id, type: 'RESULT', payload: { grammar } });
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
        const loadedModelIds = [...state.loadedModels];
        postEvent({
          id: req.id,
          type: 'RESULT',
          payload: {
            pressure: 'unknown',
            loadedModelIds,
            loadedModelCount: loadedModelIds.length,
            maxModels: WASM_MAX_CONCURRENT_MODELS,
            ...(details ?? {}),
          },
        });
        return;
      }

      case 'RERANK': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        if (typeof engine.rerank !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'rerank is not supported by this WASM build');
          return;
        }
        const results = await engine.rerank(req.modelId, req.query, req.documents);
        postEvent({ id: req.id, type: 'RESULT', payload: { results } });
        return;
      }

      case 'BENCH': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        if (typeof engine.bench !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'bench is not supported by this WASM build');
          return;
        }
        const result = await engine.bench(req.modelId, req.pp, req.tg, req.pl, req.nr);
        postEvent({ id: req.id, type: 'RESULT', payload: { result } });
        return;
      }

      case 'SAVE_SESSION': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        if (typeof engine.saveSession !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'saveSession is not supported by this WASM build');
          return;
        }
        const result = await engine.saveSession(req.modelId, req.filepath, req.tokenSize);
        postEvent({ id: req.id, type: 'RESULT', payload: result });
        return;
      }

      case 'LOAD_SESSION': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        if (typeof engine.loadSession !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'loadSession is not supported by this WASM build');
          return;
        }
        const result = await engine.loadSession(req.modelId, req.filepath);
        postEvent({ id: req.id, type: 'RESULT', payload: result });
        return;
      }

      case 'APPLY_LORA': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        if (typeof engine.applyLoraAdapters !== 'function') {
          postError(req.id, 'INFERENCE_FAILED', 'applyLoraAdapters is not supported by this WASM build');
          return;
        }
        await engine.applyLoraAdapters(req.modelId, req.loraAdapters);
        postEvent({ id: req.id, type: 'RESULT', payload: { ok: true } });
        return;
      }

      case 'REMOVE_LORA': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        await engine.removeLoraAdapters?.(req.modelId);
        postEvent({ id: req.id, type: 'RESULT', payload: { ok: true } });
        return;
      }

      case 'GET_LORA': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const adapters = (await engine.getLoadedLoraAdapters?.(req.modelId)) ?? [];
        postEvent({ id: req.id, type: 'RESULT', payload: { adapters } });
        return;
      }

      case 'INIT_MULTIMODAL': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const ok = await engine.initMultimodal?.(req.modelId, req.path, req.useGpu ?? false);
        postEvent({ id: req.id, type: 'RESULT', payload: { ok: !!ok } });
        return;
      }

      case 'MULTIMODAL_STATUS': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const status = await engine.multimodalStatus?.(req.modelId);
        postEvent({ id: req.id, type: 'RESULT', payload: status ?? { enabled: false, vision: false, audio: false } });
        return;
      }

      case 'RELEASE_MULTIMODAL': {
        const engine = ensureEngine();
        await engine.releaseMultimodal?.(req.modelId);
        postEvent({ id: req.id, type: 'RESULT', payload: { ok: true } });
        return;
      }

      case 'INIT_VOCODER': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const ok = await engine.initVocoder?.(req.modelId, req.path, req.nBatch ?? 512);
        postEvent({ id: req.id, type: 'RESULT', payload: { ok: !!ok } });
        return;
      }

      case 'VOCODER_ENABLED': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const enabled = await engine.vocoderEnabled?.(req.modelId);
        postEvent({ id: req.id, type: 'RESULT', payload: { enabled: !!enabled } });
        return;
      }

      case 'RELEASE_VOCODER': {
        const engine = ensureEngine();
        await engine.releaseVocoder?.(req.modelId);
        postEvent({ id: req.id, type: 'RESULT', payload: { ok: true } });
        return;
      }

      case 'FORMATTED_AUDIO': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const result = await engine.formattedAudioCompletion?.(
          req.modelId,
          req.speakerJson,
          req.textToSpeak,
        );
        postEvent({ id: req.id, type: 'RESULT', payload: result ?? { prompt: '' } });
        return;
      }

      case 'AUDIO_GUIDE_TOKENS': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const tokens = await engine.audioGuideTokens?.(req.modelId, req.textToSpeak);
        postEvent({ id: req.id, type: 'RESULT', payload: { tokens: tokens ?? [] } });
        return;
      }

      case 'DECODE_AUDIO_TOKENS': {
        if (!state.loadedModels.has(req.modelId)) {
          postError(req.id, 'MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded in worker.`);
          return;
        }
        const engine = ensureEngine();
        const audio = await engine.decodeAudioTokens?.(req.modelId, req.tokens);
        postEvent({ id: req.id, type: 'RESULT', payload: { audio: audio ?? [] } });
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
