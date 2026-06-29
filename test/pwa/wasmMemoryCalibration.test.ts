import {
  applyCalibration,
  calibrateFootprintFromLinearDelta,
  createFootprintEntry,
  projectWasmAfterLoad,
  resolveFootprintBytes,
  sumResidentFootprintBytes,
} from '../../src/isomorphic/wasmMemoryCalibration';

describe('wasmMemoryCalibration', () => {
  test('calibrateFootprintFromLinearDelta uses full heap for first model', () => {
    const estimated = 1_016 * 1024 * 1024;
    expect(
      calibrateFootprintFromLinearDelta(20 * 1024 * 1024, 941 * 1024 * 1024, estimated, {
        firstModelInHeap: true,
      }),
    ).toBe(941 * 1024 * 1024);
  });

  test('calibrateFootprintFromLinearDelta uses delta for second model', () => {
    const estimated = 70 * 1024 * 1024;
    expect(
      calibrateFootprintFromLinearDelta(941 * 1024 * 1024, 1011 * 1024 * 1024, estimated),
    ).toBe(70 * 1024 * 1024);
  });

  test('resolveFootprintBytes prefers measured over estimate', () => {
    const entry = applyCalibration(
      createFootprintEntry(730_894_880, 1_016 * 1024 * 1024),
      20 * 1024 * 1024,
      941 * 1024 * 1024,
      true,
    );
    expect(resolveFootprintBytes(entry, entry.estimatedBytes)).toBe(941 * 1024 * 1024);
    expect(entry.measuredBytes).toBe(941 * 1024 * 1024);
  });

  test('projectWasmAfterLoad uses measured resident sum for BGE after LFM', () => {
    const footprints = new Map<string, ReturnType<typeof createFootprintEntry>>();
    const lfm = applyCalibration(
      createFootprintEntry(730_894_880, 1_016 * 1024 * 1024),
      20 * 1024 * 1024,
      941 * 1024 * 1024,
      true,
    );
    footprints.set('lfm2', lfm);
    const bgeEstimate = 70 * 1024 * 1024;
    const projected = projectWasmAfterLoad({
      wasmLinearBytes: 941 * 1024 * 1024,
      residentModelCount: 1,
      residentFootprintBytes: sumResidentFootprintBytes(footprints),
      candidateEstimateBytes: bgeEstimate,
    });
    expect(projected).toBe((941 + 70) * 1024 * 1024);
  });
});
