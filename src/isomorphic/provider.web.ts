import type {
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  InitializeOptions,
  LlmProvider,
  MemorySnapshot,
  TokenEvent,
} from './provider.interface';
import { LlmError } from './errors';
import {
  ensureModelInOpfs,
  getOpfsUsage,
  readModelFromOpfs,
} from '../storage/opfs.store';
import { getManifestEntry } from '../storage/manifest';
import type { WorkerEvent, WorkerRequest } from '../workers/worker.protocol';

type WithoutId<T> = T extends { id: string } ? Omit<T, 'id'> : never;
type WorkerRequestWithoutId = WithoutId<WorkerRequest>;
type WorkerFactory = () => Worker;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  onToken?: (event: TokenEvent) => void;
};

const toError = (code: string, message: string, meta?: Record<string, unknown>): LlmError => {
  const knownCodes = [
    'MODEL_NOT_LOADED',
    'MODEL_LIMIT_REACHED',
    'INSUFFICIENT_MEMORY',
    'MODEL_DOWNLOAD_FAILED',
    'STORAGE_UNAVAILABLE',
    'STORAGE_IO_FAILED',
    'UNSUPPORTED_PLATFORM',
    'WASM_INIT_FAILED',
    'NATIVE_PLUGIN_UNAVAILABLE',
    'INFERENCE_FAILED',
    'INVALID_REQUEST',
  ];
  const normalizedCode = knownCodes.includes(code) ? (code as any) : 'INFERENCE_FAILED';
  return new LlmError(normalizedCode, message, meta);
};

export class WebProvider implements LlmProvider {
  private static globalWorkerFactory?: WorkerFactory;
  readonly platform = 'web' as const;
  private loadedModelIds = new Set<string>();
  private worker: Worker | null = null;
  private reqCounter = 0;
  private pending = new Map<string, PendingRequest>();
  constructor(private workerFactoryOverride?: WorkerFactory) {}

  static setWorkerFactory(factory?: WorkerFactory): void {
    WebProvider.globalWorkerFactory = factory;
  }

  private defaultWorkerFactory(): Worker {
    const customUrl = (globalThis as any)?.__LLAMA_WORKER_URL__;
    if (typeof customUrl === 'string' && customUrl.length > 0) {
      return new Worker(customUrl, { type: 'module' });
    }

    // Resolve module URL without using direct `import.meta` syntax so tests
    // running under CommonJS transforms can still compile this module.
    try {
      const moduleUrl = Function('return import.meta.url')() as string;
      const workerUrl = new URL('../workers/llm.worker.ts', moduleUrl).toString();
      return new Worker(workerUrl, { type: 'module' });
    } catch {
      const baseHref = (globalThis as any)?.location?.href ?? 'http://localhost/';
      const workerUrl = new URL('workers/llm.worker.js', baseHref).toString();
      return new Worker(workerUrl, { type: 'module' });
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const factory = this.workerFactoryOverride ?? WebProvider.globalWorkerFactory ?? (() => this.defaultWorkerFactory());
    const worker = factory();
    worker.onmessage = (evt: MessageEvent<WorkerEvent>) => {
      const message = evt.data;
      const request = this.pending.get(message.id);
      if (!request) return;

      if (message.type === 'TOKEN') {
        request.onToken?.({
          modelId: message.modelId,
          token: message.token,
          index: message.index,
        });
        return;
      }

      if (message.type === 'RESULT') {
        this.pending.delete(message.id);
        request.resolve(message.payload);
        return;
      }

      this.pending.delete(message.id);
      request.reject(toError(message.code, message.message, message.meta));
    };
    worker.onerror = (evt) => {
      const err = toError('INFERENCE_FAILED', `Web worker error: ${evt.message || 'unknown worker error'}`);
      for (const [id, req] of this.pending.entries()) {
        this.pending.delete(id);
        req.reject(err);
      }
    };
    this.worker = worker;
    return worker;
  }

  private sendRequest<T>(
    request: WorkerRequestWithoutId,
    transfer: Transferable[] = [],
    onToken?: (event: TokenEvent) => void,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = `req_${Date.now()}_${this.reqCounter++}`;
    const message = { ...request, id } as WorkerRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onToken });
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(
          toError('INFERENCE_FAILED', 'Failed to post request to wasm worker.', {
            cause: String(error),
            requestType: request.type,
          }),
        );
      }
    });
  }

  async initialize(opts: InitializeOptions): Promise<void> {
    await this.sendRequest<{ ok: boolean }>({ type: 'INIT' });
    await this.loadModel(opts);
  }

  async loadModel(opts: InitializeOptions): Promise<void> {
    if (!opts.modelId) {
      throw new LlmError('INVALID_REQUEST', 'modelId is required');
    }
    if (this.loadedModelIds.has(opts.modelId)) {
      return;
    }

    const existing = await getManifestEntry(opts.modelId);
    if (!existing && !opts.modelUrl) {
      throw new LlmError(
        'INVALID_REQUEST',
        'modelUrl is required for first-time web load when model is not cached in OPFS.',
      );
    }
    if (!existing && opts.modelUrl) {
      await ensureModelInOpfs(opts.modelId, opts.modelUrl);
    }

    const file = await readModelFromOpfs(opts.modelId);
    const modelBuffer = await file.arrayBuffer();
    await this.sendRequest<{ ok: boolean }>(
      {
        type: 'LOAD_MODEL',
        modelId: opts.modelId,
        modelBuffer,
        opts: {
          modelPath:
            (opts as any).modelPath ??
            (opts as any).model_path ??
            existing?.path,
          modelBytes: file.size,
          n_ctx: opts.n_ctx,
          n_threads: opts.n_threads,
          embedding: opts.embedding,
        },
      },
      [modelBuffer],
    );
    this.loadedModelIds.add(opts.modelId);
  }

  async unloadModel(modelId: string): Promise<void> {
    if (!this.loadedModelIds.has(modelId)) {
      return;
    }
    await this.sendRequest<{ ok: boolean }>({ type: 'UNLOAD_MODEL', modelId });
    this.loadedModelIds.delete(modelId);
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!this.loadedModelIds.has(req.modelId)) {
      throw new LlmError('MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded`);
    }
    return this.sendRequest<GenerateResult>({
      type: 'GENERATE',
      modelId: req.modelId,
      req: {
        prompt: req.prompt,
        messages: req.messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        stream: false,
      },
    });
  }

  async generateStream(req: GenerateRequest, onToken: (event: TokenEvent) => void): Promise<GenerateResult> {
    if (!this.loadedModelIds.has(req.modelId)) {
      throw new LlmError('MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded`);
    }
    return this.sendRequest<GenerateResult>(
      {
        type: 'GENERATE',
        modelId: req.modelId,
        req: {
          prompt: req.prompt,
          messages: req.messages,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
          stream: true,
        },
      },
      [],
      onToken,
    );
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (!this.loadedModelIds.has(req.modelId)) {
      throw new LlmError('MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded`);
    }
    return this.sendRequest<EmbedResult>({
      type: 'EMBED',
      modelId: req.modelId,
      input: req.input,
    });
  }

  async getMemorySnapshot(): Promise<MemorySnapshot> {
    const memoryInfo = (globalThis as any)?.performance?.memory;
    if (memoryInfo) {
      const totalBytes = Number(memoryInfo.jsHeapSizeLimit);
      const usedBytes = Number(memoryInfo.usedJSHeapSize);
      const freeBytes = Number(memoryInfo.jsHeapSizeLimit - memoryInfo.usedJSHeapSize);
      const usedRatio = totalBytes > 0 ? usedBytes / totalBytes : 0;
      const pressure = usedRatio >= 0.85 ? 'high' : usedRatio >= 0.7 ? 'medium' : 'low';
      return { totalBytes, usedBytes, freeBytes, pressure };
    }

    const workerMemory = await this.sendRequest<Record<string, unknown>>({ type: 'MEMORY' }).catch(() => undefined);
    const pressure =
      workerMemory && typeof workerMemory.pressure === 'string' ? (workerMemory.pressure as MemorySnapshot['pressure']) : 'unknown';
    return { pressure };
  }

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    const usage = await getOpfsUsage().catch(() => ({ usedBytes: 0 as number, quotaBytes: undefined as number | undefined }));
    const workerHealth = await this.sendRequest<Record<string, unknown>>({ type: 'HEALTH' }).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    return {
      ok: !!workerHealth?.ok,
      details: {
        loadedModels: this.loadedModelIds.size,
        opfsUsedBytes: usage.usedBytes,
        opfsQuotaBytes: usage.quotaBytes,
        worker: workerHealth,
      },
    };
  }
}

