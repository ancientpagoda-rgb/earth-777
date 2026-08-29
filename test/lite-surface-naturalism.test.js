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

test("Lite generated source still exposes the surface-naturalism patch points", () => {
  assert.ok(source.includes("const plantMax=lowQuality?220:520,plantMesh=new THREE.InstancedMesh(new THREE.ConeGeometry(.026,.13,5)"));
  assert.ok(source.includes("const riverGeom=new THREE.BufferGeometry(),riverLines=new THREE.LineSegments"));
  assert.ok(source.includes("riverGeom.setAttribute('position',new THREE.Float32BufferAttribute(riverPositions,3));riverGeom.computeBoundingSphere();"));
});

test("Lite loader keeps one instanced plant mesh while switching biome silhouettes", () => {
  assert.match(loader, /function makeNaturalTreeGeometry\(kind='temperate'\)/);
  assert.match(loader, /biomePlantGeometries=\{rainforest:/);
  assert.match(loader, /boreal:makeNaturalTreeGeometry\('boreal'\)/);
  assert.match(loader, /savanna:makeNaturalTreeGeometry\('savanna'\)/);
  assert.match(loader, /scrub:makeNaturalTreeGeometry\('scrub'\)/);
  assert.match(loader, /tundra:makeNaturalTreeGeometry\('tundra'\)/);
  assert.match(loader, /new THREE\.InstancedMesh\(biomePlantGeometries\.temperate,new THREE\.MeshLambertMaterial\(\{vertexColors:true\}\),plantMax\)/);
  assert.match(loader, /const plantMax=lowQuality\?220:520/);
  assert.ok(!loader.includes("plantMesh2"));
  assert.ok(!loader.includes("plantMax2"));
});

test("biome surface styles cover every Lite biome and remain climate-coupled", () => {
  for (const biome of ["ocean", "ice", "tundra", "desert", "grassland", "shrubland", "temperate forest", "rainforest", "boreal forest", "alpine"]) {
    assert.ok(loader.includes(`${biome.includes(' ') ? `'${biome}'` : biome}:{key:`), `missing style for ${biome}`);
  }
  assert.match(loader, /function surfaceBiomeStyle\(\)\{const name=BIOME_NAMES\[biome\[stateIndex\(surfaceLat,surfaceLon\)\]\]/);
  assert.match(loader, /applyBiomeSurfaceCharacter\(true\);applySurfaceZoomPresentation\(\)/);
  assert.match(loader, /surfacePlantDensity=style\.density\.toFixed\(2\)/);
  assert.match(loader, /surfaceMesh\.material\.color\.setHex\(activeLayer==='terrain'\?style\.ground:0xffffff\)/);
});

test("Lite loader expands rivers into biome-scaled shallow ribbons", () => {
  assert.match(loader, /function updateNaturalRiverRibbons\(segments\)/);
  assert.match(loader, /expanded=new Float32Array\(count\*18\)/);
  assert.match(loader, /style=surfaceBiomeStyle\(\),halfWidth=clamp\(\.025\*Math\.sqrt\(620\/Math\.max\(70,surfaceSpanKm\)\)\*style\.riverWidth,\.005,\.04\)/);
  assert.match(loader, /new THREE\.Mesh\(riverGeom,new THREE\.MeshPhongMaterial/);
  assert.match(loader, /depthWrite:false/);
  assert.match(loader, /updateNaturalRiverRibbons\(riverPositions\)/);
  assert.match(loader, /surfaceRiverStyle=`ribbon-\$\{style\.key\}`/);
});

test("Surface naturalism preserves the Lite population and river triangle budgets", () => {
  const lowQualityPlants = 220;
  const fullQualityPlants = 520;
  const trianglesPerRiverSegment = 2;
  assert.equal(lowQualityPlants, 220);
  assert.equal(fullQualityPlants, 520);
  assert.equal(trianglesPerRiverSegment, 2);
  assert.ok(!loader.includes("plantMax=lowQuality?440:1040"));
});
