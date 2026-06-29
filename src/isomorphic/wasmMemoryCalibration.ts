export type ModelFootprintEntry = {
  fileBytes: number;
  estimatedBytes: number;
  measuredBytes?: number;
  linearBefore?: number;
  linearAfter?: number;
  calibratedAt?: number;
};

export type WasmProjectionInput = {
  wasmLinearBytes: number;
  residentModelCount: number;
  residentFootprintBytes: number;
  candidateEstimateBytes: number;
  candidateMeasuredBytes?: number;
};

const WARM_HEAP_BYTES = 64 * 1024 * 1024;

/** Bytes used for scheduling — measured when calibrated, else estimate. */
export function resolveFootprintBytes(
  entry: ModelFootprintEntry | number | undefined,
  fallbackEstimate: number,
): number {
  if (typeof entry === 'number' && entry > 0) return entry;
  if (entry && typeof entry === 'object') {
    if (typeof entry.measuredBytes === 'number' && entry.measuredBytes > 0) {
      return entry.measuredBytes;
    }
    if (entry.estimatedBytes > 0) return entry.estimatedBytes;
  }
  return fallbackEstimate;
}

/** Attribute heap growth to one model load (delta from linear before → after). */
export function calibrateFootprintFromLinearDelta(
  linearBefore: number,
  linearAfter: number,
  estimatedBytes: number,
  options?: { firstModelInHeap?: boolean },
): number {
  const delta = Math.max(0, linearAfter - linearBefore);
  if (options?.firstModelInHeap && linearAfter > WARM_HEAP_BYTES) {
    return linearAfter;
  }
  if (delta > 0) {
    return delta;
  }
  return estimatedBytes;
}

export function createFootprintEntry(
  fileBytes: number,
  estimatedBytes: number,
): ModelFootprintEntry {
  return { fileBytes, estimatedBytes };
}

export function applyCalibration(
  entry: ModelFootprintEntry,
  linearBefore: number,
  linearAfter: number,
  firstModelInHeap: boolean,
): ModelFootprintEntry {
  const measuredBytes = calibrateFootprintFromLinearDelta(
    linearBefore,
    linearAfter,
    entry.estimatedBytes,
    { firstModelInHeap },
  );
  return {
    ...entry,
    measuredBytes,
    linearBefore,
    linearAfter,
    calibratedAt: Date.now(),
  };
}

export function sumResidentFootprintBytes(
  footprints: Map<string, ModelFootprintEntry | number>,
  excludeModelId?: string,
): number {
  let sum = 0;
  for (const [id, entry] of footprints) {
    if (excludeModelId && id === excludeModelId) continue;
    const fallback = typeof entry === 'object' ? entry.estimatedBytes : 0;
    sum += resolveFootprintBytes(entry, fallback);
  }
  return sum;
}

/** Project WASM linear bytes after admitting one more model. */
export function projectWasmAfterLoad(input: WasmProjectionInput): number {
  const linear = input.wasmLinearBytes;
  const nextBytes = input.candidateMeasuredBytes ?? input.candidateEstimateBytes;

  if (input.residentModelCount > 0) {
    return linear + nextBytes;
  }
  if (linear > WARM_HEAP_BYTES) {
    return Math.max(linear, nextBytes);
  }
  return Math.max(linear, input.residentFootprintBytes, nextBytes);
}
