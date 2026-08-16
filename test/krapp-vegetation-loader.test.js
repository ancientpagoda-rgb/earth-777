import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { KRAPP_777_VEGETATION_META, loadKrapp777Vegetation } from "../src/data/krapp-777-vegetation.js";

const compressedAsset = readFileSync(new URL("../public/data/krapp-777-vegetation.bin.gz", import.meta.url));
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

test("published BIOME4 payload has pinned compressed and raw digests", () => {
  assert.equal(createHash("sha256").update(compressedAsset).digest("hex"), KRAPP_777_VEGETATION_META.assetSha256);
  assert.equal(createHash("sha256").update(rawAsset).digest("hex"), KRAPP_777_VEGETATION_META.uncompressedSha256);
  assert.equal(rawAsset.byteLength, KRAPP_777_VEGETATION_META.uncompressedBytes);
});

test("Krapp vegetation loader accepts the original gzip transport", async () => {
  const layer = await loadKrapp777Vegetation({ fetchImpl: async () => responseFor(compressedAsset) });
  assert.ok(layer.annualAt(0, 25));
});

test("Krapp vegetation loader accepts browser-transparent gzip decoding with raw integrity verification", async () => {
  const layer = await loadKrapp777Vegetation({ fetchImpl: async () => responseFor(rawAsset) });
  assert.ok(layer.annualAt(0, 25));

  const corrupted = Buffer.from(rawAsset);
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(
    () => loadKrapp777Vegetation({ fetchImpl: async () => responseFor(corrupted) }),
    /uncompressed SHA-256 mismatch/
  );
});
