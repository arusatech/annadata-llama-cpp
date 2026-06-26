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
  | { id: string; type: 'HEALTH' }
  | { id: string; type: 'MEMORY' };

export type WorkerEvent =
  | { id: string; type: 'TOKEN'; modelId: string; token: string; index: number }
  // Fix #6: progress events for OPFS model downloads
  | { id: string; type: 'PROGRESS'; modelId: string; downloaded: number; total: number }
  | { id: string; type: 'RESULT'; payload: unknown }
  | { id: string; type: 'ERROR'; code: string; message: string; meta?: Record<string, unknown> };
