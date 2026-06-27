/**
 * HeapFS — allocate model bytes directly in WASM linear memory (wllama-style).
 *
 * Standard Emscripten MEMFS stores file contents in the JS heap; reads/mmap
 * copy into WASM. HeapFS patches MEMFS so file contents are a subarray of
 * HEAPU8 at an mmapAlloc'd address, enabling zero-copy mmap for llama.cpp.
 *
 * Ref: ref-code/wllama/src/workers-code/llama-cpp.js
 */

export type EmscriptenModule = {
  MEMFS: {
    stream_ops: Record<string, unknown> & {
      read: (...args: unknown[]) => unknown;
      write: (...args: unknown[]) => unknown;
      llseek: (...args: unknown[]) => unknown;
      allocate: (...args: unknown[]) => unknown;
      mmap: (...args: unknown[]) => unknown;
      msync: (...args: unknown[]) => unknown;
      _read?: (...args: unknown[]) => unknown;
      _write?: (...args: unknown[]) => unknown;
      _llseek?: (...args: unknown[]) => unknown;
      _allocate?: (...args: unknown[]) => unknown;
      _mmap?: (...args: unknown[]) => unknown;
      _msync?: (...args: unknown[]) => unknown;
    };
    ops_table: { file: { stream: Record<string, unknown> } };
  };
  FS: {
    mkdir: (path: string) => void;
    mount: (type: unknown, opts: unknown, mountpoint: string) => void;
    createDataFile: (
      parent: string,
      name: string,
      data: ArrayBuffer,
      canRead: boolean,
      canWrite: boolean,
      canOwn: boolean,
    ) => void;
  };
  mmapAlloc: (size: number) => number;
  HEAPU8: Uint8Array;
};

type HeapFile = {
  ptr: number;
  size: number;
  id: number;
};

const fsNameToFile: Record<string, HeapFile> = {};
const fsIdToFile: Record<number, HeapFile> = {};
let currFileId = 0;
let patched = false;

const getHeapU8 = (mod: EmscriptenModule): Uint8Array => {
  const buffer = (mod as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer ?? mod.HEAPU8.buffer;
  return new Uint8Array(buffer);
};

const patchStream = (mod: EmscriptenModule, stream: { node: { name: string; contents?: Uint8Array; usedBytes?: number } }) => {
  const name = stream.node.name;
  const f = fsNameToFile[name];
  if (!f) return;
  const heap = getHeapU8(mod);
  const ptr = f.ptr;
  stream.node.contents = heap.subarray(ptr, ptr + f.size);
  stream.node.usedBytes = f.size;
};

/** Patch MEMFS stream ops so mmap/read use WASM-heap-backed file storage. */
export const patchHeapFS = (mod: EmscriptenModule): void => {
  if (patched) return;
  patched = true;

  const ops = mod.MEMFS.stream_ops;
  ops._read = ops._read ?? ops.read;
  ops._write = ops._write ?? ops.write;
  ops._llseek = ops._llseek ?? ops.llseek;
  ops._allocate = ops._allocate ?? ops.allocate;
  ops._mmap = ops._mmap ?? ops.mmap;
  ops._msync = ops._msync ?? ops.msync;

  ops.read = function (this: unknown, stream: Parameters<typeof ops._read>[0], ...rest: unknown[]) {
    patchStream(mod, stream as Parameters<typeof patchStream>[1]);
    return (ops._read as (...a: unknown[]) => unknown).call(this, stream, ...rest);
  };
  mod.MEMFS.ops_table.file.stream.read = ops.read;

  ops.llseek = function (this: unknown, stream: Parameters<typeof ops._llseek>[0], ...rest: unknown[]) {
    patchStream(mod, stream as Parameters<typeof patchStream>[1]);
    return (ops._llseek as (...a: unknown[]) => unknown).call(this, stream, ...rest);
  };
  mod.MEMFS.ops_table.file.stream.llseek = ops.llseek;

  ops.mmap = function (this: unknown, stream: unknown, ...rest: unknown[]) {
    patchStream(mod, stream as Parameters<typeof patchStream>[1]);
    const name = (stream as { node: { name: string } }).node.name;
    const f = fsNameToFile[name];
    if (f) {
      const position = rest[1] as number;
      return { ptr: f.ptr + position, allocated: false };
    }
    return (ops._mmap as (...a: unknown[]) => unknown).call(this, stream, ...rest);
  };
  mod.MEMFS.ops_table.file.stream.mmap = ops.mmap;

  mod.FS.mkdir('/models');
  mod.FS.mount(mod.MEMFS, { root: '.' }, '/models');
};

/** Allocate `size` bytes in WASM heap for a model file; returns file id. */
export const heapfsAlloc = (mod: EmscriptenModule, name: string, size: number, allocBuffer = true): number => {
  if (size < 1) throw new Error('HeapFS file size must be > 0');
  const ptr = allocBuffer ? mod.mmapAlloc(size) : 0;
  const file: HeapFile = { ptr, size, id: currFileId++ };
  fsIdToFile[file.id] = file;
  fsNameToFile[name] = file;
  return file.id;
};

/** Write bytes at `offset` into a HeapFS file. Returns bytes written. */
export const heapfsWrite = (mod: EmscriptenModule, id: number, buffer: Uint8Array, offset: number): number => {
  const f = fsIdToFile[id];
  if (!f) throw new Error(`HeapFS file id ${id} not found`);
  const after = offset + buffer.byteLength;
  if (after > f.size) {
    throw new Error(`HeapFS write out of bounds: ${after} > ${f.size}`);
  }
  getHeapU8(mod).set(buffer, f.ptr + offset);
  return buffer.byteLength;
};

/** VFS path for a model basename under /models/. */
export const heapfsModelPath = (basename: string): string => `/models/${basename}`;

/** Whether HeapFS runtime methods are present on the module. */
export const supportsHeapFS = (mod: unknown): mod is EmscriptenModule =>
  !!mod &&
  typeof (mod as EmscriptenModule).mmapAlloc === 'function' &&
  typeof (mod as EmscriptenModule).MEMFS === 'object' &&
  typeof (mod as EmscriptenModule).FS === 'object';
