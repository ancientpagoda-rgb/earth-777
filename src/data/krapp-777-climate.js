import { KRAPP_777_META } from "./generated/krapp-777-meta.generated.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function monthIndex(meta, month) {
  if (Number.isInteger(month)) {
    if (month < 0 || month >= meta.months.length) throw new RangeError(`Month index ${month} is outside 0..${meta.months.length - 1}`);
    return month;
  }
  const index = meta.months.indexOf(String(month).toLowerCase().slice(0, 3));
  if (index < 0) throw new RangeError(`Unknown month ${month}`);
  return index;
}

function normalizeLongitude(longitude) {
  return mod(Number(longitude) + 180, 360) - 180;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required to verify the Krapp climate asset checksum.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not provide DecompressionStream, required for the compact Krapp climate asset.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function resolveClimatePayload(received, verifyChecksum) {
  let raw;
  if (received.byteLength === KRAPP_777_META.compressedBytes) {
    if (verifyChecksum) {
      const digest = await sha256Hex(received);
      if (digest !== KRAPP_777_META.assetSha256) throw new Error(`Krapp climate compressed SHA-256 mismatch: ${digest}`);
    }
    raw = await gunzip(received);
  } else if (received.byteLength === KRAPP_777_META.uncompressedBytes) {
    // Browsers may transparently decode a gzip response according to its HTTP
    // Content-Encoding header. Accept that transport form, but verify the raw
    // bytes independently before exposing the scientific layer.
    raw = received;
  } else {
    throw new Error(
      `Krapp climate response length ${received.byteLength} matches neither compressed metadata ${KRAPP_777_META.compressedBytes} nor uncompressed metadata ${KRAPP_777_META.uncompressedBytes}.`
    );
  }

  if (raw.byteLength !== KRAPP_777_META.uncompressedBytes) {
    throw new Error(`Krapp climate payload length ${raw.byteLength} does not match metadata ${KRAPP_777_META.uncompressedBytes}.`);
  }
  if (verifyChecksum) {
    const digest = await sha256Hex(raw);
    if (digest !== KRAPP_777_META.uncompressedSha256) throw new Error(`Krapp climate uncompressed SHA-256 mismatch: ${digest}`);
  }
  return raw;
}

export class Krapp777ClimateLayer {
  constructor(rawBytes, meta = KRAPP_777_META) {
    const bytes = rawBytes instanceof Uint8Array
      ? rawBytes
      : rawBytes instanceof ArrayBuffer
        ? new Uint8Array(rawBytes)
        : ArrayBuffer.isView(rawBytes)
          ? new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
          : null;
    if (!bytes) throw new TypeError("Krapp777ClimateLayer requires an ArrayBuffer or typed-array view.");
    if (bytes.byteLength !== meta.uncompressedBytes) {
      throw new Error(`Krapp climate payload length ${bytes.byteLength} does not match metadata ${meta.uncompressedBytes}.`);
    }

    this.meta = meta;
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.cellCount = meta.rows * meta.cols;
    this._annualFields = new Map();
  }

  _variableMeta(variable) {
    const metadata = this.meta.variables[variable];
    if (!metadata) throw new RangeError(`Unknown Krapp climate variable ${variable}`);
    return metadata;
  }

  _code(variable, month, cellIndex) {
    const metadata = this._variableMeta(variable);
    const index = monthIndex(this.meta, month);
    const byteOffset = metadata.blockByteOffset + index * metadata.monthByteLength + cellIndex * 2;
    return this.view.getUint16(byteOffset, true);
  }

  _decoded(variable, code) {
    if (code === this.meta.missingValue) return Number.NaN;
    const metadata = this._variableMeta(variable);
    return code * metadata.scale + metadata.offset;
  }

  _cellValue(variable, month, row, col) {
    const wrappedCol = mod(col, this.meta.cols);
    const clampedRow = clamp(row, 0, this.meta.rows - 1);
    return this._decoded(variable, this._code(variable, month, clampedRow * this.meta.cols + wrappedCol));
  }

  _position(latitude, longitude) {
    const latitudeValue = clamp(Number(latitude), this.meta.southLatitude, this.meta.northLatitude);
    const longitudeValue = normalizeLongitude(longitude);
    const row = clamp(
      (this.meta.northLatitude - latitudeValue) / this.meta.spacingDegrees,
      0,
      this.meta.rows - 1
    );
    const col = mod(
      (longitudeValue - this.meta.westLongitude) / this.meta.spacingDegrees,
      this.meta.cols
    );
    return { row, col };
  }

  _sample(getValue, latitude, longitude) {
    const { row, col } = this._position(latitude, longitude);
    const nearestRow = Math.round(row);
    const nearestCol = mod(Math.round(col), this.meta.cols);
    const nearest = getValue(nearestRow, nearestCol);

    // Do not smear terrestrial climate across an ocean/missing cell.
    if (!Number.isFinite(nearest)) return null;

    const row0 = Math.floor(row);
    const row1 = Math.min(this.meta.rows - 1, row0 + 1);
    const col0 = Math.floor(col);
    const col1 = mod(col0 + 1, this.meta.cols);
    const fy = row - row0;
    const fx = col - col0;
    const samples = [
      [getValue(row0, col0), (1 - fy) * (1 - fx)],
      [getValue(row0, col1), (1 - fy) * fx],
      [getValue(row1, col0), fy * (1 - fx)],
      [getValue(row1, col1), fy * fx]
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

  sample(variable, month, latitude, longitude) {
    return this._sample(
      (row, col) => this._cellValue(variable, month, row, col),
      latitude,
      longitude
    );
  }

  monthlyAt(month, latitude, longitude) {
    const index = monthIndex(this.meta, month);
    const temperatureKelvin = this.sample("temperature", index, latitude, longitude);
    const precipitationMmPerYear = this.sample("precipitation", index, latitude, longitude);
    const cloudCoverPercent = this.sample("cloudCover", index, latitude, longitude);
    return Object.freeze({
      month: this.meta.months[index],
      monthIndex: index,
      temperatureKelvin,
      temperatureCelsius: temperatureKelvin == null ? null : temperatureKelvin - 273.15,
      precipitationMmPerYear,
      cloudCoverPercent,
      source: this.meta.id
    });
  }

  _annualField(variable) {
    if (this._annualFields.has(variable)) return this._annualFields.get(variable);
    this._variableMeta(variable);
    const field = new Float32Array(this.cellCount);
    field.fill(Number.NaN);

    for (let cell = 0; cell < this.cellCount; cell += 1) {
      let sum = 0;
      let count = 0;
      for (let month = 0; month < 12; month += 1) {
        const value = this._decoded(variable, this._code(variable, month, cell));
        if (!Number.isFinite(value)) continue;
        sum += value;
        count += 1;
      }
      if (count === 12) field[cell] = sum / count;
    }

    this._annualFields.set(variable, field);
    return field;
  }

  annualValueAt(variable, latitude, longitude) {
    const field = this._annualField(variable);
    return this._sample(
      (row, col) => field[row * this.meta.cols + mod(col, this.meta.cols)],
      latitude,
      longitude
    );
  }

  annualAt(latitude, longitude) {
    const temperatureKelvin = this.annualValueAt("temperature", latitude, longitude);
    const precipitationMmPerYear = this.annualValueAt("precipitation", latitude, longitude);
    const cloudCoverPercent = this.annualValueAt("cloudCover", latitude, longitude);
    if (temperatureKelvin == null && precipitationMmPerYear == null && cloudCoverPercent == null) return null;
    return Object.freeze({
      temperatureKelvin,
      temperatureCelsius: temperatureKelvin == null ? null : temperatureKelvin - 273.15,
      // Each Krapp monthly precipitation field is an annualized rate (mm/a).
      // Averaging the 12 rates gives annual precipitation; the authors' BIOME4
      // preparation divides each monthly rate by 12 before using monthly totals.
      precipitationMmPerYear,
      cloudCoverPercent,
      availableMonths: temperatureKelvin == null ? 0 : 12,
      source: this.meta.id,
      epistemicStatus: this.meta.epistemicStatus
    });
  }
}

export async function loadKrapp777Climate({ fetchImpl = globalThis.fetch, url = null, verifyChecksum = true } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required to load the Krapp climate layer.");
  const base = typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
  const assetUrl = url ?? `${base.replace(/\/?$/, "/")}${KRAPP_777_META.asset.replace(/^\/+/, "")}`;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Failed to load Krapp 777 ka climate asset: HTTP ${response.status}`);
  const received = new Uint8Array(await response.arrayBuffer());
  const raw = await resolveClimatePayload(received, verifyChecksum);
  return new Krapp777ClimateLayer(raw, KRAPP_777_META);
}

export { KRAPP_777_META };
