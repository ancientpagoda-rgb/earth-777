export const SW = 256;
export const SH = 128;
export const N = SW * SH;

export const BIOME_NAMES = Object.freeze([
  'ocean',
  'ice',
  'tundra',
  'desert',
  'grassland',
  'shrubland',
  'temperate forest',
  'rainforest',
  'boreal forest',
  'alpine',
]);

export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const mix = (a, b, t) => a + (b - a) * t;

export function noise01(seed, x, y, salt = 0) {
  let n = Math.imul((x | 0) + 374761393, (y | 0) + 668265263);
  n ^= Math.imul((seed >>> 0) + 1442695041 + (salt | 0), 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function smoothNoise(seed, x, y, scaleX = 16, scaleY = 10, salt = 0) {
  const gx = x / scaleX;
  const gy = y / scaleY;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = noise01(seed, x0, y0, salt);
  const n10 = noise01(seed, x0 + 1, y0, salt);
  const n01 = noise01(seed, x0, y0 + 1, salt);
  const n11 = noise01(seed, x0 + 1, y0 + 1, salt);
  return mix(mix(n00, n10, sx), mix(n01, n11, sx), sy);
}

function neighborIndex(x, y, dx, dy, width = SW, height = SH) {
  const yy = y + dy;
  if (yy < 0 || yy >= height) return -1;
  const xx = (x + dx + width) % width;
  return yy * width + xx;
}

const NEIGHBORS = Object.freeze([
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
]);

export function computeHydrology(heights, sea = -20, width = SW, height = SH) {
  const size = width * height;
  if (heights.length !== size) throw new Error(`hydrology grid mismatch: ${heights.length} != ${size}`);
  const flow = new Int32Array(size).fill(-1);
  const accumulation = new Float32Array(size);
  const lake = new Uint8Array(size);
  const order = Array.from({ length: size }, (_, index) => index);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const k = y * width + x;
      const z = heights[k];
      accumulation[k] = z >= sea ? 1 : 0;
      let best = -1;
      let bestZ = z - 0.05;
      for (const [dx, dy] of NEIGHBORS) {
        const n = neighborIndex(x, y, dx, dy, width, height);
        if (n < 0) continue;
        const nz = heights[n];
        if (nz < bestZ) {
          best = n;
          bestZ = nz;
        }
      }
      if (best >= 0) flow[k] = best;
      else if (z >= sea) lake[k] = 1;
    }
  }

  order.sort((a, b) => heights[b] - heights[a]);
  for (const k of order) {
    const target = flow[k];
    if (target >= 0) accumulation[target] += accumulation[k];
  }

  let riverCells = 0;
  let lakeCells = 0;
  for (let k = 0; k < size; k += 1) {
    if (lake[k]) lakeCells += 1;
    if (heights[k] >= sea && accumulation[k] > 26) riverCells += 1;
  }
  return { flow, accumulation, lake, riverCells, lakeCells };
}

export function prepareTerrainDrivers(baseElevation, seed, width = SW, height = SH) {
  const size = width * height;
  if (baseElevation.length !== size) throw new Error(`terrain grid mismatch: ${baseElevation.length} != ${size}`);
  const relief = new Float32Array(size);
  const slope = new Float32Array(size);
  const tectonic = new Float32Array(size);
  const weatherability = new Float32Array(size);
  const baseHydrology = computeHydrology(baseElevation, -20, width, height);

  for (let y = 0; y < height; y += 1) {
    const lat = 90 - (y + 0.5) / height * 180;
    const latRad = lat * Math.PI / 180;
    for (let x = 0; x < width; x += 1) {
      const k = y * width + x;
      const z = baseElevation[k];
      let lowest = z;
      let mean = 0;
      let count = 0;
      for (const [dx, dy] of NEIGHBORS) {
        const n = neighborIndex(x, y, dx, dy, width, height);
        if (n < 0) continue;
        const nz = baseElevation[n];
        lowest = Math.min(lowest, nz);
        mean += nz;
        count += 1;
      }
      const localRelief = Math.max(0, z - lowest);
      relief[k] = localRelief;
      slope[k] = clamp(localRelief / 1700);

      const broad = smoothNoise(seed, x, y, 28, 18, 41) * 2 - 1;
      const ridge = Math.sin((x / width) * Math.PI * 6 + seed * 0.00031) * Math.cos(latRad * 1.4);
      tectonic[k] = clamp(broad * 0.72 + ridge * 0.28, -1, 1);
      const roughness = count ? Math.abs(z - mean / count) / 2200 : 0;
      weatherability[k] = clamp(0.3 + roughness + smoothNoise(seed, x, y, 12, 9, 89) * 0.45);
    }
  }

  return {
    relief,
    slope,
    tectonic,
    weatherability,
    baseAccumulation: baseHydrology.accumulation,
  };
}

function deterministicMoisturePotential(baseZ, x, y, elapsed, seed, width = SW, height = SH) {
  const lat = 90 - (y + 0.5) / height * 180;
  const bandShift = Math.sin(elapsed / 4100) * 5.6;
  const band = 0.12 + 0.78 * Math.pow(Math.cos((lat - bandShift) * Math.PI / 180), 2);
  const continental = (smoothNoise(seed, x, y, 22, 12, 113) - 0.5) * 0.34;
  const pulse = Math.sin(elapsed / 1700 + x * 0.037) * 0.11;
  return clamp(band + continental + pulse - Math.max(0, baseZ) / 10500);
}

export function fillTerrainDelta(baseElevation, out, elapsed, seed, drivers, width = SW, height = SH) {
  const size = width * height;
  if (out.length !== size || baseElevation.length !== size) throw new Error('terrain delta grid mismatch');
  const age = Math.max(0, elapsed);
  const upliftAge = 1 - Math.exp(-age / 420000);
  const weatherAge = 1 - Math.exp(-age / 210000);
  const incisionAge = 1 - Math.exp(-age / 145000);
  const depositionAge = 1 - Math.exp(-age / 175000);
  const pulseAge = 1 - Math.exp(-age / 10000);
  let sumAbs = 0;
  let maxAbs = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const k = y * width + x;
      const z = baseElevation[k];
      const moisture = deterministicMoisturePotential(z, x, y, age, seed, width, height);
      const warmth = clamp((31 - Math.abs(90 - (y + 0.5) / height * 180) * 0.32 - Math.max(0, z) * 0.004 + 8) / 39);
      const riverPower = clamp(Math.log1p(drivers.baseAccumulation[k]) / Math.log(700));
      const uplift = drivers.tectonic[k] * (z < -1500 ? 280 : 520) * upliftAge;
      const weathering = drivers.weatherability[k] * drivers.slope[k] * moisture * warmth * 175 * weatherAge;
      const incision = riverPower * drivers.slope[k] * moisture * 235 * incisionAge;
      const deposition = riverPower * (1 - drivers.slope[k]) * moisture * (z > -100 ? 92 : 28) * depositionAge;
      const pulseField = smoothNoise(seed, x, y, 18, 12, 157) * 2 - 1;
      const pulse = pulseField * Math.sin(age / 15500 + x * 0.011) * 26 * pulseAge;
      const delta = clamp(uplift - weathering - incision + deposition + pulse, -620, 620);
      out[k] = delta;
      const abs = Math.abs(delta);
      sumAbs += abs;
      maxAbs = Math.max(maxAbs, abs);
    }
  }
  return { meanAbs: sumAbs / size, maxAbs };
}

export function classifyBiome({ temperature, moisture, frozen, elevation, sea }) {
  if (elevation < sea) return 0;
  if (frozen > 0.58 || temperature < -10) return 1;
  if (elevation > 3600 && temperature < 10) return 9;
  if (temperature < 1.5) return 2;
  if (moisture < 0.2) return 3;
  if (temperature > 20 && moisture > 0.68) return 7;
  if (temperature < 9 && moisture > 0.43) return 8;
  if (moisture > 0.54) return 6;
  if (moisture > 0.34) return 5;
  return 4;
}

export function fillBiomes(out, baseElevation, terrainDelta, temp, wet, green, frozen, sea) {
  let changed = 0;
  for (let k = 0; k < out.length; k += 1) {
    const previous = out[k];
    let code = classifyBiome({
      temperature: temp[k],
      moisture: wet[k],
      frozen: frozen[k],
      elevation: baseElevation[k] + terrainDelta[k],
      sea,
    });
    if (code > 1 && green[k] < 0.08 && wet[k] < 0.28) code = 3;
    out[k] = code;
    if (previous !== code) changed += 1;
  }
  return changed;
}

export function fillFauna(out, baseElevation, terrainDelta, temp, wet, green, frozen, biome, elapsed, seed, width = SW, height = SH) {
  let land = 0;
  let sum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const k = y * width + x;
      const code = biome[k];
      if (code === 0 || code === 1) {
        out[k] = 0;
        continue;
      }
      land += 1;
      const habitat = clamp(green[k] * 1.35) * clamp(1 - frozen[k]) * (0.45 + wet[k] * 0.55);
      const spatial = 0.72 + smoothNoise(seed, x, y, 10, 8, 211) * 0.42;
      const phase = noise01(seed, Math.floor(x / 5), Math.floor(y / 4), 239) * Math.PI * 2;
      const herbPulse = 0.84 + 0.16 * Math.sin(elapsed / 1700 + phase);
      const predatorPulse = 0.76 + 0.24 * Math.sin(elapsed / 2300 + phase - 1.15);
      const herbivore = clamp(habitat * spatial * herbPulse);
      const predator = clamp(Math.sqrt(herbivore) * 0.32 * predatorPulse * clamp((temp[k] + 12) / 38));
      const density = clamp(herbivore * 0.82 + predator * 0.18);
      const byte = Math.round(density * 255);
      out[k] = byte;
      sum += byte / 255;
    }
  }
  return land ? sum / land : 0;
}

export function countFlowChanges(previous, next) {
  if (!previous || previous.length !== next.length) return next.length;
  let changed = 0;
  for (let k = 0; k < next.length; k += 1) if (previous[k] !== next[k]) changed += 1;
  return changed;
}

export function biomeName(code) {
  return BIOME_NAMES[code] || 'unknown';
}
