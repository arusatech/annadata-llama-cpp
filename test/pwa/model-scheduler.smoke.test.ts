import { canAdmitModel } from '../../src/isomorphic/model.admission';
import { DefaultModelScheduler } from '../../src/isomorphic/model.scheduler';
import { LlmError } from '../../src/isomorphic/errors';

describe('Model admission + scheduler smoke', () => {
  test('rejects by model limit with deniedBy=limit', () => {
    const result = canAdmitModel({
      modelId: 'm6',
      modelBytes: 1024,
      currentlyLoaded: 5,
      maxModels: 5,
      memory: { pressure: 'low', freeBytes: 10 * 1024 * 1024 * 1024 },
    });
    expect(result.allow).toBe(false);
    expect(result.deniedBy).toBe('limit');
  });

  test('rejects by memory with deniedBy=memory', () => {
    const result = canAdmitModel({
      modelId: 'm-low-mem',
      modelBytes: 1024 * 1024 * 1024,
      currentlyLoaded: 1,
      maxModels: 5,
      memory: { pressure: 'high', freeBytes: 200 * 1024 * 1024 },
      reserveBytes: 128 * 1024 * 1024,
    });
    expect(result.allow).toBe(false);
    expect(result.deniedBy).toBe('memory');
  });

  test('scheduler enforces max loaded models', () => {
    const scheduler = new DefaultModelScheduler(2);
    const memory = { pressure: 'low' as const, freeBytes: 10 * 1024 * 1024 * 1024 };

    scheduler.ensureCapacity('m1', 1000, memory);
    scheduler.markLoaded('m1');
    scheduler.ensureCapacity('m2', 1000, memory);
    scheduler.markLoaded('m2');

    expect(() => scheduler.ensureCapacity('m3', 1000, memory)).toThrow(LlmError);
    try {
      scheduler.ensureCapacity('m3', 1000, memory);
    } catch (error) {
      expect((error as LlmError).code).toBe('MODEL_LIMIT_REACHED');
    }
  });

  test('scheduler memory guard throws INSUFFICIENT_MEMORY', () => {
    const scheduler = new DefaultModelScheduler(5);
    const memory = { pressure: 'high' as const, freeBytes: 32 * 1024 * 1024 };
    expect(() =>
      scheduler.ensureCapacity('m-big', 1024 * 1024 * 1024, memory, 16 * 1024 * 1024),
    ).toThrow(LlmError);

    try {
      scheduler.ensureCapacity('m-big', 1024 * 1024 * 1024, memory, 16 * 1024 * 1024);
    } catch (error) {
      expect((error as LlmError).code).toBe('INSUFFICIENT_MEMORY');
    }
  });

  test('markLoaded/markUnloaded keeps registry consistent', () => {
    const scheduler = new DefaultModelScheduler(5);
    scheduler.markLoaded('a');
    scheduler.markLoaded('b');
    expect(scheduler.listLoaded().sort()).toEqual(['a', 'b']);
    scheduler.markUnloaded('a');
    expect(scheduler.listLoaded()).toEqual(['b']);
  });
});

