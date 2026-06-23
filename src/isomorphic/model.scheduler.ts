import type { MemorySnapshot } from './provider.interface';
import { canAdmitModel } from './model.admission';
import { LlmError } from './errors';

export interface Scheduler {
  ensureCapacity(modelId: string, modelBytes: number, memory: MemorySnapshot, reserveBytes?: number): void;
  markLoaded(modelId: string): void;
  markUnloaded(modelId: string): void;
  listLoaded(): string[];
}

export class DefaultModelScheduler implements Scheduler {
  private loaded = new Set<string>();

  constructor(private maxModels: number = 5) {}

  ensureCapacity(modelId: string, modelBytes: number, memory: MemorySnapshot, reserveBytes?: number): void {
    if (this.loaded.has(modelId)) return;

    const admission = canAdmitModel({
      modelId,
      modelBytes,
      currentlyLoaded: this.loaded.size,
      maxModels: this.maxModels,
      memory,
      reserveBytes,
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

  markLoaded(modelId: string): void {
    this.loaded.add(modelId);
  }

  markUnloaded(modelId: string): void {
    this.loaded.delete(modelId);
  }

  listLoaded(): string[] {
    return [...this.loaded];
  }
}

