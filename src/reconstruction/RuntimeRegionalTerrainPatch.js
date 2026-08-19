import { interpolatedEtopoBedrockElevationAt } from "./ModernTerrainAnchorSelector.js";

const GMRT_GRIDSERVER_BASE = "https://www.gmrt.org/services/GridServer";
const DEFAULT_SPAN_DEGREES = 1.5;
const DEFAULT_RESOLUTION_METERS = 400;
const MAX_GRID_CELLS = 900_000;
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;

function headerNumber(headers, key) {
  const value = headers.get(key);
  return finite(value) ? Number(value) : null;
}

export function parseRegionalTerrainAscii(text) {
  const lines = String(text ?? "").trim().split(/\r?\n/);
  const headers = new Map();
  let dataStart = 0;
  for (let index = 0; index < Math.min(12, lines.length); index += 1) {
    const match = lines[index].trim().match(/^([A-Za-z_]+)\s+(.+)$/);
    if (!match) break;
    const key = match[1].toLowerCase();
    if (!["ncols", "nrows", "xllcorner", "xllcenter", "yllcorner", "yllcenter", "cellsize", "nodata_value"].includes(key)) break;
    headers.set(key, match[2].trim());
    dataStart = index + 1;
  }

  const ncols = headerNumber(headers, "ncols");
  const nrows = headerNumber(headers, "nrows");
  const cellsize = headerNumber(headers, "cellsize");
  const xllCorner = headerNumber(headers, "xllcorner");
  const yllCorner = headerNumber(headers, "yllcorner");
  const xllCenter = headerNumber(headers, "xllcenter");
  const yllCenter = headerNumber(headers, "yllcenter");
  const west = xllCorner ?? (xllCenter != null && cellsize != null ? xllCenter - cellsize / 2 : null);
  const south = yllCorner ?? (yllCenter != null && cellsize != null ? yllCenter - cellsize / 2 : null);
  const nodata = headerNumber(headers, "nodata_value");
  if (![ncols, nrows, cellsize, west, south].every(finite) || ncols <= 1 || nrows <= 1 || cellsize <= 0) {
    throw new Error("Invalid regional terrain ArcASCII header");
  }
  if (ncols * nrows > MAX_GRID_CELLS) throw new Error(`Regional terrain grid too large (${ncols}x${nrows})`);

  const values = new Float32Array(ncols * nrows);
  let cursor = 0;
  for (const line of lines.slice(dataStart)) {
    for (const token of line.trim().split(/\s+/)) {
      if (!token) continue;
      if (cursor >= values.length) break;
      const value = Number(token);
      values[cursor++] = Number.isFinite(value) && (nodata == null || value !== nodata) ? value : Number.NaN;
    }
  }
  if (cursor !== values.length) throw new Error(`Expected ${values.length} regional terrain values, received ${cursor}`);

  return {
    ncols,
    nrows,
    cellsizeDegrees: cellsize,
    west,
    south,
    east: west + ncols * cellsize,
    north: south + nrows * cellsize,
    nodata: Number.isFinite(nodata) ? nodata : null,
    values
  };
}

function gridValue(patch, row, col) {
  const r = clamp(Math.round(row), 0, patch.nrows - 1);
  const c = clamp(Math.round(col), 0, patch.ncols - 1);
  const value = patch.values[r * patch.ncols + c];
  return Number.isFinite(value) ? value : null;
}

export function regionalTerrainValueAt(patch, latitude, longitude) {
  if (!patch?.values || !finite(latitude) || !finite(longitude)) return null;
  const lat = Number(latitude);
  const lon = wrapLongitude(longitude);
  if (lat < patch.south || lat > patch.north || lon < patch.west || lon > patch.east) return null;

  // ArcASCII data rows run north -> south and coordinates describe cell edges.
  const x = (lon - patch.west) / patch.cellsizeDegrees - 0.5;
  const y = (patch.north - lat) / patch.cellsizeDegrees - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  const z00 = gridValue(patch, y0, x0);
  const z10 = gridValue(patch, y0, x0 + 1);
  const z01 = gridValue(patch, y0 + 1, x0);
  const z11 = gridValue(patch, y0 + 1, x0 + 1);
  const samples = [z00, z10, z01, z11].filter(Number.isFinite);
  if (!samples.length) return null;
  if (samples.length < 4) return samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const north = z00 + (z10 - z00) * tx;
  const south = z01 + (z11 - z01) * tx;
  return north + (south - north) * ty;
}

export function regionalTerrainResidualAt(patch, latitude, longitude) {
  const highResolution = regionalTerrainValueAt(patch, latitude, longitude);
  if (!Number.isFinite(highResolution)) return 0;
  const compact = interpolatedEtopoBedrockElevationAt(latitude, longitude);
  return highResolution - compact;
}

export function buildRegionalTerrainUrl(latitude, longitude, {
  spanDegrees = DEFAULT_SPAN_DEGREES,
  resolutionMeters = DEFAULT_RESOLUTION_METERS
} = {}) {
  const span = clamp(spanDegrees, 0.5, 3.0);
  const half = span / 2;
  const lat = clamp(latitude, -89 + half, 89 - half);
  const lon = wrapLongitude(longitude);
  const url = new URL(GMRT_GRIDSERVER_BASE);
  url.searchParams.set("south", String(lat - half));
  url.searchParams.set("north", String(lat + half));
  url.searchParams.set("west", String(lon - half));
  url.searchParams.set("east", String(lon + half));
  // Unmasked topo retains a complete land/ocean surface; GMRT high-resolution
  // observations replace its background where available.
  url.searchParams.set("layer", "topo");
  url.searchParams.set("format", "esriascii");
  url.searchParams.set("mresolution", String(Math.max(200, Math.round(Number(resolutionMeters) || DEFAULT_RESOLUTION_METERS))));
  return url.toString();
}

export async function loadRuntimeRegionalTerrainPatch(latitude, longitude, options = {}) {
  const url = buildRegionalTerrainUrl(latitude, longitude, options);
  const response = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!response.ok) throw new Error(`Regional terrain request failed (${response.status})`);
  const grid = parseRegionalTerrainAscii(await response.text());
  return {
    ...grid,
    sourceId: "gmrt-4.5.0-runtime",
    resolutionMeters: Math.max(200, Math.round(Number(options.resolutionMeters) || DEFAULT_RESOLUTION_METERS)),
    requestedAt: Date.now(),
    requestUrl: url,
    scientificRole: "modern regional spatial-detail residual applied to the 777 ka reconstruction; not direct paleo topography"
  };
}
