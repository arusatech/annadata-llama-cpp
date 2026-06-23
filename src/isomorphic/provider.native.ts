import { registerPlugin } from '@capacitor/core';
import type { LlamaCppPlugin } from '../definitions';
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

const EVENT_ON_TOKEN = '@LlamaCpp_onToken';
const MAX_MODELS = 5;

type TokenNativeEvent = {
  contextId: number;
  tokenResult: {
    token?: string;
  };
};

const plugin = registerPlugin<LlamaCppPlugin>('LlamaCpp');

export class NativeProvider implements LlmProvider {
  readonly platform = 'native' as const;
  private contextByModel = new Map<string, number>();
  private nextContextId = 1;
  private scheduler = new DefaultModelScheduler(MAX_MODELS);

  async initialize(opts: InitializeOptions): Promise<void> {
    await plugin.setContextLimit({ limit: MAX_MODELS });
    await this.loadModel(opts);
  }

  async loadModel(opts: InitializeOptions): Promise<void> {
    if (!opts.modelId) {
      throw new LlmError('INVALID_REQUEST', 'modelId is required');
    }
    if (!opts.modelPath) {
      throw new LlmError('INVALID_REQUEST', 'modelPath is required on native provider');
    }
    if (this.contextByModel.has(opts.modelId)) {
      return;
    }

    const modelBytes = typeof opts.modelBytes === 'number' ? opts.modelBytes : 0;
    const reserveBytes = typeof opts.reserveBytes === 'number' ? opts.reserveBytes : undefined;
    const memory = await this.getMemorySnapshot();
    if (typeof opts.availableMemoryBytes === 'number') {
      memory.freeBytes = opts.availableMemoryBytes;
    }
    if (typeof opts.totalMemoryBytes === 'number') {
      memory.totalBytes = opts.totalMemoryBytes;
    }
    this.scheduler.ensureCapacity(opts.modelId, modelBytes, memory, reserveBytes);

    const contextId = this.nextContextId++;
    await plugin.initContext({
      contextId,
      params: {
        model: opts.modelPath,
        n_ctx: opts.n_ctx,
        n_threads: opts.n_threads,
        embedding: opts.embedding,
      },
    });
    this.contextByModel.set(opts.modelId, contextId);
    this.scheduler.markLoaded(opts.modelId);
  }

  async unloadModel(modelId: string): Promise<void> {
    const contextId = this.contextByModel.get(modelId);
    if (contextId === undefined) {
      return;
    }
    await plugin.releaseContext({ contextId });
    this.contextByModel.delete(modelId);
    this.scheduler.markUnloaded(modelId);
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const contextId = this.contextByModel.get(req.modelId);
    if (contextId === undefined) {
      throw new LlmError('MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded`);
    }
    const prompt = req.prompt ?? req.messages?.map((m) => `${m.role}: ${m.content}`).join('\n');
    if (!prompt) {
      throw new LlmError('INVALID_REQUEST', 'prompt or messages is required');
    }

    const completion = await plugin.completion({
      contextId,
      params: {
        prompt,
        n_predict: req.max_tokens,
        temperature: req.temperature,
        emit_partial_completion: false,
      },
    });

    return {
      text: completion.content || completion.text || '',
      tokens_predicted: completion.tokens_predicted || 0,
      tokens_evaluated: completion.tokens_evaluated || 0,
      finish_reason: completion.stopped_limit ? 'length' : 'stop',
    };
  }

  async generateStream(req: GenerateRequest, onToken: (event: TokenEvent) => void): Promise<GenerateResult> {
    const contextId = this.contextByModel.get(req.modelId);
    if (contextId === undefined) {
      throw new LlmError('MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded`);
    }
    const prompt = req.prompt ?? req.messages?.map((m) => `${m.role}: ${m.content}`).join('\n');
    if (!prompt) {
      throw new LlmError('INVALID_REQUEST', 'prompt or messages is required');
    }

    let tokenIndex = 0;
    const listener = await (plugin as any).addListener(EVENT_ON_TOKEN, (evt: TokenNativeEvent) => {
      if (evt.contextId !== contextId) return;
      const token = evt.tokenResult?.token ?? '';
      if (!token) return;
      onToken({ modelId: req.modelId, token, index: tokenIndex++ });
    });

    try {
      const completion = await plugin.completion({
        contextId,
        params: {
          prompt,
          n_predict: req.max_tokens,
          temperature: req.temperature,
          emit_partial_completion: true,
        },
      });

      return {
        text: completion.content || completion.text || '',
        tokens_predicted: completion.tokens_predicted || 0,
        tokens_evaluated: completion.tokens_evaluated || 0,
        finish_reason: completion.stopped_limit ? 'length' : 'stop',
      };
    } finally {
      listener?.remove?.();
    }
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const contextId = this.contextByModel.get(req.modelId);
    if (contextId === undefined) {
      throw new LlmError('MODEL_NOT_LOADED', `Model '${req.modelId}' is not loaded`);
    }

    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const vectors: number[][] = [];
    for (const text of inputs) {
      const res = await plugin.embedding({
        contextId,
        text,
        params: {},
      });
      vectors.push(res.embedding || []);
    }
    return { vectors };
  }

  async getMemorySnapshot(): Promise<MemorySnapshot> {
    const memoryFromPerformance = (globalThis as any)?.performance?.memory;
    if (memoryFromPerformance) {
      const totalBytes = Number(memoryFromPerformance.jsHeapSizeLimit);
      const usedBytes = Number(memoryFromPerformance.usedJSHeapSize);
      const freeBytes = Number(memoryFromPerformance.jsHeapSizeLimit - memoryFromPerformance.usedJSHeapSize);
      const usedRatio = totalBytes > 0 ? usedBytes / totalBytes : 0;
      const pressure = usedRatio >= 0.85 ? 'high' : usedRatio >= 0.7 ? 'medium' : 'low';
      return { totalBytes, usedBytes, freeBytes, pressure };
    }
    return { pressure: 'unknown' };
  }

  async health(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    return {
      ok: true,
      details: {
        loadedModels: this.contextByModel.size,
        maxModels: MAX_MODELS,
        schedulerLoadedModels: this.scheduler.listLoaded().length,
      },
    };
  }
}

