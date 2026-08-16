import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer, KRAPP_777_META, loadKrapp777Climate } from "../src/data/krapp-777-climate.js";
import { regionalState } from "../src/sim/regional-state.js";

const compressedAsset = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const rawAsset = gunzipSync(compressedAsset);

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function responseFor(bytes) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => arrayBufferOf(bytes)
  };
}

function loadLayer() {
  const digest = createHash("sha256").update(compressedAsset).digest("hex");
  assert.equal(digest, KRAPP_777_META.assetSha256);
  const rawDigest = createHash("sha256").update(rawAsset).digest("hex");
  assert.equal(rawDigest, KRAPP_777_META.uncompressedSha256);
  assert.equal(rawAsset.byteLength, KRAPP_777_META.uncompressedBytes);
  return new Krapp777ClimateLayer(arrayBufferOf(rawAsset));
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

test("Krapp climate loader accepts the original gzip transport", async () => {
  const layer = await loadKrapp777Climate({ fetchImpl: async () => responseFor(compressedAsset) });
  assert.ok(layer.annualAt(0, 25));
});

test("Krapp climate loader accepts browser-transparent gzip decoding with raw integrity verification", async () => {
  const layer = await loadKrapp777Climate({ fetchImpl: async () => responseFor(rawAsset) });
  assert.ok(layer.annualAt(0, 25));

  const corrupted = Buffer.from(rawAsset);
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(
    () => loadKrapp777Climate({ fetchImpl: async () => responseFor(corrupted) }),
    /uncompressed SHA-256 mismatch/
  );
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
  const base = regionalState(checkpoint, 0, 25, { climateLayer: layer });
  assert.equal(base.climateSource, "krapp-2021-777ka");
  assert.match(base.confidence, /published reconstruction/);
  assert.ok(Number.isFinite(base.annualPrecipitation));
  assert.ok(Number.isFinite(base.cloudCover));

  const later = regionalState({ ...checkpoint, elapsedYears: 1_000, temperatureAnomaly: checkpoint.temperatureAnomaly + 1 }, 0, 25, { climateLayer: layer });
  assert.ok(Math.abs((later.annualTemperature - base.annualTemperature) - 1) < 0.11);
  assert.notEqual(later.annualPrecipitation, base.annualPrecipitation);
  assert.notEqual(later.cloudCover, base.cloudCover);
  assert.equal(later.climateSource, "krapp-2021-777ka + branch-response");
  assert.match(later.confidence, /model-derived temperature, orbital, ice and hydrological response/);
});

test("regional climate safely falls back when no Krapp layer is supplied", () => {
  const region = regionalState(checkpointState(), 52, 13);
  assert.ok(Number.isFinite(region.annualTemperature));
  assert.equal(region.climateSource, "regional-emulator");
  assert.equal(region.checkpointClimate, false);
});
