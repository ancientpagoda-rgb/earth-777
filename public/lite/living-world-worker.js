import {
  SW,
  SH,
  N,
  clamp,
  mix,
  noise01,
  prepareTerrainDrivers,
  fillTerrainDelta,
  computeHydrology,
  fillBiomes,
  fillFauna,
  countFlowChanges,
} from './living-world-core.js';

let elevation;
let evolved;
let terrainDelta;
let terrainDrivers;
let temp;
let wet;
let green;
let frozen;
let t2;
let m2;
let v2;
let i2;
let biome;
let fauna;
let flow;
let accumulation;
let lake;
let seed = 777;
let elapsed = 0;
let sea = -20;
let terrainVersion = 0;
let hydrologyVersion = 0;
let biomeVersion = 0;
let ecologyVersion = 0;
let hydrologyDirty = false;
let hydrologyChanges = 0;
let riverCells = 0;
let lakeCells = 0;
let terrainMeanAbs = 0;
let terrainMaxAbs = 0;
let biomeChanges = 0;
let faunaLand = 0;

function targetTemperature(k, x, y) {
  const lat = 90 - (y + 0.5) / SH * 180;
  const z = evolved[k];
  const latitude = Math.abs(Math.sin(lat * Math.PI / 180));
  const cycle = Math.sin(elapsed / 7600)
    + 0.52 * Math.sin(elapsed / 23000 + 1.8)
    + 0.18 * Math.sin(elapsed / 1300 + x * 0.018);
  const rough = (noise01(seed, x, y, 17) - 0.5) * 4.5;
  return 28 - 54 * latitude - Math.max(0, z) * 0.0062 + cycle * 5.8 + rough;
}

function initialMoisture(k, x, y) {
  const z = evolved[k];
  if (z < sea) return 1;
  const lat = 90 - (y + 0.5) / SH * 180;
  const shift = Math.sin(elapsed / 4100) * 0.16;
  const band = 0.12 + 0.78 * Math.pow(Math.cos((lat - shift * 35) * Math.PI / 180), 2);
  const riverBoost = clamp(Math.log1p(accumulation[k]) / Math.log(900)) * 0.12;
  return clamp(
    band * 0.72
      + (noise01(seed, x + 91, y + 17, 31) - 0.5) * 0.45
      + riverBoost
      - Math.max(0, z) / 9500,
  );
}

function rebuildTerrain() {
  const metrics = fillTerrainDelta(elevation, terrainDelta, elapsed, seed, terrainDrivers);
  terrainMeanAbs = metrics.meanAbs;
  terrainMaxAbs = metrics.maxAbs;
  for (let k = 0; k < N; k += 1) evolved[k] = elevation[k] + terrainDelta[k];
  terrainVersion += 1;
}

function rebuildHydrology(force = false) {
  if (!force && terrainVersion % 8 !== 0) return;
  const next = computeHydrology(evolved, sea);
  hydrologyChanges = countFlowChanges(flow, next.flow);
  flow = next.flow;
  accumulation = next.accumulation;
  lake = next.lake;
  riverCells = next.riverCells;
  lakeCells = next.lakeCells;
  hydrologyVersion += 1;
  hydrologyDirty = true;
}

function rebuildLivingLayers() {
  biomeChanges = fillBiomes(biome, elevation, terrainDelta, temp, wet, green, frozen, sea);
  biomeVersion += 1;
  faunaLand = fillFauna(fauna, elevation, terrainDelta, temp, wet, green, frozen, biome, elapsed, seed);
  ecologyVersion += 1;
}

function metrics() {
  let tempSum = 0;
  let land = 0;
  let greenSum = 0;
  for (let k = 0; k < N; k += 1) {
    tempSum += temp[k];
    if (evolved[k] >= sea) {
      land += 1;
      greenSum += green[k];
    }
  }
  return {
    meanTemp: tempSum / N,
    greenLand: land ? greenSum / land : 0,
    faunaLand,
    terrainMeanAbs,
    terrainMaxAbs,
    terrainVersion,
    hydrologyVersion,
    hydrologyChanges,
    riverCells,
    lakeCells,
    biomeVersion,
    biomeChanges,
    ecologyVersion,
  };
}

function initialize(s, years) {
  seed = s >>> 0;
  elapsed = Math.max(0, years || 0);
  sea = elapsed > 0 ? -20 + 38 * Math.sin(elapsed / 10500) + 17 * Math.sin(elapsed / 3100 + 0.7) : -20;
  terrainDelta = new Float32Array(N);
  evolved = new Float32Array(N);
  terrainDrivers = prepareTerrainDrivers(elevation, seed);
  temp = new Float32Array(N);
  wet = new Float32Array(N);
  green = new Float32Array(N);
  frozen = new Float32Array(N);
  t2 = new Float32Array(N);
  m2 = new Float32Array(N);
  v2 = new Float32Array(N);
  i2 = new Float32Array(N);
  biome = new Uint8Array(N);
  fauna = new Uint8Array(N);
  flow = null;
  accumulation = terrainDrivers.baseAccumulation.slice();
  lake = new Uint8Array(N);
  terrainVersion = 0;
  hydrologyVersion = 0;
  biomeVersion = 0;
  ecologyVersion = 0;
  hydrologyChanges = 0;

  rebuildTerrain();
  rebuildHydrology(true);

  for (let y = 0; y < SH; y += 1) {
    for (let x = 0; x < SW; x += 1) {
      const k = y * SW + x;
      const z = evolved[k];
      const t = targetTemperature(k, x, y);
      const m = initialMoisture(k, x, y);
      const ice = clamp((-t - 2) / 15) * (z < sea ? 0.74 : 1);
      const vegetation = z < sea ? 0 : clamp((t + 9) / 30) * m * (1 - ice);
      temp[k] = t;
      wet[k] = m;
      frozen[k] = ice;
      green[k] = vegetation;
    }
  }
  rebuildLivingLayers();
  emit();
}

function advance(dt) {
  elapsed += dt;
  sea = -20 + 38 * Math.sin(elapsed / 10500) + 17 * Math.sin(elapsed / 3100 + 0.7);
  rebuildTerrain();
  rebuildHydrology(false);

  for (let y = 0; y < SH; y += 1) {
    const north = Math.max(0, y - 1);
    const south = Math.min(SH - 1, y + 1);
    for (let x = 0; x < SW; x += 1) {
      const k = y * SW + x;
      const z = evolved[k];
      const west = y * SW + (x + SW - 1) % SW;
      const east = y * SW + (x + 1) % SW;
      const tt = targetTemperature(k, x, y);
      const ocean = z < sea;
      const nt = mix(temp[k], tt, 1 - Math.exp(-dt / (ocean ? 420 : 85)));
      const lat = 90 - (y + 0.5) / SH * 180;
      const shift = Math.sin(elapsed / 4100) * 0.16;
      const band = 0.12 + 0.78 * Math.pow(Math.cos((lat - shift * 35) * Math.PI / 180), 2);
      const neighbor = wet[west] * 0.40
        + wet[east] * 0.12
        + wet[north * SW + x] * 0.24
        + wet[south * SW + x] * 0.24;
      const orographic = Math.max(0, z) / 8200;
      const riverBoost = clamp(Math.log1p(accumulation[k]) / Math.log(900)) * 0.11;
      const lowlandMoisture = clamp((600 - z) / 1800) * (lake[k] ? 0.14 : 0.03);
      const dryPulse = 0.16 * Math.sin(elapsed / 1500 + x * 0.041);
      const mt = ocean ? 1 : clamp(band * 0.50 + neighbor * 0.48 + riverBoost + lowlandMoisture - orographic + dryPulse);
      const nm = mix(wet[k], mt, 1 - Math.exp(-dt / (ocean ? 25 : 20)));
      const it = clamp((-nt - 1) / 14) * (ocean ? 0.74 : 1);
      const ni = mix(frozen[k], it, 1 - Math.exp(-dt / 620));
      const vt = ocean ? 0 : clamp((nt + 10) / 27) * clamp((39 - nt) / 18) * Math.pow(nm, 0.8) * (1 - ni);
      const nv = mix(green[k], vt, 1 - Math.exp(-dt / 48));
      t2[k] = nt;
      m2[k] = nm;
      i2[k] = ni;
      v2[k] = nv;
    }
  }

  [temp, t2] = [t2, temp];
  [wet, m2] = [m2, wet];
  [frozen, i2] = [i2, frozen];
  [green, v2] = [v2, green];
  rebuildLivingLayers();
  emit();
}

function emit() {
  const message = {
    type: 'state',
    elapsed,
    sea,
    temp,
    wet,
    green,
    frozen,
    terrainDelta,
    biome,
    fauna,
    ...metrics(),
  };
  if (hydrologyDirty) {
    message.flow = flow;
    message.accumulation = accumulation;
    message.lake = lake;
    hydrologyDirty = false;
  }
  postMessage(message);
}

onmessage = (event) => {
  const data = event.data;
  if (data.type === 'init') {
    elevation = new Float32Array(data.elevation);
    if (elevation.length !== N) throw new Error(`terrain grid mismatch: ${elevation.length}`);
    initialize(data.seed, data.elapsed || 0);
  } else if (data.type === 'step') {
    advance(Math.max(0.001, data.dt));
  }
};
