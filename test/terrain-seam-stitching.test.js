import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { edgeVertexIndex, stitchTerrainPair } from "../src/render/TerrainSeamStitching.js";

function terrainMesh(segments, edge, edgeHeight) {
  const side = segments + 1;
  const positions = new Float32Array(side * side * 3);
  const elevations = new Float32Array(side * side);
  const colors = new Float32Array(side * side * 3);
  const indices = [];
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const index = row * side + col;
      positions[index * 3] = col / segments;
      positions[index * 3 + 1] = -5;
      positions[index * 3 + 2] = row / segments;
      elevations[index] = -500;
      colors[index * 3] = 0.2;
      colors[index * 3 + 1] = 0.3;
      colors[index * 3 + 2] = 0.4;
    }
  }
  for (let i = 0; i <= segments; i += 1) {
    const index = edgeVertexIndex(segments, edge, i);
    const y = edgeHeight(i / segments);
    positions[index * 3 + 1] = y;
    elevations[index] = y * 100;
    colors[index * 3] = i / segments;
  }
  for (let row = 0; row < segments; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      const a = row * side + col;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("elevationMeters", new THREE.BufferAttribute(elevations, 1));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData.segments = segments;
  return mesh;
}

test("fine terrain edge conforms exactly to coarse neighbor interpolation", () => {
  const coarse = terrainMesh(4, "east", (t) => 2 + t * 8);
  const fine = terrainMesh(12, "west", (t) => 30 + Math.sin(t * Math.PI) * 10);
  assert.equal(stitchTerrainPair(fine, "west", coarse, "east"), true);
  const finePosition = fine.geometry.getAttribute("position");
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const index = edgeVertexIndex(12, "west", i);
    assert.ok(Math.abs(finePosition.getY(index) - (2 + t * 8)) < 1e-5);
  }
});

test("equal-resolution neighboring edges meet at the same height", () => {
  const west = terrainMesh(6, "east", (t) => 4 + t * 2);
  const east = terrainMesh(6, "west", (t) => 6 + t * 4);
  stitchTerrainPair(west, "east", east, "west");
  const westPosition = west.geometry.getAttribute("position");
  const eastPosition = east.geometry.getAttribute("position");
  for (let i = 0; i <= 6; i += 1) {
    const a = edgeVertexIndex(6, "east", i);
    const b = edgeVertexIndex(6, "west", i);
    assert.ok(Math.abs(westPosition.getY(a) - eastPosition.getY(b)) < 1e-8);
  }
});
