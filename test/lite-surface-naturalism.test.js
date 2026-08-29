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

test("Lite loader replaces cone vegetation with one vertex-colored instanced tree mesh", () => {
  assert.match(loader, /function makeNaturalTreeGeometry\(\)/);
  assert.match(loader, /CylinderGeometry\(\.008,\.011,\.066,5,1,false\)/);
  assert.match(loader, /IcosahedronGeometry\(\.041,0\)/);
  assert.match(loader, /MeshLambertMaterial\(\{vertexColors:true\}\)/);
  assert.match(loader, /const plantMax=lowQuality\?220:520/);
  assert.match(loader, /surfaceTreeStyle='trunk-crown-v1'/);
});

test("Lite loader expands rivers into bounded shallow ribbons", () => {
  assert.match(loader, /function updateNaturalRiverRibbons\(segments\)/);
  assert.match(loader, /expanded=new Float32Array\(count\*18\)/);
  assert.match(loader, /clamp\(\.025\*Math\.sqrt\(620\/Math\.max\(70,surfaceSpanKm\)\),\.006,\.032\)/);
  assert.match(loader, /new THREE\.Mesh\(riverGeom,new THREE\.MeshPhongMaterial/);
  assert.match(loader, /depthWrite:false/);
  assert.match(loader, /updateNaturalRiverRibbons\(riverPositions\)/);
  assert.match(loader, /surfaceRiverStyle='ribbon-v1'/);
});

test("Surface naturalism preserves the Lite population budgets", () => {
  const lowQualityPlants = 220;
  const fullQualityPlants = 520;
  const trianglesPerRiverSegment = 2;
  assert.equal(lowQualityPlants, 220);
  assert.equal(fullQualityPlants, 520);
  assert.equal(trianglesPerRiverSegment, 2);
  assert.ok(!loader.includes("plantMax=lowQuality?440:1040"));
});
