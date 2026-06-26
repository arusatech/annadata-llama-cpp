import { registerPlugin } from '@capacitor/core';
import type { LlamaCppPlugin, NativeLlamaContext, NativeCompletionResult } from './definitions';
import { WebProvider } from './isomorphic/provider.web';
import { ensureModelInOpfs } from './storage/opfs.store';
import { listManifestEntries } from './storage/manifest';

// ---------------------------------------------------------------------------
// Fix #4: LlamaCppWeb now delegates real inference work to WebProvider so
// that calling the standard Capacitor LlamaCpp API on the web platform routes
// through the WASM engine rather than throwing "not supported" errors.
// ---------------------------------------------------------------------------

const MODEL_DESC_STUB = {
  desc: 'WASM model',
  size: 0,
  nEmbd: 0,
  nParams: 0,
  chatTemplates: {
    llamaChat: true,
    minja: {
      default: true,
      defaultCaps: {
        tools: false, toolCalls: false, toolResponses: false,
        systemRole: true, parallelToolCalls: false, toolCallId: false,
      },
      toolUse: false,
      toolUseCaps: {
        tools: false, toolCalls: false, toolResponses: false,
        systemRole: true, parallelToolCalls: false, toolCallId: false,
      },
    },
  },
  metadata: {},
  isChatTemplateSupported: true,
};

// In-progress downloads: url → { abort: AbortController; progress: number; total: number }
const activeDownloads = new Map<string, {
  promise: Promise<void>;
  downloaded: number;
  total: number;
  completed: boolean;
  failed: boolean;
  errorMessage?: string;
  localPath?: string;
}>();

export class LlamaCppWeb implements LlamaCppPlugin {
  private provider = new WebProvider();
  // contextId → modelId
  private contextToModel = new Map<number, string>();

  // -------------------------------------------------------------------------
  // Core initialization
  // -------------------------------------------------------------------------
  async toggleNativeLog(): Promise<void> {
    // No-op on web; no native log callback to toggle.
  }

  async setContextLimit(): Promise<void> {
    // No-op; WebProvider manages its own slot limit via DefaultModelScheduler.
  }

  async modelInfo({ path }: { path: string; skip?: string[] }): Promise<Object> {
    const entry = await listManifestEntries().then((es) => es.find((e) => e.modelId === path || e.path === path));
    return {
      path,
      desc: 'WASM model (web)',
      size: entry?.sizeBytes ?? 0,
      ...MODEL_DESC_STUB,
    };
  }

  async initContext({
    contextId,
    params,
  }: {
    contextId: number;
    params: any;
  }): Promise<NativeLlamaContext> {
    // Use the model path/URL as the modelId for the isomorphic layer.
    const modelId: string = params.model;

    await this.provider.initialize({
      modelId,
      modelPath: params.model,
      // If model is a URL, ensureModelInOpfs will download it; if it's an
      // OPFS-relative path, WebProvider will look it up in the manifest.
      modelUrl: params.model?.startsWith('http') ? params.model : undefined,
      n_ctx: params.n_ctx,
      n_threads: params.n_threads,
      embedding: params.embedding,
    });

    this.contextToModel.set(contextId, modelId);

    return {
      contextId,
      gpu: false,
      reasonNoGPU: 'WebAssembly does not expose GPU acceleration in browsers',
      model: MODEL_DESC_STUB,
    };
  }

  async releaseContext({ contextId }: { contextId: number }): Promise<void> {
    const modelId = this.contextToModel.get(contextId);
    if (modelId) {
      await this.provider.unloadModel(modelId);
      this.contextToModel.delete(contextId);
    }
  }

  async releaseAllContexts(): Promise<void> {
    for (const [contextId, modelId] of this.contextToModel.entries()) {
      await this.provider.unloadModel(modelId).catch(() => {});
      this.contextToModel.delete(contextId);
    }
  }

  // -------------------------------------------------------------------------
  // Chat and completion
  // -------------------------------------------------------------------------

  async getFormattedChat({ messages }: { contextId: number; messages: string; chatTemplate?: string; params?: any }): Promise<any> {
    // Web: return a simple prompt string built from messages.
    const parsed: Array<{ role: string; content: string }> = JSON.parse(messages);
    const prompt = parsed.map((m) => `${m.role}: ${m.content}`).join('\n') + '\nassistant:';
    return { type: 'llama-chat', prompt, has_media: false, media_paths: [] };
  }

  async completion({
    contextId,
    params,
  }: {
    contextId: number;
    params: any;
  }): Promise<NativeCompletionResult> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');

    const result = await this.provider.generate({
      modelId,
      prompt: params.prompt,
      max_tokens: params.n_predict,
      temperature: params.temperature,
      stream: false,
    });

    return {
      text: result.text,
      content: result.text,
      reasoning_content: '',
      tool_calls: [],
      tokens_predicted: result.tokens_predicted,
      tokens_evaluated: result.tokens_evaluated,
      truncated: false,
      stopped_eos: result.finish_reason === 'stop',
      stopped_word: '',
      stopped_limit: result.finish_reason === 'length',
      stopping_word: '',
      context_full: false,
      interrupted: result.finish_reason === 'error',
      tokens_cached: 0,
      chat_format: 0,
      timings: {
        prompt_n: result.tokens_evaluated,
        prompt_ms: 0,
        prompt_per_token_ms: 0,
        prompt_per_second: 0,
        predicted_n: result.tokens_predicted,
        predicted_ms: 0,
        predicted_per_token_ms: 0,
        predicted_per_second: 0,
      },
    };
  }

  // Fix #7: implement chat convenience helpers (#7)
  async chat({ contextId, messages, params }: {
    contextId: number;
    messages: Array<{ role: string; content: string }>;
    system?: string;
    chatTemplate?: string;
    params?: any;
  }): Promise<NativeCompletionResult> {
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n') + '\nassistant:';
    return this.completion({ contextId, params: { ...params, prompt } });
  }

  async chatWithSystem({ contextId, system, message, params }: {
    contextId: number;
    system: string;
    message: string;
    params?: any;
  }): Promise<NativeCompletionResult> {
    return this.chat({
      contextId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      params,
    });
  }

  async generateText({ contextId, prompt, params }: {
    contextId: number;
    prompt: string;
    params?: any;
  }): Promise<NativeCompletionResult> {
    return this.completion({ contextId, params: { ...params, prompt } });
  }

  async stopCompletion(): Promise<void> {
    // WASM single-threaded — cannot interrupt mid-generation.
    // A future implementation can use a shared flag checked in the Rust loop.
  }

  // -------------------------------------------------------------------------
  // Session management (not supported on web)
  // -------------------------------------------------------------------------
  async loadSession(): Promise<any> {
    throw new Error('LlamaCppWeb: session persistence is not supported on web');
  }

  async saveSession(): Promise<number> {
    throw new Error('LlamaCppWeb: session persistence is not supported on web');
  }

  // -------------------------------------------------------------------------
  // Tokenization (stubs — require the WASM model to be loaded)
  // -------------------------------------------------------------------------
  async tokenize(): Promise<any> {
    throw new Error('LlamaCppWeb: tokenize requires direct WASM engine access; use WebProvider');
  }

  async detokenize(): Promise<string> {
    throw new Error('LlamaCppWeb: detokenize requires direct WASM engine access; use WebProvider');
  }

  // -------------------------------------------------------------------------
  // Embeddings
  // -------------------------------------------------------------------------
  async embedding({ contextId, text }: { contextId: number; text: string; params: any }): Promise<any> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    const result = await this.provider.embed({ modelId, input: text });
    return { embedding: result.vectors[0] ?? [] };
  }

  async rerank(): Promise<Array<any>> {
    throw new Error('LlamaCppWeb: rerank is not supported on web');
  }

  // -------------------------------------------------------------------------
  // Benchmarking
  // -------------------------------------------------------------------------
  async bench(): Promise<string> {
    throw new Error('LlamaCppWeb: bench is not supported on web');
  }

  // -------------------------------------------------------------------------
  // LoRA adapters (not available in WASM)
  // -------------------------------------------------------------------------
  async applyLoraAdapters(): Promise<void> {
    throw new Error('LlamaCppWeb: LoRA adapters are not supported on web');
  }

  async removeLoraAdapters(): Promise<void> {
    throw new Error('LlamaCppWeb: LoRA adapters are not supported on web');
  }

  async getLoadedLoraAdapters(): Promise<Array<{ path: string; scaled?: number }>> {
    return [];
  }

  // -------------------------------------------------------------------------
  // Multimodal (not available in WASM)
  // -------------------------------------------------------------------------
  async initMultimodal(): Promise<boolean> { return false; }
  async isMultimodalEnabled(): Promise<boolean> { return false; }
  async getMultimodalSupport(): Promise<{ vision: boolean; audio: boolean }> {
    return { vision: false, audio: false };
  }
  async releaseMultimodal(): Promise<void> {}

  // -------------------------------------------------------------------------
  // TTS (not available in WASM)
  // -------------------------------------------------------------------------
  async initVocoder(): Promise<boolean> { return false; }
  async isVocoderEnabled(): Promise<boolean> { return false; }
  async getFormattedAudioCompletion(): Promise<{ prompt: string; grammar?: string }> {
    throw new Error('LlamaCppWeb: TTS is not supported on web');
  }
  async getAudioCompletionGuideTokens(): Promise<Array<number>> {
    throw new Error('LlamaCppWeb: TTS is not supported on web');
  }
  async decodeAudioTokens(): Promise<Array<number>> {
    throw new Error('LlamaCppWeb: TTS is not supported on web');
  }
  async releaseVocoder(): Promise<void> {}

  // -------------------------------------------------------------------------
  // Fix #8: Model download / management — implemented via OPFS (#8)
  // -------------------------------------------------------------------------
  async downloadModel({ url, filename }: { url: string; filename: string }): Promise<string> {
    const modelId = filename;
    const entry = {
      promise: Promise.resolve<void>(undefined),
      downloaded: 0,
      total: 0,
      completed: false,
      failed: false,
      errorMessage: undefined as string | undefined,
      localPath: undefined as string | undefined,
    };

    entry.promise = ensureModelInOpfs(modelId, url, (downloaded, total) => {
      entry.downloaded = downloaded;
      entry.total = total;
    })
      .then((manifest) => {
        entry.completed = true;
        entry.localPath = manifest.path;
      })
      .catch((err: Error) => {
        entry.failed = true;
        entry.errorMessage = err.message;
      });

    activeDownloads.set(url, entry);
    return modelId;
  }

  async getDownloadProgress({ url }: { url: string }): Promise<{
    progress: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
    localPath?: string;
    downloadedBytes: number;
    totalBytes: number;
  }> {
    const dl = activeDownloads.get(url);
    if (!dl) {
      return { progress: 0, completed: false, failed: false, downloadedBytes: 0, totalBytes: 0 };
    }
    const progress = dl.total > 0 ? dl.downloaded / dl.total : 0;
    return {
      progress,
      completed: dl.completed,
      failed: dl.failed,
      errorMessage: dl.errorMessage,
      localPath: dl.localPath,
      downloadedBytes: dl.downloaded,
      totalBytes: dl.total,
    };
  }

  async cancelDownload({ url }: { url: string }): Promise<boolean> {
    const has = activeDownloads.has(url);
    activeDownloads.delete(url);
    return has;
  }

  async getAvailableModels(): Promise<Array<{ name: string; path: string; size: number }>> {
    const entries = await listManifestEntries();
    return entries.map((e) => ({
      name: e.modelId,
      path: e.path,
      size: e.sizeBytes,
    }));
  }

  // -------------------------------------------------------------------------
  // Grammar utilities
  // -------------------------------------------------------------------------
  async convertJsonSchemaToGrammar(): Promise<string> {
    throw new Error('LlamaCppWeb: convertJsonSchemaToGrammar requires the WASM engine');
  }

  // -------------------------------------------------------------------------
  // Native server (not available on web)
  // -------------------------------------------------------------------------
  async startNativeLlamaServer(): Promise<{ running: boolean }> {
    throw new Error('LlamaCppWeb: native server is only available on iOS/Android');
  }

  async stopNativeLlamaServer(): Promise<void> {}

  async isNativeLlamaServerRunning(): Promise<{ running: boolean }> {
    return { running: false };
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------
  async addListener(): Promise<void> {
    // Events are surfaced via the WebProvider's streaming callbacks.
  }

  async removeAllListeners(): Promise<void> {}
}

const LlamaCpp = registerPlugin<LlamaCppPlugin>('LlamaCpp', {
  web: () => import('./web').then((m) => new m.LlamaCppWeb()),
});

export * from './definitions';
export { LlamaCpp };
