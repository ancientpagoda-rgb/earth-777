import { KRAPP_777_META } from "./generated/krapp-777-meta.generated.js";
import { KRAPP_777_VEGETATION_META } from "./generated/krapp-777-vegetation-meta.generated.js";
import { BIOME4_SOIL_META } from "./generated/biome4-soil-meta.generated.js";
import { BIOME4_PFT_DRIVERS_META } from "./generated/biome4-pft-drivers-meta.generated.js";

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

const META = Object.freeze({
  climate: KRAPP_777_META,
  vegetation: KRAPP_777_VEGETATION_META,
  soil: BIOME4_SOIL_META,
  pftDrivers: BIOME4_PFT_DRIVERS_META
});
const DB_NAME = "earth-777-science-cache-v1";
const DB_VERSION = 1;
const STORE = "verified-assets";
const cache = new Map();
let databasePromise = null;

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function cacheKey(asset) {
  const meta = META[asset];
  return `${asset}:${meta?.assetSha256 ?? "unversioned"}:${meta?.uncompressedBytes ?? 0}`;
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return databasePromise;
}

async function deletePersistent(key) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    request.onsuccess = request.onerror = () => resolve();
  });
}

async function readPersistent(asset) {
  const meta = META[asset];
  const key = cacheKey(asset);
  const db = await openDatabase();
  if (!db || !meta) return null;
  const record = await new Promise((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
  if (!record?.buffer || record.sourceSha256 !== meta.assetSha256) return null;
  const bytes = new Uint8Array(record.buffer);
  if (bytes.byteLength !== meta.uncompressedBytes) {
    await deletePersistent(key);
    return null;
  }
  const digest = await sha256Hex(bytes);
  const expectedRawDigest = meta.uncompressedSha256 ?? record.rawSha256;
  if (!digest || !expectedRawDigest || digest !== expectedRawDigest) {
    await deletePersistent(key);
    return null;
  }
  return bytes;
}

async function writePersistent(asset, bytes) {
  const meta = META[asset];
  const db = await openDatabase();
  if (!db || !meta) return;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const rawSha256 = await sha256Hex(view);
  if (!rawSha256) return;
  const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  await new Promise((resolve) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({
      key: cacheKey(asset),
      asset,
      sourceSha256: meta.assetSha256,
      rawSha256,
      uncompressedBytes: meta.uncompressedBytes,
      buffer,
      cachedAt: Date.now()
    });
    request.onsuccess = request.onerror = () => resolve();
  });
}

async function loadAsset(asset) {
  if (!LOADERS[asset]) throw new RangeError(`Unknown regional science asset ${asset}`);
  if (cache.has(asset)) return { bytes: await cache.get(asset), source: "memory" };

  const task = (async () => {
    const persistent = await readPersistent(asset);
    if (persistent) return { bytes: persistent, source: "persistent" };
    const bytes = await LOADERS[asset]();
    await writePersistent(asset, bytes);
    return { bytes, source: "network" };
  })();
  cache.set(asset, task.then((result) => result.bytes));
  return task;
}

self.addEventListener("message", async (event) => {
  const { id, asset } = event.data ?? {};
  if (!Number.isInteger(id)) return;
  try {
    const { bytes, source } = await loadAsset(asset);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ id, asset, buffer, cacheSource: source }, [buffer]);
  } catch (error) {
    cache.delete(asset);
    self.postMessage({ id, asset, error: error?.message ?? String(error) });
  }
});
