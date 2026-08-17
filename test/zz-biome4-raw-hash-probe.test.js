import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

function rawDigest(path) {
  const raw = gunzipSync(readFileSync(new URL(path, import.meta.url)));
  return `${raw.byteLength}:${createHash("sha256").update(raw).digest("hex")}`;
}

test("probe authoritative BIOME4 raw hashes", () => {
  const soil = rawDigest("../public/data/biome4-soil.bin.gz");
  const pft = rawDigest("../public/data/biome4-pft-drivers.bin.gz");
  throw new Error(`BIOME4_RAW_HASH_PROBE soil=${soil} pft=${pft}`);
});
