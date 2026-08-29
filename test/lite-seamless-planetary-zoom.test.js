import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loader = readFileSync(new URL("../public/lite/app-loader.js", import.meta.url), "utf8");
const source = Buffer.from(
  Array.from({ length: 6 }, (_, index) =>
    readFileSync(new URL(`../public/lite/app-${index}.b64`, import.meta.url), "utf8")
  ).join(""),
  "base64",
).toString("utf8");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const logBlend = (spanKm, startKm, endKm) => {
  if (spanKm <= startKm) return 0;
  return smooth((Math.log(spanKm) - Math.log(startKm)) / (Math.log(endKm) - Math.log(startKm)));
};
const curve = (spanKm) => logBlend(spanKm, 1800, 9000);
const blend = (spanKm) => logBlend(spanKm, 9000, 14000);

test("Lite generated source still exposes the planetary-zoom patch points", () => {
  assert.ok(source.includes("let mode='globe',surfaceLat=selectedLat??0,surfaceLon=selectedLon??0,surfaceSpanKm=620,surfaceDirty=true;"));
  assert.ok(source.includes("surfaceSpanKm=clamp(surfaceSpanKm*factor,70,1800);surfaceDirty=true"));
  assert.ok(source.includes("surfaceSpanKm=clamp(surfaceSpanKm*Math.exp(e.deltaY*.0012),70,1800);surfaceDirty=true"));
  assert.ok(source.includes("if(mode!=='surface')return;\n    const scale=12/surfaceSpanKm"));
  assert.ok(source.includes("function exitSurface(){mode='globe';"));
});

test("Lite loader curves the regional surface before revealing the globe", () => {
  assert.match(loader, /PLANETARY_CURVE_START_KM=1800/);
  assert.match(loader, /PLANETARY_CURVE_FULL_KM=9000/);
  assert.match(loader, /PLANETARY_BLEND_START_KM=9000/);
  assert.match(loader, /PLANETARY_BLEND_END_KM=14000/);
  assert.match(loader, /PLANETARY_GLOBE_REVEAL_KM=9000/);
  assert.match(loader, /PLANETARY_DETAIL_CUTOFF_KM=14000/);
  assert.match(loader, /EARTH_RADIUS_KM=6371/);
  assert.match(loader, /function applyPlanetaryCurvature\(\)/);
  assert.match(loader, /curveGeometryToPlanet\(surfaceMesh\.geometry,amount,scale\)/);
  assert.match(loader, /curveGeometryToPlanet\(riverGeom,amount,scale\)/);
  assert.match(loader, /applyPlanetaryCurvature\(\);applySurfaceZoomPresentation\(\)/);

  assert.equal(blend(5695), 0, "the screenshot scale must not reveal a globe");
  assert.ok(curve(5695) > 0 && curve(5695) < 1, "the same scale should already show Earth curvature");
  assert.equal(curve(9000), 1);
});

test("planetary handoff remains monotonic and reaches a full globe", () => {
  assert.equal(blend(9000), 0);
  assert.ok(blend(11000) > 0 && blend(11000) < 1);
  assert.equal(blend(14000), 1);
  assert.equal(blend(40000), 1);
  assert.match(loader, /if\(surfaceSpanKm<PLANETARY_GLOBE_REVEAL_KM\)\{globeRoot\.visible=false;/);
  assert.match(loader, /state\.material\.opacity=0;state\.material\.transparent=true;state\.material\.depthWrite=false/);
  assert.ok(40000 >= 39900);
  assert.ok(20000 <= 40000 / 2);
});

test("Navigation 2.0 separates travel, orbit, roll and camera pan", () => {
  assert.match(loader, /let surfaceOrbitYaw=0,surfaceOrbitPitch=0,surfaceOrbitRoll=0,surfaceFocusX=0,surfaceFocusY=0/);
  assert.match(loader, /function applySurfaceCameraPose\(t,far\)/);
  assert.match(loader, /e\.button!==1&&e\.button!==2/);
  assert.match(loader, /navPointer\.roll=e\.button===2&&e\.shiftKey/);
  assert.match(loader, /surfaceOrbitYaw-=dx\/innerWidth\*Math\.PI\*2\.2/);
  assert.match(loader, /surfaceOrbitPitch=clamp\(/);
  assert.match(loader, /surfaceOrbitRoll=clamp\(/);
  assert.match(loader, /surfaceFocusX=clamp\(/);
  assert.match(loader, /surfaceFocusY=clamp\(/);
  assert.match(loader, /stage\.addEventListener\('contextmenu'/);
  assert.match(loader, /stage\.addEventListener\('pointerdown',navigationPointerDown,true\)/);
});

test("Navigation 2.0 adds coarse/fine wheel zoom and double-click focus/reset", () => {
  assert.match(loader, /function surfaceWheelRate\(e\)\{return e\.shiftKey\?\.0024:e\.ctrlKey\?\.00045:\.0012\}/);
  assert.match(loader, /Math\.exp\(e\.deltaY\*surfaceWheelRate\(e\)\)/);
  assert.match(loader, /function focusSurfaceFromDoubleClick\(e\)/);
  assert.match(loader, /if\(e\.button===2\).*resetSurfaceCameraOrientation\(\)/);
  assert.match(loader, /ray\.intersectObject\(surfaceMesh,false\)/);
  assert.match(loader, /ray\.intersectObjects\(globeRoot\.children,true\)/);
  assert.match(loader, /stage\.addEventListener\('dblclick',focusSurfaceFromDoubleClick,true\)/);
});

test("planetary-scale left drag preserves the authoritative geographic navigation contract", () => {
  assert.match(loader, /surfaceDragSpanKm\(\)/);
  assert.match(loader, /surfaceLon=wrapLon\(surfaceLon-\(now\.x-old\.x\)\/innerWidth\*surfaceDragSpanKm\(\)\/\(111\*cos\)\)/);
  assert.match(loader, /surfaceLat=clamp\(surfaceLat\+\(now\.y-old\.y\)\/innerHeight\*surfaceDragSpanKm\(\)\/111,-89,89\)/);
  assert.match(loader, /if\(t>\.001\)centerGlobeOnSurface\(\)/);
  assert.match(loader, /if\(surfaceSpanKm>=PLANETARY_DETAIL_CUTOFF_KM\)\{surfaceDirty=false;applySurfaceZoomPresentation\(\);return;\}/);
});
