export const TERRAIN_SEAM_POLICY = "mixed-lod-shared-edge-conformance-v1";

const clampIndex = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

export function edgeVertexIndex(segments, edge, offset) {
  const seg = Math.max(1, Math.round(Number(segments) || 1));
  const side = seg + 1;
  const i = clampIndex(offset, seg);
  if (edge === "west") return i * side;
  if (edge === "east") return i * side + seg;
  if (edge === "south") return i;
  if (edge === "north") return seg * side + i;
  throw new RangeError(`Unknown terrain seam edge ${String(edge)}`);
}

function interpolateScalar(attribute, segments, edge, t) {
  const scaled = Math.max(0, Math.min(1, Number(t) || 0)) * segments;
  const lower = Math.floor(scaled);
  const upper = Math.min(segments, lower + 1);
  const fraction = scaled - lower;
  const a = Number(attribute.getX(edgeVertexIndex(segments, edge, lower))) || 0;
  const b = Number(attribute.getX(edgeVertexIndex(segments, edge, upper))) || 0;
  return a + (b - a) * fraction;
}

function interpolateY(attribute, segments, edge, t) {
  const scaled = Math.max(0, Math.min(1, Number(t) || 0)) * segments;
  const lower = Math.floor(scaled);
  const upper = Math.min(segments, lower + 1);
  const fraction = scaled - lower;
  const a = Number(attribute.getY(edgeVertexIndex(segments, edge, lower))) || 0;
  const b = Number(attribute.getY(edgeVertexIndex(segments, edge, upper))) || 0;
  return a + (b - a) * fraction;
}

function interpolateColor(attribute, segments, edge, t) {
  const scaled = Math.max(0, Math.min(1, Number(t) || 0)) * segments;
  const lower = Math.floor(scaled);
  const upper = Math.min(segments, lower + 1);
  const fraction = scaled - lower;
  const a = edgeVertexIndex(segments, edge, lower);
  const b = edgeVertexIndex(segments, edge, upper);
  return [
    attribute.getX(a) + (attribute.getX(b) - attribute.getX(a)) * fraction,
    attribute.getY(a) + (attribute.getY(b) - attribute.getY(a)) * fraction,
    attribute.getZ(a) + (attribute.getZ(b) - attribute.getZ(a)) * fraction
  ];
}

function markGeometryChanged(geometry, { position = false, elevation = false, color = false } = {}) {
  if (position && geometry.getAttribute("position")) geometry.getAttribute("position").needsUpdate = true;
  if (elevation && geometry.getAttribute("elevationMeters")) geometry.getAttribute("elevationMeters").needsUpdate = true;
  if (color && geometry.getAttribute("color")) geometry.getAttribute("color").needsUpdate = true;
  if (position) {
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
}

function conformHighEdgeToLow(highMesh, highEdge, lowMesh, lowEdge) {
  const highSegments = Math.max(1, Number(highMesh.userData?.segments) || 1);
  const lowSegments = Math.max(1, Number(lowMesh.userData?.segments) || 1);
  const highPosition = highMesh.geometry.getAttribute("position");
  const lowPosition = lowMesh.geometry.getAttribute("position");
  const highElevation = highMesh.geometry.getAttribute("elevationMeters");
  const lowElevation = lowMesh.geometry.getAttribute("elevationMeters");
  const highColor = highMesh.geometry.getAttribute("color");
  const lowColor = lowMesh.geometry.getAttribute("color");
  if (!highPosition || !lowPosition) return false;

  for (let i = 0; i <= highSegments; i += 1) {
    const t = i / highSegments;
    const index = edgeVertexIndex(highSegments, highEdge, i);
    highPosition.setY(index, interpolateY(lowPosition, lowSegments, lowEdge, t));
    if (highElevation && lowElevation) highElevation.setX(index, interpolateScalar(lowElevation, lowSegments, lowEdge, t));
    if (highColor && lowColor) {
      const [r, g, b] = interpolateColor(lowColor, lowSegments, lowEdge, t);
      highColor.setXYZ(index, r, g, b);
    }
  }
  markGeometryChanged(highMesh.geometry, { position: true, elevation: Boolean(highElevation && lowElevation), color: Boolean(highColor && lowColor) });
  return true;
}

function averageEqualEdges(meshA, edgeA, meshB, edgeB) {
  const segments = Math.max(1, Number(meshA.userData?.segments) || 1);
  if (segments !== Math.max(1, Number(meshB.userData?.segments) || 1)) return false;
  const positionA = meshA.geometry.getAttribute("position");
  const positionB = meshB.geometry.getAttribute("position");
  const elevationA = meshA.geometry.getAttribute("elevationMeters");
  const elevationB = meshB.geometry.getAttribute("elevationMeters");
  const colorA = meshA.geometry.getAttribute("color");
  const colorB = meshB.geometry.getAttribute("color");
  if (!positionA || !positionB) return false;

  for (let i = 0; i <= segments; i += 1) {
    const a = edgeVertexIndex(segments, edgeA, i);
    const b = edgeVertexIndex(segments, edgeB, i);
    const y = (positionA.getY(a) + positionB.getY(b)) * 0.5;
    positionA.setY(a, y);
    positionB.setY(b, y);
    if (elevationA && elevationB) {
      const elevation = (elevationA.getX(a) + elevationB.getX(b)) * 0.5;
      elevationA.setX(a, elevation);
      elevationB.setX(b, elevation);
    }
    if (colorA && colorB) {
      const r = (colorA.getX(a) + colorB.getX(b)) * 0.5;
      const g = (colorA.getY(a) + colorB.getY(b)) * 0.5;
      const blue = (colorA.getZ(a) + colorB.getZ(b)) * 0.5;
      colorA.setXYZ(a, r, g, blue);
      colorB.setXYZ(b, r, g, blue);
    }
  }
  const flags = { position: true, elevation: Boolean(elevationA && elevationB), color: Boolean(colorA && colorB) };
  markGeometryChanged(meshA.geometry, flags);
  markGeometryChanged(meshB.geometry, flags);
  return true;
}

export function stitchTerrainPair(meshA, edgeA, meshB, edgeB) {
  if (!meshA?.geometry || !meshB?.geometry) return false;
  const segmentsA = Math.max(1, Number(meshA.userData?.segments) || 1);
  const segmentsB = Math.max(1, Number(meshB.userData?.segments) || 1);
  if (segmentsA === segmentsB) return averageEqualEdges(meshA, edgeA, meshB, edgeB);
  return segmentsA > segmentsB
    ? conformHighEdgeToLow(meshA, edgeA, meshB, edgeB)
    : conformHighEdgeToLow(meshB, edgeB, meshA, edgeA);
}

export function stitchChunkNeighborhood(chunks, key) {
  const mesh = chunks?.get?.(key);
  if (!mesh) return 0;
  const { x, z } = mesh.userData?.chunk ?? {};
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) return 0;
  const pairs = [
    [`${x - 1}:${z}`, "west", "east"],
    [`${x + 1}:${z}`, "east", "west"],
    [`${x}:${z - 1}`, "south", "north"],
    [`${x}:${z + 1}`, "north", "south"]
  ];
  let stitched = 0;
  for (const [neighborKey, edge, neighborEdge] of pairs) {
    const neighbor = chunks.get(neighborKey);
    if (neighbor && stitchTerrainPair(mesh, edge, neighbor, neighborEdge)) stitched += 1;
  }
  return stitched;
}
