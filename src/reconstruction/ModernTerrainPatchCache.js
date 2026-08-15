import { GMRT_TERRAIN_PATCHES, GMRT_TERRAIN_PATCH_META } from "../data/generated/gmrt-terrain-patches.generated.js";

const decoded = new WeakMap();
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;

function decodeInt16Base64(base64) {
  if (typeof Buffer !== "undefined") {
    const bytes = Buffer.from(base64, "base64");
    return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function patchValues(patch) {
  let values = decoded.get(patch);
  if (!values) {
    values = decodeInt16Base64(patch.dataBase64 ?? "");
    decoded.set(patch, values);
  }
  return values;
}

function contains(patch, latitude, longitude) {
  const lat = Number(latitude);
  const lon = wrapLongitude(longitude);
  return finite(lat) && finite(lon)
    && lat >= Number(patch.south)
    && lat <= Number(patch.north)
    && lon >= Number(patch.west)
    && lon <= Number(patch.east);
}

function sampleNearest(patch, latitude, longitude) {
  if (!contains(patch, latitude, longitude)) return null;
  const ncols = Number(patch.ncols);
  const nrows = Number(patch.nrows);
  const cell = Number(patch.cellsizeDegrees);
  if (![ncols, nrows, cell].every(Number.isFinite) || ncols <= 0 || nrows <= 0 || cell <= 0) return null;
  const lon = wrapLongitude(longitude);
  const x = Math.max(0, Math.min(ncols - 1, Math.round((lon - Number(patch.west)) / cell - 0.5)));
  // ArcASCII rows are north to south; generated patch bounds describe cell edges.
  const y = Math.max(0, Math.min(nrows - 1, Math.round((Number(patch.north) - Number(latitude)) / cell - 0.5)));
  const values = patchValues(patch);
  const value = values[y * ncols + x];
  if (value === Number(patch.nodata ?? -32768)) return null;
  return Number(value);
}

export function cachedTerrainPatchCandidatesAt(latitude, longitude) {
  const candidates = [];
  for (const patch of GMRT_TERRAIN_PATCHES) {
    const value = sampleNearest(patch, latitude, longitude);
    if (value == null) continue;
    candidates.push(Object.freeze({
      sourceId: patch.sourceId ?? "gmrt-4.5.0",
      field: "bedrockElevationMeters",
      relation: "modern-spatial-anchor",
      value,
      latitude: Number(latitude),
      longitude: wrapLongitude(longitude),
      resolutionMeters: patch.resolutionMeters ?? GMRT_TERRAIN_PATCH_META.resolutionMeters ?? 200,
      directMeasurement: true,
      maskedHighResolution: true,
      measurementClass: "direct",
      sourceQuality: patch.sourceQuality ?? 0.97,
      spatialSupportKm: Math.max(0.25, Number(patch.resolutionMeters ?? 200) / 500),
      patchId: patch.id,
      coverageFraction: patch.coverageFraction ?? null,
      method: "GMRT masked high-resolution terrain patch",
      note: "Present-day masked high-resolution GMRT cell. It improves spatial detail only and still requires explicit 777 ka hindcast."
    }));
  }
  return Object.freeze(candidates);
}

export function modernTerrainPatchCacheMeta() {
  return GMRT_TERRAIN_PATCH_META;
}
