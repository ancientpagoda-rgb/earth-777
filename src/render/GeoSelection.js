export function geographicSelection(hit) {
  if (!hit?.uv) return null;
  return {
    latitude: hit.uv.y * 180 - 90,
    longitude: hit.uv.x * 360 - 180,
    direction: hit.point.clone().normalize()
  };
}
