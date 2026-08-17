const LOADERS = Object.freeze({
  climate: async () => {
    const { loadKrapp777Climate } = await import("./krapp-777-climate.js");
    return (await loadKrapp777Climate()).bytes;
  },
  vegetation: async () => {
    const { loadKrapp777Vegetation } = await import("./krapp-777-vegetation.js");
    return (await loadKrapp777Vegetation()).bytes;
  },
  soil: async () => {
    const { loadBiome4Soil } = await import("./biome4-soil.js");
    return (await loadBiome4Soil()).bytes;
  },
  pftDrivers: async () => {
    const { loadBiome4PftDrivers } = await import("./biome4-pft-drivers.js");
    return (await loadBiome4PftDrivers()).bytes;
  }
});

const cache = new Map();

async function loadAsset(asset) {
  if (!LOADERS[asset]) throw new RangeError(`Unknown regional science asset ${asset}`);
  if (!cache.has(asset)) cache.set(asset, LOADERS[asset]());
  return cache.get(asset);
}

self.addEventListener("message", async (event) => {
  const { id, asset } = event.data ?? {};
  if (!Number.isInteger(id)) return;
  try {
    const bytes = await loadAsset(asset);
    // Keep the worker-side cached layer intact. Transfer a tightly sized copy to
    // the UI thread so checksum, gzip decoding, and large response processing all
    // remain off the rendering thread while repeat requests stay cache-hot here.
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ id, asset, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ id, asset, error: error?.message ?? String(error) });
  }
});
