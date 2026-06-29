import type { MemorySnapshot } from './provider.interface';
import { projectWasmAfterLoad } from './wasmMemoryCalibration';

/** Max concurrent GGUF contexts in one WASM worker (matches n_threads slot policy). */
export const WASM_MAX_CONCURRENT_MODELS = 5;

/** Practical browser WASM pool cap (below Emscripten 2 GB hard max). */
export const WASM_POOL_CEILING_BYTES = 1536 * 1024 * 1024;

/** Emscripten MAXIMUM_MEMORY — absolute hard limit from build. */
export const WASM_EMSCRIPTEN_MAX_BYTES = 2147483648;

/** Keep this much headroom free inside the WASM pool after a load. */
export const WASM_POOL_RESERVE_BYTES = 64 * 1024 * 1024;

export type ModelLoadMemoryOpts = {
  n_ctx?: number;
  n_batch?: number;
  embedding?: boolean;
};

export type WasmMemoryStatus = MemorySnapshot & {
  wasmLinearBytes?: number;
  wasmPoolCeilingBytes?: number;
  wasmHeadroomBytes?: number;
  loadedModelCount?: number;
  maxModels?: number;
  loadedModels?: Array<{ modelId: string; fileBytes?: number; estimatedFootprintBytes?: number }>;
};

export type WasmLoadAdmissionInput = {
  modelId: string;
  fileBytes: number;
  loadOpts?: ModelLoadMemoryOpts;
  currentlyLoaded: number;
  maxModels?: number;
  wasmLinearBytes?: number;
  wasmPoolCeilingBytes?: number;
  loadedFootprintBytes?: number;
  /** Prior measured footprint for this model id (if re-loading after unload). */
  candidateMeasuredBytes?: number;
  reserveBytes?: number;
  browserMemory?: MemorySnapshot;
};

export type WasmLoadAdmissionResult = {
  allow: boolean;
  deniedBy?: 'limit' | 'wasm_pool' | 'browser_memory';
  reason?: string;
  estimatedFootprintBytes: number;
  projectedWasmBytes?: number;
};

/**
 * Estimate WASM linear memory for one model (weights + context/KV headroom).
 * PWA loads via async OPFS — weights are not fully duplicated in heap (not 2× file).
 * Observed: LFM2 ~697 MB GGUF → ~940 MB WASM; BGE ~17 MB → ~150–200 MB.
 */
export function estimateModelWasmFootprint(
  fileBytes: number,
  opts: ModelLoadMemoryOpts = {},
): number {
  if (!(fileBytes > 0)) return 20 * 1024 * 1024;

  const embedding = opts.embedding === true;
  const n_ctx = typeof opts.n_ctx === 'number' && opts.n_ctx > 0 ? opts.n_ctx : embedding ? 256 : 512;
  const n_batch = typeof opts.n_batch === 'number' && opts.n_batch > 0 ? opts.n_batch : embedding ? 32 : 16;

  // Async OPFS: ~1.3× file for large chat; embed models are lighter.
  const weightMultiplier = embedding ? 1.25 : fileBytes > 200 * 1024 * 1024 ? 1.32 : 1.2;
  const ctxBytes = n_ctx * n_batch * 4096;
  const proportional = Math.ceil(fileBytes * 0.12);
  const minHeadroom = embedding ? 48 * 1024 * 1024 : 96 * 1024 * 1024;
  const headroom = Math.max(minHeadroom, proportional, ctxBytes);

  return Math.ceil(fileBytes * weightMultiplier + headroom);
}

export function canAdmitWasmModelLoad(input: WasmLoadAdmissionInput): WasmLoadAdmissionResult {
  const maxModels = input.maxModels ?? WASM_MAX_CONCURRENT_MODELS;
  const ceiling = input.wasmPoolCeilingBytes ?? WASM_POOL_CEILING_BYTES;
  const reserve = input.reserveBytes ?? WASM_POOL_RESERVE_BYTES;
  const estimated = estimateModelWasmFootprint(input.fileBytes, input.loadOpts ?? {});

  if (input.currentlyLoaded >= maxModels) {
    return {
      allow: false,
      deniedBy: 'limit',
      reason: `Model slot limit reached (${maxModels} concurrent WASM contexts)`,
      estimatedFootprintBytes: estimated,
    };
  }

  const linear = input.wasmLinearBytes ?? 0;
  const loadedFootprint = input.loadedFootprintBytes ?? 0;
  const projectedWasm = projectWasmAfterLoad({
    wasmLinearBytes: linear,
    residentModelCount: input.currentlyLoaded,
    residentFootprintBytes: loadedFootprint,
    candidateEstimateBytes: estimated,
    candidateMeasuredBytes: input.candidateMeasuredBytes,
  });
  const admitLimit = ceiling - reserve;

  if (projectedWasm > admitLimit) {
    return {
      allow: false,
      deniedBy: 'wasm_pool',
      reason:
        `WASM pool would exceed ${(ceiling / 1024 / 1024).toFixed(0)} MB ` +
        `(projected ${(projectedWasm / 1024 / 1024).toFixed(0)} MB, ` +
        `GGUF ${(input.fileBytes / 1024 / 1024).toFixed(0)} MB → est. WASM ~${(estimated / 1024 / 1024).toFixed(0)} MB)`,
      estimatedFootprintBytes: estimated,
      projectedWasmBytes: projectedWasm,
    };
  }

  if (typeof input.browserMemory?.freeBytes === 'number') {
    const browserReserve = 256 * 1024 * 1024;
    const postFree = input.browserMemory.freeBytes - estimated;
    if (postFree < browserReserve) {
      return {
        allow: false,
        deniedBy: 'browser_memory',
        reason: 'Insufficient browser JS heap after model load reserve',
        estimatedFootprintBytes: estimated,
        projectedWasmBytes: projectedWasm,
      };
    }
  }

  return {
    allow: true,
    estimatedFootprintBytes: estimated,
    projectedWasmBytes: projectedWasm,
  };
}

export function wasmMemoryPressure(
  wasmLinearBytes: number,
  ceilingBytes: number = WASM_POOL_CEILING_BYTES,
): MemorySnapshot['pressure'] {
  if (!(wasmLinearBytes > 0) || !(ceilingBytes > 0)) return 'unknown';
  const ratio = wasmLinearBytes / ceilingBytes;
  if (ratio >= 0.85) return 'high';
  if (ratio >= 0.7) return 'medium';
  return 'low';
}
