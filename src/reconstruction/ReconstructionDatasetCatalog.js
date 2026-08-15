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
    fields: Object.freeze(["globalSeaLevel"]),
    stream: RECONSTRUCTION_STREAMS.PALEO,
    targetRelation: "target-epoch-reference-with-uncertainty",
    direct777Constraint: true,
    note: "Sea-level reconstruction constrains the global shoreline datum with explicit uncertainty."
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
