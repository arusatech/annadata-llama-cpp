import { WebProvider } from '../../src/isomorphic/provider.web';

jest.mock('../../src/storage/opfs.store', () => ({
  ensureModelInOpfs: jest.fn(),
  getOpfsUsage: jest.fn(),
  readModelFromOpfs: jest.fn(),
}));

jest.mock('../../src/storage/manifest', () => ({
  getManifestEntry: jest.fn(),
}));

import { getManifestEntry } from '../../src/storage/manifest';
import { getOpfsUsage, readModelFromOpfs } from '../../src/storage/opfs.store';

type WorkerRequest = { id: string; type: string; [key: string]: any };

class ParallelWorker {
  onmessage: ((evt: MessageEvent<any>) => void) | null = null;
  onerror: ((evt: ErrorEvent) => void) | null = null;

  postMessage(request: WorkerRequest): void {
    if (!this.onmessage) return;

    switch (request.type) {
      case 'INIT':
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: request.id, type: 'RESULT', payload: { ok: true, initialized: true } },
          } as MessageEvent);
        });
        return;
      case 'LOAD_MODEL':
      case 'UNLOAD_MODEL':
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: request.id, type: 'RESULT', payload: { ok: true, modelId: request.modelId } },
          } as MessageEvent);
        });
        return;
      case 'GENERATE':
        if (request.req?.stream) {
          // Emit interleaved stream tokens by request id to validate routing isolation.
          setTimeout(() => {
            this.onmessage?.({
              data: { id: request.id, type: 'TOKEN', modelId: request.modelId, token: 'X', index: 0 },
            } as MessageEvent);
          }, 0);
          setTimeout(() => {
            this.onmessage?.({
              data: { id: request.id, type: 'TOKEN', modelId: request.modelId, token: 'Y', index: 1 },
            } as MessageEvent);
          }, 1);
        }
        setTimeout(() => {
          this.onmessage?.({
            data: {
              id: request.id,
              type: 'RESULT',
              payload: {
                text: 'XY',
                tokens_predicted: 2,
                tokens_evaluated: 3,
                finish_reason: 'stop',
              },
            },
          } as MessageEvent);
        }, 2);
        return;
      case 'EMBED':
        setTimeout(() => {
          this.onmessage?.({
            data: {
              id: request.id,
              type: 'RESULT',
              payload: { vectors: [[9, 8, 7]] },
            },
          } as MessageEvent);
        }, 0);
        return;
      case 'HEALTH':
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              id: request.id,
              type: 'RESULT',
              payload: { ok: true, initialized: true, loadedModels: 2, details: { runtime: 'ok' } },
            },
          } as MessageEvent);
        });
        return;
      case 'MEMORY':
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: request.id, type: 'RESULT', payload: { pressure: 'low' } },
          } as MessageEvent);
        });
        return;
      default:
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: request.id, type: 'ERROR', code: 'INVALID_REQUEST', message: 'unknown' },
          } as MessageEvent);
        });
    }
  }
}

const mockedGetManifestEntry = getManifestEntry as jest.MockedFunction<typeof getManifestEntry>;
const mockedReadModelFromOpfs = readModelFromOpfs as jest.MockedFunction<typeof readModelFromOpfs>;
const mockedGetOpfsUsage = getOpfsUsage as jest.MockedFunction<typeof getOpfsUsage>;

describe('Multi-model parallel orchestration contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    WebProvider.setWorkerFactory(() => new ParallelWorker() as unknown as Worker);
    mockedGetManifestEntry.mockImplementation(async (modelId) => ({
      modelId,
      path: `models/${modelId}.gguf`,
      sizeBytes: 3,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    }));
    mockedReadModelFromOpfs.mockResolvedValue({
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as any);
    mockedGetOpfsUsage.mockResolvedValue({ usedBytes: 100, quotaBytes: 1000 });
  });

  afterEach(() => {
    WebProvider.setWorkerFactory(undefined);
  });

  test('supports concurrent stream + embed across different models', async () => {
    const provider = new WebProvider();

    await provider.initialize({ modelId: 'model-a', modelUrl: 'https://example.com/a.gguf' });
    await provider.loadModel({ modelId: 'model-b', modelUrl: 'https://example.com/b.gguf' });

    const tokensA: string[] = [];
    const streamPromise = provider.generateStream(
      { modelId: 'model-a', prompt: 'hello', stream: true },
      (evt) => tokensA.push(evt.token),
    );
    const embedPromise = provider.embed({ modelId: 'model-b', input: 'embed this' });

    const [streamResult, embedResult] = await Promise.all([streamPromise, embedPromise]);

    expect(tokensA).toEqual(['X', 'Y']);
    expect(streamResult.text).toBe('XY');
    expect(embedResult.vectors).toEqual([[9, 8, 7]]);
  });

  test('keeps token callbacks isolated per concurrent generateStream request', async () => {
    const provider = new WebProvider();
    await provider.initialize({ modelId: 'shared-model', modelUrl: 'https://example.com/shared.gguf' });

    const tokens1: string[] = [];
    const tokens2: string[] = [];

    const p1 = provider.generateStream(
      { modelId: 'shared-model', prompt: 'first', stream: true },
      (evt) => tokens1.push(evt.token),
    );
    const p2 = provider.generateStream(
      { modelId: 'shared-model', prompt: 'second', stream: true },
      (evt) => tokens2.push(evt.token),
    );

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(tokens1).toEqual(['X', 'Y']);
    expect(tokens2).toEqual(['X', 'Y']);
    expect(r1.text).toBe('XY');
    expect(r2.text).toBe('XY');
  });
});

