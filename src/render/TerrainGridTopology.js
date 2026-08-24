const indexCache = new Map();

export function gridIndicesForSegments(segments = 18) {
  const count = Math.max(1, Math.round(Number(segments) || 18));
  if (indexCache.has(count)) return indexCache.get(count);
  const side = count + 1;
  const indices = new Uint32Array(count * count * 6);
  let offset = 0;
  for (let z = 0; z < count; z += 1) {
    for (let x = 0; x < count; x += 1) {
      const a = z * side + x;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[offset++] = a; indices[offset++] = c; indices[offset++] = b;
      indices[offset++] = b; indices[offset++] = c; indices[offset++] = d;
    }
  }
  indexCache.set(count, indices);
  return indices;
}

export function terrainGridTopologyDiagnostics() {
  return Object.freeze({ cachedSegmentCounts: Object.freeze([...indexCache.keys()].sort((a, b) => a - b)) });
}
