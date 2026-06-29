export type PlatformKind = 'native' | 'web';

export interface InitializeOptions {
  modelId: string;
  modelPath?: string;
  modelUrl?: string;
  n_ctx?: number;
  n_batch?: number;
  n_threads?: number;
  n_gpu_layers?: number;
  embedding?: boolean;
  /** WASM: force VFS streaming instead of HeapFS (default: auto for models >500 MB). */
  preferVfsStreaming?: boolean;
  /** WASM: use mmap when loading from VFS (default false — safer for large GGUF). */
  use_mmap?: boolean;
  /** Called during OPFS model download with running byte counts (#6). */
  onProgress?: (downloaded: number, total: number) => void;
  [key: string]: unknown;
}

export interface GenerateRequest {
  modelId: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface TokenEvent {
  modelId: string;
  token: string;
  index: number;
}

export interface GenerateResult {
  text: string;
  tokens_predicted: number;
  tokens_evaluated: number;
  finish_reason: 'stop' | 'length' | 'error';
}

export interface EmbedRequest {
  modelId: string;
  input: string | string[];
}

export interface EmbedResult {
  vectors: number[][];
}

export interface MemorySnapshot {
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  pressure: 'low' | 'medium' | 'high' | 'unknown';
}

export interface LlmProvider {
  readonly platform: PlatformKind;
  initialize(opts: InitializeOptions): Promise<void>;
  loadModel(opts: InitializeOptions): Promise<void>;
  unloadModel(modelId: string): Promise<void>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  generateStream(req: GenerateRequest, onToken: (event: TokenEvent) => void): Promise<GenerateResult>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  getMemorySnapshot(): Promise<MemorySnapshot>;
  health(): Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}

