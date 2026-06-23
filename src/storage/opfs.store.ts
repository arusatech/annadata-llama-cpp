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

const writeStreamToFile = async (res: Response, fileHandle: any): Promise<number> => {
  const writable = await fileHandle.createWritable();
  let written = 0;
  try {
    if (!res.body) {
      const buf = await res.arrayBuffer();
      await writable.write(buf);
      written += buf.byteLength;
      return written;
    }

    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        await writable.write(value);
        written += value.byteLength;
      }
    }
    return written;
  } finally {
    await writable.close();
  }
};

export async function ensureModelInOpfs(modelId: string, modelUrl: string): Promise<ModelManifestEntry> {
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
    sizeBytes = await writeStreamToFile(res, fileHandle);
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

