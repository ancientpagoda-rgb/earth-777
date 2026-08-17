import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BIOME4_SOIL_META } from "../src/data/generated/biome4-soil-meta.generated.js";
import { BIOME4_PFT_DRIVERS_META } from "../src/data/generated/biome4-pft-drivers-meta.generated.js";

const soilIngest = readFileSync(new URL("../scripts/ingest-biome4-soil.py", import.meta.url), "utf8");
const pftIngest = readFileSync(new URL("../scripts/ingest-biome4-pft-drivers.py", import.meta.url), "utf8");

test("BIOME4 ingestion regenerates the pinned raw checksums used for browser-transparent transport", () => {
  assert.match(soilIngest, /raw_sha = hashlib\.sha256\(raw\)\.hexdigest\(\)/);
  assert.match(soilIngest, /"uncompressedSha256": raw_sha/);
  assert.match(pftIngest, /raw_sha = hashlib\.sha256\(raw_bytes\)\.hexdigest\(\)/);
  assert.match(pftIngest, /"uncompressedSha256": raw_sha/);
  assert.equal(BIOME4_SOIL_META.uncompressedSha256, "bdf14436cde35df8c1465f2b945d07d7f6b46caaee26e2d6e081ad5d76f0f767");
  assert.equal(BIOME4_PFT_DRIVERS_META.uncompressedSha256, "995b6c33a13436c84c945041f0ee8db904f7452ba1e28738d135e9d44ca4138e");
});
