export type WorkerRequest =
  | { id: string; type: 'INIT' }
  | {
      id: string;
      type: 'LOAD_MODEL';
      modelId: string;
      modelBuffer: ArrayBuffer;
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
  | { id: string; type: 'RESULT'; payload: unknown }
  | { id: string; type: 'ERROR'; code: string; message: string; meta?: Record<string, unknown> };

