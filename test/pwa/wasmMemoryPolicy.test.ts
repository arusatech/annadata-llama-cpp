import {
  WASM_MAX_CONCURRENT_MODELS,
  WASM_POOL_CEILING_BYTES,
  canAdmitWasmModelLoad,
  estimateModelWasmFootprint,
  wasmMemoryPressure,
} from '../../src/isomorphic/wasmMemoryPolicy';

describe('wasmMemoryPolicy', () => {
  test('estimateModelWasmFootprint scales embed vs chat models', () => {
    const bge = estimateModelWasmFootprint(17_572_160, { embedding: true, n_ctx: 256, n_batch: 32 });
    const lfm = estimateModelWasmFootprint(730_894_880, { n_ctx: 512, n_batch: 16 });
    expect(bge).toBeGreaterThan(17_572_160);
    expect(bge).toBeLessThan(300 * 1024 * 1024);
    expect(lfm).toBeGreaterThan(700 * 1024 * 1024);
    expect(lfm).toBeLessThan(WASM_POOL_CEILING_BYTES);
  });

  test('rejects when concurrent model slot limit reached', () => {
    const result = canAdmitWasmModelLoad({
      modelId: 'new_model',
      fileBytes: 20 * 1024 * 1024,
      currentlyLoaded: WASM_MAX_CONCURRENT_MODELS,
      maxModels: WASM_MAX_CONCURRENT_MODELS,
      wasmLinearBytes: 100 * 1024 * 1024,
    });
    expect(result.allow).toBe(false);
    expect(result.deniedBy).toBe('limit');
  });

  test('allows async pre-grown heap for same model (stream begin → load)', () => {
    const result = canAdmitWasmModelLoad({
      modelId: 'lfm2_1_2b_rag_q4_k_m',
      fileBytes: 730_894_880,
      loadOpts: { n_ctx: 512, n_batch: 16 },
      currentlyLoaded: 0,
      wasmLinearBytes: 941 * 1024 * 1024,
    });
    expect(result.allow).toBe(true);
    expect(result.projectedWasmBytes).toBeLessThanOrEqual(1048 * 1024 * 1024);
  });

  test('rejects when incremental load would exceed pool', () => {
    const result = canAdmitWasmModelLoad({
      modelId: 'lfm2_1_2b_rag_q4_k_m',
      fileBytes: 730_894_880,
      loadOpts: { n_ctx: 512, n_batch: 16 },
      currentlyLoaded: 1,
      wasmLinearBytes: 941 * 1024 * 1024,
    });
    expect(result.allow).toBe(false);
    expect(result.deniedBy).toBe('wasm_pool');
  });

  test('allows BGE after LFM2 resident (incremental heap)', () => {
    const result = canAdmitWasmModelLoad({
      modelId: 'bge_micro_v2',
      fileBytes: 17_572_160,
      loadOpts: { embedding: true, n_ctx: 256, n_batch: 32 },
      currentlyLoaded: 1,
      wasmLinearBytes: 941 * 1024 * 1024,
    });
    expect(result.allow).toBe(true);
  });

  test('allows LFM2 solo load on empty worker (697 MB GGUF ≠ 1536 MB WASM)', () => {
    const result = canAdmitWasmModelLoad({
      modelId: 'lfm2_1_2b_rag_q4_k_m',
      fileBytes: 730_894_880,
      loadOpts: { n_ctx: 512, n_batch: 16 },
      currentlyLoaded: 0,
      wasmLinearBytes: 20 * 1024 * 1024,
    });
    expect(result.allow).toBe(true);
    expect(result.estimatedFootprintBytes).toBeLessThan(1100 * 1024 * 1024);
    expect(result.estimatedFootprintBytes).toBeGreaterThan(850 * 1024 * 1024);
  });

  test('allows small embed when pool has headroom', () => {
    const result = canAdmitWasmModelLoad({
      modelId: 'bge_micro_v2',
      fileBytes: 17_572_160,
      loadOpts: { embedding: true, n_ctx: 256, n_batch: 32 },
      currentlyLoaded: 0,
      wasmLinearBytes: 20 * 1024 * 1024,
    });
    expect(result.allow).toBe(true);
    expect(result.estimatedFootprintBytes).toBeGreaterThan(0);
  });

  test('wasmMemoryPressure maps utilization bands', () => {
    expect(wasmMemoryPressure(0.5 * WASM_POOL_CEILING_BYTES)).toBe('low');
    expect(wasmMemoryPressure(0.75 * WASM_POOL_CEILING_BYTES)).toBe('medium');
    expect(wasmMemoryPressure(0.9 * WASM_POOL_CEILING_BYTES)).toBe('high');
  });
});
