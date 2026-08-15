import { RECONSTRUCTION_STREAMS } from "./ReconstructionAssimilation.js";

export const RECONSTRUCTION_DATASET_CATALOG = Object.freeze([
  Object.freeze({
    sourceId: "etopo-2022",
    fields: Object.freeze(["bedrockElevationMeters", "bathymetryMeters", "modernCoastGeometry"]),
    stream: RECONSTRUCTION_STREAMS.MODERN,
    targetRelation: "modern-anchor-requires-hindcast",
    direct777Constraint: false,
    note: "High-resolution modern bedrock/bathymetry anchor. It must be transformed for uplift, erosion/deposition, isostasy, ice loading and paleo sea level before it is a 777 ka terrain estimate."
  }),
  Object.freeze({
    sourceId: "krapp-2021",
    fields: Object.freeze(["monthlyTemperature", "monthlyPrecipitation", "monthlyCloudCover", "biome", "annualNpp", "annualLai", "monthlyNpp"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "direct-777ka-constraint",
    direct777Constraint: true,
    note: "Published 0.5 degree fields extracted at exactly 777 ka are direct target-epoch constraints and should anchor later downscaling."
  }),
  Object.freeze({
    sourceId: "ruddiman-2018-mis19",
    fields: Object.freeze(["orbitalBoundary", "greenhouseBoundary", "climateComparison"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "direct-777ka-boundary",
    direct777Constraint: true,
    note: "Canonical MIS 19 experiment boundary conditions constrain the target epoch."
  }),
  Object.freeze({
    sourceId: "la2004",
    fields: Object.freeze(["eccentricity", "obliquity", "longitudeOfPerihelion"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "astronomical-target-epoch-forcing",
    direct777Constraint: true,
    note: "Astronomical solution supplies deterministic orbital forcing around the reconstruction epoch."
  }),
  Object.freeze({
    sourceId: "spratt-lisiecki-2016",
    fields: Object.freeze(["globalSeaLevel", "shorelineConfidence"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "direct-777ka-reference-with-uncertainty",
    direct777Constraint: true,
    datasetId: "PANGAEA.979830-v2",
    doi: "10.1594/PANGAEA.979830",
    note: "At exactly 777 ka the five-record stack gives -12.76 m versus modern, 1-sigma uncertainty 9.52 m, and a published 95% interval of -33.06 to +4.17 m. The canonical shoreline uses the median while uncertainty is retained as a coastal confidence band."
  }),
  Object.freeze({
    sourceId: "delong-2017-northern-california",
    fields: Object.freeze(["rockUpliftRate", "denudationRate", "channelSteepness"]),
    stream: RECONSTRUCTION_STREAMS.HISTORICAL,
    targetRelation: "process-calibration-postdates-target-change",
    direct777Constraint: false,
    doi: "10.1130/B31551.1",
    note: "Measured late-Pleistocene uplift and denudation calibrate landscape response, but the inferred uplift-rate increase at roughly 450-350 ka post-dates 777 ka, so those rates are not back-projected to the target epoch."
  }),
  Object.freeze({
    sourceId: "cyr-granger-italy-uplift",
    fields: Object.freeze(["rockUpliftRate", "erosionRate", "channelSteepness"]),
    stream: RECONSTRUCTION_STREAMS.HISTORICAL,
    targetRelation: "process-calibration-spans-target",
    direct777Constraint: false,
    doi: "10.1130/L96.1",
    note: "Romagna Apennines uplift reported steady since about 0.9 Ma can calibrate long-duration landscape behavior across 777 ka, but uplift alone is not treated as surface-elevation change without an erosion/denudation budget."
  }),
  Object.freeze({
    sourceId: "lease-2018-western-alaska-range",
    fields: Object.freeze(["erosionRate", "glacialErosionFeedback"]),
    stream: RECONSTRUCTION_STREAMS.HISTORICAL,
    targetRelation: "process-calibration-geologic-timescale",
    direct777Constraint: false,
    doi: "10.1016/j.epsl.2018.06.009",
    note: "Pliocene-Pleistocene erosion-rate history constrains glacial erosion feedbacks and non-stationarity; it is not a direct 777 ka elevation observation."
  }),
  Object.freeze({
    sourceId: "lr04",
    fields: Object.freeze(["iceVolumeProxy", "deepOceanTemperatureProxy"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "independent-validation-constraint",
    direct777Constraint: false,
    note: "Independent validation track rather than a silently forced target."
  }),
  Object.freeze({
    sourceId: "neotoma",
    fields: Object.freeze(["paleoecologyOccurrences", "faunaRanges", "vegetationEvidence"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "dated-occurrence-constraint",
    direct777Constraint: false,
    note: "Dated occurrences can become local target-epoch constraints after temporal filtering and uncertainty propagation."
  }),
  Object.freeze({
    sourceId: "road",
    fields: Object.freeze(["homininOccurrences", "archaeology", "fauna", "botanicalEvidence"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "dated-occurrence-constraint",
    direct777Constraint: false,
    note: "Dated archaeological and hominin evidence can constrain local presence envelopes after temporal filtering."
  })
]);

export function reconstructionDatasetBySourceId(sourceId) {
  return RECONSTRUCTION_DATASET_CATALOG.find((entry) => entry.sourceId === sourceId) ?? null;
}

export function reconstructionDatasetsForField(field) {
  return Object.freeze(RECONSTRUCTION_DATASET_CATALOG.filter((entry) => entry.fields.includes(field)));
}

export function direct777Datasets() {
  return Object.freeze(RECONSTRUCTION_DATASET_CATALOG.filter((entry) => entry.direct777Constraint));
}
