import { CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import { loadKrapp777Climate } from "../data/krapp-777-climate.js";
import { loadKrapp777Vegetation } from "../data/krapp-777-vegetation.js";

const WIDTH = 512;
const HEIGHT = 256;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
let climatePromise = null;
let vegetationPromise = null;

function noise(longitude, latitude) {
  return (
    Math.sin(longitude * 0.071 + latitude * 0.053) * 0.45 +
    Math.sin(longitude * 0.019 - latitude * 0.127) * 0.3 +
    Math.cos(longitude * 0.173 + latitude * 0.011) * 0.25
  );
}

function moistureFromCheckpoint(precipitationMmPerYear, cloudCoverPercent) {
  const precipitation = clamp(Math.log1p(Math.max(0, precipitationMmPerYear)) / Math.log1p(5_000), 0, 1);
  const cloud = clamp((cloudCoverPercent ?? 50) / 100, 0, 1);
  return clamp(precipitation * 0.82 + cloud * 0.18, 0.05, 1);
}

function vegetationColor(vegetation, rugged) {
  const code = vegetation?.biomeCode;
  const nppStrength = clamp(Math.log1p(Math.max(0, vegetation?.npp ?? 0)) / Math.log1p(2_214), 0, 1);
  const laiStrength = clamp((vegetation?.lai ?? 0) / 7.12, 0, 1);
  const vigor = clamp(nppStrength * 0.7 + laiStrength * 0.3, 0, 1);
  let base;
  if (code >= 1 && code <= 3) base = [24, 77, 42];
  else if (code >= 4 && code <= 11) base = [42, 79, 48];
  else if (code >= 12 && code <= 20) base = [91, 104, 58];
  else if (code === 21) base = [139, 112, 69];
  else if (code >= 22 && code <= 26) base = [105, 118, 94];
  else if (code === 27) base = [119, 111, 94];
  else base = [78, 92, 59];
  const vitality = 0.78 + vigor * 0.34;
  return [
    clamp(base[0] * vitality + rugged * 14, 0, 255),
    clamp(base[1] * vitality + rugged * 18, 0, 255),
    clamp(base[2] * vitality + rugged * 10, 0, 255)
  ];
}

async function getClimate() {
  climatePromise ??= loadKrapp777Climate().catch((error) => {
    console.warn("Earth raster worker: checkpoint climate unavailable; using visual fallback.", error);
    return null;
  });
  return climatePromise;
}

async function getVegetation() {
  vegetationPromise ??= loadKrapp777Vegetation().catch((error) => {
    console.warn("Earth raster worker: checkpoint vegetation unavailable; using visual fallback.", error);
    return null;
  });
  return vegetationPromise;
}

function colorEarthPixel(data, offset, latitude, longitude, state, climate, vegetation) {
  const elevation = bedrockElevationAt(latitude, longitude);
  const seaLevel = Number.isFinite(state.seaLevel) ? state.seaLevel : 0;
  const land = elevation > seaLevel;

  if (!land) {
    const polar = Math.abs(latitude) / 90;
    const depth = clamp(Math.max(0, seaLevel - elevation) / 6500, 0, 1);
    data[offset] = mix(13, 2, depth);
    data[offset + 1] = mix(43, 15, depth);
    data[offset + 2] = mix(57, 31, depth);
    if (polar > 0.84 + state.iceIndex * 0.05) {
      const ice = clamp((polar - 0.84) * 5, 0, 0.7);
      data[offset] = mix(data[offset], 154, ice);
      data[offset + 1] = mix(data[offset + 1], 181, ice);
      data[offset + 2] = mix(data[offset + 2], 177, ice);
    }
    data[offset + 3] = 255;
    return;
  }

  const absLat = Math.abs(latitude);
  const checkpointClimate = climate?.annualAt?.(latitude, longitude) ?? null;
  const vegetationState = vegetation?.annualAt?.(latitude, longitude) ?? null;
  const checkpointGlobalAnomaly = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const freeEarthTemperatureDelta = (state.temperatureAnomaly ?? checkpointGlobalAnomaly) - checkpointGlobalAnomaly;
  const temperature = Number.isFinite(checkpointClimate?.temperatureCelsius)
    ? checkpointClimate.temperatureCelsius + freeEarthTemperatureDelta
    : 28 - absLat * 0.58 + state.temperatureAnomaly * (1 + absLat / 110);
  const moisture = Number.isFinite(checkpointClimate?.precipitationMmPerYear)
    ? moistureFromCheckpoint(checkpointClimate.precipitationMmPerYear, checkpointClimate.cloudCoverPercent)
    : clamp(0.58 + Math.cos(latitude * Math.PI / 45) * 0.18 + noise(longitude, latitude) * 0.28, 0, 1);
  const relief = clamp(elevation / 4500, -1, 1);
  const rugged = relief * 0.72 + noise(longitude * 2.4, latitude * 2.2) * 0.28;
  let red;
  let green;
  let blue;

  if (vegetationState?.biomeCode === 28 || absLat > 73 - state.iceIndex * 9 || temperature < -10) {
    red = 182 + rugged * 18;
    green = 198 + rugged * 15;
    blue = 190 + rugged * 13;
  } else if (vegetationState) {
    [red, green, blue] = vegetationColor(vegetationState, rugged);
  } else if (temperature < 2) {
    red = 82 + rugged * 12;
    green = 93 + rugged * 13;
    blue = 81 + rugged * 10;
  } else if (moisture > 0.69) {
    red = 30 + rugged * 10;
    green = 69 + rugged * 18;
    blue = 48 + rugged * 10;
  } else if (moisture > 0.39) {
    red = 69 + rugged * 18;
    green = 88 + rugged * 21;
    blue = 52 + rugged * 12;
  } else {
    red = 111 + rugged * 24;
    green = 93 + rugged * 20;
    blue = 52 + rugged * 12;
  }

  data[offset] = clamp(red, 0, 255);
  data[offset + 1] = clamp(green, 0, 255);
  data[offset + 2] = clamp(blue, 0, 255);
  data[offset + 3] = 255;
}

async function buildEarth(id, state) {
  const started = performance.now();
  const [climate, vegetation] = await Promise.all([getClimate(), getVegetation()]);
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    const latitude = 90 - (y / (HEIGHT - 1)) * 180;
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const longitude = (x / (WIDTH - 1)) * 360 - 180;
      colorEarthPixel(data, offset, latitude, longitude, state, climate, vegetation);
    }
    if (y % 16 === 15) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  postMessage({ type: "earth", id, width: WIDTH, height: HEIGHT, milliseconds: performance.now() - started, buffer: data.buffer }, [data.buffer]);
}

function paintCloud(data, centerX, centerY, radiusX, radiusY, alpha) {
  const minX = Math.max(0, Math.floor(centerX - radiusX));
  const maxX = Math.min(WIDTH - 1, Math.ceil(centerX + radiusX));
  const minY = Math.max(0, Math.floor(centerY - radiusY));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(centerY + radiusY));
  for (let y = minY; y <= maxY; y += 1) {
    const dy = (y - centerY) / Math.max(1, radiusY);
    for (let x = minX; x <= maxX; x += 1) {
      const dx = (x - centerX) / Math.max(1, radiusX);
      const radius = dx * dx + dy * dy;
      if (radius >= 1) continue;
      const strength = (1 - radius) ** 1.7;
      const offset = (y * WIDTH + x) * 4;
      const nextAlpha = Math.round(255 * alpha * strength);
      if (nextAlpha <= data[offset + 3]) continue;
      data[offset] = 210;
      data[offset + 1] = 226;
      data[offset + 2] = 217;
      data[offset + 3] = nextAlpha;
    }
  }
}

async function buildClouds(id, state, cloudScale = 1) {
  const started = performance.now();
  const climate = await getClimate();
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const count = Math.max(180, Math.round(420 * clamp(cloudScale, 0.45, 1)));
  for (let i = 0; i < count; i += 1) {
    const x = (Math.sin(i * 913.17) * 0.5 + 0.5) * WIDTH;
    const y = (Math.sin(i * 271.91 + 2) * 0.5 + 0.5) * HEIGHT;
    const latitude = 90 - y / HEIGHT * 180;
    if (Math.abs(latitude) > 76) continue;
    const longitude = x / WIDTH * 360 - 180;
    const checkpointCloud = climate?.annualValueAt?.("cloudCover", latitude, longitude);
    const cloudFraction = Number.isFinite(checkpointCloud) ? clamp(checkpointCloud / 100, 0, 1) : 0.55;
    if ((Math.sin(i * 191.3) * 0.5 + 0.5) > 0.25 + cloudFraction * 0.75) continue;
    const width = (12 + (Math.sin(i * 71.3) * 0.5 + 0.5) * 44) * cloudScale;
    const height = (3 + (Math.cos(i * 37.4) * 0.5 + 0.5) * 10) * cloudScale;
    paintCloud(data, x, y, width, height, 0.08 + cloudFraction * 0.28);
    if (i % 48 === 47) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  postMessage({ type: "clouds", id, width: WIDTH, height: HEIGHT, milliseconds: performance.now() - started, stateYear: state.yearBP, buffer: data.buffer }, [data.buffer]);
}

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  if (message.type === "earth") {
    buildEarth(message.id, message.state).catch((error) => postMessage({ type: "error", id: message.id, job: "earth", message: error?.message ?? String(error) }));
  } else if (message.type === "clouds") {
    buildClouds(message.id, message.state, message.cloudScale).catch((error) => postMessage({ type: "error", id: message.id, job: "clouds", message: error?.message ?? String(error) }));
  }
});
