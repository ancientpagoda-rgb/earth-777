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
    label: "Performance",
    canonical: "Maintains >=55 FPS average during normal globe -> region -> surface navigation on a typical desktop browser, with 1% low >=30 FPS.",
    automation: "full",
  },
  {
    id: "high-speed-simulation",
    label: "High-speed simulation",
    canonical: "100x runs continuously without visible freezing. 1000x may reduce visual update frequency, but the UI must remain responsive.",
    automation: "full",
  },
  {
    id: "no-degradation",
    label: "No degradation",
    canonical: "After 20 minutes running, FPS has not fallen by >10% and memory usage is not continuously climbing.",
    automation: "full",
  },
  {
    id: "load-time",
    label: "Load time",
    canonical: "Interactive world appears within 5 seconds on a normal broadband connection after assets are cached; no long blank screen.",
    automation: "ci-proxy",
  },
  {
    id: "infinite-surface",
    label: "Infinite surface illusion",
    canonical: "At surface level, travel continuously in any direction for at least 10 viewport widths without ever seeing a square world edge, void, or hard cutoff.",
    automation: "ci-proxy",
  },
  {
    id: "chunk-continuity",
    label: "Chunk continuity",
    canonical: "Adjacent terrain joins with no cracks, seams, duplicated mountains, sudden elevation jumps, or obvious chunk boundaries.",
    automation: "manual",
  },
  {
    id: "persistent-geography",
    label: "Persistent geography",
    canonical: "Leaving an area and returning to the same coordinates produces the same underlying terrain, except for changes caused by simulation.",
    automation: "ci-proxy",
  },
  {
    id: "topography",
    label: "Topography",
    canonical: "Mountains, valleys, slopes, coastlines, and major elevation differences remain clearly perceptible at surface level and do not disappear after simulation updates.",
    automation: "manual",
  },
  {
    id: "continuous-evolution",
    label: "Continuous evolution",
    canonical: "At accelerated time, terrain visibly continues changing after the first update. It cannot perform one evolution step and then effectively stop.",
    automation: "ci-proxy",
  },
  {
    id: "visible-change-rate",
    label: "Visible change rate",
    canonical: "At 100x, a fixed surface viewed for 5 minutes shows detectable erosion/uplift/coast/river/biome change without becoming unrecognizable noise.",
    automation: "manual",
  },
  {
    id: "simulation-continuity",
    label: "Simulation continuity",
    canonical: "Evolution continues for at least 30 simulated update cycles with no freeze, NaNs, reset, or identical repeated frame.",
    automation: "ci-proxy",
  },
  {
    id: "spatial-coherence",
    label: "Spatial coherence",
    canonical: "Geological changes affect regions rather than isolated random pixels. Neighboring terrain generally evolves continuously.",
    automation: "manual",
  },
  {
    id: "lod-behavior",
    label: "LOD behavior",
    canonical: "High-detail simulation/rendering is concentrated near the camera. Distant terrain uses progressively cheaper representations with no obvious visual popping during ordinary movement.",
    automation: "manual",
  },
  {
    id: "globe-to-region",
    label: "Globe -> region",
    canonical: "Clicking Descend to Region once always performs the transition. No double/triple clicking.",
    automation: "manual",
  },
  {
    id: "region-to-surface",
    label: "Region -> surface",
    canonical: "Entering surface mode works on the first action and lands at the geographically corresponding location.",
    automation: "ci-proxy",
  },
  {
    id: "zoom",
    label: "Zoom",
    canonical: "Repeated zoom-in/zoom-out through all levels 20 times produces no disappearing terrain, broken camera state, sudden square surface, or corrupted scale.",
    automation: "ci-proxy",
  },
  {
    id: "navigation",
    label: "Navigation",
    canonical: "Panning/rotating/moving remains responsive while simulation is running at 100x.",
    automation: "ci-proxy",
  },
  {
    id: "determinism",
    label: "Determinism",
    canonical: "Same world seed + coordinates + elapsed simulation time produces the same large-scale geography after reload.",
    automation: "manual",
  },
  {
    id: "visual-character",
    label: "Visual character",
    canonical: "Retains the lo-fi Earth aesthetic, but terrain is not so pixelated that mountains/valleys become unreadable.",
    automation: "manual",
  },
  {
    id: "failure-handling",
    label: "Failure handling",
    canonical: "If a chunk/evolution calculation fails, the app continues running and regenerates/skips it instead of freezing the entire simulation.",
    automation: "manual",
  },
  {
    id: "console-cleanliness",
    label: "Console cleanliness",
    canonical: "A 10-minute normal session produces zero uncaught exceptions, WebGL-context-loss errors, or continuously repeating console errors.",
    automation: "ci-proxy",
  },
  {
    id: "regression-rule",
    label: "Regression rule",
    canonical: "No new feature is accepted if it causes >10% degradation in the performance benchmark unless the tradeoff is explicitly approved.",
    automation: "full",
  },
]);

export function acceptanceCriterion(id) {
  return LITE_ACCEPTANCE_CRITERIA.find((criterion) => criterion.id === id);
}
