export class SurfaceComputeClient {
  constructor() {
    this.worker = typeof Worker === "function"
      ? new Worker(new URL("./surface-compute.worker.js", import.meta.url), { type: "module", name: "earth-777-surface-compute" })
      : null;
    this.contextId = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.lastTerrainMs = 0;
    this.lastEcologyMs = 0;
    this.lastRegionalTerrainMs = 0;
    this.completedTerrain = 0;
    this.completedEcology = 0;
    this.completedRegionalTerrain = 0;
    this.status = this.worker ? "ready" : "unavailable";
    this.worker?.addEventListener("message", (event) => this._handleMessage(event.data ?? {}));
    this.worker?.addEventListener("error", (event) => this._failAll(event.error ?? new Error(event.message || "Surface compute worker failed")));
  }

  setContext(context) {
    this.contextId += 1;
    if (this.worker) this.worker.postMessage({ type: "context", contextId: this.contextId, context });
    return this.contextId;
  }

  clearRegionalTerrainPatch() {
    if (this.worker) this.worker.postMessage({ type: "clearRegionalTerrain" });
  }

  invalidateRegionalTerrainRequest() {
    if (this.worker) this.worker.postMessage({ type: "invalidateRegionalTerrainRequest" });
  }

  _request(type, payload = {}) {
    if (!this.worker) return Promise.resolve(null);
    const id = this.nextId++;
    const contextId = this.contextId;
    this.status = `${type} busy`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { type, contextId, resolve, reject });
      this.worker.postMessage({ type, id, contextId, ...payload });
    });
  }

  terrain(chunkX, chunkZ, options = {}) {
    return this._request("terrain", { chunkX, chunkZ, options });
  }

  ecology(payload) {
    return this._request("ecology", { payload });
  }

  regionalTerrain(latitude, longitude, options = {}) {
    return this._request("regionalTerrain", { latitude, longitude, options });
  }

  _handleMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.type === "error") pending.reject(new Error(message.message || "Surface compute worker error"));
    else if (message.type === "stale" || (pending.type !== "regionalTerrain" && (message.contextId !== pending.contextId || message.contextId !== this.contextId))) pending.resolve(null);
    else {
      if (message.type === "terrain") {
        this.lastTerrainMs = Number(message.milliseconds) || 0;
        this.completedTerrain += 1;
      } else if (message.type === "ecology") {
        this.lastEcologyMs = Number(message.milliseconds) || 0;
        this.completedEcology += 1;
      } else if (message.type === "regionalTerrain") {
        this.lastRegionalTerrainMs = Number(message.milliseconds) || 0;
        this.completedRegionalTerrain += 1;
      }
      pending.resolve(message);
    }
    this.status = this.pending.size ? "busy" : "ready";
  }

  _failAll(error) {
    this.status = "error";
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  diagnostics() {
    return Object.freeze({
      available: Boolean(this.worker),
      status: this.status,
      contextId: this.contextId,
      pending: this.pending.size,
      lastTerrainMs: this.lastTerrainMs,
      lastEcologyMs: this.lastEcologyMs,
      lastRegionalTerrainMs: this.lastRegionalTerrainMs,
      completedTerrain: this.completedTerrain,
      completedEcology: this.completedEcology,
      completedRegionalTerrain: this.completedRegionalTerrain
    });
  }

  dispose() {
    this._failAll(new Error("Surface compute worker disposed"));
    this.worker?.terminate();
    this.worker = null;
    this.status = "disposed";
  }
}
