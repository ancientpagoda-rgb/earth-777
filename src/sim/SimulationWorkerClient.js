export class SimulationWorkerClient {
  constructor({ seed = 777001, worker = null, onState = null, onFidelity = null, onError = null } = {}) {
    this.worker = worker ?? new Worker(new URL("./simulation.worker.js", import.meta.url), { type: "module" });
    this.onState = onState;
    this.onFidelity = onFidelity;
    this.onError = onError;
    this.version = 0;
    this.nextRequestId = 0;
    this.readyResolved = false;
    this.pendingAdvanceYears = 0;
    this.advanceInFlight = null;
    this.pendingRequests = new Map();

    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker.addEventListener("message", (event) => this._handleMessage(event.data ?? {}));
    this.worker.addEventListener?.("error", (event) => {
      const error = event?.error instanceof Error ? event.error : new Error(event?.message || "Simulation worker failed");
      this.rejectReady?.(error);
      this.onError?.(error);
    });

    this._post("init", { seed: Number(seed) >>> 0, version: this.version });
  }

  _post(type, payload = {}) {
    const requestId = ++this.nextRequestId;
    this.worker.postMessage({ type, requestId, ...payload });
    return requestId;
  }

  _handleMessage(message) {
    if (message.type === "error") {
      const error = new Error(message.message || "Simulation worker error");
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        this.pendingRequests.delete(message.requestId);
        pending.reject(error);
      }
      if (!this.readyResolved) this.rejectReady?.(error);
      this.onError?.(error);
      if (this.advanceInFlight?.requestId === message.requestId) {
        this.advanceInFlight = null;
        this._flushAdvance();
      }
      return;
    }

    if (message.type === "ready") {
      this.readyResolved = true;
      const result = this._normalizeResult(message);
      this.resolveReady?.(result);
      this.onFidelity?.(result.fidelity);
      this._flushAdvance();
      return;
    }

    if (message.type === "fidelity") {
      if (message.version === this.version) this.onFidelity?.(message.fidelity ?? { targets: [] });
      this._resolveRequest(message);
      return;
    }

    if (["advance", "seek", "reset"].includes(message.type)) {
      const result = this._normalizeResult(message);
      if (message.version === this.version) {
        this.onFidelity?.(result.fidelity);
        this.onState?.(result);
      }
      this._resolveRequest(message, result);
      if (this.advanceInFlight?.requestId === message.requestId) {
        this.advanceInFlight = null;
        this._flushAdvance();
      }
    }
  }

  _normalizeResult(message) {
    return {
      type: message.type,
      requestId: message.requestId,
      version: message.version,
      state: message.state,
      fidelity: message.fidelity ?? { targets: [] },
      durationMs: Number(message.durationMs) || 0
    };
  }

  _resolveRequest(message, value = message) {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;
    this.pendingRequests.delete(message.requestId);
    if (message.version === pending.version) pending.resolve(value);
    else pending.resolve(null);
  }

  _request(type, payload, { bumpVersion = false } = {}) {
    if (bumpVersion) {
      this.version += 1;
      this.pendingAdvanceYears = 0;
    }
    const version = this.version;
    const requestId = this._post(type, { ...payload, version });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject, version });
    });
  }

  queueAdvance(years) {
    const delta = Math.max(0, Number(years) || 0);
    if (!delta) return;
    this.pendingAdvanceYears += delta;
    this._flushAdvance();
  }

  _flushAdvance() {
    if (!this.readyResolved || this.advanceInFlight || this.pendingAdvanceYears <= 0) return;
    const years = this.pendingAdvanceYears;
    this.pendingAdvanceYears = 0;
    const version = this.version;
    const requestId = this._post("advance", { years, version });
    this.advanceInFlight = { requestId, version };
  }

  clearPendingAdvance() {
    this.pendingAdvanceYears = 0;
  }

  seek(elapsedYears) {
    return this._request("seek", { elapsedYears: Number(elapsedYears) || 0 }, { bumpVersion: true });
  }

  reset(seed) {
    return this._request("reset", { seed: Number(seed) >>> 0 }, { bumpVersion: true });
  }

  setObserverRelevance(observerRelevance = {}) {
    return this._request("observer-relevance", { observerRelevance });
  }

  diagnostics() {
    return {
      version: this.version,
      ready: this.readyResolved,
      advanceInFlight: Boolean(this.advanceInFlight),
      pendingAdvanceYears: this.pendingAdvanceYears
    };
  }

  dispose() {
    this.worker.terminate?.();
    for (const pending of this.pendingRequests.values()) pending.reject(new Error("Simulation worker disposed"));
    this.pendingRequests.clear();
  }
}
