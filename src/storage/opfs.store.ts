import { LlmError } from '../isomorphic/errors';
import {
  getManifestEntry,
  listManifestEntries,
  type ModelManifestEntry,
  removeManifestEntry,
  upsertManifestEntry,
} from './manifest';

const MODELS_DIR = 'models';

const getStorageApi = (): any => {
  const storageApi = (globalThis as any)?.navigator?.storage;
  if (!storageApi || typeof storageApi.getDirectory !== 'function') {
    throw new LlmError(
      'STORAGE_UNAVAILABLE',
      'OPFS is not available in this runtime. navigator.storage.getDirectory is missing.',
    );
  }
  return storageApi;
};

const getRootDirectory = async (): Promise<any> => {
  const storageApi = getStorageApi();
  try {
    return await storageApi.getDirectory();
  } catch (error) {
    throw new LlmError('STORAGE_IO_FAILED', 'Failed to access OPFS root directory.', {
      cause: String(error),
    });
  }
};

const sanitizeModelId = (modelId: string): string =>
  modelId.replace(/[^a-zA-Z0-9._-]/g, '_');

const pathForModelId = (modelId: string): string =>
  `${MODELS_DIR}/${sanitizeModelId(modelId)}.gguf`;

const ensureParentDirAndFileHandle = async (path: string, create = true): Promise<any> => {
  const root = await getRootDirectory();
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    throw new LlmError('STORAGE_IO_FAILED', `Invalid OPFS path '${path}'.`);
  }
  let current = root;
  for (const dir of parts) {
    current = await current.getDirectoryHandle(dir, { create: true });
  }
  return current.getFileHandle(fileName, { create });
};

const writeStreamToFile = async (
  res: Response,
  fileHandle: any,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<number> => {
  const writable = await fileHandle.createWritable();
  const total = Number(res.headers.get('content-length') ?? 0);
  let written = 0;
  try {
    if (!res.body) {
      const buf = await res.arrayBuffer();
      await writable.write(buf);
      written += buf.byteLength;
      onProgress?.(written, total || written);
      return written;
    }

    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        await writable.write(value);
        written += value.byteLength;
        onProgress?.(written, total || written);
      }
    }
    return written;
  } finally {
    await writable.close();
  }
};

export async function ensureModelInOpfs(
  modelId: string,
  modelUrl: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<ModelManifestEntry> {
  if (!modelId) {
    throw new LlmError('INVALID_REQUEST', 'modelId is required for OPFS storage.');
  }
  if (!modelUrl) {
    throw new LlmError('INVALID_REQUEST', 'modelUrl is required for OPFS storage.');
  }

  const existing = await getManifestEntry(modelId);
  if (existing) {
    await upsertManifestEntry({ ...existing, lastUsedAt: Date.now() });
    return { ...existing, lastUsedAt: Date.now() };
  }

  let res: Response;
  try {
    res = await fetch(modelUrl);
  } catch (error) {
    throw new LlmError('MODEL_DOWNLOAD_FAILED', `Failed to download model '${modelId}'.`, {
      modelId,
      modelUrl,
      cause: String(error),
    });
  }
  if (!res.ok) {
    throw new LlmError('MODEL_DOWNLOAD_FAILED', `Failed to download model '${modelId}': HTTP ${res.status}`, {
      modelId,
      modelUrl,
      status: res.status,
    });
  }

  const path = pathForModelId(modelId);
  let sizeBytes = 0;
  try {
    const fileHandle = await ensureParentDirAndFileHandle(path, true);
    sizeBytes = await writeStreamToFile(res, fileHandle, onProgress);
  } catch (error) {
    throw new LlmError('STORAGE_IO_FAILED', `Failed to persist model '${modelId}' in OPFS.`, {
      modelId,
      path,
      cause: String(error),
    });
  }

  const now = Date.now();
  const entry: ModelManifestEntry = {
    modelId,
    path,
    sizeBytes,
    sourceUrl: modelUrl,
    createdAt: now,
    lastUsedAt: now,
  };
  await upsertManifestEntry(entry);
  return entry;
}

/**
 * Choice 3 — primary web model load path.
 * Opens an OPFS FileSystemSyncAccessHandle in the worker and reads the
 * model in fixed-size chunks (default 4MB). Chunks are streamed into WASM
 * MEMFS; the full GGUF is never materialised as a single JS ArrayBuffer.
 *
 * Worker-only: createSyncAccessHandle is not available on the main thread.
 */
export const OPFS_MODEL_CHUNK_BYTES = 4 * 1024 * 1024;

export interface OpfsModelSyncReader {
  readonly sizeBytes: number;
  readChunk(offset: number, length?: number): Uint8Array;
  close(): void;
}

export async function openOpfsModelSyncReader(modelId: string): Promise<OpfsModelSyncReader> {
  const entry = await getManifestEntry(modelId);
  if (!entry) {
    throw new LlmError('MODEL_NOT_LOADED', `Model '${modelId}' is not present in OPFS manifest.`);
  }

  const fileHandle = await ensureParentDirAndFileHandle(entry.path, false);
  if (typeof fileHandle.createSyncAccessHandle !== 'function') {
    throw new LlmError(
      'STORAGE_UNAVAILABLE',
      'OPFS sync access handles are not available in this browser/worker context.',
      { modelId },
    );
  }

  let accessHandle: {
    getSize(): number;
    read(buffer: Uint8Array, options: { at: number }): number;
    close(): void;
  };
  try {
    accessHandle = await fileHandle.createSyncAccessHandle();
  } catch (error) {
    throw new LlmError('STORAGE_IO_FAILED', `Failed to open OPFS sync handle for '${modelId}'.`, {
      modelId,
      path: entry.path,
      cause: String(error),
    });
  }

  const sizeBytes = accessHandle.getSize();
  await upsertManifestEntry({ ...entry, lastUsedAt: Date.now() });

  return {
    sizeBytes,
    readChunk(offset: number, length = OPFS_MODEL_CHUNK_BYTES) {
      const toRead = Math.min(length, sizeBytes - offset);
      if (toRead <= 0) {
        return new Uint8Array(0);
      }
      const buf = new Uint8Array(toRead);
      const bytesRead = accessHandle.read(buf, { at: offset });
      return buf.subarray(0, bytesRead);
    },
    close() {
      accessHandle.close();
    },
  };
}

/**
 * Read the model from OPFS as an ArrayBuffer (fallback when sync handles
 * are unavailable). Prefer openOpfsModelSyncReader in workers.
 */
export async function readModelBufferFromOpfs(modelId: string): Promise<{ buffer: ArrayBuffer; sizeBytes: number }> {
  const file = await readModelFromOpfs(modelId);
  const buffer = await file.arrayBuffer();
  return { buffer, sizeBytes: file.size };
}

export async function readModelFromOpfs(modelId: string): Promise<File> {
  const entry = await getManifestEntry(modelId);
  if (!entry) {
    throw new LlmError('MODEL_NOT_LOADED', `Model '${modelId}' is not present in OPFS manifest.`);
  }
  try {
    const fileHandle = await ensureParentDirAndFileHandle(entry.path, false);
    const file = await fileHandle.getFile();
    await upsertManifestEntry({ ...entry, lastUsedAt: Date.now() });
    return file;
  } catch (error) {
    throw new LlmError('STORAGE_IO_FAILED', `Failed to read model '${modelId}' from OPFS.`, {
      modelId,
      path: entry.path,
      cause: String(error),
    });
  }
}

export async function removeModelFromOpfs(modelId: string): Promise<void> {
  const entry = await getManifestEntry(modelId);
  if (!entry) return;

  const root = await getRootDirectory();
  const parts = entry.path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    await removeManifestEntry(modelId);
    return;
  }

  try {
    let current = root;
    for (const dir of parts) {
      current = await current.getDirectoryHandle(dir, { create: false });
    }
    await current.removeEntry(fileName);
  } catch (error) {
    // Keep manifest cleanup deterministic even if file was already gone.
    if (!(error instanceof Error) || !/not found/i.test(error.message)) {
      throw new LlmError('STORAGE_IO_FAILED', `Failed to remove model '${modelId}' from OPFS.`, {
        modelId,
        path: entry.path,
        cause: String(error),
      });
    }
  } finally {
    await removeManifestEntry(modelId);
  }
}

export async function getOpfsUsage(): Promise<{ usedBytes: number; quotaBytes?: number }> {
  const entries = await listManifestEntries();
  const usedBytes = entries.reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
  const estimate = await (globalThis as any)?.navigator?.storage?.estimate?.();
  const quotaBytes = typeof estimate?.quota === 'number' ? estimate.quota : undefined;
  return { usedBytes, quotaBytes };
}

