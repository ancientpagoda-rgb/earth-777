import test from "node:test";
import assert from "node:assert/strict";
import { SURFACE_SCALE_BANDS, surfaceFrameForBand, surfaceScaleBandForDistance, surfaceWaterPolicy } from "../src/render/SurfaceScaleController.js";
import { ATMOSPHERE_REFERENCE_TOP_KM, DEEP_EARTH_BOUNDARIES_KM, EARTH_LAYER_PRESENTATION, earthLayerFarSideVisibility, surfaceEarthLayerLayout, surfaceEarthLayerProfile } from "../src/render/SurfaceEarthLayers.js";

test("surface scale bands descend from region to ground", () => {
  assert.equal(surfaceScaleBandForDistance(42).id, "regional");
  assert.equal(surfaceScaleBandForDistance(3).id, "landscape");
  assert.equal(surfaceScaleBandForDistance(0.8).id, "ecology");
  assert.equal(surfaceScaleBandForDistance(0.08).id, "ground");
});

test("regional overview stays bounded and sufficiently tessellated", () => {
  const regional = SURFACE_SCALE_BANDS.find((band) => band.id === "regional");
  assert.ok(regional);
  const spanKm = regional.chunkSizeKm * (regional.radius * 2 + 1);
  assert.ok(spanKm <= 90, `regional footprint should stay aerially frameable, got ${spanKm} km`);
  assert.ok(regional.segments >= 18, `regional chunks should avoid giant facets, got ${regional.segments} segments`);
  assert.ok(regional.radius <= 1, `regional streaming should not expose a postage-stamp center tile, got radius ${regional.radius}`);
});

test("regional framing derives camera distance from footprint and viewport", () => {
  const frame = surfaceFrameForBand({ bandId: "regional", fovDegrees: 58, aspect: 16 / 9, fill: 0.78 });
  assert.equal(frame.spanKm, 84);
  assert.ok(frame.distanceKm > frame.spanKm * 0.6);
  assert.ok(frame.distanceKm < frame.spanKm * 1.8);
  assert.ok(frame.position.y > 0);
  assert.ok(frame.position.z > 0);
});

test("local branch lakes are suppressed at regional and landscape scale", () => {
  for (const bandId of ["regional", "landscape"]) {
    const policy = surfaceWaterPolicy({
      bandId,
      waterBody: "lake",
      baseElevationMeters: 420,
      seaLevelMeters: -14,
      lakeCoverageFraction: 0.72
    });
    assert.equal(policy.visible, false);
    assert.equal(policy.presentation, "hidden");
    assert.equal(policy.reason, "local-lake-deferred");
  }
});

test("local lakes materialize only close to the surface and remain bounded", () => {
  const ecology = surfaceWaterPolicy({ bandId: "ecology", waterBody: "lake", lakeCoverageFraction: 1 });
  const ground = surfaceWaterPolicy({ bandId: "ground", waterBody: "lake", lakeCoverageFraction: 1 });
  assert.equal(ecology.visible, true);
  assert.equal(ecology.presentation, "surface");
  assert.ok(ecology.spanFraction <= 0.36);
  assert.equal(ground.visible, true);
  assert.equal(ground.presentation, "surface");
  assert.ok(ground.spanFraction <= 0.58);
});

test("regional ocean uses a sea-level reference outline instead of a filled rectangle", () => {
  const inland = surfaceWaterPolicy({
    bandId: "regional",
    waterBody: "ocean",
    baseElevationMeters: 410,
    seaLevelMeters: -14
  });
  assert.equal(inland.visible, false);
  assert.equal(inland.presentation, "hidden");
  assert.equal(inland.reason, "inland-ocean-suppressed");

  const coast = surfaceWaterPolicy({
    bandId: "regional",
    waterBody: "ocean",
    baseElevationMeters: 18,
    seaLevelMeters: -14
  });
  assert.equal(coast.visible, true);
  assert.equal(coast.presentation, "reference-outline");
  assert.equal(coast.reason, "regional-sea-level-reference");

  const local = surfaceWaterPolicy({
    bandId: "ground",
    waterBody: "ocean",
    baseElevationMeters: -12,
    seaLevelMeters: -14
  });
  assert.equal(local.visible, true);
  assert.equal(local.presentation, "surface");
  assert.equal(local.reason, "coastal-ocean");
});

test("cutaway distinguishes oceanic and continental crust", () => {
  const oceanic = surfaceEarthLayerProfile({ baseElevationMeters: -4200, seaLevelMeters: -14 });
  const continental = surfaceEarthLayerProfile({ baseElevationMeters: 450, seaLevelMeters: -14 });
  assert.equal(oceanic.crustType, "oceanic");
  assert.equal(oceanic.crustThicknessKm, DEEP_EARTH_BOUNDARIES_KM.mohoOceanic);
  assert.equal(continental.crustType, "continental");
  assert.equal(continental.crustThicknessKm, DEEP_EARTH_BOUNDARIES_KM.mohoContinental);
  assert.ok(continental.crustThicknessKm > oceanic.crustThicknessKm);
});

test("deep Earth and atmosphere retain real boundaries while display depth stays regional", () => {
  const layout = surfaceEarthLayerLayout({ spanKm: 84, baseElevationMeters: 450, seaLevelMeters: -14 });
  assert.equal(layout.atmosphere.at(-1).topKm, ATMOSPHERE_REFERENCE_TOP_KM);
  assert.equal(layout.geology.at(-1).bottomKm, DEEP_EARTH_BOUNDARIES_KM.center);
  assert.ok(layout.geologyDisplayDepthKm <= 19);
  assert.ok(layout.geologyDisplayDepthKm >= 12);
  assert.ok(layout.atmosphereDisplayHeightKm <= 12);
  assert.equal(layout.geology.length, 7);
  assert.equal(layout.atmosphere.length, 4);
  assert.equal(layout.presentation, EARTH_LAYER_PRESENTATION);
});

test("cutaway keeps exactly the two farthest side walls", () => {
  assert.deepEqual(earthLayerFarSideVisibility({ x: 8, z: 70 }, 84), {
    front: false,
    back: true,
    left: true,
    right: false
  });
  assert.deepEqual(earthLayerFarSideVisibility({ x: -8, z: -70 }, 84), {
    front: true,
    back: false,
    left: false,
    right: true
  });
  const oblique = earthLayerFarSideVisibility({ x: 90, z: 18 }, 84);
  assert.equal(Object.values(oblique).filter(Boolean).length, 2);
  assert.equal(oblique.left, true);
  assert.equal(oblique.right, false);
});
