import { registerPlugin } from '@capacitor/core';
import type { LlamaCppPlugin } from './definitions';

export class LlamaCppWeb implements LlamaCppPlugin {
  // Core initialization and management
  async toggleNativeLog(): Promise<void> {
    console.warn('LlamaCpp: toggleNativeLog is not supported on web platform');
  }

  async setContextLimit(): Promise<void> {
    console.warn('LlamaCpp: setContextLimit is not supported on web platform');
  }

  async modelInfo(): Promise<Object> {
    console.warn('LlamaCpp: modelInfo is not supported on web platform');
    return {};
  }

  async initContext(): Promise<any> {
    throw new Error('LlamaCpp: initContext is not supported on web platform. Use native platforms (iOS/Android) for llama.cpp functionality.');
  }

  async releaseContext(): Promise<void> {
    console.warn('LlamaCpp: releaseContext is not supported on web platform');
  }

  async releaseAllContexts(): Promise<void> {
    console.warn('LlamaCpp: releaseAllContexts is not supported on web platform');
  }

  // Chat and completion
  async getFormattedChat(): Promise<any> {
    throw new Error('LlamaCpp: getFormattedChat is not supported on web platform');
  }

  async completion(): Promise<any> {
    throw new Error('LlamaCpp: completion is not supported on web platform');
  }

  async stopCompletion(): Promise<void> {
    console.warn('LlamaCpp: stopCompletion is not supported on web platform');
  }

  // Session management
  async loadSession(): Promise<any> {
    throw new Error('LlamaCpp: loadSession is not supported on web platform');
  }

  async saveSession(): Promise<number> {
    throw new Error('LlamaCpp: saveSession is not supported on web platform');
  }

  // Tokenization
  async tokenize(): Promise<any> {
    throw new Error('LlamaCpp: tokenize is not supported on web platform');
  }

  async detokenize(): Promise<string> {
    throw new Error('LlamaCpp: detokenize is not supported on web platform');
  }

  // Embeddings and reranking
  async embedding(): Promise<any> {
    throw new Error('LlamaCpp: embedding is not supported on web platform');
  }

  async rerank(): Promise<Array<any>> {
    throw new Error('LlamaCpp: rerank is not supported on web platform');
  }

  // Benchmarking
  async bench(): Promise<string> {
    throw new Error('LlamaCpp: bench is not supported on web platform');
  }

  // LoRA adapters
  async applyLoraAdapters(): Promise<void> {
    console.warn('LlamaCpp: applyLoraAdapters is not supported on web platform');
  }

  async removeLoraAdapters(): Promise<void> {
    console.warn('LlamaCpp: removeLoraAdapters is not supported on web platform');
  }

  async getLoadedLoraAdapters(): Promise<Array<{ path: string; scaled?: number }>> {
    console.warn('LlamaCpp: getLoadedLoraAdapters is not supported on web platform');
    return [];
  }

  // Multimodal methods
  async initMultimodal(): Promise<boolean> {
    console.warn('LlamaCpp: initMultimodal is not supported on web platform');
    return false;
  }

  async isMultimodalEnabled(): Promise<boolean> {
    console.warn('LlamaCpp: isMultimodalEnabled is not supported on web platform');
    return false;
  }

  async getMultimodalSupport(): Promise<{ vision: boolean; audio: boolean }> {
    console.warn('LlamaCpp: getMultimodalSupport is not supported on web platform');
    return { vision: false, audio: false };
  }

  async releaseMultimodal(): Promise<void> {
    console.warn('LlamaCpp: releaseMultimodal is not supported on web platform');
  }

  // TTS methods
  async initVocoder(): Promise<boolean> {
    console.warn('LlamaCpp: initVocoder is not supported on web platform');
    return false;
  }

  async isVocoderEnabled(): Promise<boolean> {
    console.warn('LlamaCpp: isVocoderEnabled is not supported on web platform');
    return false;
  }

  async getFormattedAudioCompletion(): Promise<{ prompt: string; grammar?: string }> {
    throw new Error('LlamaCpp: getFormattedAudioCompletion is not supported on web platform');
  }

  async getAudioCompletionGuideTokens(): Promise<Array<number>> {
    throw new Error('LlamaCpp: getAudioCompletionGuideTokens is not supported on web platform');
  }

  async decodeAudioTokens(): Promise<Array<number>> {
    throw new Error('LlamaCpp: decodeAudioTokens is not supported on web platform');
  }

  async releaseVocoder(): Promise<void> {
    console.warn('LlamaCpp: releaseVocoder is not supported on web platform');
  }

  async startNativeLlamaServer(): Promise<{ running: boolean }> {
    throw new Error('LlamaCpp: startNativeLlamaServer is only available on iOS/Android native');
  }

  async stopNativeLlamaServer(): Promise<void> {
    console.warn('LlamaCpp: stopNativeLlamaServer is not supported on web platform');
  }

  async isNativeLlamaServerRunning(): Promise<{ running: boolean }> {
    return { running: false };
  }

  // Events
  async addListener(): Promise<void> {
    console.warn('LlamaCpp: addListener is not supported on web platform');
  }

  async removeAllListeners(): Promise<void> {
    console.warn('LlamaCpp: removeAllListeners is not supported on web platform');
  }
}

const LlamaCpp = registerPlugin<LlamaCppPlugin>('LlamaCpp', {
  web: () => import('./web').then((m) => new m.LlamaCppWeb()),
});

export * from './definitions';
export { LlamaCpp };
