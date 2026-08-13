import test from "node:test";
import assert from "node:assert/strict";
import {
  ETOPO_COLS,
  ETOPO_ROWS,
  buildEtopoOpendapUrl,
  encodeInt16Base64,
  parseEtopoAscii
} from "../scripts/etopo-utils.mjs";

test("ETOPO OPeNDAP request uses centered 30-cell hyperslabs", () => {
  const url = decodeURIComponent(buildEtopoOpendapUrl());
  assert.match(url, /z\[15:30:10785\]\[15:30:21585\]/);
  assert.equal(ETOPO_ROWS, 360);
  assert.equal(ETOPO_COLS, 720);
});

test("ETOPO ASCII parser extracts elevations and reconstructs cell-center coordinates", () => {
  const fixture = `Dataset {\n  Grid {\n    ARRAY:\n      Float32 z[lat = 2][lon = 3];\n  } z;\n} sample;\n---------------------------------------------\nz.z\n[2][3]\n[0], -10, 0, 12\n[1], 25, 31, 44\n`;
  const parsed = parseEtopoAscii(fixture, { rows: 2, cols: 3 });
  assert.deepEqual(parsed.elevations, [-10, 0, 12, 25, 31, 44]);
  assert.ok(Math.abs(parsed.latitudes[0] - 89.74166666666666) < 1e-12);
  assert.ok(Math.abs(parsed.latitudes[1] - 89.24166666666666) < 1e-12);
  assert.ok(Math.abs(parsed.longitudes[0] + 179.74166666666667) < 1e-12);
  assert.ok(Math.abs(parsed.longitudes[1] + 179.24166666666667) < 1e-12);
  assert.ok(Math.abs(parsed.longitudes[2] + 178.74166666666667) < 1e-12);
});

test("ETOPO int16 encoding is deterministic and meter-preserving", () => {
  const values = [-10900.2, -1, 0, 8848.4];
  const first = encodeInt16Base64(values);
  const second = encodeInt16Base64(values);
  assert.equal(first, second);
  const buffer = Buffer.from(first, "base64");
  assert.deepEqual([
    buffer.readInt16LE(0),
    buffer.readInt16LE(2),
    buffer.readInt16LE(4),
    buffer.readInt16LE(6)
  ], [-10900, -1, 0, 8848]);
});
