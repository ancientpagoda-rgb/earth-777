export class RasterTaskClient {
  constructor() {
    this.sequence = 0;
    this.pending = new Map();
    this.lastEarthMs = 0;
    this.lastCloudMs = 0;
    this.status = "starting";
    this.worker = typeof Worker === "function"
      ? new Worker(new URL("./earth-raster-worker.js", import.meta.url), { type: "module", name: "earth-777-raster" })
      : null;
    if (!this.worker) {
      this.status = "unavailable";
      return;
    }
    this.status = "ready";
    this.worker.addEventListener("message", (event) => this._handleMessage(event.data));
    this.worker.addEventListener("error", () => {
      this.status = "error";
    });
  }

  _request(type, payload = {}) {
    if (!this.worker) return Promise.resolve({ type: "error", job: type, message: "Web Worker unavailable." });
    const id = ++this.sequence;
    this.status = `${type} queued`;
    return new Promise((resolve) => {
      this.pending.set(id, { type, resolve });
      this.worker.postMessage({ type, id, ...payload });
    });
  }

  buildEarth(state) {
    return this._request("earth", { state });
  }

  buildClouds(state, cloudScale = 1) {
    return this._request("clouds", { state, cloudScale });
  }

  _handleMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.type === "earth") this.lastEarthMs = message.milliseconds ?? 0;
    if (message.type === "clouds") this.lastCloudMs = message.milliseconds ?? 0;
    this.status = message.type === "error" ? `${message.job} error` : this.pending.size ? "busy" : "ready";
    pending.resolve(message);
  }

  diagnostics() {
    return Object.freeze({
      status: this.status,
      queuedJobs: this.pending.size,
      lastEarthMs: this.lastEarthMs,
      lastCloudMs: this.lastCloudMs
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.status = "disposed";
  }
}
