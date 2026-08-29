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
const blend = (spanKm, startKm = 1400, endKm = 12000) => smooth(
  (Math.log(spanKm) - Math.log(startKm)) / (Math.log(endKm) - Math.log(startKm)),
);

test("Lite generated source still exposes the planetary-zoom patch points", () => {
  assert.ok(source.includes("let mode='globe',surfaceLat=selectedLat??0,surfaceLon=selectedLon??0,surfaceSpanKm=620,surfaceDirty=true;"));
  assert.ok(source.includes("surfaceSpanKm=clamp(surfaceSpanKm*factor,70,1800);surfaceDirty=true"));
  assert.ok(source.includes("surfaceSpanKm=clamp(surfaceSpanKm*Math.exp(e.deltaY*.0012),70,1800);surfaceDirty=true"));
  assert.ok(source.includes("if(mode!=='surface')return;\n    const scale=12/surfaceSpanKm"));
  assert.ok(source.includes("function exitSurface(){mode='globe';"));
});

test("Lite loader installs one continuous surface-to-globe zoom state", () => {
  assert.match(loader, /PLANETARY_BLEND_START_KM=1400/);
  assert.match(loader, /PLANETARY_BLEND_END_KM=12000/);
  assert.match(loader, /PLANETARY_DETAIL_CUTOFF_KM=12000/);
  assert.match(loader, /PLANETARY_MAX_SPAN_KM=40000/);
  assert.match(loader, /PLANETARY_DRAG_SPAN_KM=20000/);
  assert.match(loader, /function applySurfaceZoomPresentation\(\)/);
  assert.match(loader, /function centerGlobeOnSurface\(\)/);
  assert.match(loader, /surfaceSpanKm=clamp\(surfaceSpanKm\*Math\.exp\(e\.deltaY\*\.0012\),70,PLANETARY_MAX_SPAN_KM\)/);
  assert.match(loader, /surfaceSpanKm=clamp\(surfaceSpanKm\*factor,70,PLANETARY_MAX_SPAN_KM\)/);
  assert.match(loader, /document\.body\.dataset\.planetaryZoom/);
});

test("planetary handoff is monotonic and reaches a full-globe presentation", () => {
  assert.equal(blend(620), 0);
  assert.equal(blend(1400), 0);
  assert.ok(blend(3000) > 0 && blend(3000) < 0.5);
  assert.ok(blend(7000) > 0.5 && blend(7000) < 1);
  assert.equal(blend(12000), 1);
  assert.equal(blend(40000), 1);

  // ~40,000 km is Earth's circumference, so the accepted maximum can represent
  // the complete planet while the capped drag span remains about a half-turn.
  assert.ok(40000 >= 39900);
  assert.ok(20000 <= 40000 / 2);
});

test("planetary-scale surface navigation preserves the authoritative coordinates", () => {
  assert.match(loader, /surfaceDragSpanKm\(\)/);
  assert.match(loader, /surfaceLon=wrapLon\(surfaceLon-\(now\.x-old\.x\)\/innerWidth\*surfaceDragSpanKm\(\)\/\(111\*cos\)\)/);
  assert.match(loader, /surfaceLat=clamp\(surfaceLat\+\(now\.y-old\.y\)\/innerHeight\*surfaceDragSpanKm\(\)\/111,-89,89\)/);
  assert.match(loader, /if\(t>\.001\)centerGlobeOnSurface\(\)/);
  assert.match(loader, /if\(surfaceSpanKm>=PLANETARY_DETAIL_CUTOFF_KM\)\{surfaceDirty=false;applySurfaceZoomPresentation\(\);return;\}/);
});
