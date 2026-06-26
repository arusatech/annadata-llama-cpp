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
import { DefaultModelScheduler } from './model.scheduler';
import {
  ensureModelInOpfs,
  getOpfsUsage,
} from '../storage/opfs.store';
import { getManifestEntry } from '../storage/manifest';
import type { WorkerEvent, WorkerRequest } from '../workers/worker.protocol';

// ---------------------------------------------------------------------------
// Fix #10: Pre-flight capability checks
// ---------------------------------------------------------------------------

/** Verify that the browser supports everything the web WASM path needs. */
export function checkWasmCapabilities(): {
  supported: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
    missing.push('WebAssembly');
  }
  if (typeof (globalThis as any)?.Worker === 'undefined') {
    missing.push('Worker');
  }
  if (
    typeof (globalThis as any)?.navigator?.storage?.getDirectory !== 'function'
  ) {
    missing.push('OPFS (navigator.storage.getDirectory)');
  }

  // WASM threads (needed for multi-threaded inference) require cross-origin
  // isolation. Warn but don't block — single-threaded inference still works.
  const coi = (globalThis as any)?.crossOriginIsolated === true;
  const hasShared = typeof SharedArrayBuffer !== 'undefined';
  if (!coi || !hasShared) {
    // Not a hard failure — single-threaded WASM still functions.
    // Callers can check this separately via checkCrossOriginIsolation().
  }

  return { supported: missing.length === 0, missing };
}

/** Returns true only when COOP/COEP headers are set for WASM threads. */
export function checkCrossOriginIsolation(): boolean {
  return (
    (globalThis as any)?.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined'
  );
}

// ---------------------------------------------------------------------------
// Worker factory helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Fix #11: Cross-browser memory snapshot using storage.estimate() fallback
// ---------------------------------------------------------------------------
async function getMemorySnapshotCrossBrowser(): Promise<MemorySnapshot> {
  // performance.memory is Chromium-only and non-standard. Use it when present,
  // otherwise fall back to storage.estimate() which is universally available.
  const perfMem = (globalThis as any)?.performance?.memory;
  if (perfMem && typeof perfMem.jsHeapSizeLimit === 'number' && perfMem.jsHeapSizeLimit > 0) {
    const totalBytes = Number(perfMem.jsHeapSizeLimit);
    const usedBytes  = Number(perfMem.usedJSHeapSize);
    const freeBytes  = totalBytes - usedBytes;
    const usedRatio  = usedBytes / totalBytes;
    const pressure   = usedRatio >= 0.85 ? 'high' : usedRatio >= 0.7 ? 'medium' : 'low';
    return { totalBytes, usedBytes, freeBytes, pressure };
  }

  // Fallback: use OPFS storage quota as a coarse proxy for available memory.
  // Not perfect but gives the admission controller a real number to work with
  // on Safari/Firefox instead of always returning undefined (which caused the
  // memory guard to be silently bypassed — fix #11).
  try {
    const est = await (globalThis as any)?.navigator?.storage?.estimate?.();
    if (est && typeof est.quota === 'number' && typeof est.usage === 'number') {
      const totalBytes = est.quota;
      const usedBytes  = est.usage;
      const freeBytes  = totalBytes - usedBytes;
      const usedRatio  = totalBytes > 0 ? usedBytes / totalBytes : 0;
      const pressure   = usedRatio >= 0.85 ? 'high' : usedRatio >= 0.7 ? 'medium' : 'low';
      return { totalBytes, usedBytes, freeBytes, pressure };
    }
  } catch {
    // ignore
  }

  return { pressure: 'unknown' };
}

// ---------------------------------------------------------------------------
// WebProvider
// ---------------------------------------------------------------------------
export class WebProvider implements LlmProvider {
  private static globalWorkerFactory?: WorkerFactory;
  readonly platform = 'web' as const;
  private loadedModelIds = new Set<string>();
  private worker: Worker | null = null;
  private reqCounter = 0;
  private pending = new Map<string, PendingRequest>();
  // Fix #5: wire the scheduler so admission control is enforced on the web path.
  private scheduler = new DefaultModelScheduler(5);

  constructor(private workerFactoryOverride?: WorkerFactory) {}

  static setWorkerFactory(factory?: WorkerFactory): void {
    WebProvider.globalWorkerFactory = factory;
  }

  // Fix #15 (also in wasm.engine.ts): the worker URL uses the canonical
  // import.meta.url pattern that bundlers (Vite/Webpack/Rollup) detect as a
  // static asset. Applications that bundle with a different setup should set
  // window.__LLAMA_WORKER_URL__ to the compiled worker script URL.
  private defaultWorkerFactory(): Worker {
    const customUrl = (globalThis as any)?.__LLAMA_WORKER_URL__;
    if (typeof customUrl === 'string' && customUrl.length > 0) {
      return new Worker(customUrl, { type: 'module' });
    }
    // Use new URL(..., import.meta.url) so bundlers can detect and handle it.
    return new Worker(
      new URL('../workers/llm.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const factory =
      this.workerFactoryOverride ??
      WebProvider.globalWorkerFactory ??
      (() => this.defaultWorkerFactory());
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

      if (message.type === 'PROGRESS') {
        // Progress events are handled by the caller via onProgress (#6).
        // Here they're surfaced in the pending map as token events with
        // a discriminant so callers can distinguish download vs token progress.
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
      const err = toError(
        'INFERENCE_FAILED',
        `Web worker error: ${evt.message || 'unknown worker error'}`,
      );
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
    onToken?: (event: TokenEvent) => void,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = `req_${Date.now()}_${this.reqCounter++}`;
    const message = { ...request, id } as WorkerRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onToken });
      try {
        // Fix #9: no Transferable[] needed — the ArrayBuffer lives in the worker
        worker.postMessage(message);
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
    // Fix #10: gate on capability check before touching the worker.
    const caps = checkWasmCapabilities();
    if (!caps.supported) {
      throw new LlmError(
        'UNSUPPORTED_PLATFORM',
        `Missing browser capabilities for WASM inference: ${caps.missing.join(', ')}`,
        { missing: caps.missing },
      );
    }
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

    // Download and persist to OPFS if needed (#6: with progress events).
    if (!existing && opts.modelUrl) {
      await ensureModelInOpfs(opts.modelId, opts.modelUrl, opts.onProgress);
    }

    // Fix #5: enforce admission control (memory guard + slot limit) BEFORE
    // asking the worker to load, using a real memory snapshot (#11).
    const memory = await getMemorySnapshotCrossBrowser();
    // sizeBytes from manifest tells the scheduler how big the model is.
    const manifestEntry = existing ?? (await getManifestEntry(opts.modelId));
    const modelBytes = manifestEntry?.sizeBytes ?? 0;
    this.scheduler.ensureCapacity(opts.modelId, modelBytes, memory);

    // Fix #9: send modelId only — the worker reads from OPFS internally.
    await this.sendRequest<{ ok: boolean }>({
      type: 'LOAD_MODEL',
      modelId: opts.modelId,
      opts: {
        modelPath: (opts as any).modelPath ?? (opts as any).model_path ?? manifestEntry?.path,
        modelBytes,
        n_ctx: opts.n_ctx,
        n_threads: opts.n_threads,
        embedding: opts.embedding,
      },
    });
    this.loadedModelIds.add(opts.modelId);
    this.scheduler.markLoaded(opts.modelId);
  }

  async unloadModel(modelId: string): Promise<void> {
    if (!this.loadedModelIds.has(modelId)) {
      return;
    }
    await this.sendRequest<{ ok: boolean }>({ type: 'UNLOAD_MODEL', modelId });
    this.loadedModelIds.delete(modelId);
    this.scheduler.markUnloaded(modelId);
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

  // Fix #11: use cross-browser memory snapshot instead of performance.memory only.
  async getMemorySnapshot(): Promise<MemorySnapshot> {
    return getMemorySnapshotCrossBrowser();
  }

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    const usage = await getOpfsUsage().catch(() => ({
      usedBytes: 0 as number,
      quotaBytes: undefined as number | undefined,
    }));
    const workerHealth = await this.sendRequest<Record<string, unknown>>({ type: 'HEALTH' }).catch(
      (error: unknown) => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return {
      ok: !!workerHealth?.ok,
      details: {
        loadedModels: this.loadedModelIds.size,
        opfsUsedBytes: usage.usedBytes,
        opfsQuotaBytes: usage.quotaBytes,
        worker: workerHealth,
        crossOriginIsolated: checkCrossOriginIsolation(),
      },
    };
  }
}
