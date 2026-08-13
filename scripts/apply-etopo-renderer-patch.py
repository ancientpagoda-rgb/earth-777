from pathlib import Path

CHECKSUM = "ec275e81a80b1c635210a17485a04ff53e985e912e030a794f46a6b6638d4d32"

ingest = Path("scripts/ingest-etopo-2022.mjs")
s = ingest.read_text()
old = "const expectedSha256 = process.env.ETOPO_EXPECTED_SHA256?.trim();\nif (expectedSha256 && expectedSha256 !== rawSha256) {"
new = f'const expectedSha256 = "{CHECKSUM}";\nif (expectedSha256 !== rawSha256) {{'
assert old in s, "checksum insertion point not found"
ingest.write_text(s.replace(old, new, 1))

view = Path("src/render/earth-view.js")
s = view.read_text()
old_imports = 'import { feature } from "topojson-client";\nimport landTopology from "world-atlas/land-110m.json";'
new_import = 'import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";'
assert old_imports in s, "old topology imports not found"
s = s.replace(old_imports, new_import, 1)

start = s.index("function drawRing(")
end = s.index("function colorEarthPixel(", start)
s = s[:start] + s[end:]

start = s.index("function colorEarthPixel(")
abs_lat = s.index("  const absLat = Math.abs(latitude);", start)
prefix = '''function colorEarthPixel(data, offset, latitude, longitude, state) {
  const elevation = bedrockElevationAt(latitude, longitude);
  const seaLevel = Number.isFinite(state.seaLevel) ? state.seaLevel : 0;
  const land = elevation > seaLevel;

  if (!land) {
    const polar = Math.abs(latitude) / 90;
    const waterDepth = Math.max(0, seaLevel - elevation);
    const depth = clamp(waterDepth / 6500, 0, 1);
    data[offset] = mix(13, 2, depth);
    data[offset + 1] = mix(43, 15, depth);
    data[offset + 2] = mix(57, 31, depth);
    if (polar > 0.84 + state.iceIndex * 0.05) {
      const ice = clamp((polar - 0.84) * 5, 0, 0.7);
      data[offset] = mix(data[offset], 154, ice);
      data[offset + 1] = mix(data[offset + 1], 181, ice);
      data[offset + 2] = mix(data[offset + 2], 177, ice);
    }
    data[offset + 3] = 255;
    return;
  }

'''
s = s[:start] + prefix + s[abs_lat:]
s = s.replace(
    "  const rugged = noise(longitude * 2.4, latitude * 2.2);",
    "  const relief = clamp(elevation / 4500, -1, 1);\n  const rugged = relief * 0.72 + noise(longitude * 2.4, latitude * 2.2) * 0.28;",
    1,
)
s = s.replace("function createEarthTexture(mask, state) {", "function createEarthTexture(state) {", 1)
old_call = "      colorEarthPixel(image.data, offset, mask[offset] > 127, latitude, longitude, state);"
assert old_call in s, "texture pixel call not found"
s = s.replace(old_call, "      colorEarthPixel(image.data, offset, latitude, longitude, state);", 1)
s = s.replace("    this.mask = createLandMask();\n", "", 1)
s = s.replace("map: createEarthTexture(this.mask, initialState)", "map: createEarthTexture(initialState)", 1)
s = s.replace("const next = createEarthTexture(this.mask, state);", "const next = createEarthTexture(state);", 1)
view.write_text(s)

test = Path("test/terrain-layer.test.js")
test.write_text('''import test from "node:test";
import assert from "node:assert/strict";
import { ETOPO_2022_META, bedrockElevationAt, isLandAt } from "../src/data/generated/etopo-2022.generated.js";

test("compact ETOPO layer is finite, global, and scientifically labeled", () => {
  assert.equal(ETOPO_2022_META.rows, 360);
  assert.equal(ETOPO_2022_META.cols, 720);
  assert.equal(ETOPO_2022_META.sampleSpacingDegrees, 0.5);
  assert.match(ETOPO_2022_META.epistemicStatus, /modern bedrock baseline/);
  assert.match(ETOPO_2022_META.epistemicStatus, /not a direct reconstruction of 777 ka/);
  for (const [lat, lon] of [[0, 0], [40, -100], [-30, 140], [70, 20]]) {
    assert.ok(Number.isFinite(bedrockElevationAt(lat, lon)));
  }
});

test("paleo sea level changes shoreline classification without changing bedrock", () => {
  const latitude = 0;
  const longitude = 0;
  const elevation = bedrockElevationAt(latitude, longitude);
  assert.equal(isLandAt(latitude, longitude, elevation - 1), true);
  assert.equal(isLandAt(latitude, longitude, elevation + 1), false);
  assert.equal(bedrockElevationAt(latitude, longitude), elevation);
});
''')
