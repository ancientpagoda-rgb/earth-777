export const LITE_ACCEPTANCE_THRESHOLDS = Object.freeze({
  averageFps: 55,
  onePercentLowFps: 30,
  maxPerformanceRegressionFraction: 0.10,
  cachedInteractiveMs: 5000,
  soakMinutes: 20,
  hundredXObservationMinutes: 5,
  minimumEvolutionCycles: 30,
  minimumSurfaceViewportWidths: 10,
  zoomCycles: 20,
  maxSoakFpsLossFraction: 0.10,
  maxEventLoopStallMs: 500,
});

export const LITE_ACCEPTANCE_CRITERIA = Object.freeze([
  {
    id: "performance",
    label: "Normal navigation performance",
    canonical: "Average FPS >=55 and 1% low >=30 during normal globe -> region/surface navigation.",
    automation: "full",
  },
  {
    id: "hundred-x-responsive",
    label: "100x remains responsive",
    canonical: "100x runs continuously without visible freezing; UI remains responsive.",
    automation: "full",
  },
  {
    id: "thousand-x-responsive",
    label: "1000x remains responsive",
    canonical: "1000x may reduce visual update frequency, but the UI must remain responsive.",
    automation: "ci",
  },
  {
    id: "soak",
    label: "20-minute stability",
    canonical: "After 20 minutes, FPS has not fallen by >10% and memory is not continuously climbing.",
    automation: "full",
  },
  {
    id: "cached-load",
    label: "Cached load time",
    canonical: "Interactive world appears within 5 seconds on a normal broadband connection after assets are cached.",
    automation: "ci",
  },
  {
    id: "surface-travel",
    label: "Infinite surface illusion",
    canonical: "Travel at least 10 viewport widths in any direction without exposing a square edge, void, or hard cutoff.",
    automation: "ci-proxy",
  },
  {
    id: "chunk-continuity",
    label: "Chunk continuity",
    canonical: "Adjacent terrain has no cracks, seams, duplicated mountains, sudden elevation jumps, or obvious chunk boundaries.",
    automation: "manual",
  },
  {
    id: "persistent-geography",
    label: "Persistent geography",
    canonical: "Leaving and returning to the same coordinates reproduces the same underlying terrain except simulated changes.",
    automation: "ci-proxy",
  },
  {
    id: "topography-readable",
    label: "Readable topography",
    canonical: "Mountains, valleys, slopes, coastlines, and major elevation differences remain clearly perceptible and survive simulation updates.",
    automation: "manual",
  },
  {
    id: "continuous-evolution",
    label: "Continuous evolution",
    canonical: "Terrain/world state visibly keeps changing after the first update and does not effectively stop.",
    automation: "full",
  },
  {
    id: "visible-change-rate",
    label: "Visible 100x change rate",
    canonical: "At 100x, a fixed surface observed for 5 minutes shows detectable coherent change without becoming unrecognizable noise.",
    automation: "manual",
  },
  {
    id: "evolution-cycles",
    label: "Evolution cycle continuity",
    canonical: "At least 30 simulated update cycles complete with no freeze, NaN, reset, or identical repeated state.",
    automation: "ci-proxy",
  },
  {
    id: "spatial-coherence",
    label: "Spatial coherence",
    canonical: "Evolution affects coherent regions rather than isolated random pixels.",
    automation: "manual",
  },
  {
    id: "lod",
    label: "LOD behavior",
    canonical: "Detail is concentrated near the camera and transitions do not visibly pop during ordinary movement.",
    automation: "manual",
  },
  {
    id: "single-action-descent",
    label: "One-action descent/return",
    canonical: "A single action always transitions globe -> surface and surface -> globe.",
    automation: "ci",
  },
  {
    id: "zoom-stability",
    label: "Zoom stability",
    canonical: "Twenty complete zoom cycles produce no missing terrain, broken camera state, hard square surface, or corrupted scale.",
    automation: "ci-proxy",
  },
  {
    id: "navigation-responsive",
    label: "Navigation during simulation",
    canonical: "Panning, rotating, and moving remain responsive while simulation runs at 100x.",
    automation: "ci-proxy",
  },
  {
    id: "determinism",
    label: "Deterministic replay",
    canonical: "Same seed + coordinates + elapsed simulation time produces the same large-scale geography after reload.",
    automation: "manual",
  },
  {
    id: "visual-character",
    label: "Lo-fi visual character",
    canonical: "The lo-fi Earth aesthetic remains while terrain is detailed enough to read mountains and valleys.",
    automation: "manual",
  },
  {
    id: "failure-isolation",
    label: "Failure isolation",
    canonical: "A failed chunk/evolution calculation is regenerated or skipped instead of freezing the application.",
    automation: "manual",
  },
  {
    id: "console-clean",
    label: "Console cleanliness",
    canonical: "A 10-minute normal session has zero uncaught exceptions, WebGL context-loss errors, or continuously repeating console errors.",
    automation: "ci-proxy",
  },
  {
    id: "regression-budget",
    label: "Performance regression budget",
    canonical: "No feature is accepted if the established performance benchmark degrades by more than 10% without explicit approval.",
    automation: "full",
  },
]);

export function acceptanceCriterion(id) {
  return LITE_ACCEPTANCE_CRITERIA.find((criterion) => criterion.id === id);
}
