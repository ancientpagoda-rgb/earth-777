import test from "node:test";
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

test("regional state preserves the Krapp checkpoint but allows branch hydroclimate to evolve", () => {
  const layer = loadLayer();
  const checkpoint = checkpointState();
  const base = regionalState(checkpoint, 0, 25, layer);
  assert.equal(base.climateSource, "krapp-2021-777ka");
  assert.match(base.confidence, /published reconstruction/);
  assert.ok(Number.isFinite(base.annualPrecipitation));
  assert.ok(Number.isFinite(base.cloudCover));

  const later = regionalState({ ...checkpoint, elapsedYears: 1_000, temperatureAnomaly: checkpoint.temperatureAnomaly + 1 }, 0, 25, layer);
  assert.ok(Math.abs((later.annualTemperature - base.annualTemperature) - 1) < 0.11);
  assert.notEqual(later.annualPrecipitation, base.annualPrecipitation);
  assert.notEqual(later.cloudCover, base.cloudCover);
  assert.equal(later.climateSource, "krapp-2021-777ka + branch-response");
  assert.match(later.confidence, /model-derived temperature, orbital, ice and hydrological response/);
});

test("regional climate safely falls back when no Krapp layer is supplied", () => {
  const region = regionalState(checkpointState(), 52, 13, null);
  assert.ok(Number.isFinite(region.annualTemperature));
  assert.equal(region.climateSource, "regional-emulator");
  assert.equal(region.checkpointClimate, false);
});
