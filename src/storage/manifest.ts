import { LlmError } from '../isomorphic/errors';

export interface ModelManifestEntry {
  modelId: string;
  path: string;
  sizeBytes: number;
  sha256?: string;
  sourceUrl?: string;
  createdAt: number;
  lastUsedAt: number;
}

type ManifestMap = Record<string, ModelManifestEntry>;

const MANIFEST_FILE = '.llm-manifest.json';

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

const readTextFile = async (fileHandle: any): Promise<string> => {
  const file = await fileHandle.getFile();
  return file.text();
};

const writeTextFile = async (fileHandle: any, content: string): Promise<void> => {
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
};

async function loadManifestInternal(): Promise<ManifestMap> {
  const root = await getRootDirectory();
  try {
    const handle = await root.getFileHandle(MANIFEST_FILE, { create: true });
    const content = await readTextFile(handle);
    if (!content.trim()) {
      return {};
    }
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ManifestMap;
  } catch (error) {
    throw new LlmError('STORAGE_IO_FAILED', 'Failed to read OPFS manifest.', {
      cause: String(error),
    });
  }
}

async function saveManifestInternal(manifest: ManifestMap): Promise<void> {
  const root = await getRootDirectory();
  try {
    const handle = await root.getFileHandle(MANIFEST_FILE, { create: true });
    await writeTextFile(handle, JSON.stringify(manifest, null, 2));
  } catch (error) {
    throw new LlmError('STORAGE_IO_FAILED', 'Failed to write OPFS manifest.', {
      cause: String(error),
    });
  }
}

export async function listManifestEntries(): Promise<ModelManifestEntry[]> {
  const manifest = await loadManifestInternal();
  return Object.values(manifest);
}

export async function getManifestEntry(modelId: string): Promise<ModelManifestEntry | undefined> {
  const manifest = await loadManifestInternal();
  return manifest[modelId];
}

export async function upsertManifestEntry(entry: ModelManifestEntry): Promise<void> {
  const manifest = await loadManifestInternal();
  manifest[entry.modelId] = entry;
  await saveManifestInternal(manifest);
}

export async function removeManifestEntry(modelId: string): Promise<void> {
  const manifest = await loadManifestInternal();
  if (manifest[modelId]) {
    delete manifest[modelId];
    await saveManifestInternal(manifest);
  }
}

