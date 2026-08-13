export const ETOPO_ROWS = 360;
export const ETOPO_COLS = 720;
export const ETOPO_STRIDE = 30;
export const ETOPO_LAT_START = 15;
export const ETOPO_LON_START = 15;
export const ETOPO_LAT_STOP = 10_785;
export const ETOPO_LON_STOP = 21_585;
export const ETOPO_SOURCE_STEP_DEGREES = 1 / 60;

export function buildEtopoOpendapUrl({ stride = ETOPO_STRIDE } = {}) {
  const base = "https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc.ascii";
  const constraint = `z[${ETOPO_LAT_START}:${stride}:${ETOPO_LAT_STOP}][${ETOPO_LON_START}:${stride}:${ETOPO_LON_STOP}]`;
  return `${base}?${encodeURIComponent(constraint)}`;
}

function rasterSection(text) {
  const marker = "z.z";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing OPeNDAP section: ${marker}`);
  return text.slice(start + marker.length);
}

function parseRasterRows(text, rows, cols) {
  const values = [];
  let parsedRows = 0;
  for (const rawLine of rasterSection(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^\[\d+\],/.test(line)) continue;
    const comma = line.indexOf(",");
    const row = line.slice(comma + 1).split(",").map((token) => Number(token.trim()));
    if (row.length !== cols || row.some((value) => !Number.isFinite(value))) continue;
    values.push(...row);
    parsedRows += 1;
    if (parsedRows === rows) break;
  }
  if (parsedRows !== rows || values.length !== rows * cols) {
    throw new Error(`Expected ${rows} × ${cols} ETOPO elevations, received ${parsedRows} rows / ${values.length} values`);
  }
  return values;
}

function latitudeForSourceIndex(index) {
  return 90 - (index + 0.5) * ETOPO_SOURCE_STEP_DEGREES;
}

function longitudeForSourceIndex(index) {
  return -180 + (index + 0.5) * ETOPO_SOURCE_STEP_DEGREES;
}

export function parseEtopoAscii(text, { rows = ETOPO_ROWS, cols = ETOPO_COLS, stride = ETOPO_STRIDE } = {}) {
  const elevations = parseRasterRows(text, rows, cols);
  const latitudes = Array.from({ length: rows }, (_, row) =>
    latitudeForSourceIndex(ETOPO_LAT_START + row * stride)
  );
  const longitudes = Array.from({ length: cols }, (_, col) =>
    longitudeForSourceIndex(ETOPO_LON_START + col * stride)
  );
  return { rows, cols, elevations, latitudes, longitudes };
}

export function encodeInt16Base64(values) {
  const buffer = Buffer.allocUnsafe(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.max(-32_768, Math.min(32_767, Math.round(values[index])));
    buffer.writeInt16LE(value, index * 2);
  }
  return buffer.toString("base64");
}
