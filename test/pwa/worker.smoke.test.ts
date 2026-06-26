import type { WorkerEvent } from '../../src/workers/worker.protocol';

jest.mock('../../src/workers/wasm.engine', () => ({
  loadLlamaWasmEngine: jest.fn(),
}));

jest.mock('../../src/storage/opfs.store', () => ({
  openOpfsModelSyncReader: jest.fn().mockRejectedValue(
    Object.assign(new Error('OPFS sync access handle unavailable'), { code: 'STORAGE_UNAVAILABLE' }),
  ),
  readModelBufferFromOpfs: jest.fn().mockResolvedValue({
    buffer: new Uint8Array([1, 2, 3]).buffer,
    sizeBytes: 3,
  }),
  OPFS_MODEL_CHUNK_BYTES: 4 * 1024 * 1024,
}));

type WorkerSelf = {
  onmessage?: (evt: { data: unknown }) => Promise<void> | void;
  postMessage: (evt: WorkerEvent) => void;
};

const flush = async (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Engine mocks must expose choice-3 streaming load (tests fall back to loadModel). */
const withWasmEngineMocks = (engine: Record<string, unknown>) => ({
  loadModelFromOpfsReader: async () => {},
  ...engine,
});

const bootstrapWorker = async (engine?: Record<string, unknown>) => {
  jest.resetModules();

  const emitted: WorkerEvent[] = [];
  const selfObj: WorkerSelf = {
    postMessage: (evt: WorkerEvent) => emitted.push(evt),
  };
  (globalThis as any).self = selfObj;

  if (engine) {
    const wasmEngineModule = await import('../../src/workers/wasm.engine');
    const mockedLoadEngine = wasmEngineModule
      .loadLlamaWasmEngine as jest.MockedFunction<typeof wasmEngineModule.loadLlamaWasmEngine>;
    mockedLoadEngine.mockResolvedValue(withWasmEngineMocks(engine) as any);
  }

  await import('../../src/workers/llm.worker');
  return { emitted, selfObj };
};

const sendRequest = async (
  selfObj: WorkerSelf,
  request: Record<string, unknown>,
): Promise<void> => {
  if (!selfObj.onmessage) {
    throw new Error('Worker onmessage handler is not registered');
  }
  await selfObj.onmessage({ data: request });
  await flush();
};

describe('PWA worker smoke', () => {
  test('responds with init result', async () => {
    const { emitted, selfObj } = await bootstrapWorker({
      init: async () => {},
      loadModel: async () => {},
      unloadModel: async () => {},
      generate: async () => ({
        text: 'ok',
        tokens_predicted: 1,
        tokens_evaluated: 1,
        finish_reason: 'stop',
      }),
      embed: async () => ({ vectors: [[0.1, 0.2]] }),
      health: async () => ({ runtime: 'ok' }),
      memory: async () => ({ pressure: 'low' }),
    });
    await sendRequest(selfObj, { id: 'init-1', type: 'INIT' });

    expect(emitted).toContainEqual({
      id: 'init-1',
      type: 'RESULT',
      payload: { ok: true, initialized: true },
    });
  });

  test('rejects model load before init', async () => {
    const { emitted, selfObj } = await bootstrapWorker();
    await sendRequest(selfObj, {
      id: 'load-before-init',
      type: 'LOAD_MODEL',
      modelId: 'm1',
      opts: {},
    });

    expect(emitted).toContainEqual({
      id: 'load-before-init',
      type: 'ERROR',
      code: 'WASM_INIT_FAILED',
      message: 'Worker is not initialized. Send INIT first.',
      meta: undefined,
    });
  });

  test('runs init-load-generate-embed flow with token events', async () => {
    const { emitted, selfObj } = await bootstrapWorker({
      init: async () => {},
      loadModel: async () => {},
      unloadModel: async () => {},
      generate: async (_modelId: string, _req: Record<string, unknown>, onToken?: (token: string, index: number) => void) => {
        onToken?.('Hello ', 0);
        onToken?.('world', 1);
        return {
          text: 'Hello world',
          tokens_predicted: 2,
          tokens_evaluated: 3,
          finish_reason: 'stop',
        } as const;
      },
      embed: async () => ({ vectors: [[0.3, 0.4, 0.5]] }),
      health: async () => ({ ready: true }),
      memory: async () => ({ pressure: 'low' }),
    });

    await sendRequest(selfObj, { id: 'flow-init', type: 'INIT' });
    await sendRequest(selfObj, {
      id: 'flow-load',
      type: 'LOAD_MODEL',
      modelId: 'model-a',
      opts: {},
    });
    await sendRequest(selfObj, {
      id: 'flow-generate',
      type: 'GENERATE',
      modelId: 'model-a',
      req: { prompt: 'hi', stream: true, max_tokens: 8 },
    });
    await sendRequest(selfObj, {
      id: 'flow-embed',
      type: 'EMBED',
      modelId: 'model-a',
      input: 'embedding text',
    });

    expect(
      emitted.filter((evt) => evt.id === 'flow-generate' && evt.type === 'TOKEN'),
    ).toEqual([
      {
        id: 'flow-generate',
        type: 'TOKEN',
        modelId: 'model-a',
        token: 'Hello ',
        index: 0,
      },
      {
        id: 'flow-generate',
        type: 'TOKEN',
        modelId: 'model-a',
        token: 'world',
        index: 1,
      },
    ]);

    expect(emitted).toContainEqual({
      id: 'flow-generate',
      type: 'RESULT',
      payload: {
        text: 'Hello world',
        tokens_predicted: 2,
        tokens_evaluated: 3,
        finish_reason: 'stop',
      },
    });

    expect(emitted).toContainEqual({
      id: 'flow-embed',
      type: 'RESULT',
      payload: { vectors: [[0.3, 0.4, 0.5]] },
    });
  });

  test('returns health and memory snapshots after init', async () => {
    const { emitted, selfObj } = await bootstrapWorker({
      init: async () => {},
      loadModel: async () => {},
      unloadModel: async () => {},
      generate: async () => ({
        text: 'ok',
        tokens_predicted: 1,
        tokens_evaluated: 1,
        finish_reason: 'stop',
      }),
      embed: async () => ({ vectors: [[0.1]] }),
      health: async () => ({ runtime: 'ok', wasmReady: true }),
      memory: async () => ({ pressure: 'low', freeBytes: 12345 }),
    });

    await sendRequest(selfObj, { id: 'state-init', type: 'INIT' });
    await sendRequest(selfObj, { id: 'state-health', type: 'HEALTH' });
    await sendRequest(selfObj, { id: 'state-memory', type: 'MEMORY' });

    expect(emitted).toContainEqual({
      id: 'state-health',
      type: 'RESULT',
      payload: {
        ok: true,
        initialized: true,
        loadedModels: 0,
        details: { runtime: 'ok', wasmReady: true },
      },
    });
    expect(emitted).toContainEqual({
      id: 'state-memory',
      type: 'RESULT',
      payload: {
        pressure: 'low',
        freeBytes: 12345,
      },
    });
  });

  test('returns MODEL_NOT_LOADED for generate before model load', async () => {
    const { emitted, selfObj } = await bootstrapWorker({
      init: async () => {},
      loadModel: async () => {},
      unloadModel: async () => {},
      generate: async () => ({
        text: 'should-not-run',
        tokens_predicted: 0,
        tokens_evaluated: 0,
        finish_reason: 'error',
      }),
      embed: async () => ({ vectors: [] }),
    });

    await sendRequest(selfObj, { id: 'nl-init', type: 'INIT' });
    await sendRequest(selfObj, {
      id: 'nl-generate',
      type: 'GENERATE',
      modelId: 'unloaded-model',
      req: { prompt: 'hello', stream: false },
    });

    expect(emitted).toContainEqual({
      id: 'nl-generate',
      type: 'ERROR',
      code: 'MODEL_NOT_LOADED',
      message: "Model 'unloaded-model' is not loaded in worker.",
      meta: undefined,
    });
  });
});

