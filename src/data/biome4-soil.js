import { BIOME4_SOIL_META } from "./generated/biome4-soil-meta.generated.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function wrapLongitude(longitude) {
  return mod(Number(longitude) + 180, 360) - 180;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required to verify the BIOME4 soil asset checksum.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not provide DecompressionStream, required for the compact BIOME4 soil asset.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function resolveSoilPayload(received, verifyChecksum) {
  let raw;
  if (received.byteLength === BIOME4_SOIL_META.compressedBytes) {
    if (verifyChecksum) {
      const digest = await sha256Hex(received);
      if (digest !== BIOME4_SOIL_META.assetSha256) throw new Error(`BIOME4 soil compressed SHA-256 mismatch: ${digest}`);
    }
    raw = await gunzip(received);
  } else if (received.byteLength === BIOME4_SOIL_META.uncompressedBytes) {
    // GitHub Pages/browser fetch may transparently decode Content-Encoding.
    // Treat that as a transport representation only; the raw scientific bytes
    // still have an independently pinned checksum below.
    raw = received;
  } else {
    throw new Error(
      `BIOME4 soil response length ${received.byteLength} matches neither compressed metadata ${BIOME4_SOIL_META.compressedBytes} nor uncompressed metadata ${BIOME4_SOIL_META.uncompressedBytes}.`
    );
  }
  if (raw.byteLength !== BIOME4_SOIL_META.uncompressedBytes) {
    throw new Error(`BIOME4 soil payload length ${raw.byteLength} does not match metadata ${BIOME4_SOIL_META.uncompressedBytes}.`);
  }
  if (verifyChecksum) {
    const digest = await sha256Hex(raw);
    if (digest !== BIOME4_SOIL_META.uncompressedSha256) throw new Error(`BIOME4 soil uncompressed SHA-256 mismatch: ${digest}`);
  }
  return raw;
}

export class Biome4SoilLayer {
  constructor(rawBytes, meta = BIOME4_SOIL_META) {
    const bytes = rawBytes instanceof Uint8Array
      ? rawBytes
      : rawBytes instanceof ArrayBuffer
        ? new Uint8Array(rawBytes)
        : ArrayBuffer.isView(rawBytes)
          ? new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
          : null;
    if (!bytes) throw new TypeError("Biome4SoilLayer requires an ArrayBuffer or typed-array view.");
    if (bytes.byteLength !== meta.uncompressedBytes) {
      throw new Error(`BIOME4 soil payload length ${bytes.byteLength} does not match metadata ${meta.uncompressedBytes}.`);
    }
    this.meta = meta;
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  _cell(latitude, longitude) {
    const lat = clamp(Number(latitude), this.meta.southLatitude, this.meta.northLatitude);
    const lon = wrapLongitude(longitude);
    const row = clamp(
      Math.round((this.meta.northLatitude - lat) / this.meta.spacingDegrees),
      0,
      this.meta.rows - 1
    );
    const col = mod(
      Math.round((lon - this.meta.westLongitude) / this.meta.spacingDegrees),
      this.meta.cols
    );
    return { row, col, index: row * this.meta.cols + col };
  }

  _float(fieldName, index) {
    const field = this.meta.fields[fieldName];
    return this.view.getFloat32(field.byteOffset + index * 4, true);
  }

  profileAt(latitude, longitude) {
    const cell = this._cell(latitude, longitude);
    const statusCode = this.bytes[this.meta.status.byteOffset + cell.index];
    const status = this.meta.statusLabels[String(statusCode)] ?? "unknown";
    const cellLatitude = this.meta.northLatitude - cell.row * this.meta.spacingDegrees;
    const cellLongitude = this.meta.westLongitude + cell.col * this.meta.spacingDegrees;
    if (status !== "soil") {
      return Object.freeze({
        latitude: cellLatitude,
        longitude: cellLongitude,
        statusCode,
        status,
        validSoil: false,
        source: this.meta.id,
        license: this.meta.license,
        epistemicStatus: this.meta.epistemicStatus
      });
    }

    const topWaterCapacity = this._float("whcTop", cell.index);
    const bottomWaterCapacity = this._float("whcBottom", cell.index);
    const topPercolation = this._float("percolationTop", cell.index);
    const bottomPercolation = this._float("percolationBottom", cell.index);
    return Object.freeze({
      latitude: cellLatitude,
      longitude: cellLongitude,
      statusCode,
      status,
      validSoil: true,
      topWaterCapacityMm: topWaterCapacity,
      bottomWaterCapacityMm: bottomWaterCapacity,
      totalWaterCapacityMm: topWaterCapacity + bottomWaterCapacity,
      topPercolationCoefficient: topPercolation,
      bottomPercolationCoefficient: bottomPercolation,
      sourceDeclaredWhcUnits: this.meta.sourceWhcUnits,
      sourceDeclaredPercolationUnits: this.meta.sourcePercolationUnits,
      operationalCapacityUnits: "mm per BIOME4 soil layer",
      operationalPercolationSemantics: "source coefficient applied once per model day as k × wetness^4",
      source: this.meta.id,
      license: this.meta.license,
      epistemicStatus: this.meta.epistemicStatus
    });
  }
}

export async function loadBiome4Soil({ fetchImpl = globalThis.fetch, url = null, verifyChecksum = true } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required to load the BIOME4 soil layer.");
  const base = typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
  const assetUrl = url ?? `${base.replace(/\/?$/, "/")}${BIOME4_SOIL_META.asset.replace(/^\/+/, "")}`;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Failed to load BIOME4 soil asset: HTTP ${response.status}`);
  const received = new Uint8Array(await response.arrayBuffer());
  return new Biome4SoilLayer(await resolveSoilPayload(received, verifyChecksum), BIOME4_SOIL_META);
}

export { BIOME4_SOIL_META };
