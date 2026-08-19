import test from "node:test";
import assert from "node:assert/strict";
import { bedrockElevationAt, ETOPO_2022_META } from "../src/data/generated/etopo-2022.generated.js";
import { interpolatedEtopoBedrockElevationAt, selectModernTerrainAnchor } from "../src/reconstruction/ModernTerrainAnchorSelector.js";

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test("compact ETOPO interpolation preserves exact stored cell centers", () => {
  const row = 190;
  const col = 410;
  const latitude = ETOPO_2022_META.northLatitude - row * ETOPO_2022_META.latitudeStepDegrees;
  const longitude = ETOPO_2022_META.westLongitude + col * ETOPO_2022_META.longitudeStepDegrees;
  closeTo(interpolatedEtopoBedrockElevationAt(latitude, longitude), bedrockElevationAt(latitude, longitude));
});

test("compact ETOPO midpoint is bilinear instead of nearest-cell terracing", () => {
  const row = 180;
  const col = 360;
  const lat0 = ETOPO_2022_META.northLatitude - row * ETOPO_2022_META.latitudeStepDegrees;
  const lat1 = lat0 - ETOPO_2022_META.latitudeStepDegrees;
  const lon0 = ETOPO_2022_META.westLongitude + col * ETOPO_2022_META.longitudeStepDegrees;
  const lon1 = lon0 + ETOPO_2022_META.longitudeStepDegrees;
  const midpointLat = (lat0 + lat1) / 2;
  const midpointLon = (lon0 + lon1) / 2;
  const expected = (
    bedrockElevationAt(lat0, lon0)
    + bedrockElevationAt(lat0, lon1)
    + bedrockElevationAt(lat1, lon0)
    + bedrockElevationAt(lat1, lon1)
  ) / 4;
  closeTo(interpolatedEtopoBedrockElevationAt(midpointLat, midpointLon), expected, 1e-6);
});

test("ETOPO fallback advertises compact browser-grid resolution honestly", () => {
  const selection = selectModernTerrainAnchor(7.6, -77.6);
  const fallback = selection.ranked.find((candidate) => candidate.sourceId === "etopo-2022");
  assert.ok(fallback);
  assert.ok(fallback.resolutionMeters > 50_000 && fallback.resolutionMeters < 60_000);
  assert.equal(fallback.measurementClass, "interpolated");
});
