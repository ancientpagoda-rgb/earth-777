import { RECONSTRUCTION_STREAMS } from "./ReconstructionAssimilation.js";

export const TERRAIN_PROCESS_EVIDENCE_POLICY = "published-rate-process-calibration-no-naive-backprojection-v1";

export const TERRAIN_PROCESS_EVIDENCE = Object.freeze([
  Object.freeze({
    sourceId: "delong-2017-northern-california",
    doi: "10.1130/B31551.1",
    stream: RECONSTRUCTION_STREAMS.HISTORICAL,
    fields: Object.freeze(["rockUpliftRate", "denudationRate", "channelSteepness"]),
    calibrationOnly: true,
    canDirectlyMove777Terrain: false,
    timeCoverage: "late Pleistocene to present; inferred uplift-rate increase at roughly 450-350 ka",
    note: "Useful for calibrating relationships among uplift, channel steepness and denudation. The documented rate change post-dates 777 ka, so late-Pleistocene rates must not be projected back to the target epoch."
  }),
  Object.freeze({
    sourceId: "cyr-granger-italy-uplift",
    doi: "10.1130/L96.1",
    stream: RECONSTRUCTION_STREAMS.HISTORICAL,
    fields: Object.freeze(["rockUpliftRate", "erosionRate", "channelSteepness"]),
    calibrationOnly: true,
    canDirectlyMove777Terrain: false,
    timeCoverage: "Romagna Apennines uplift reported steady since about 0.9 Ma",
    note: "Spans the 777 ka target and can calibrate long-duration process behavior. Rock uplift is not identical to surface-elevation change because erosion/denudation may compensate it, so this remains process calibration until a landscape-evolution hindcast closes that budget."
  }),
  Object.freeze({
    sourceId: "lease-2018-western-alaska-range",
    doi: "10.1016/j.epsl.2018.06.009",
    stream: RECONSTRUCTION_STREAMS.HISTORICAL,
    fields: Object.freeze(["erosionRate", "glacialErosionFeedback"]),
    calibrationOnly: true,
    canDirectlyMove777Terrain: false,
    timeCoverage: "Pliocene-Pleistocene; moderate erosion reported since about 2.9 Ma",
    note: "Constrains the scale and non-stationarity of glacial erosion over geologic time. It is a process prior, not a target-epoch elevation observation."
  })
]);

export function terrainProcessEvidenceBySourceId(sourceId) {
  return TERRAIN_PROCESS_EVIDENCE.find((entry) => entry.sourceId === sourceId) ?? null;
}

export function terrainHistoricalCalibrationRecords() {
  return Object.freeze(TERRAIN_PROCESS_EVIDENCE.map((entry) => Object.freeze({
    stream: entry.stream,
    sourceId: entry.sourceId,
    method: TERRAIN_PROCESS_EVIDENCE_POLICY,
    note: entry.note
  })));
}
