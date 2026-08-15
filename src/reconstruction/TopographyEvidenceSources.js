import { EVIDENCE_RELATIONS } from "./EvidenceHarvester.js";

const source = (entry) => Object.freeze({ ...entry, fields: Object.freeze(entry.fields ?? []) });

/**
 * Source manifest for topography/paleotopography discovery.
 *
 * This is deliberately a discovery/catalog layer, not a claim that every source is
 * already ingested into the browser bundle. Runtime/network adapters can populate
 * normalized evidence records from these sources without changing ranking rules.
 */
export const TOPOGRAPHY_EVIDENCE_SOURCES = Object.freeze([
  source({
    sourceId: "etopo-2022",
    family: "global-modern-relief",
    fields: ["bedrockElevationMeters", "bathymetryMeters", "modernCoastGeometry"],
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    sourceQuality: 0.90,
    spatialResolution: "15 arc-second",
    access: "integrated-local-grid",
    note: "Canonical modern spatial anchor already bundled in Earth 777. It requires explicit uplift, erosion/deposition, GIA/ice-loading and sea-level transformation before interpretation at 777 ka."
  }),
  source({
    sourceId: "gebco-2026",
    family: "global-modern-bathymetry",
    fields: ["bathymetryMeters", "bedrockElevationMeters", "bathymetrySourceType"],
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    sourceQuality: 0.92,
    spatialResolution: "15 arc-second global; selected regions multi-resolution",
    access: "download-opendap",
    doi: "10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa",
    note: "Independent modern global terrain/bathymetry anchor. The TID grid identifies measured versus interpolated source types and can improve spatial uncertainty."
  }),
  source({
    sourceId: "copernicus-dem-glo30",
    family: "global-modern-land-dem",
    fields: ["surfaceElevationMeters", "modernLandRelief", "heightError"],
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    sourceQuality: 0.91,
    spatialResolution: "30 m global",
    access: "copernicus-api-download",
    doi: "10.5270/ESA-c5d3d65",
    note: "High-resolution modern DSM anchor for land. Because it includes vegetation/buildings, it must be converted toward bare-earth/bedrock relief before deep-time use."
  }),
  source({
    sourceId: "opentopography-global-dem-api",
    family: "modern-dem-discovery-api",
    fields: ["surfaceElevationMeters", "bareEarthElevationMeters", "lidarTerrain"],
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    sourceQuality: 0.88,
    spatialResolution: "dataset dependent; global 30-1000 m plus regional lidar",
    access: "rest-api",
    note: "Discovery/access layer for COP30, NASADEM, ALOS, SRTM, GEBCO and regional high-resolution topography. Useful for selecting the best modern spatial anchor per location."
  }),
  source({
    sourceId: "gmrt-4.5.0",
    family: "multi-resolution-modern-topography",
    fields: ["bathymetryMeters", "terrainMeters", "multibeamCoverage"],
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    sourceQuality: 0.93,
    spatialResolution: "multi-resolution",
    access: "point-grid-web-services",
    note: "Curated multi-resolution multibeam synthesis, especially valuable where ocean-floor measurements are much finer than global base grids."
  }),
  source({
    sourceId: "ncei-paleo-search",
    family: "paleo-record-discovery",
    fields: ["sedimentCore", "lakeCore", "paleoceanography", "loessPaleosol", "speleothem", "pollen"],
    relation: EVIDENCE_RELATIONS.NEARBY_PALEO,
    sourceQuality: 0.88,
    spatialResolution: "point/core records",
    access: "metadata-web-service",
    note: "Temporal/geographic discovery layer for dated paleo records. Records near 777 ka may constrain sedimentation, buried surfaces, depositional environments and landscape history after proxy-specific transformation."
  }),
  source({
    sourceId: "usgs-marine-terraces",
    family: "dated-geomorphic-surfaces",
    fields: ["marineTerraceElevation", "terraceAge", "rockUpliftRate", "shorelineAngle"],
    relation: EVIDENCE_RELATIONS.PROCESS_CALIBRATION,
    sourceQuality: 0.91,
    spatialResolution: "site/terrace",
    access: "usgs-data-releases-publications",
    note: "Dated terraces constrain regional uplift and relative sea-level history. Younger terraces calibrate process models; they are not naively projected back to 777 ka."
  }),
  source({
    sourceId: "walis",
    family: "standardized-paleo-sea-level-indicators",
    fields: ["relativeSeaLevelIndicator", "indicatorElevation", "age", "datingUncertainty"],
    relation: EVIDENCE_RELATIONS.PROCESS_CALIBRATION,
    sourceQuality: 0.92,
    spatialResolution: "site indicators",
    access: "open-database-releases",
    note: "Standardized Last Interglacial shoreline indicators are younger than 777 ka but valuable for calibrating uplift/GIA/indicator interpretation and uncertainty handling."
  }),
  source({
    sourceId: "pangaea-submerged-terraces-918191",
    family: "global-submerged-terraces",
    fields: ["submergedTerraceDepth", "geomorphicSurface"],
    relation: EVIDENCE_RELATIONS.PROCESS_CALIBRATION,
    sourceQuality: 0.84,
    spatialResolution: "site/terrace",
    access: "pangaea-download",
    doi: "10.1594/PANGAEA.918191",
    note: "Global submerged-terrace compilation can calibrate preservation, shelf morphology and sea-level/geomorphic interpretation, but terrace age must be established before target-epoch use."
  }),
  source({
    sourceId: "earthbyte-gplates",
    family: "plate-kinematic-hindcast",
    fields: ["plateMotion", "coastlinePosition", "continentOceanBoundary", "dynamicTopography"],
    relation: EVIDENCE_RELATIONS.PROCESS_CALIBRATION,
    sourceQuality: 0.89,
    spatialResolution: "global plate model",
    access: "download-gplates-data",
    note: "Global rotation, coastline, plate-boundary and time-dependent dynamic-topography products can constrain horizontal displacement and long-wavelength vertical motion over 0.777 Myr."
  }),
  source({
    sourceId: "sesar-geosamples",
    family: "physical-sample-discovery",
    fields: ["core", "rockSample", "sedimentSample", "sampleLocation", "linkedDataset"],
    relation: EVIDENCE_RELATIONS.NEARBY_PALEO,
    sourceQuality: 0.82,
    spatialResolution: "sample point",
    access: "sample-search",
    note: "Global physical-sample registry useful for discovering cores and geological samples with linked datasets/publications near a target location."
  }),
  source({
    sourceId: "spratt-lisiecki-2016",
    family: "global-paleo-sea-level",
    fields: ["globalSeaLevel", "shorelineConfidence"],
    relation: EVIDENCE_RELATIONS.DIRECT_TARGET,
    sourceQuality: 0.94,
    spatialResolution: "global eustatic datum",
    access: "integrated-checkpoint",
    doi: "10.1594/PANGAEA.979830",
    note: "Exact 777 ka global sea-level target already integrated; it constrains the water datum rather than bedrock height and must be combined with local GIA/vertical-motion terms."
  })
]);

export function topographyEvidenceSourceById(sourceId) {
  return TOPOGRAPHY_EVIDENCE_SOURCES.find((entry) => entry.sourceId === sourceId) ?? null;
}

export function topographyEvidenceSourcesForField(field) {
  return Object.freeze(TOPOGRAPHY_EVIDENCE_SOURCES.filter((entry) => entry.fields.includes(field)));
}

export function topographyEvidenceSourcesByRelation(relation) {
  return Object.freeze(TOPOGRAPHY_EVIDENCE_SOURCES.filter((entry) => entry.relation === relation));
}
