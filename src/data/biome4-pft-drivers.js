import { BIOME4_PFT_DRIVERS_META } from "./generated/biome4-pft-drivers-meta.generated.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const wrapLongitude = (longitude) => mod(Number(longitude) + 180, 360) - 180;

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required to verify the BIOME4 PFT driver asset checksum.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not provide DecompressionStream, required for the compact BIOME4 PFT driver asset.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function resolvePftPayload(received, verifyChecksum) {
  let raw;
  if (received.byteLength === BIOME4_PFT_DRIVERS_META.compressedBytes) {
    if (verifyChecksum) {
      const digest = await sha256Hex(received);
      if (digest !== BIOME4_PFT_DRIVERS_META.assetSha256) throw new Error(`BIOME4 PFT driver compressed SHA-256 mismatch: ${digest}`);
    }
    raw = await gunzip(received);
  } else if (received.byteLength === BIOME4_PFT_DRIVERS_META.uncompressedBytes) {
    raw = received;
  } else {
    throw new Error(
      `BIOME4 PFT driver response length ${received.byteLength} matches neither compressed metadata ${BIOME4_PFT_DRIVERS_META.compressedBytes} nor uncompressed metadata ${BIOME4_PFT_DRIVERS_META.uncompressedBytes}.`
    );
  }
  if (raw.byteLength !== BIOME4_PFT_DRIVERS_META.uncompressedBytes) {
    throw new Error(`BIOME4 PFT driver payload length ${raw.byteLength} does not match metadata ${BIOME4_PFT_DRIVERS_META.uncompressedBytes}.`);
  }
  if (verifyChecksum) {
    const digest = await sha256Hex(raw);
    if (digest !== BIOME4_PFT_DRIVERS_META.uncompressedSha256) throw new Error(`BIOME4 PFT driver uncompressed SHA-256 mismatch: ${digest}`);
  }
  return raw;
}

export class Biome4PftDriverLayer {
  constructor(rawBytes, meta = BIOME4_PFT_DRIVERS_META) {
    const bytes = rawBytes instanceof Uint8Array
      ? rawBytes
      : rawBytes instanceof ArrayBuffer
        ? new Uint8Array(rawBytes)
        : ArrayBuffer.isView(rawBytes)
          ? new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
          : null;
    if (!bytes) throw new TypeError("Biome4PftDriverLayer requires an ArrayBuffer or typed-array view.");
    if (bytes.byteLength !== meta.uncompressedBytes) {
      throw new Error(`BIOME4 PFT driver payload length ${bytes.byteLength} does not match metadata ${meta.uncompressedBytes}.`);
    }
    this.meta = meta;
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  _cell(latitude, longitude) {
    const lat = clamp(Number(latitude), this.meta.southLatitude, this.meta.northLatitude);
    const lon = wrapLongitude(longitude);
    const row = clamp(Math.round((this.meta.northLatitude - lat) / this.meta.spacingDegrees), 0, this.meta.rows - 1);
    const col = mod(Math.round((lon - this.meta.westLongitude) / this.meta.spacingDegrees), this.meta.cols);
    return { row, col, index: row * this.meta.cols + col };
  }

  absoluteMinimumTemperatureAt(latitude, longitude) {
    const cell = this._cell(latitude, longitude);
    const raw = this.view.getInt16(this.meta.tmin.byteOffset + cell.index * 2, true);
    if (raw === this.meta.tmin.missingValue) return null;
    return Object.freeze({
      latitude: this.meta.northLatitude - cell.row * this.meta.spacingDegrees,
      longitude: this.meta.westLongitude + cell.col * this.meta.spacingDegrees,
      rawTenthCelsius: raw,
      temperatureCelsius: raw * this.meta.tmin.operationalScaleCelsius,
      source: this.meta.id,
      license: this.meta.license,
      epistemicStatus: this.meta.epistemicStatus
    });
  }
}

export async function loadBiome4PftDrivers({ fetchImpl = globalThis.fetch, url = null, verifyChecksum = true } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required to load the BIOME4 PFT drivers.");
  const base = typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
  const assetUrl = url ?? `${base.replace(/\/?$/, "/")}${BIOME4_PFT_DRIVERS_META.asset.replace(/^\/+/, "")}`;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Failed to load BIOME4 PFT driver asset: HTTP ${response.status}`);
  const received = new Uint8Array(await response.arrayBuffer());
  return new Biome4PftDriverLayer(await resolvePftPayload(received, verifyChecksum), BIOME4_PFT_DRIVERS_META);
}

export { BIOME4_PFT_DRIVERS_META };
