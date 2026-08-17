import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadBiome4Soil, BIOME4_SOIL_META } from "../src/data/biome4-soil.js";
import { loadBiome4PftDrivers, BIOME4_PFT_DRIVERS_META } from "../src/data/biome4-pft-drivers.js";

function responseFor(bytes) {
  const copy = Uint8Array.from(bytes);
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
    }
  };
}

function asset(path) {
  const compressed = new Uint8Array(readFileSync(new URL(path, import.meta.url)));
  const raw = new Uint8Array(gunzipSync(compressed));
  return { compressed, raw };
}

const soil = asset("../public/data/biome4-soil.bin.gz");
const pft = asset("../public/data/biome4-pft-drivers.bin.gz");

test("BIOME4 soil accepts either original gzip bytes or browser-transparent raw bytes with independent checksums", async () => {
  assert.equal(soil.compressed.byteLength, BIOME4_SOIL_META.compressedBytes);
  assert.equal(soil.raw.byteLength, BIOME4_SOIL_META.uncompressedBytes);
  const compressedLayer = await loadBiome4Soil({ fetchImpl: async () => responseFor(soil.compressed) });
  const transparentLayer = await loadBiome4Soil({ fetchImpl: async () => responseFor(soil.raw) });
  assert.equal(compressedLayer.bytes.byteLength, transparentLayer.bytes.byteLength);
  assert.deepEqual(compressedLayer.profileAt(38.5, -98.0), transparentLayer.profileAt(38.5, -98.0));
});

test("BIOME4 PFT drivers accept either original gzip bytes or browser-transparent raw bytes with independent checksums", async () => {
  assert.equal(pft.compressed.byteLength, BIOME4_PFT_DRIVERS_META.compressedBytes);
  assert.equal(pft.raw.byteLength, BIOME4_PFT_DRIVERS_META.uncompressedBytes);
  const compressedLayer = await loadBiome4PftDrivers({ fetchImpl: async () => responseFor(pft.compressed) });
  const transparentLayer = await loadBiome4PftDrivers({ fetchImpl: async () => responseFor(pft.raw) });
  assert.deepEqual(compressedLayer.absoluteMinimumTemperatureAt(12.5, 34.5), transparentLayer.absoluteMinimumTemperatureAt(12.5, 34.5));
});

test("transparently decoded BIOME4 bytes are rejected when their pinned raw checksum changes", async () => {
  const corruptedSoil = Uint8Array.from(soil.raw);
  corruptedSoil[12345] ^= 1;
  await assert.rejects(
    loadBiome4Soil({ fetchImpl: async () => responseFor(corruptedSoil) }),
    /uncompressed SHA-256 mismatch/
  );
  const corruptedPft = Uint8Array.from(pft.raw);
  corruptedPft[23456] ^= 1;
  await assert.rejects(
    loadBiome4PftDrivers({ fetchImpl: async () => responseFor(corruptedPft) }),
    /uncompressed SHA-256 mismatch/
  );
});
