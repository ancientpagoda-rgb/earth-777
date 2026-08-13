from pathlib import Path

main = Path("src/main.js")
s = main.read_text()
old = '''  .then((layer) => {
    climate777 = layer;
    if (selected) renderRegion(engine.snapshot(), selected.latitude, selected.longitude);
  })'''
new = '''  .then((layer) => {
    climate777 = layer;
    earthView.setClimate(layer);
    if (selected) renderRegion(engine.snapshot(), selected.latitude, selected.longitude);
  })'''
assert old in s, "Krapp load completion block not found"
main.write_text(s.replace(old, new, 1))

view = Path("src/render/earth-view.js")
s = view.read_text()
old = '''function moistureFromCheckpoint(precipitationMmPerYear, cloudCoverPercent) {
  const precipitation = clamp(Math.log1p(Math.max(0, precipitationMmPerYear)) / Math.log1p(5_000), 0, 1);
  const cloud = clamp((cloudCoverPercent ?? 50) / 100, 0, 1);
  return clamp(precipitation * 0.82 + cloud * 0.18, 0.05, 1);
}'''
new = '''function moistureFromCheckpoint(precipitationMmPerYear) {
  return clamp(precipitationMmPerYear / (precipitationMmPerYear + 700), 0.05, 1);
}'''
assert old in s, "renderer moisture helper not found"
s = s.replace(old, new, 1)
s = s.replace(
    'moistureFromCheckpoint(checkpointClimate.precipitationMmPerYear, checkpointClimate.cloudCoverPercent)',
    'moistureFromCheckpoint(checkpointClimate.precipitationMmPerYear)',
    1,
)
view.write_text(s)
