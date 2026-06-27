/**
 * External GGUF read — model bytes stay in JS/OPFS; WASM sync-fread pulls on demand.
 * Does not require native WebAssembly JSPI (uses sync EM_JS, not EM_ASYNC_JS).
 */

/** True when this build includes the cap-wasm-fs fread hook. */
export const canUseAsyncFileRead = (wasmJspiBuild = false): boolean => wasmJspiBuild;

export type AsyncFileReader = {
  sizeBytes: number;
  /** Must be synchronous — called from WASM EM_JS without suspend. */
  readChunk: (offset: number, length: number) => Uint8Array;
};

/** Zero-copy subarray reader over a Uint8Array (ArrayBuffer load path). */
export const asyncReaderFromBytes = (bytes: Uint8Array): AsyncFileReader => ({
  sizeBytes: bytes.byteLength,
  readChunk: (offset, length) => bytes.subarray(offset, Math.min(offset + length, bytes.byteLength)),
});
