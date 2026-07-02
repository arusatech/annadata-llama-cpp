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

// ---------------------------------------------------------------------------
// Chat template formatting
// ---------------------------------------------------------------------------

type ChatMessage = { role: string; content: string };

/**
 * Format a message array into a prompt string using the specified template.
 * Supports the four most common open-weight model formats. Defaults to ChatML.
 */
function formatMessagesWithTemplate(messages: ChatMessage[], template?: string): string {
  const tpl = (template ?? 'chatml').toLowerCase();

  if (tpl === 'llama3' || tpl === 'llama-3') {
    const parts = messages.map(
      (m) =>
        `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`,
    );
    return `<|begin_of_text|>${parts.join('')}<|start_header_id|>assistant<|end_header_id|>\n\n`;
  }

  if (tpl === 'mistral') {
    // Mistral: [INST] user [/INST] assistant </s> [INST] ...
    let out = '';
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'system') {
        out += `[INST] ${m.content}\n`;
      } else if (m.role === 'user') {
        out += `[INST] ${m.content} [/INST]`;
      } else if (m.role === 'assistant') {
        out += ` ${m.content}</s>`;
      }
    }
    return out;
  }

  if (tpl === 'gemma' || tpl === 'gemma2') {
    const parts = messages.map(
      (m) => `<start_of_turn>${m.role}\n${m.content}<end_of_turn>`,
    );
    return `${parts.join('\n')}\n<start_of_turn>model\n`;
  }

  // Default: ChatML — widely used by Qwen, Phi, Hermes, OpenChat, etc.
  const parts = messages.map(
    (m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>`,
  );
  return `${parts.join('\n')}\n<|im_start|>assistant\n`;
}

// ---------------------------------------------------------------------------
// In-progress downloads
// ---------------------------------------------------------------------------
type ActiveDownload = {
  abortController: AbortController;
  promise: Promise<void>;
  downloaded: number;
  total: number;
  completed: boolean;
  failed: boolean;
  errorMessage?: string;
  localPath?: string;
};

const activeDownloads = new Map<string, ActiveDownload>();

/** Map a user-facing path to a WASM VFS path (MEMFS /tmp). */
function vfsPathForWeb(filepath: string): string {
  if (filepath.startsWith('/')) return filepath;
  const base = filepath.split(/[/\\]/).pop() ?? 'file.bin';
  return `/tmp/${base}`;
}

export class LlamaCppWeb implements LlamaCppPlugin {
  private provider = new WebProvider();
  // contextId → modelId
  private contextToModel = new Map<number, string>();
  // eventName → Set of listener callbacks
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  private emitListener(eventName: string, data: unknown): void {
    this.listeners.get(eventName)?.forEach((cb) => cb(data));
  }

  private hasListeners(eventName: string): boolean {
    const set = this.listeners.get(eventName);
    return !!set && set.size > 0;
  }

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

  async getFormattedChat({ messages, chatTemplate }: { contextId: number; messages: string; chatTemplate?: string; params?: any }): Promise<any> {
    const parsed: Array<{ role: string; content: string }> = JSON.parse(messages);
    const prompt = formatMessagesWithTemplate(parsed, chatTemplate);
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

    const wantStream = this.hasListeners('@LlamaCpp_onToken');
    const generateFn = wantStream
      ? this.provider.generateStream.bind(
          this.provider,
          {
            modelId,
            prompt: params.prompt,
            max_tokens: params.n_predict,
            temperature: params.temperature,
            stream: true,
          },
          (evt) => {
            this.emitListener('@LlamaCpp_onToken', {
              contextId,
              token: evt.token,
              index: evt.index,
            });
          },
        )
      : () =>
          this.provider.generate({
            modelId,
            prompt: params.prompt,
            max_tokens: params.n_predict,
            temperature: params.temperature,
            stream: false,
          });

    const result = await generateFn();

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
    // Terminates the worker process; the model must be reloaded on the next call.
    this.provider.stopGeneration();
  }

  // -------------------------------------------------------------------------
  // Session management (WASM VFS — persist via /tmp paths in worker)
  // -------------------------------------------------------------------------
  async loadSession({
    contextId,
    filepath,
  }: {
    contextId: number;
    filepath: string;
  }): Promise<{ tokens_loaded: number; prompt: string }> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.loadSession(modelId, vfsPathForWeb(filepath));
  }

  async saveSession({
    contextId,
    filepath,
    size,
  }: {
    contextId: number;
    filepath: string;
    size: number;
  }): Promise<number> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.saveSession(modelId, vfsPathForWeb(filepath), size);
  }

  // -------------------------------------------------------------------------
  // Tokenization
  // -------------------------------------------------------------------------
  async tokenize({
    contextId,
    text,
  }: {
    contextId: number;
    text: string;
    [key: string]: unknown;
  }): Promise<{ tokens: number[]; has_media: boolean }> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    const result = await this.provider.tokenize(modelId, text);
    return { tokens: result.tokens, has_media: result.has_media ?? false };
  }

  async detokenize({
    contextId,
    tokens,
  }: {
    contextId: number;
    tokens: number[];
    [key: string]: unknown;
  }): Promise<string> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    const result = await this.provider.detokenize(modelId, tokens);
    return result.text;
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

  async rerank({
    contextId,
    query,
    documents,
  }: {
    contextId: number;
    query: string;
    documents: string[];
    params?: Record<string, unknown>;
  }): Promise<Array<{ score: number; index: number }>> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.rerank(modelId, query, documents);
  }

  // -------------------------------------------------------------------------
  // Benchmarking
  // -------------------------------------------------------------------------
  async bench({
    contextId,
    pp,
    tg,
    pl,
    nr,
  }: {
    contextId: number;
    pp: number;
    tg: number;
    pl: number;
    nr: number;
  }): Promise<string> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.bench(modelId, pp, tg, pl, nr);
  }

  // -------------------------------------------------------------------------
  // LoRA adapters
  // -------------------------------------------------------------------------
  async applyLoraAdapters({
    contextId,
    loraAdapters,
  }: {
    contextId: number;
    loraAdapters: Array<{ path: string; scaled?: number }>;
  }): Promise<void> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    const mapped = loraAdapters.map((la) => ({
      ...la,
      path: vfsPathForWeb(la.path),
    }));
    await this.provider.applyLoraAdapters(modelId, mapped);
  }

  async removeLoraAdapters({ contextId }: { contextId: number }): Promise<void> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    await this.provider.removeLoraAdapters(modelId);
  }

  async getLoadedLoraAdapters({
    contextId,
  }: {
    contextId: number;
  }): Promise<Array<{ path: string; scaled?: number }>> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.getLoadedLoraAdapters(modelId);
  }

  // -------------------------------------------------------------------------
  // Multimodal
  // -------------------------------------------------------------------------
  async initMultimodal({
    contextId,
    params,
  }: {
    contextId: number;
    params: { path: string; use_gpu?: boolean };
  }): Promise<boolean> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.initMultimodal(modelId, vfsPathForWeb(params.path), params.use_gpu ?? false);
  }

  async isMultimodalEnabled({ contextId }: { contextId: number }): Promise<boolean> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) return false;
    return this.provider.isMultimodalEnabled(modelId);
  }

  async getMultimodalSupport({ contextId }: { contextId: number }): Promise<{ vision: boolean; audio: boolean }> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) return { vision: false, audio: false };
    return this.provider.getMultimodalSupport(modelId);
  }

  async releaseMultimodal({ contextId }: { contextId: number }): Promise<void> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) return;
    await this.provider.releaseMultimodal(modelId);
  }

  // -------------------------------------------------------------------------
  // TTS
  // -------------------------------------------------------------------------
  async initVocoder({
    contextId,
    params,
  }: {
    contextId: number;
    params: { path: string; n_batch?: number };
  }): Promise<boolean> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.initVocoder(
      modelId,
      vfsPathForWeb(params.path),
      params.n_batch ?? 512,
    );
  }

  async isVocoderEnabled({ contextId }: { contextId: number }): Promise<boolean> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) return false;
    return this.provider.isVocoderEnabled(modelId);
  }

  async getFormattedAudioCompletion({
    contextId,
    speaker,
    textToSpeak,
  }: {
    contextId: number;
    speaker: object | null;
    textToSpeak: string;
  }): Promise<{ prompt: string; grammar?: string }> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.getFormattedAudioCompletion(modelId, speaker, textToSpeak);
  }

  async getAudioCompletionGuideTokens({
    contextId,
    textToSpeak,
  }: {
    contextId: number;
    textToSpeak: string;
  }): Promise<number[]> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.getAudioCompletionGuideTokens(modelId, textToSpeak);
  }

  async decodeAudioTokens({
    contextId,
    tokens,
  }: {
    contextId: number;
    tokens: number[];
  }): Promise<number[]> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) throw new Error('LlamaCppWeb: context not found');
    return this.provider.decodeAudioTokens(modelId, tokens);
  }

  async releaseVocoder({ contextId }: { contextId: number }): Promise<void> {
    const modelId = this.contextToModel.get(contextId);
    if (!modelId) return;
    await this.provider.releaseVocoder(modelId);
  }

  // -------------------------------------------------------------------------
  // Fix #8: Model download / management — implemented via OPFS (#8)
  // -------------------------------------------------------------------------
  async downloadModel({ url, filename }: { url: string; filename: string }): Promise<string> {
    const modelId = filename;
    const abortController = new AbortController();
    const entry: ActiveDownload = {
      abortController,
      promise: Promise.resolve<void>(undefined),
      downloaded: 0,
      total: 0,
      completed: false,
      failed: false,
      errorMessage: undefined,
      localPath: undefined,
    };

    entry.promise = ensureModelInOpfs(
      modelId,
      url,
      (downloaded, total) => {
        entry.downloaded = downloaded;
        entry.total = total;
        this.emitListener('@LlamaCpp_onDownloadProgress', {
          url,
          modelId,
          downloaded,
          total,
          progress: total > 0 ? downloaded / total : 0,
        });
      },
      abortController.signal,
    )
      .then((manifest) => {
        entry.completed = true;
        entry.localPath = manifest.path;
        this.emitListener('@LlamaCpp_onDownloadComplete', { url, modelId, localPath: manifest.path });
      })
      .catch((err: Error) => {
        const cancelled = abortController.signal.aborted;
        entry.failed = !cancelled;
        entry.errorMessage = err.message;
        if (!cancelled) {
          this.emitListener('@LlamaCpp_onDownloadError', { url, modelId, error: err.message });
        }
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
    const entry = activeDownloads.get(url);
    if (!entry) return false;
    entry.abortController.abort();
    activeDownloads.delete(url);
    return true;
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
  async convertJsonSchemaToGrammar({
    schema,
  }: {
    schema: string;
    [key: string]: unknown;
  }): Promise<string> {
    return this.provider.convertJsonSchemaToGrammar(schema);
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
  async addListener(eventName: string, listenerFunc: (data: unknown) => void): Promise<{ remove: () => void }> {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(listenerFunc);
    return {
      remove: () => {
        this.listeners.get(eventName)?.delete(listenerFunc);
      },
    };
  }

  async removeAllListeners(): Promise<void> {
    this.listeners.clear();
  }
}

const LlamaCpp = registerPlugin<LlamaCppPlugin>('LlamaCpp', {
  web: () => import('./web').then((m) => new m.LlamaCppWeb()),
});

export * from './definitions';
export { LlamaCpp };
