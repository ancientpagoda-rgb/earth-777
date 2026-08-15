const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const firstFinite = (...values) => values.find(finite);

export const GMRT_SOURCE_ID = "gmrt-4.5.0";
export const GMRT_POINTSERVER_BASE = "https://www.gmrt.org/services/PointServer";

export function buildGmrtPointUrl(latitude, longitude, format = "json") {
  const url = new URL(GMRT_POINTSERVER_BASE);
  url.searchParams.set("latitude", String(Number(latitude)));
  url.searchParams.set("longitude", String(Number(longitude)));
  url.searchParams.set("format", format);
  return url.toString();
}

function payloadProperties(payload) {
  if (payload?.features?.[0]?.properties) return payload.features[0].properties;
  if (payload?.properties) return payload.properties;
  if (payload?.result && typeof payload.result === "object") return payload.result;
  return payload ?? {};
}

function sourceText(properties) {
  return String(properties.source ?? properties.data_source ?? properties.datasource ?? properties.attribution ?? properties.type ?? "").toLowerCase();
}

function measurementClass(properties) {
  const source = sourceText(properties);
  if (/multibeam|singlebeam|single beam|sounding|lidar|seismic/.test(source)) return "direct";
  if (/satellite|gravity|predicted|interpolat/.test(source)) return "predicted";
  if (/grid|mixed|synthesis/.test(source)) return "mixed";
  return "mixed";
}

/**
 * Normalize one GMRT PointServer response to a modern spatial-anchor candidate.
 * Unknown attribution remains mixed rather than being promoted to direct measured
 * bathymetry. PointServer observations are present-day anchors only.
 */
export function normalizeGmrtPointResponse(payload, {
  latitude,
  longitude,
  evidenceSourceIds = []
} = {}) {
  const properties = payloadProperties(payload);
  const value = firstFinite(
    properties.elevation,
    properties.elevation_m,
    properties.elevationMeters,
    properties.z,
    properties.topo,
    properties.depth,
    properties.value,
    payload?.elevation,
    payload?.z
  );
  if (!finite(value) || !finite(latitude) || !finite(longitude)) return null;
  const resolution = firstFinite(properties.resolution, properties.resolution_m, properties.resolutionMeters, properties.cellsize);
  const klass = measurementClass(properties);
  return Object.freeze({
    sourceId: GMRT_SOURCE_ID,
    archiveSourceId: GMRT_SOURCE_ID,
    field: "bedrockElevationMeters",
    relation: "modern-spatial-anchor",
    value: Number(value),
    sigma: null,
    latitude: Number(latitude),
    longitude: Number(longitude),
    resolutionMeters: finite(resolution) ? Math.max(1, Number(resolution)) : (klass === "direct" ? 120 : null),
    measurementClass: klass,
    directMeasurement: klass === "direct",
    sourceQuality: klass === "direct" ? 0.97 : 0.90,
    spatialSupportKm: klass === "direct" ? 0.35 : 0.20,
    evidenceSourceIds: Object.freeze([...new Set(evidenceSourceIds.filter(Boolean))]),
    gmrtAttribution: properties.source ?? properties.data_source ?? properties.datasource ?? properties.attribution ?? null,
    method: "GMRT PointServer highest-available modern terrain sample",
    note: "Present-day GMRT spatial anchor at a paleo-evidence coordinate. Unknown/mixed source attribution is not promoted to direct multibeam. Explicit 777 ka hindcast remains required."
  });
}
