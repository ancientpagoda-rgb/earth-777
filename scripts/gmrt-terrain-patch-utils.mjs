const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const coordinateToken = (value) => `${Number(value) < 0 ? "m" : ""}${Math.abs(Number(value)).toFixed(3).replace(".", "p")}`;

export const GMRT_PATCH_SOURCE_ID = "gmrt-4.5.0";
export const GMRT_GRIDSERVER_BASE = "https://www.gmrt.org/services/GridServer";
export const GMRT_PATCH_TILE_DEGREES = 1;
export const GMRT_PATCH_RESOLUTION_METERS = 200;
export const GMRT_PATCH_NODATA = -32768;

export function gmrtPatchTileFor(latitude, longitude, tileDegrees = GMRT_PATCH_TILE_DEGREES) {
  const size = Math.max(0.05, Number(tileDegrees) || GMRT_PATCH_TILE_DEGREES);
  const lat = Math.max(-89.999999, Math.min(89.999999, Number(latitude) || 0));
  const lon = wrapLongitude(longitude);
  const south = Math.floor((lat + 90) / size) * size - 90;
  const west = Math.floor((lon + 180) / size) * size - 180;
  const north = Math.min(90, south + size);
  const east = west + size;
  return Object.freeze({
    id: `gmrt-${coordinateToken(south)}-${coordinateToken(west)}-${coordinateToken(size)}`,
    south,
    north,
    west,
    east,
    tileDegrees: size
  });
}

export function uniqueGmrtPatchTiles(records = [], tileDegrees = GMRT_PATCH_TILE_DEGREES) {
  const tiles = new Map();
  for (const record of records) {
    if (!finite(record?.latitude) || !finite(record?.longitude)) continue;
    const tile = gmrtPatchTileFor(record.latitude, record.longitude, tileDegrees);
    const existing = tiles.get(tile.id) ?? { ...tile, evidenceSourceIds: [] };
    if (record.sourceId) existing.evidenceSourceIds.push(record.sourceId);
    tiles.set(tile.id, existing);
  }
  return Object.freeze([...tiles.values()]
    .map((tile) => Object.freeze({ ...tile, evidenceSourceIds: Object.freeze([...new Set(tile.evidenceSourceIds)].sort()) }))
    .sort((a, b) => a.south - b.south || a.west - b.west));
}

export function buildGmrtMaskedPatchUrl(tile, {
  resolutionMeters = GMRT_PATCH_RESOLUTION_METERS,
  format = "esriascii"
} = {}) {
  const url = new URL(GMRT_GRIDSERVER_BASE);
  url.searchParams.set("south", String(tile.south));
  url.searchParams.set("north", String(tile.north));
  url.searchParams.set("west", String(tile.west));
  url.searchParams.set("east", String(tile.east));
  url.searchParams.set("layer", "topo-mask");
  url.searchParams.set("format", format);
  url.searchParams.set("mresolution", String(Math.max(100, Math.round(Number(resolutionMeters) || GMRT_PATCH_RESOLUTION_METERS))));
  return url.toString();
}

function headerNumber(headers, key) {
  const value = headers.get(key.toLowerCase());
  return finite(value) ? Number(value) : null;
}

/** Parse ESRI ArcASCII while retaining NaN mask semantics from GMRT topo-mask. */
export function parseEsriAsciiGrid(text) {
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
  const xll = headerNumber(headers, "xllcorner") ?? headerNumber(headers, "xllcenter");
  const yll = headerNumber(headers, "yllcorner") ?? headerNumber(headers, "yllcenter");
  const noData = headerNumber(headers, "nodata_value");
  if (![ncols, nrows, cellsize, xll, yll].every(finite) || ncols <= 0 || nrows <= 0 || cellsize <= 0) {
    throw new Error("Invalid GMRT ESRI ASCII header");
  }
  const values = [];
  for (const line of lines.slice(dataStart)) {
    for (const token of line.trim().split(/\s+/)) {
      if (!token) continue;
      const value = Number(token);
      values.push(Number.isFinite(value) && (noData == null || value !== noData) ? value : NaN);
    }
  }
  if (values.length !== ncols * nrows) throw new Error(`Expected ${ncols * nrows} GMRT grid values, received ${values.length}`);
  return Object.freeze({ ncols, nrows, cellsize, xll, yll, noData, values: Object.freeze(values) });
}

export function packTerrainPatchInt16(grid) {
  const array = new Int16Array(grid.values.length);
  let finiteCount = 0;
  for (let index = 0; index < grid.values.length; index += 1) {
    const value = grid.values[index];
    if (!Number.isFinite(value)) {
      array[index] = GMRT_PATCH_NODATA;
      continue;
    }
    array[index] = Math.max(-32767, Math.min(32767, Math.round(value)));
    finiteCount += 1;
  }
  return Object.freeze({
    ncols: grid.ncols,
    nrows: grid.nrows,
    cellsizeDegrees: grid.cellsize,
    west: grid.xll,
    south: grid.yll,
    nodata: GMRT_PATCH_NODATA,
    finiteCount,
    coverageFraction: grid.values.length ? finiteCount / grid.values.length : 0,
    dataBase64: Buffer.from(array.buffer).toString("base64")
  });
}
