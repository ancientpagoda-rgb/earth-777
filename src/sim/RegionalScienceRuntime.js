let runtimePromise = null;
let dataClient = null;
let snapshot = Object.freeze({
  stage: "empty",
  climate: null,
  hydrology: null,
  vegetation: null,
  soil: null,
  pftDrivers: null,
  complete: false
});
const listeners = new Set();

function publish(stage, patch = {}) {
  snapshot = Object.freeze({ ...snapshot, ...patch, stage });
  for (const listener of listeners) {
    try { listener(snapshot); } catch (error) { console.warn("Regional science stage listener failed.", error); }
  }
  return snapshot;
}

const settled = (promise) => promise.then(
  (value) => ({ status: "fulfilled", value }),
  (reason) => ({ status: "rejected", reason })
);

async function buildRegionalScience() {
  const [
    { RegionalDataWorkerClient },
    { Krapp777ClimateLayer },
    { Krapp777VegetationLayer },
    { Biome4SoilLayer },
    { Biome4PftDriverLayer },
    { SpatialHydroClimate },
    { EarthSystemHydrology },
    { SpatialVegetation }
  ] = await Promise.all([
    import("../data/RegionalDataWorkerClient.js"),
    import("../data/krapp-777-climate.js"),
    import("../data/krapp-777-vegetation.js"),
    import("../data/biome4-soil.js"),
    import("../data/biome4-pft-drivers.js"),
    import("./SpatialHydroClimate.js"),
    import("./EarthSystemHydrology.js"),
    import("./SpatialVegetation.js")
  ]);

  dataClient ??= new RegionalDataWorkerClient();

  // The largest mandatory dataset arrives first and immediately enables the
  // calibrated climate view. The UI no longer waits for every optional layer.
  const climateBuffer = await dataClient.load("climate");
  const climate = new Krapp777ClimateLayer(climateBuffer);
  publish("climate", { climate });

  // Hydrology becomes useful immediately with its transparent uniform-soil
  // fallback while BIOME4 soil/PFT and vegetation continue loading in parallel.
  let hydrology = new EarthSystemHydrology(new SpatialHydroClimate(climate), null);
  publish("hydrology-provisional", { hydrology });

  const soilTask = settled(dataClient.load("soil"));
  const pftTask = settled(dataClient.load("pftDrivers"));
  const vegetationTask = settled(dataClient.load("vegetation"));

  const soilResult = await soilTask;
  let soil = null;
  if (soilResult.status === "fulfilled") {
    soil = new Biome4SoilLayer(soilResult.value);
    hydrology = new EarthSystemHydrology(new SpatialHydroClimate(climate), soil);
    publish("hydrology", { soil, hydrology });
  } else {
    console.warn("BIOME4 static soil layer unavailable; retaining the transparent uniform fallback water bucket.", soilResult.reason);
  }

  const [pftResult, vegetationResult] = await Promise.all([pftTask, vegetationTask]);
  let pftDrivers = null;
  if (pftResult.status === "fulfilled") pftDrivers = new Biome4PftDriverLayer(pftResult.value);
  else console.warn("BIOME4 PFT absolute-minimum-temperature driver unavailable; using the documented coldest-month fallback.", pftResult.reason);

  let vegetation = null;
  if (vegetationResult.status === "fulfilled") {
    const vegetationLayer = new Krapp777VegetationLayer(vegetationResult.value);
    hydrology.climate?.setCheckpointVegetation?.(vegetationLayer);
    vegetation = new SpatialVegetation(vegetationLayer, hydrology, pftDrivers);
  } else {
    console.warn("Krapp 777 ka BIOME4 vegetation layer unavailable; using hydroclimate vegetation fallback.", vegetationResult.reason);
  }

  return publish("complete", { hydrology, vegetation, soil, pftDrivers, complete: true });
}

export function regionalScienceSnapshot() { return snapshot; }

export async function loadRegionalScienceProgressively({ onStage = null } = {}) {
  if (typeof onStage === "function") {
    listeners.add(onStage);
    if (snapshot.stage !== "empty") onStage(snapshot);
  }
  runtimePromise ??= buildRegionalScience().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  try {
    return await runtimePromise;
  } finally {
    if (typeof onStage === "function") listeners.delete(onStage);
  }
}

export function regionalScienceDiagnostics() {
  return Object.freeze({ stage: snapshot.stage, complete: snapshot.complete, ...(dataClient?.diagnostics?.() ?? { cachedAssets: 0, pendingAssets: 0 }) });
}
