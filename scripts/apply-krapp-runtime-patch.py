from pathlib import Path

# --- free-earth regional climate integration ---
path = Path("src/sim/free-earth.js")
s = path.read_text()
start = s.index("export function regionalState(")
new_function = r'''export function regionalState(globalState, latitude, longitude, climateLayer = null) {
  const checkpointClimate = climateLayer?.annualAt?.(latitude, longitude) ?? null;
  let annualTemperature;
  let moisture;
  let annualPrecipitation = null;
  let cloudCover = null;
  let confidence = "modeled regional estimate";
  let climateSource = "regional-emulator";

  if (checkpointClimate && Number.isFinite(checkpointClimate.temperatureCelsius)) {
    const checkpointGlobalAnomaly = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
    const freeEarthTemperatureDelta = (globalState.temperatureAnomaly ?? checkpointGlobalAnomaly) - checkpointGlobalAnomaly;
    annualTemperature = checkpointClimate.temperatureCelsius + freeEarthTemperatureDelta;
    annualPrecipitation = checkpointClimate.precipitationMmPerYear;
    cloudCover = checkpointClimate.cloudCoverPercent;
    moisture = Number.isFinite(annualPrecipitation)
      ? clamp(annualPrecipitation / (annualPrecipitation + 700), 0.05, 1)
      : 0.5;
    climateSource = "krapp-2021-777ka";
    confidence = globalState.elapsedYears > 0
      ? "Krapp 777 ka 0.5° checkpoint + model-derived Free Earth temperature anomaly; precipitation/cloud held at checkpoint baseline"
      : "Krapp 777 ka 0.5° published reconstruction";
  } else {
    const lat = latitude * Math.PI / 180;
    const lon = longitude * Math.PI / 180;
    const seasonality = Math.abs(Math.sin(lat));
    const continentality = 0.55 + 0.45 * Math.sin(lon * 2.7 + lat) ** 2;
    annualTemperature =
      27 - seasonality * 43 + globalState.temperatureAnomaly * (1 + seasonality * 0.8) - continentality * seasonality * 5;
    moisture = clamp(
      0.64 + Math.cos(lat * 2.7) * 0.22 + Math.sin(lon * 1.7 - lat) * 0.16 - globalState.iceIndex * seasonality * 0.2,
      0.05,
      1
    );
  }

  const biome = Math.abs(latitude) > 72 - globalState.iceIndex * 8
    ? "polar ice / tundra"
    : annualTemperature < -4
      ? "cold steppe"
      : annualTemperature < 5
        ? moisture > 0.58 ? "boreal woodland" : "mammoth steppe"
        : annualTemperature > 23
          ? moisture > 0.7 ? "tropical woodland" : "warm savanna"
          : moisture > 0.68
            ? "temperate forest"
            : moisture > 0.38 ? "open woodland" : "dry grassland";

  return {
    latitude,
    longitude,
    annualTemperature: round(annualTemperature, 1),
    annualPrecipitation: Number.isFinite(annualPrecipitation) ? round(annualPrecipitation, 0) : null,
    cloudCover: Number.isFinite(cloudCover) ? round(cloudCover, 1) : null,
    moisture: round(moisture, 2),
    biome,
    climateSource,
    checkpointClimate: climateSource === "krapp-2021-777ka",
    confidence
  };
}
'''
s = s[:start] + new_function
path.write_text(s)

# --- async loader + regional UI ---
path = Path("src/main.js")
s = path.read_text()
old = 'import { SOURCES } from "./data/provenance.js";\nimport { FreeEarthEngine, regionalState } from "./sim/free-earth.js";'
new = 'import { SOURCES } from "./data/provenance.js";\nimport { loadKrapp777Climate } from "./data/krapp-777-climate.js";\nimport { FreeEarthEngine, regionalState } from "./sim/free-earth.js";'
assert old in s, "main import block not found"
s = s.replace(old, new, 1)
old = 'let selected = null;\nconst engine = new FreeEarthEngine(seed);'
new = 'let selected = null;\nlet climate777 = null;\nconst engine = new FreeEarthEngine(seed);'
assert old in s, "main climate state insertion point not found"
s = s.replace(old, new, 1)
old = '''function renderRegion(state, latitude, longitude) {
  const region = regionalState(state, latitude, longitude);
  const latLabel = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  ui.locationTitle.textContent = region.biome;
  ui.locationDetail.textContent = `Estimated mean annual temperature ${signed(region.annualTemperature, 1)} °C · moisture index ${Math.round(region.moisture * 100)}%.`;
  ui.locationCoordinates.textContent = `${latLabel}  ${lonLabel} · ${region.confidence}`;
}
'''
new = '''function renderRegion(state, latitude, longitude) {
  const region = regionalState(state, latitude, longitude, climate777);
  const latLabel = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  ui.locationTitle.textContent = region.biome;
  const climateDetails = [`mean annual temperature ${signed(region.annualTemperature, 1)} °C`];
  if (Number.isFinite(region.annualPrecipitation)) climateDetails.push(`precipitation ${Math.round(region.annualPrecipitation).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.cloudCover)) climateDetails.push(`cloud ${region.cloudCover.toFixed(1)}%`);
  climateDetails.push(`moisture index ${Math.round(region.moisture * 100)}%`);
  ui.locationDetail.textContent = `${region.checkpointClimate ? "Climate" : "Estimated climate"}: ${climateDetails.join(" · ")}.`;
  ui.locationCoordinates.textContent = `${latLabel}  ${lonLabel} · ${region.confidence}`;
}
'''
assert old in s, "renderRegion block not found"
s = s.replace(old, new, 1)
old = '''populateSources();
updateInterface(engine.snapshot(), true);
requestAnimationFrame(frame);'''
new = '''populateSources();
updateInterface(engine.snapshot(), true);
loadKrapp777Climate()
  .then((layer) => {
    climate777 = layer;
    if (selected) renderRegion(engine.snapshot(), selected.latitude, selected.longitude);
  })
  .catch((error) => console.warn("Krapp 777 ka climate layer unavailable; using regional emulator.", error));
requestAnimationFrame(frame);'''
assert old in s, "main startup block not found"
s = s.replace(old, new, 1)
path.write_text(s)

# --- checkpoint layer statuses ---
path = Path("src/data/checkpoint-777.js")
s = path.read_text()
s = s.replace(
    'terrain: Object.freeze({ status: "topology proxy", target: "ETOPO 2022 downsample", sources: ["etopo-2022"] }),',
    'terrain: Object.freeze({ status: "integrated ETOPO 2022 bedrock baseline", target: "time-varying paleo topography and isostasy", sources: ["etopo-2022"] }),',
    1,
)
s = s.replace(
    'climate: Object.freeze({ status: "global emulator", target: "Krapp 777 ka monthly frame", sources: ["krapp-2021"] }),',
    'climate: Object.freeze({ status: "integrated Krapp 777 ka monthly 0.5° checkpoint", target: "branch-evolving gridded climate", sources: ["krapp-2021"] }),',
    1,
)
path.write_text(s)

# --- provenance ---
path = Path("src/data/provenance.js")
s = path.read_text()
old = '''    role: "Monthly climate, biome, and productivity frames at 1 kyr intervals.",
    status: "adapter prepared"'''
new = '''    role: "Published 0.5° monthly temperature, precipitation, and cloud-cover reconstruction at the 777 ka checkpoint; all 36 source files are SHA-256 pinned in the climate manifest.",
    status: "integrated · 777 ka monthly 360 × 720 climate"'''
assert old in s, "Krapp provenance block not found"
s = s.replace(old, new, 1)
path.write_text(s)

# --- package scripts ---
path = Path("package.json")
s = path.read_text()
old = '''    "data:terrain": "node scripts/ingest-etopo-2022.mjs",
    "data:ingest": "npm run data:paleo && npm run data:terrain",'''
new = '''    "data:terrain": "node scripts/ingest-etopo-2022.mjs",
    "data:climate": "python3 scripts/ingest-krapp-777.py",
    "data:ingest": "npm run data:paleo && npm run data:terrain && npm run data:climate",'''
assert old in s, "package data scripts block not found"
s = s.replace(old, new, 1)
path.write_text(s)

# --- extractor units now confirmed by the publication table ---
path = Path("scripts/ingest-krapp-777.py")
s = path.read_text()
s = s.replace('"units": "source mm/a", "description": "uint16 integer source precipitation units"', '"units": "mm year^-1", "description": "uint16 integer mm year^-1"', 1)
path.write_text(s)

# --- README ---
path = Path("README.md")
s = path.read_text()
s = s.replace(
    '- coastlines and ocean depth rendered from ETOPO bedrock against the simulated paleo sea level rather than a decorative land mask;\n',
    '- coastlines and ocean depth rendered from ETOPO bedrock against the simulated paleo sea level rather than a decorative land mask;\n- the exact published Krapp et al. 777 ka 0.5° monthly temperature, precipitation, and cloud-cover fields, compacted from 36 SHA-256-pinned author NetCDFs into a 3.94 MB browser layer;\n',
    1,
)
s = s.replace(
    '- globe-to-region inspection with modeled regional temperature, moisture, and biome;\n',
    '- globe-to-region inspection grounded in the published Krapp 777 ka climate where source coverage exists, with later Free Earth temperature divergence explicitly model derived;\n',
    1,
)
needle = 'The physical relief baseline now comes from NOAA NCEI ETOPO 2022 **Bedrock**.'
pos = s.index(needle)
paragraph_end = s.index('\n\n', pos)
climate_paragraph = '''\n\nThe spatial climate checkpoint now comes directly from the final published Krapp et al. (2021) 0.5° monthly reconstruction. Earth 777 extracts only the exact −777,000-year time slice from each of the authors’ 36 temperature, precipitation, and cloud-cover NetCDFs, verifies every source SHA-256, masks the CDO missing-data sentinel, and compacts the result into a deterministic 3.94 MB gzip layer. At the checkpoint, regional inspection uses those published fields directly. After the checkpoint, only the Free Earth global temperature anomaly is currently applied to that spatial baseline; precipitation and cloud cover remain explicitly labeled 777 ka checkpoint values until a branch-evolving hydrology/climate solver is integrated.\n'''
s = s[:paragraph_end] + climate_paragraph + s[paragraph_end:]
s = s.replace(
    'The paleo ingestion path downloads the official forcing sources when absent, rejects checksum changes, parses only 0–777 ka, and writes the compact browser forcing module plus [`data/manifest.json`](data/manifest.json). The terrain ingestion path requests a centered OPeNDAP hyperslab from NOAA\'s ETOPO 2022 Bedrock grid, rejects source-subset checksum changes, and writes `src/data/generated/etopo-2022.generated.js` plus [`data/terrain-manifest.json`](data/terrain-manifest.json). Large raw scientific datasets remain preprocessing inputs rather than browser dependencies.',
    'The paleo ingestion path downloads the official forcing sources when absent, rejects checksum changes, parses only 0–777 ka, and writes the compact browser forcing module plus [`data/manifest.json`](data/manifest.json). The terrain ingestion path requests a centered OPeNDAP hyperslab from NOAA\'s ETOPO 2022 Bedrock grid, rejects source-subset checksum changes, and writes `src/data/generated/etopo-2022.generated.js` plus [`data/terrain-manifest.json`](data/terrain-manifest.json). The climate ingestion path downloads the 36 final Krapp monthly NetCDFs one at a time, verifies pinned SHA-256 hashes, extracts only the exact 777 ka slice, deletes each large source immediately, and writes the compact browser asset plus [`data/climate-manifest.json`](data/climate-manifest.json). Rebuilding the climate layer requires Python `netCDF4` and `numpy`. Large raw scientific datasets remain preprocessing inputs rather than browser dependencies.',
    1,
)
s = s.replace(
    'npm run data:paleo\nnpm run data:terrain',
    'npm run data:paleo\nnpm run data:terrain\nnpm run data:climate',
    1,
)
s = s.replace(
    '2. Extract the 777 ka monthly fields from Krapp et al. (2021), retaining source metadata and uncertainty.\n3. Add LR04 as an independent validation track for the integrated Spratt–Lisiecki layer.',
    '2. **Integrated:** Krapp et al. 777 ka monthly temperature, precipitation, and cloud cover at 0.5°.\n3. Build branch-evolving gridded hydrology/climate on the Krapp checkpoint baseline, with CWF-driven spatial detail.\n4. Add LR04 as an independent validation track for the integrated Spratt–Lisiecki layer.',
    1,
)
# Renumber remaining roadmap items after inserting a new step.
s = s.replace('4. Build probabilistic fauna envelopes', '5. Build probabilistic fauna envelopes', 1)
s = s.replace('5. Build hominin evidence envelopes', '6. Build hominin evidence envelopes', 1)
s = s.replace('6. Calibrate aggregate ecosystem dynamics', '7. Calibrate aggregate ecosystem dynamics', 1)
s = s.replace('7. Materialize representative individual animals', '8. Materialize representative individual animals', 1)
path.write_text(s)

# --- tests ---
Path("test/krapp-climate.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer, KRAPP_777_META } from "../src/data/krapp-777-climate.js";
import { regionalState } from "../src/sim/free-earth.js";

function loadLayer() {
  const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
  const digest = createHash("sha256").update(compressed).digest("hex");
  assert.equal(digest, KRAPP_777_META.assetSha256);
  const raw = gunzipSync(compressed);
  assert.equal(raw.byteLength, KRAPP_777_META.uncompressedBytes);
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return new Krapp777ClimateLayer(buffer);
}

test("published Krapp 777 ka layer is checksum-valid and sampleable", () => {
  const layer = loadLayer();
  const samples = [[40, -100], [0, 25], [-25, 135]].map(([lat, lon]) => layer.annualAt(lat, lon));
  assert.ok(samples.some(Boolean));
  for (const sample of samples.filter(Boolean)) {
    assert.ok(sample.temperatureCelsius > -80 && sample.temperatureCelsius < 50);
    assert.ok(sample.precipitationMmPerYear >= 0 && sample.precipitationMmPerYear <= 15_000);
    assert.ok(sample.cloudCoverPercent >= 0 && sample.cloudCoverPercent <= 100);
    assert.equal(sample.availableMonths, 12);
  }
});

test("monthly Krapp access accepts names and numeric month indexes", () => {
  const layer = loadLayer();
  const byName = layer.monthlyAt("jan", 0, 25);
  const byIndex = layer.monthlyAt(0, 0, 25);
  assert.deepEqual(byName, byIndex);
});

test("regional state uses Krapp checkpoint climate and only models temperature drift", () => {
  const layer = loadLayer();
  const checkpoint = checkpointState();
  const base = regionalState(checkpoint, 0, 25, layer);
  assert.equal(base.climateSource, "krapp-2021-777ka");
  assert.match(base.confidence, /published reconstruction/);
  assert.ok(Number.isFinite(base.annualPrecipitation));
  assert.ok(Number.isFinite(base.cloudCover));

  const later = regionalState({ ...checkpoint, elapsedYears: 1_000, temperatureAnomaly: checkpoint.temperatureAnomaly + 1 }, 0, 25, layer);
  assert.ok(Math.abs((later.annualTemperature - base.annualTemperature) - 1) < 0.11);
  assert.equal(later.annualPrecipitation, base.annualPrecipitation);
  assert.equal(later.cloudCover, base.cloudCover);
  assert.match(later.confidence, /held at checkpoint baseline/);
});

test("regional climate safely falls back when no Krapp layer is supplied", () => {
  const region = regionalState(checkpointState(), 52, 13, null);
  assert.ok(Number.isFinite(region.annualTemperature));
  assert.equal(region.climateSource, "regional-emulator");
  assert.equal(region.checkpointClimate, false);
});
''')
