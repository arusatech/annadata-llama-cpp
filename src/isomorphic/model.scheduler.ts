import type { MemorySnapshot } from './provider.interface';
import { canAdmitModel } from './model.admission';
import {
  canAdmitWasmModelLoad,
  estimateModelWasmFootprint,
  type ModelLoadMemoryOpts,
  WASM_MAX_CONCURRENT_MODELS,
  WASM_POOL_CEILING_BYTES,
} from './wasmMemoryPolicy';
import { LlmError } from './errors';

export type WasmAdmissionContext = {
  wasmLinearBytes?: number;
  wasmPoolCeilingBytes?: number;
  loadOpts?: ModelLoadMemoryOpts;
};

export interface Scheduler {
  ensureCapacity(
    modelId: string,
    modelBytes: number,
    memory: MemorySnapshot,
    reserveBytes?: number,
    wasm?: WasmAdmissionContext,
  ): void;
  markLoaded(
    modelId: string,
    modelBytes?: number,
    loadOpts?: ModelLoadMemoryOpts,
    measuredFootprintBytes?: number,
  ): void;
  markUnloaded(modelId: string): void;
  listLoaded(): string[];
  totalFootprintBytes(): number;
  calibrateFootprint(modelId: string, measuredFootprintBytes: number): void;
  getFootprintBytes(modelId: string): number | undefined;
}

export class DefaultModelScheduler implements Scheduler {
  private loaded = new Set<string>();
  private footprints = new Map<string, number>();

  constructor(private maxModels: number = WASM_MAX_CONCURRENT_MODELS) {}

  ensureCapacity(
    modelId: string,
    modelBytes: number,
    memory: MemorySnapshot,
    reserveBytes?: number,
    wasm?: WasmAdmissionContext,
  ): void {
    if (this.loaded.has(modelId)) return;

    const loadOpts = wasm?.loadOpts;
    const estimatedFootprint = estimateModelWasmFootprint(modelBytes, loadOpts ?? {});

    const wasmAdmission = canAdmitWasmModelLoad({
      modelId,
      fileBytes: modelBytes,
      loadOpts,
      currentlyLoaded: this.loaded.size,
      maxModels: this.maxModels,
      wasmLinearBytes: wasm?.wasmLinearBytes,
      wasmPoolCeilingBytes: wasm?.wasmPoolCeilingBytes ?? WASM_POOL_CEILING_BYTES,
      loadedFootprintBytes: this.totalFootprintBytes(),
      reserveBytes,
      browserMemory: memory,
    });
    if (!wasmAdmission.allow) {
      const code =
        wasmAdmission.deniedBy === 'limit' ? 'MODEL_LIMIT_REACHED' : 'INSUFFICIENT_MEMORY';
      throw new LlmError(code, wasmAdmission.reason ?? 'WASM model admission rejected', {
        modelId,
        estimatedBytes: wasmAdmission.estimatedFootprintBytes,
        projectedWasmBytes: wasmAdmission.projectedWasmBytes,
        deniedBy: wasmAdmission.deniedBy,
      });
    }

    const admission = canAdmitModel({
      modelId,
      modelBytes,
      currentlyLoaded: this.loaded.size,
      maxModels: this.maxModels,
      memory,
      reserveBytes,
      estimatedMultiplier: estimatedFootprint / Math.max(modelBytes, 1),
    });
    if (!admission.allow) {
      if (admission.deniedBy === 'memory') {
        throw new LlmError('INSUFFICIENT_MEMORY', admission.reason ?? 'Model admission rejected by memory guard', {
          modelId,
          estimatedBytes: admission.estimatedBytes,
        });
      }
      throw new LlmError('MODEL_LIMIT_REACHED', admission.reason ?? 'Model admission rejected by limit', {
        modelId,
        estimatedBytes: admission.estimatedBytes,
      });
    }
  }

  markLoaded(
    modelId: string,
    modelBytes?: number,
    loadOpts?: ModelLoadMemoryOpts,
    measuredFootprintBytes?: number,
  ): void {
    this.loaded.add(modelId);
    if (typeof modelBytes === 'number' && modelBytes > 0) {
      const estimate = estimateModelWasmFootprint(modelBytes, loadOpts ?? {});
      this.footprints.set(
        modelId,
        typeof measuredFootprintBytes === 'number' && measuredFootprintBytes > 0
          ? measuredFootprintBytes
          : estimate,
      );
    }
  }

  /** Replace formula footprint with post-load measured WASM bytes. */
  calibrateFootprint(modelId: string, measuredFootprintBytes: number): void {
    if (!(measuredFootprintBytes > 0)) return;
    if (this.loaded.has(modelId)) {
      this.footprints.set(modelId, measuredFootprintBytes);
    }
  }

  getFootprintBytes(modelId: string): number | undefined {
    return this.footprints.get(modelId);
  }

  markUnloaded(modelId: string): void {
    this.loaded.delete(modelId);
    this.footprints.delete(modelId);
  }

  listLoaded(): string[] {
    return [...this.loaded];
  }

  totalFootprintBytes(): number {
    let sum = 0;
    for (const bytes of this.footprints.values()) sum += bytes;
    return sum;
  }
}

