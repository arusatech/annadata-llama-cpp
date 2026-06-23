export type LlmErrorCode =
  | 'MODEL_NOT_LOADED'
  | 'MODEL_LIMIT_REACHED'
  | 'INSUFFICIENT_MEMORY'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_IO_FAILED'
  | 'UNSUPPORTED_PLATFORM'
  | 'WASM_INIT_FAILED'
  | 'NATIVE_PLUGIN_UNAVAILABLE'
  | 'INFERENCE_FAILED'
  | 'INVALID_REQUEST';

export class LlmError extends Error {
  code: LlmErrorCode;
  meta?: Record<string, unknown>;

  constructor(code: LlmErrorCode, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.meta = meta;
  }
}

