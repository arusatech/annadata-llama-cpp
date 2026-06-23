import type { MemorySnapshot } from './provider.interface';

export interface AdmissionInput {
  modelId: string;
  modelBytes: number;
  currentlyLoaded: number;
  maxModels: number;
  memory: MemorySnapshot;
  estimatedMultiplier?: number;
  reserveBytes?: number;
}

export interface AdmissionResult {
  allow: boolean;
  deniedBy?: 'limit' | 'memory';
  reason?: string;
  estimatedBytes: number;
}

export function canAdmitModel(input: AdmissionInput): AdmissionResult {
  const multiplier = input.estimatedMultiplier ?? 1.5;
  const reserveBytes = input.reserveBytes ?? 512 * 1024 * 1024; // 512MB default reserve
  const estimatedBytes = Math.ceil(input.modelBytes * multiplier);

  if (input.currentlyLoaded >= input.maxModels) {
    return {
      allow: false,
      deniedBy: 'limit',
      reason: `Model limit reached (${input.maxModels})`,
      estimatedBytes,
    };
  }

  if (typeof input.memory.freeBytes === 'number') {
    const postLoadFree = input.memory.freeBytes - estimatedBytes;
    if (postLoadFree < reserveBytes) {
      return {
        allow: false,
        deniedBy: 'memory',
        reason: 'Insufficient free memory after reserve threshold',
        estimatedBytes,
      };
    }
  }

  return { allow: true, estimatedBytes };
}

