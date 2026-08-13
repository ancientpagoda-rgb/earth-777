#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    file = ROOT / path
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:80]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


regional = r'''import { CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { regionalState as fallbackRegionalState } from "./free-earth.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));

function moistureFromClimate(precipitationMmPerYear, cloudCoverPercent) {
  const precipitation = clamp(Math.log1p(Math.max(0, precipitationMmPerYear)) / Math.log1p(5_000), 0, 1);
  const cloud = clamp((cloudCoverPercent ?? 50) / 100, 0, 1);
  return clamp(precipitation * 0.82 + cloud * 0.18, 0.05, 1);
}

function biomeFromClimate(latitude, annualTemperature, moisture, iceIndex) {
  if (Math.abs(latitude) > 72 - iceIndex * 8) return "polar ice / tundra";
  if (annualTemperature < -4) return "cold steppe";
  if (annualTemperature < 5) return moisture > 0.58 ? "boreal woodland" : "mammoth steppe";
  if (annualTemperature > 23) return moisture > 0.7 ? "tropical woodland" : "warm savanna";
  if (moisture > 0.68) return "temperate forest";
  if (moisture > 0.38) return "open woodland";
  return "dry grassland";
}

export function regionalState(globalState, latitude, longitude, climate = null) {
  const baseline = climate?.annualAt?.(latitude, longitude) ?? null;
  if (!baseline || !Number.isFinite(baseline.temperatureCelsius)) {
    return fallbackRegionalState(globalState, latitude, longitude);
  }

  const checkpointTemperature = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const checkpointIce = CHECKPOINT_777.boundary.iceVolumeIndex.value;
  const polarAmplification = 1 + Math.abs(latitude) / 110;
  const temperatureDelta = (globalState.temperatureAnomaly - checkpointTemperature) * polarAmplification;
  const annualTemperature = baseline.temperatureCelsius + temperatureDelta;

  const seasonality = Math.abs(Math.sin(latitude * Math.PI / 180));
  const precipitationScale = clamp(
    1 + (globalState.productivityIndex - 1) * 0.35 - (globalState.iceIndex - checkpointIce) * seasonality * 0.25,
    0.55,
    1.45
  );
  const annualPrecipitationMm = Number.isFinite(baseline.precipitationMmPerYear)
    ? baseline.precipitationMmPerYear * precipitationScale
    : null;
  const cloudCoverPercent = Number.isFinite(baseline.cloudCoverPercent)
    ? clamp(baseline.cloudCoverPercent + (precipitationScale - 1) * 8, 0, 100)
    : null;
  const moisture = Number.isFinite(annualPrecipitationMm)
    ? moistureFromClimate(annualPrecipitationMm, cloudCoverPercent)
    : 0.5;

  return {
    latitude,
    longitude,
    annualTemperature: round(annualTemperature, 1),
    annualPrecipitationMm: annualPrecipitationMm == null ? null : round(annualPrecipitationMm, 0),
    cloudCoverPercent: cloudCoverPercent == null ? null : round(cloudCoverPercent, 1),
    moisture: round(moisture, 2),
    biome: biomeFromClimate(latitude, annualTemperature, moisture, globalState.iceIndex),
    climateSource: "krapp-2021",
    climateStatus: globalState.elapsedYears < 1 ? "study constrained" : "model derived from Krapp checkpoint",
    confidence: globalState.elapsedYears < 1
      ? "Krapp 777 ka climate · model-derived biome"
      : "Krapp 777 ka baseline + modeled Free Earth divergence"
  };
}
'''
(ROOT / "src/sim/regional-climate.js").write_text(regional, encoding="utf-8")

# main.js: load the compact climate layer asynchronously and use it for selection.
replace_once(
    "src/main.js",
    'import { FreeEarthEngine, regionalState } from "./sim/free-earth.js";\n',
    'import { FreeEarthEngine } from "./sim/free-earth.js";\nimport { regionalState } from "./sim/regional-climate.js";\nimport { loadKrapp777Climate } from "./data/krapp-777-climate.js";\n'
)
replace_once(
    "src/main.js",
    'let selected = null;\nconst engine = new FreeEarthEngine(seed);',
    'let selected = null;\nlet climate = null;\nconst engine = new FreeEarthEngine(seed);'
)
replace_once(
    "src/main.js",
    '  const region = regionalState(state, latitude, longitude);',
    '  const region = regionalState(state, latitude, longitude, climate);'
)
replace_once(
    "src/main.js",
    '  ui.locationDetail.textContent = `Estimated mean annual temperature ${signed(region.annualTemperature, 1)} °C · moisture index ${Math.round(region.moisture * 100)}%.`;',
    '  const hydro = Number.isFinite(region.annualPrecipitationMm)\n    ? ` · precipitation ${Math.round(region.annualPrecipitationMm).toLocaleString()} mm/yr · cloud ${Math.round(region.cloudCoverPercent ?? 0)}%`\n    : "";\n  ui.locationDetail.textContent = `Mean annual temperature ${signed(region.annualTemperature, 1)} °C${hydro} · moisture index ${Math.round(region.moisture * 100)}%.`;'
)
replace_once(
    "src/main.js",
    'populateSources();\nupdateInterface(engine.snapshot(), true);\nrequestAnimationFrame(frame);',
    'populateSources();\nupdateInterface(engine.snapshot(), true);\nloadKrapp777Climate()\n  .then((layer) => {\n    climate = layer;\n    earthView.setClimate(layer);\n    updateInterface(engine.snapshot(), true);\n  })\n  .catch((error) => console.warn("Krapp 777 ka climate layer unavailable; retaining modeled regional fallback.", error));\nrequestAnimationFrame(frame);'
)

# earth-view.js: use Krapp annual checkpoint fields for terrestrial color state.
replace_once(
    "src/render/earth-view.js",
    'import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";\n',
    'import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";\nimport { CHECKPOINT_777 } from "../data/checkpoint-777.js";\n'
)
replace_once(
    "src/render/earth-view.js",
    '''function noise(longitude, latitude) {
  return (
    Math.sin(longitude * 0.071 + latitude * 0.053) * 0.45 +
    Math.sin(longitude * 0.019 - latitude * 0.127) * 0.3 +
    Math.cos(longitude * 0.173 + latitude * 0.011) * 0.25
  );
}

function colorEarthPixel(data, offset, latitude, longitude, state) {''',
    '''function noise(longitude, latitude) {
  return (
    Math.sin(longitude * 0.071 + latitude * 0.053) * 0.45 +
    Math.sin(longitude * 0.019 - latitude * 0.127) * 0.3 +
    Math.cos(longitude * 0.173 + latitude * 0.011) * 0.25
  );
}

function climateMoisture(precipitationMmPerYear, cloudCoverPercent) {
  const precipitation = clamp(Math.log1p(Math.max(0, precipitationMmPerYear)) / Math.log1p(5_000), 0, 1);
  const cloud = clamp((cloudCoverPercent ?? 50) / 100, 0, 1);
  return clamp(precipitation * 0.82 + cloud * 0.18, 0, 1);
}

function colorEarthPixel(data, offset, latitude, longitude, state, climate = null) {'''
)
replace_once(
    "src/render/earth-view.js",
    '''  const absLat = Math.abs(latitude);
  const temperature = 28 - absLat * 0.58 + state.temperatureAnomaly * (1 + absLat / 110);
  const moisture = clamp(0.58 + Math.cos(latitude * Math.PI / 45) * 0.18 + noise(longitude, latitude) * 0.28, 0, 1);
  const relief = clamp(elevation / 4500, -1, 1);''',
    '''  const absLat = Math.abs(latitude);
  const baseline = climate?.annualAt?.(latitude, longitude) ?? null;
  const temperatureDelta = state.temperatureAnomaly - CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const temperature = Number.isFinite(baseline?.temperatureCelsius)
    ? baseline.temperatureCelsius + temperatureDelta * (1 + absLat / 110)
    : 28 - absLat * 0.58 + state.temperatureAnomaly * (1 + absLat / 110);
  const moisture = Number.isFinite(baseline?.precipitationMmPerYear)
    ? climateMoisture(baseline.precipitationMmPerYear, baseline.cloudCoverPercent)
    : clamp(0.58 + Math.cos(latitude * Math.PI / 45) * 0.18 + noise(longitude, latitude) * 0.28, 0, 1);
  const relief = clamp(elevation / 4500, -1, 1);'''
)
replace_once(
    "src/render/earth-view.js",
    'function createEarthTexture(state) {',
    'function createEarthTexture(state, climate = null) {'
)
replace_once(
    "src/render/earth-view.js",
    '      colorEarthPixel(image.data, offset, latitude, longitude, state);',
    '      colorEarthPixel(image.data, offset, latitude, longitude, state, climate);'
)
replace_once(
    "src/render/earth-view.js",
    '''    this.lastTextureYear = initialState.yearBP;
    this.pointerStart = null;
    this.selectedNormal = null;''',
    '''    this.lastTextureYear = initialState.yearBP;
    this.lastState = initialState;
    this.climate = null;
    this.pointerStart = null;
    this.selectedNormal = null;'''
)
replace_once(
    "src/render/earth-view.js",
    '      map: createEarthTexture(initialState),',
    '      map: createEarthTexture(initialState, this.climate),'
)
replace_once(
    "src/render/earth-view.js",
    '''  updateState(state, force = false) {
    if (!force && Math.abs(state.yearBP - this.lastTextureYear) < 2_500) return;
    const next = createEarthTexture(state);''',
    '''  setClimate(climate) {
    this.climate = climate;
    this.updateState(this.lastState, true);
  }

  updateState(state, force = false) {
    this.lastState = state;
    if (!force && Math.abs(state.yearBP - this.lastTextureYear) < 2_500) return;
    const next = createEarthTexture(state, this.climate);'''
)

# Source/status metadata: distinguish integrated fields from BIOME4 work not yet done.
replace_once(
    "src/data/provenance.js",
    '    role: "Monthly climate, biome, and productivity frames at 1 kyr intervals.",\n    status: "adapter prepared"',
    '    role: "Published monthly temperature, precipitation, and total-cloud-cover checkpoint at 777 ka; BIOME4/NPP remains a later layer.",\n    status: "integrated · exact 777 ka monthly 0.5° climate"'
)
replace_once(
    "src/data/checkpoint-777.js",
    '    terrain: Object.freeze({ status: "topology proxy", target: "ETOPO 2022 downsample", sources: ["etopo-2022"] }),\n    climate: Object.freeze({ status: "global emulator", target: "Krapp 777 ka monthly frame", sources: ["krapp-2021"] }),',
    '    terrain: Object.freeze({ status: "ETOPO 2022 bedrock baseline", target: "Half-degree bedrock + simulated sea level", sources: ["etopo-2022"] }),\n    climate: Object.freeze({ status: "study-constrained 0.5° monthly checkpoint", target: "Krapp 777 ka temperature / precipitation / cloud cover", sources: ["krapp-2021"] }),'
)
replace_once(
    "package.json",
    '    "data:terrain": "node scripts/ingest-etopo-2022.mjs",\n    "data:ingest":',
    '    "data:terrain": "node scripts/ingest-etopo-2022.mjs",\n    "data:climate": "python3 scripts/ingest-krapp-777.py",\n    "data:ingest":'
)

# Scientific/runtime regression tests.
test = r'''import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { KRAPP_777_META, Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { checkpointState } from "../src/data/checkpoint-777.js";
import { regionalState } from "../src/sim/regional-climate.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const raw = gunzipSync(compressed);
const climate = new Krapp777ClimateLayer(raw);

test("Krapp 777 ka asset matches generated integrity metadata", () => {
  assert.equal(compressed.byteLength, KRAPP_777_META.compressedBytes);
  assert.equal(raw.byteLength, KRAPP_777_META.uncompressedBytes);
  assert.equal(createHash("sha256").update(compressed).digest("hex"), KRAPP_777_META.assetSha256);
  assert.equal(KRAPP_777_META.rows, 360);
  assert.equal(KRAPP_777_META.cols, 720);
  assert.equal(KRAPP_777_META.months.length, 12);
});

test("Krapp climate sampler returns physically bounded published fields over central Africa", () => {
  const annual = climate.annualAt(0, 20);
  assert.ok(annual);
  assert.ok(annual.temperatureKelvin > 240 && annual.temperatureKelvin < 315);
  assert.ok(annual.precipitationMmPerYear >= 0 && annual.precipitationMmPerYear <= 15_000);
  assert.ok(annual.cloudCoverPercent >= 0 && annual.cloudCoverPercent <= 100);
  const january = climate.monthlyAt("jan", 0, 20);
  assert.equal(january.month, "jan");
  assert.ok(Number.isFinite(january.temperatureCelsius));
});

test("Krapp climate sampler preserves ocean/missing cells", () => {
  assert.equal(climate.annualAt(0, -140), null);
});

test("regional state uses Krapp as the checkpoint climate and labels later divergence", () => {
  const checkpoint = checkpointState();
  const region = regionalState(checkpoint, 0, 20, climate);
  assert.equal(region.climateSource, "krapp-2021");
  assert.equal(region.climateStatus, "study constrained");
  assert.match(region.confidence, /Krapp 777 ka climate/);

  const branched = { ...checkpoint, elapsedYears: 5_000, temperatureAnomaly: checkpoint.temperatureAnomaly + 1 };
  const later = regionalState(branched, 0, 20, climate);
  assert.equal(later.climateStatus, "model derived from Krapp checkpoint");
  assert.ok(later.annualTemperature > region.annualTemperature);
});
'''
(ROOT / "test/krapp-climate.test.js").write_text(test, encoding="utf-8")

doc = r'''# Krapp 777 ka monthly climate layer

Earth 777 integrates the published Krapp et al. (2021) terrestrial climate reconstruction at the canonical 777,000 BP checkpoint.

## Scientific source

- Paper: Krapp et al. (2021), *High-resolution global terrestrial climate for the last 800,000 years*.
- Data DOI: `10.17605/OSF.IO/8N43X`.
- Source files: the authors' final bias-corrected/remapped 0.5° monthly NetCDF products for temperature, precipitation, and total cloud cover.
- Time selection: the exact NetCDF coordinate `-777000` years, index 22 in each 800-step file.

The ingest script downloads each of the 36 source files sequentially, verifies the OSF SHA-256, extracts only the 777 ka slab, removes the large source file, and writes a deterministic compact browser asset. The full per-file hashes and extraction metadata are recorded in `data/climate-manifest.json`.

## Browser representation

`public/data/krapp-777-climate.bin.gz` stores three variables × twelve months × 360 × 720 cells as little-endian uint16 values. Temperature and cloud cover retain 0.01-unit precision; precipitation retains 1 mm/a precision. `65535` is the missing value. The gzip stream has deterministic `mtime=0` and its SHA-256 is pinned in the generated metadata module.

The published source pipeline uses K for temperature, mm/a for monthly precipitation rates, and percent for total cloud cover. Krapp's BIOME4 preparation divides each monthly precipitation rate by 12 to obtain a monthly total, so the mean of the twelve annualized monthly rates is the annual precipitation total used by Earth 777.

## Epistemic boundary

At exactly 777 ka, these spatial climate fields are **study constrained** published reconstructions. They are not observations. After the checkpoint, Earth 777 treats them only as the spatial baseline: temperature and hydroclimate changes introduced by the Free Earth trajectory are **model derived** and are labeled that way. The renderer and regional inspector fall back to the older analytic climate emulator only where the Krapp terrestrial grid is missing.

BIOME4 biome classes and NPP are not integrated by this layer; those remain a separate future phase.
'''
(ROOT / "docs/KRAPP_777_CLIMATE.md").write_text(doc, encoding="utf-8")

print("Patched Krapp runtime integration")
