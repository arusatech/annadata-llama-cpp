import { WebProvider } from '../../src/isomorphic/provider.web';
import { LlmError } from '../../src/isomorphic/errors';

jest.mock('../../src/storage/opfs.store', () => ({
  ensureModelInOpfs: jest.fn(),
  getOpfsUsage: jest.fn(),
  readModelFromOpfs: jest.fn(),
}));

jest.mock('../../src/storage/manifest', () => ({
  getManifestEntry: jest.fn(),
}));

import {
  ensureModelInOpfs,
  getOpfsUsage,
  readModelFromOpfs,
} from '../../src/storage/opfs.store';
import { getManifestEntry } from '../../src/storage/manifest';

type WorkerRequest = { id: string; type: string; [key: string]: any };

class ContractTestWorker {
  onmessage: ((evt: MessageEvent<any>) => void) | null = null;
  onerror: ((evt: ErrorEvent) => void) | null = null;
  readonly requests: WorkerRequest[] = [];

  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
    queueMicrotask(() => {
      if (!this.onmessage) return;
      switch (request.type) {
        case 'INIT':
          this.onmessage({
            data: { id: request.id, type: 'RESULT', payload: { ok: true, initialized: true } },
          } as MessageEvent);
          break;
        case 'LOAD_MODEL':
          this.onmessage({
            data: { id: request.id, type: 'RESULT', payload: { ok: true, modelId: request.modelId } },
          } as MessageEvent);
          break;
        case 'UNLOAD_MODEL':
          this.onmessage({
            data: { id: request.id, type: 'RESULT', payload: { ok: true, modelId: request.modelId } },
          } as MessageEvent);
          break;
        case 'GENERATE':
          if (request.req?.stream) {
            this.onmessage({
              data: {
                id: request.id,
                type: 'TOKEN',
                modelId: request.modelId,
                token: 'A',
                index: 0,
              },
            } as MessageEvent);
            this.onmessage({
              data: {
                id: request.id,
                type: 'TOKEN',
                modelId: request.modelId,
                token: 'B',
                index: 1,
              },
            } as MessageEvent);
          }
          this.onmessage({
            data: {
              id: request.id,
              type: 'RESULT',
              payload: {
                text: 'AB',
                tokens_predicted: 2,
                tokens_evaluated: 3,
                finish_reason: 'stop',
              },
            },
          } as MessageEvent);
          break;
        case 'EMBED':
          this.onmessage({
            data: {
              id: request.id,
              type: 'RESULT',
              payload: { vectors: [[1, 2, 3]] },
            },
          } as MessageEvent);
          break;
        case 'HEALTH':
          this.onmessage({
            data: {
              id: request.id,
              type: 'RESULT',
              payload: { ok: true, initialized: true, loadedModels: 1, details: { wasm: true } },
            },
          } as MessageEvent);
          break;
        case 'MEMORY':
          this.onmessage({
            data: { id: request.id, type: 'RESULT', payload: { pressure: 'low' } },
          } as MessageEvent);
          break;
        default:
          this.onmessage({
            data: { id: request.id, type: 'ERROR', code: 'INVALID_REQUEST', message: 'unknown' },
          } as MessageEvent);
      }
    });
  }
}

const mockedEnsureModelInOpfs = ensureModelInOpfs as jest.MockedFunction<typeof ensureModelInOpfs>;
const mockedGetOpfsUsage = getOpfsUsage as jest.MockedFunction<typeof getOpfsUsage>;
const mockedReadModelFromOpfs = readModelFromOpfs as jest.MockedFunction<typeof readModelFromOpfs>;
const mockedGetManifestEntry = getManifestEntry as jest.MockedFunction<typeof getManifestEntry>;

describe('WebProvider contract (browser-level with worker indirection)', () => {
  let worker: ContractTestWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new ContractTestWorker();
    WebProvider.setWorkerFactory(() => worker as unknown as Worker);
    mockedGetOpfsUsage.mockResolvedValue({ usedBytes: 2048, quotaBytes: 8192 });
    mockedReadModelFromOpfs.mockResolvedValue({
      size: 3,
      arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
    } as any);
  });

  afterEach(() => {
    WebProvider.setWorkerFactory(undefined);
  });

  test('initialize + load + generate + embed + health', async () => {
    mockedGetManifestEntry.mockResolvedValue({
      modelId: 'contract-model',
      path: 'models/contract-model.gguf',
      sizeBytes: 3,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    const provider = new WebProvider();
    await provider.initialize({ modelId: 'contract-model', modelUrl: 'https://example.com/model.gguf' });

    const streamTokens: string[] = [];
    const generated = await provider.generateStream(
      { modelId: 'contract-model', prompt: 'hi', stream: true },
      (evt) => streamTokens.push(evt.token),
    );
    const embedded = await provider.embed({ modelId: 'contract-model', input: 'embed me' });
    const health = await provider.health();

    expect(streamTokens).toEqual(['A', 'B']);
    expect(generated.text).toBe('AB');
    expect(embedded.vectors[0]).toEqual([1, 2, 3]);
    expect(health.ok).toBe(true);
    expect(health.details?.opfsUsedBytes).toBe(2048);
    expect((health.details?.worker as any)?.ok).toBe(true);
  });

  test('requires modelUrl for first-time load', async () => {
    mockedGetManifestEntry.mockResolvedValue(undefined);
    const provider = new WebProvider();
    await expect(provider.loadModel({ modelId: 'missing-url' })).rejects.toMatchObject({
      name: 'LlmError',
      code: 'INVALID_REQUEST',
    });
  });

  test('throws MODEL_NOT_LOADED for generate before load', async () => {
    const provider = new WebProvider();
    await expect(provider.generate({ modelId: 'none', prompt: 'hello' })).rejects.toMatchObject({
      name: 'LlmError',
      code: 'MODEL_NOT_LOADED',
    });
  });

  test('uses download path when manifest is missing', async () => {
    mockedGetManifestEntry.mockResolvedValue(undefined);
    mockedEnsureModelInOpfs.mockResolvedValue({
      modelId: 'fresh-model',
      path: 'models/fresh-model.gguf',
      sizeBytes: 3,
      sourceUrl: 'https://example.com/fresh.gguf',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    const provider = new WebProvider();
    await provider.initialize({ modelId: 'fresh-model', modelUrl: 'https://example.com/fresh.gguf' });
    expect(mockedEnsureModelInOpfs).toHaveBeenCalledWith(
      'fresh-model',
      'https://example.com/fresh.gguf',
      undefined,
    );
  });
});

