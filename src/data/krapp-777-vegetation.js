import { KRAPP_777_VEGETATION_META } from "./generated/krapp-777-vegetation-meta.generated.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function normalizeLongitude(longitude) {
  return mod(Number(longitude) + 180, 360) - 180;
}

function monthIndex(meta, month) {
  if (Number.isInteger(month)) {
    if (month < 0 || month >= meta.months.length) throw new RangeError(`Month index ${month} is outside 0..${meta.months.length - 1}`);
    return month;
  }
  const index = meta.months.indexOf(String(month).toLowerCase().slice(0, 3));
  if (index < 0) throw new RangeError(`Unknown month ${month}`);
  return index;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required to verify the Krapp vegetation asset checksum.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not provide DecompressionStream, required for the compact Krapp vegetation asset.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function resolveVegetationPayload(received, verifyChecksum) {
  let raw;
  if (received.byteLength === KRAPP_777_VEGETATION_META.compressedBytes) {
    if (verifyChecksum) {
      const digest = await sha256Hex(received);
      if (digest !== KRAPP_777_VEGETATION_META.assetSha256) throw new Error(`Krapp vegetation compressed SHA-256 mismatch: ${digest}`);
    }
    raw = await gunzip(received);
  } else if (received.byteLength === KRAPP_777_VEGETATION_META.uncompressedBytes) {
    // Browsers may transparently decode a gzip response according to its HTTP
    // Content-Encoding header. Accept that transport form, but verify the raw
    // bytes independently before exposing the scientific layer.
    raw = received;
  } else {
    throw new Error(
      `Krapp vegetation response length ${received.byteLength} matches neither compressed metadata ${KRAPP_777_VEGETATION_META.compressedBytes} nor uncompressed metadata ${KRAPP_777_VEGETATION_META.uncompressedBytes}.`
    );
  }

  if (raw.byteLength !== KRAPP_777_VEGETATION_META.uncompressedBytes) {
    throw new Error(`Krapp vegetation payload length ${raw.byteLength} does not match metadata ${KRAPP_777_VEGETATION_META.uncompressedBytes}.`);
  }
  if (verifyChecksum) {
    const digest = await sha256Hex(raw);
    if (digest !== KRAPP_777_VEGETATION_META.uncompressedSha256) throw new Error(`Krapp vegetation uncompressed SHA-256 mismatch: ${digest}`);
  }
  return raw;
}

export class Krapp777VegetationLayer {
  constructor(rawBytes, meta = KRAPP_777_VEGETATION_META) {
    const bytes = rawBytes instanceof Uint8Array
      ? rawBytes
      : rawBytes instanceof ArrayBuffer
        ? new Uint8Array(rawBytes)
        : ArrayBuffer.isView(rawBytes)
          ? new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
          : null;
    if (!bytes) throw new TypeError("Krapp777VegetationLayer requires an ArrayBuffer or typed-array view.");
    if (bytes.byteLength !== meta.uncompressedBytes) {
      throw new Error(`Krapp vegetation payload length ${bytes.byteLength} does not match metadata ${meta.uncompressedBytes}.`);
    }
    this.meta = meta;
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  _position(latitude, longitude) {
    const latitudeValue = clamp(Number(latitude), this.meta.southLatitude, this.meta.northLatitude);
    const longitudeValue = normalizeLongitude(longitude);
    const row = clamp((this.meta.northLatitude - latitudeValue) / this.meta.spacingDegrees, 0, this.meta.rows - 1);
    const col = mod((longitudeValue - this.meta.westLongitude) / this.meta.spacingDegrees, this.meta.cols);
    return { row, col };
  }

  _cellIndex(row, col) {
    return clamp(row, 0, this.meta.rows - 1) * this.meta.cols + mod(col, this.meta.cols);
  }

  _nearestCell(latitude, longitude) {
    const { row, col } = this._position(latitude, longitude);
    return this._cellIndex(Math.round(row), Math.round(col));
  }

  _continuousSample(getValue, latitude, longitude) {
    const { row, col } = this._position(latitude, longitude);
    const nearest = getValue(this._cellIndex(Math.round(row), Math.round(col)));
    if (!Number.isFinite(nearest)) return null;

    const row0 = Math.floor(row);
    const row1 = Math.min(this.meta.rows - 1, row0 + 1);
    const col0 = Math.floor(col);
    const col1 = mod(col0 + 1, this.meta.cols);
    const fy = row - row0;
    const fx = col - col0;
    const samples = [
      [getValue(this._cellIndex(row0, col0)), (1 - fy) * (1 - fx)],
      [getValue(this._cellIndex(row0, col1)), (1 - fy) * fx],
      [getValue(this._cellIndex(row1, col0)), fy * (1 - fx)],
      [getValue(this._cellIndex(row1, col1)), fy * fx]
    ];
    let weighted = 0;
    let weight = 0;
    for (const [value, sampleWeight] of samples) {
      if (!Number.isFinite(value) || sampleWeight <= 0) continue;
      weighted += value * sampleWeight;
      weight += sampleWeight;
    }
    return weight > 0 ? weighted / weight : nearest;
  }

  biomeCodeAt(latitude, longitude) {
    const field = this.meta.fields.biome;
    const code = this.bytes[field.byteOffset + this._nearestCell(latitude, longitude)];
    return code === field.missingValue ? null : code;
  }

  biomeLabel(code) {
    if (code == null) return null;
    return this.meta.biomeLabels[String(code)] ?? `BIOME4 category ${code}`;
  }

  biomeAt(latitude, longitude) {
    const code = this.biomeCodeAt(latitude, longitude);
    if (code == null) return null;
    return Object.freeze({ code, label: this.biomeLabel(code), source: this.meta.id });
  }

  _u16Field(fieldName, cell) {
    const field = this.meta.fields[fieldName];
    const encoded = this.view.getUint16(field.byteOffset + cell * 2, true);
    return encoded === field.missingValue ? Number.NaN : encoded * field.scale;
  }

  _i16MonthlyNpp(month, cell) {
    const field = this.meta.fields.monthlyNpp;
    const index = monthIndex(this.meta, month);
    const encoded = this.view.getInt16(field.byteOffset + index * field.monthByteLength + cell * 2, true);
    return encoded === field.missingValue ? Number.NaN : encoded * field.scale;
  }

  annualNppAt(latitude, longitude) {
    return this._continuousSample((cell) => this._u16Field("annualNpp", cell), latitude, longitude);
  }

  annualLaiAt(latitude, longitude) {
    return this._continuousSample((cell) => this._u16Field("annualLai", cell), latitude, longitude);
  }

  monthlyNppAt(month, latitude, longitude) {
    const index = monthIndex(this.meta, month);
    return this._continuousSample((cell) => this._i16MonthlyNpp(index, cell), latitude, longitude);
  }

  monthlyAt(month, latitude, longitude) {
    const index = monthIndex(this.meta, month);
    const npp = this.monthlyNppAt(index, latitude, longitude);
    if (npp == null) return null;
    return Object.freeze({
      month: this.meta.months[index],
      monthIndex: index,
      npp,
      source: this.meta.id,
      epistemicStatus: this.meta.epistemicStatus
    });
  }

  annualAt(latitude, longitude) {
    const biome = this.biomeAt(latitude, longitude);
    const npp = this.annualNppAt(latitude, longitude);
    const lai = this.annualLaiAt(latitude, longitude);
    if (!biome && npp == null && lai == null) return null;
    return Object.freeze({
      biomeCode: biome?.code ?? null,
      biomeLabel: biome?.label ?? null,
      npp,
      lai,
      source: this.meta.id,
      epistemicStatus: this.meta.epistemicStatus
    });
  }
}

export async function loadKrapp777Vegetation({ fetchImpl = globalThis.fetch, url = null, verifyChecksum = true } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required to load the Krapp vegetation layer.");
  const base = typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
  const assetUrl = url ?? `${base.replace(/\/?$/, "/")}${KRAPP_777_VEGETATION_META.asset.replace(/^\/+/, "")}`;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Failed to load Krapp 777 ka vegetation asset: HTTP ${response.status}`);
  const received = new Uint8Array(await response.arrayBuffer());
  const raw = await resolveVegetationPayload(received, verifyChecksum);
  return new Krapp777VegetationLayer(raw, KRAPP_777_VEGETATION_META);
}

export { KRAPP_777_VEGETATION_META };
