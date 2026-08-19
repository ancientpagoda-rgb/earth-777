import test from "node:test";
import assert from "node:assert/strict";
import {
  surfaceFrameForBand,
  surfacePresentationSpanKm,
  surfaceScaleBandById,
  surfaceStreamingSpanKm
} from "../src/render/SurfaceScaleController.js";

test("regional terrain streams far beyond the framed selection", () => {
  const regional = surfaceScaleBandById("regional");
  assert.equal(surfacePresentationSpanKm(regional), 84);
  assert.equal(surfaceStreamingSpanKm(regional), 420);
  assert.ok(surfaceStreamingSpanKm(regional) >= surfacePresentationSpanKm(regional) * 4.5);
});

test("regional camera framing stays tied to the presentation span, not the streaming buffer", () => {
  const frame = surfaceFrameForBand({
    bandId: "regional",
    fovDegrees: 58,
    aspect: 16 / 9,
    fill: 0.91,
    elevationDegrees: 78,
    azimuthDegrees: 3,
    groundY: 0
  });
  assert.equal(frame.spanKm, 84);
  assert.equal(frame.streamingSpanKm, 420);
  assert.ok(frame.distanceKm < 150, `regional frame unexpectedly pulled back to ${frame.distanceKm} km`);
});

test("closer surface bands retain their normal footprint semantics", () => {
  for (const id of ["landscape", "ecology", "ground"]) {
    const band = surfaceScaleBandById(id);
    assert.equal(surfacePresentationSpanKm(band), surfaceStreamingSpanKm(band));
  }
});
