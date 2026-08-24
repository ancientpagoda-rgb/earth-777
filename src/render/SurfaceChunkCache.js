const DB_NAME = "earth-777-surface-chunks-v1";
const STORE_NAME = "terrain";
const MAX_PERSISTED_ENTRIES = 96;

function cloneTerrain(result) {
  if (!result?.positions || !result?.colors || !result?.elevations || !result?.indices || !result?.normals) return null;
  return {
    positions: result.positions.slice(),
    colors: result.colors.slice(),
    elevations: result.elevations.slice(),
    indices: result.indices.slice(),
    normals: result.normals.slice(),
    segments: Number(result.segments) || 0,
    hydrology: result.hydrology ? { ...result.hydrology } : null
  };
}

export class SurfaceChunkCache {
  constructor({ memoryLimit = 12 } = {}) {
    this.memoryLimit = Math.max(1, Math.round(Number(memoryLimit) || 12));
    this.memory = new Map();
    this.dbPromise = null;
    this.persistentHits = 0;
    this.memoryHits = 0;
    this.writes = 0;
  }

  _remember(key, value) {
    this.memory.delete(key);
    this.memory.set(key, value);
    while (this.memory.size > this.memoryLimit) this.memory.delete(this.memory.keys().next().value);
  }

  _open() {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    this.dbPromise ??= new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("storedAt", "storedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return this.dbPromise;
  }

  async get(key) {
    const memoryValue = this.memory.get(key);
    if (memoryValue) {
      this.memoryHits += 1;
      this._remember(key, memoryValue);
      return cloneTerrain(memoryValue);
    }
    const db = await this._open();
    if (!db) return null;
    const record = await new Promise((resolve) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
    if (!record?.value) return null;
    this.persistentHits += 1;
    this._remember(key, record.value);
    return cloneTerrain(record.value);
  }

  put(key, result) {
    const value = cloneTerrain(result);
    if (!value) return;
    this._remember(key, value);
    this.writes += 1;
    this._open().then((db) => {
      if (!db) return;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key, storedAt: Date.now(), value });
      if (this.writes % 12 === 0) this._trim(db);
    }).catch(() => {});
  }

  _trim(db) {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let remove = Math.max(0, Number(countRequest.result) - MAX_PERSISTED_ENTRIES);
      if (!remove) return;
      const request = store.index("storedAt").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || remove <= 0) return;
        cursor.delete();
        remove -= 1;
        cursor.continue();
      };
    };
  }

  diagnostics() {
    return Object.freeze({
      memoryEntries: this.memory.size,
      memoryHits: this.memoryHits,
      persistentHits: this.persistentHits,
      writes: this.writes
    });
  }

  clearMemory() { this.memory.clear(); }
}
