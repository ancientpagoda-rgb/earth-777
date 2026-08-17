export class RegionalDataWorkerClient {
  constructor() {
    this.worker = new Worker(new URL("./regional-data.worker.js", import.meta.url), { type: "module" });
    this.nextId = 1;
    this.pending = new Map();
    this.cache = new Map();
    this.cacheSources = new Map();
    this.worker.addEventListener("message", (event) => this._handleMessage(event.data));
    this.worker.addEventListener("error", (event) => this._failAll(event.error ?? new Error(event.message || "Regional data worker failed")));
  }

  _handleMessage(message) {
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else {
      this.cacheSources.set(message.asset, message.cacheSource ?? "unknown");
      pending.resolve(message.buffer);
    }
  }

  _failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  load(asset) {
    if (this.cache.has(asset)) return this.cache.get(asset);
    const promise = new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, asset });
    }).catch((error) => {
      this.cache.delete(asset);
      throw error;
    });
    this.cache.set(asset, promise);
    return promise;
  }

  diagnostics() {
    const sources = Object.fromEntries(this.cacheSources);
    return Object.freeze({
      cachedAssets: this.cache.size,
      pendingAssets: this.pending.size,
      persistentHits: [...this.cacheSources.values()].filter((source) => source === "persistent").length,
      networkLoads: [...this.cacheSources.values()].filter((source) => source === "network").length,
      sources: Object.freeze(sources)
    });
  }

  dispose() {
    this._failAll(new Error("Regional data worker disposed"));
    this.cache.clear();
    this.cacheSources.clear();
    this.worker.terminate();
  }
}
