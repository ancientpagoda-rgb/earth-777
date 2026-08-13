import { KRAPP_777_META } from "./generated/krapp-777-meta.generated.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function wrapLongitude(longitude) {
  return ((((Number(longitude) || 0) + 180) % 360) + 360) % 360 - 180;
}

function monthIndex(month, meta) {
  if (typeof month === "string") {
    const index = meta.months.indexOf(month.toLowerCase().slice(0, 3));
    if (index >= 0) return index;
  }
  const index = Number(month);
  if (Number.isInteger(index) && index >= 0 && index < meta.months.length) return index;
  throw new RangeError(`Unknown climate month: ${month}`);
}

function averageFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export class Krapp777ClimateLayer {
  constructor(buffer, meta = KRAPP_777_META) {
    const arrayBuffer = buffer instanceof ArrayBuffer
      ? buffer
      : buffer?.buffer instanceof ArrayBuffer
        ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        : null;
    if (!arrayBuffer) throw new TypeError("Krapp climate layer requires an ArrayBuffer or typed-array view.");
    if (arrayBuffer.byteLength !== meta.uncompressedBytes) {
      throw new RangeError(`Krapp climate payload length ${arrayBuffer.byteLength} does not match ${meta.uncompressedBytes}.`);
    }
    this.meta = meta;
    this.view = new DataView(arrayBuffer);
  }

  cellIndex(latitude, longitude) {
    const latitudeValue = clamp(Number(latitude) || 0, -90, 90);
    const longitudeValue = wrapLongitude(longitude);
    const row = clamp(
      Math.round((this.meta.northLatitude - latitudeValue) / this.meta.spacingDegrees),
      0,
      this.meta.rows - 1
    );
    const col = clamp(
      Math.round((longitudeValue - this.meta.westLongitude) / this.meta.spacingDegrees),
      0,
      this.meta.cols - 1
    );
    return row * this.meta.cols + col;
  }

  sample(variable, month, latitude, longitude) {
    const descriptor = this.meta.variables[variable];
    if (!descriptor) throw new RangeError(`Unknown Krapp climate variable: ${variable}`);
    const index = monthIndex(month, this.meta);
    const cell = this.cellIndex(latitude, longitude);
    const offset = descriptor.blockByteOffset + index * descriptor.monthByteLength + cell * 2;
    const encoded = this.view.getUint16(offset, true);
    if (encoded === this.meta.missingValue) return null;
    return encoded * descriptor.scale + descriptor.offset;
  }

  monthlyAt(month, latitude, longitude) {
    const index = monthIndex(month, this.meta);
    const temperatureKelvin = this.sample("temperature", index, latitude, longitude);
    const precipitationMmPerYear = this.sample("precipitation", index, latitude, longitude);
    const cloudCoverPercent = this.sample("cloudCover", index, latitude, longitude);
    return Object.freeze({
      month: this.meta.months[index],
      monthIndex: index,
      temperatureKelvin,
      temperatureCelsius: Number.isFinite(temperatureKelvin) ? temperatureKelvin - 273.15 : null,
      precipitationMmPerYear,
      cloudCoverPercent,
      source: this.meta.id
    });
  }

  annualAt(latitude, longitude) {
    const months = this.meta.months.map((_, index) => this.monthlyAt(index, latitude, longitude));
    const temperatureKelvin = averageFinite(months.map((entry) => entry.temperatureKelvin));
    const precipitationMmPerYear = averageFinite(months.map((entry) => entry.precipitationMmPerYear));
    const cloudCoverPercent = averageFinite(months.map((entry) => entry.cloudCoverPercent));
    const availableMonths = months.filter((entry) => Number.isFinite(entry.temperatureKelvin)).length;
    if (!availableMonths) return null;
    return Object.freeze({
      temperatureKelvin,
      temperatureCelsius: temperatureKelvin - 273.15,
      precipitationMmPerYear,
      cloudCoverPercent,
      availableMonths,
      source: this.meta.id,
      epistemicStatus: this.meta.epistemicStatus
    });
  }
}

async function decompressPayload(compressed) {
  const bytes = new Uint8Array(compressed);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return compressed;
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not provide DecompressionStream for the Krapp gzip layer.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function loadKrapp777Climate({ fetchImpl = globalThis.fetch, verify = true } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required to load the Krapp climate layer.");
  const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");
  const url = `${base}${KRAPP_777_META.asset.replace(/^\/+/, "")}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Failed to load Krapp 777 ka climate asset: ${response.status} ${response.statusText}`);
  const payload = await response.arrayBuffer();

  if (verify && typeof globalThis.crypto?.subtle?.digest === "function") {
    const bytes = new Uint8Array(payload);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const digest = hex(await globalThis.crypto.subtle.digest("SHA-256", payload));
      if (digest !== KRAPP_777_META.assetSha256) {
        throw new Error(`Krapp climate asset checksum mismatch: ${digest}`);
      }
    }
  }

  const raw = await decompressPayload(payload);
  return new Krapp777ClimateLayer(raw);
}

export { KRAPP_777_META };
