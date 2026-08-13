export const ETOPO_ROWS = 360;
export const ETOPO_COLS = 720;
export const ETOPO_STRIDE = 30;
export const ETOPO_LAT_STOP = 10_799;
export const ETOPO_LON_STOP = 21_599;

export function buildEtopoOpendapUrl({ stride = ETOPO_STRIDE } = {}) {
  const base = "https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc.ascii";
  const constraint = `z[0:${stride}:${ETOPO_LAT_STOP}][0:${stride}:${ETOPO_LON_STOP}]`;
  return `${base}?${encodeURIComponent(constraint)}`;
}

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing OPeNDAP section: ${startMarker}`);
  const from = start + startMarker.length;
  const end = endMarker ? text.indexOf(endMarker, from) : text.length;
  if (end < 0) throw new Error(`Missing OPeNDAP section terminator: ${endMarker}`);
  return text.slice(from, end);
}

function parseIndexedRows(text) {
  const values = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^\[\d+\],/.test(line)) continue;
    const comma = line.indexOf(",");
    for (const token of line.slice(comma + 1).split(",")) {
      const value = Number(token.trim());
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

export function parseEtopoAscii(text, { rows = ETOPO_ROWS, cols = ETOPO_COLS } = {}) {
  const zValues = parseIndexedRows(section(text, "z.z", "z.lat"));
  const latitudes = parseIndexedRows(section(text, "z.lat", "z.lon"));
  const longitudes = parseIndexedRows(section(text, "z.lon", null));

  if (zValues.length !== rows * cols) {
    throw new Error(`Expected ${rows * cols} ETOPO elevations, received ${zValues.length}`);
  }
  if (latitudes.length !== rows) {
    throw new Error(`Expected ${rows} ETOPO latitudes, received ${latitudes.length}`);
  }
  if (longitudes.length !== cols) {
    throw new Error(`Expected ${cols} ETOPO longitudes, received ${longitudes.length}`);
  }

  return { rows, cols, elevations: zValues, latitudes, longitudes };
}

export function encodeInt16Base64(values) {
  const buffer = Buffer.allocUnsafe(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.max(-32_768, Math.min(32_767, Math.round(values[index])));
    buffer.writeInt16LE(value, index * 2);
  }
  return buffer.toString("base64");
}
