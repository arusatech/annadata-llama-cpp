// Fix #9: LOAD_MODEL no longer carries an ArrayBuffer from the main thread.
// The worker reads the model from OPFS directly, halving peak memory usage.
export type WorkerRequest =
  | { id: string; type: 'INIT' }
  | {
      id: string;
      type: 'LOAD_MODEL';
      modelId: string;
      // modelBuffer removed — worker fetches from OPFS directly (#9)
      opts?: Record<string, unknown>;
    }
  | { id: string; type: 'UNLOAD_MODEL'; modelId: string }
  | {
      id: string;
      type: 'GENERATE';
      modelId: string;
      req: {
        prompt?: string;
        messages?: Array<{ role: string; content: string }>;
        max_tokens?: number;
        temperature?: number;
        stream?: boolean;
      };
    }
  | { id: string; type: 'EMBED'; modelId: string; input: string | string[] }
  | { id: string; type: 'TOKENIZE'; modelId: string; text: string }
  | { id: string; type: 'DETOKENIZE'; modelId: string; tokens: number[] }
  | { id: string; type: 'CONVERT_GRAMMAR'; schemaJson: string }
  | {
      id: string;
      type: 'RERANK';
      modelId: string;
      query: string;
      documents: string[];
    }
  | {
      id: string;
      type: 'BENCH';
      modelId: string;
      pp: number;
      tg: number;
      pl: number;
      nr: number;
    }
  | { id: string; type: 'SAVE_SESSION'; modelId: string; filepath: string; tokenSize: number }
  | { id: string; type: 'LOAD_SESSION'; modelId: string; filepath: string }
  | { id: string; type: 'APPLY_LORA'; modelId: string; loraAdapters: Array<{ path: string; scaled?: number }> }
  | { id: string; type: 'REMOVE_LORA'; modelId: string }
  | { id: string; type: 'GET_LORA'; modelId: string }
  | { id: string; type: 'INIT_MULTIMODAL'; modelId: string; path: string; useGpu?: boolean }
  | { id: string; type: 'MULTIMODAL_STATUS'; modelId: string }
  | { id: string; type: 'RELEASE_MULTIMODAL'; modelId: string }
  | { id: string; type: 'INIT_VOCODER'; modelId: string; path: string; nBatch?: number }
  | { id: string; type: 'VOCODER_ENABLED'; modelId: string }
  | { id: string; type: 'RELEASE_VOCODER'; modelId: string }
  | {
      id: string;
      type: 'FORMATTED_AUDIO';
      modelId: string;
      speakerJson: string;
      textToSpeak: string;
    }
  | { id: string; type: 'AUDIO_GUIDE_TOKENS'; modelId: string; textToSpeak: string }
  | { id: string; type: 'DECODE_AUDIO_TOKENS'; modelId: string; tokens: number[] }
  | { id: string; type: 'HEALTH' }
  | { id: string; type: 'MEMORY' };

export type WorkerEvent =
  | { id: string; type: 'TOKEN'; modelId: string; token: string; index: number }
  // Fix #6: progress events for OPFS model downloads
  | { id: string; type: 'PROGRESS'; modelId: string; downloaded: number; total: number }
  | { id: string; type: 'RESULT'; payload: unknown }
  | { id: string; type: 'ERROR'; code: string; message: string; meta?: Record<string, unknown> };
