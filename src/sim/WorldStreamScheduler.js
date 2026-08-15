const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 180) % 360 + 360) % 360 - 180;

export const WORLD_STREAM_POLICY = "earth777-world-stream-scheduler-v1";

export const WORLD_STREAM_LEVELS = Object.freeze({
  global: Object.freeze({ cellDegrees: 360, radius: 0 }),
  regional: Object.freeze({ cellDegrees: 10, radius: 1 }),
  local: Object.freeze({ cellDegrees: 1, radius: 1 }),
  observed: Object.freeze({ cellDegrees: 0.1, radius: 1 })
});

const MODE_SCOPES = Object.freeze({
  globe: Object.freeze(["global", "regional"]),
  descent: Object.freeze(["global", "regional", "local"]),
  surface: Object.freeze(["global", "regional", "local", "observed"])
});

function freezeCell(cell) {
  return Object.freeze(cell);
}

function globalCell() {
  return freezeCell({
    key: "global:earth",
    scope: "global",
    latitude: 0,
    longitude: 0,
    cellDegrees: 360,
    bounds: Object.freeze({ south: -90, north: 90, west: -180, east: 180 })
  });
}

function gridShape(cellDegrees) {
  return {
    latitudeCount: Math.max(1, Math.ceil(180 / cellDegrees)),
    longitudeCount: Math.max(1, Math.ceil(360 / cellDegrees))
  };
}

function gridCell(scope, latitudeIndex, longitudeIndex) {
  const config = WORLD_STREAM_LEVELS[scope];
  const size = config.cellDegrees;
  const shape = gridShape(size);
  const latIndex = clamp(Math.floor(latitudeIndex), 0, shape.latitudeCount - 1);
  const lonIndex = ((Math.floor(longitudeIndex) % shape.longitudeCount) + shape.longitudeCount) % shape.longitudeCount;
  const south = -90 + latIndex * size;
  const north = Math.min(90, south + size);
  const west = -180 + lonIndex * size;
  const east = Math.min(180, west + size);
  return freezeCell({
    key: `${scope}:${latIndex}:${lonIndex}`,
    scope,
    latitude: (south + north) * 0.5,
    longitude: wrapLongitude((west + east) * 0.5),
    cellDegrees: size,
    bounds: Object.freeze({ south, north, west, east })
  });
}

function centerIndices(latitude, longitude, cellDegrees) {
  const shape = gridShape(cellDegrees);
  const boundedLatitude = clamp(latitude, -89.999999, 89.999999);
  const wrappedLongitude = wrapLongitude(longitude);
  return {
    latitude: clamp(Math.floor((boundedLatitude + 90) / cellDegrees), 0, shape.latitudeCount - 1),
    longitude: ((Math.floor((wrappedLongitude + 180) / cellDegrees) % shape.longitudeCount) + shape.longitudeCount) % shape.longitudeCount
  };
}

function neighborhood(scope, latitude, longitude) {
  if (scope === "global") return Object.freeze([globalCell()]);
  const config = WORLD_STREAM_LEVELS[scope];
  const center = centerIndices(latitude, longitude, config.cellDegrees);
  const cells = new Map();
  for (let dy = -config.radius; dy <= config.radius; dy += 1) {
    for (let dx = -config.radius; dx <= config.radius; dx += 1) {
      const cell = gridCell(scope, center.latitude + dy, center.longitude + dx);
      cells.set(cell.key, cell);
    }
  }
  return Object.freeze([...cells.values()]);
}

function normalizeMode(mode) {
  return MODE_SCOPES[mode] ? mode : "globe";
}

function normalizeScope(scope) {
  if (scope === "any") return scope;
  if (!WORLD_STREAM_LEVELS[scope]) throw new RangeError(`Unknown world-stream scope: ${scope}`);
  return scope;
}

function normalizeWorkUnits(result) {
  if (Number.isFinite(result)) return Math.max(0, Number(result));
  if (result && Number.isFinite(result.workUnits)) return Math.max(0, Number(result.workUnits));
  return 0;
}

export class WorldStreamScheduler {
  constructor({ budgetMs = 2.5, clock = () => performance.now() } = {}) {
    this.defaultBudgetMs = Math.max(0.1, Number(budgetMs) || 2.5);
    this.clock = typeof clock === "function" ? clock : () => performance.now();
    this.systems = new Map();
    this.runtime = new Map();
    this.focus = null;
    this.mode = "globe";
    this.activeByScope = new Map([["global", Object.freeze([globalCell()])]]);
    this.lastFocusSignature = "";
    this.lastPump = Object.freeze({
      budgetMs: this.defaultBudgetMs,
      elapsedMs: 0,
      workUnits: 0,
      systemsRun: Object.freeze([]),
      budgetExhausted: false
    });
  }

  registerSystem({
    id,
    scope = "any",
    priority = 50,
    minIntervalMs = 0,
    maxSliceMs = Infinity,
    hasWork = () => true,
    run
  } = {}) {
    const key = String(id ?? "").trim();
    if (!key) throw new TypeError("World-stream systems require a non-empty id.");
    if (this.systems.has(key)) throw new Error(`World-stream system already registered: ${key}`);
    if (typeof run !== "function") throw new TypeError(`World-stream system ${key} requires a run function.`);
    const normalizedScope = normalizeScope(scope);
    const system = Object.freeze({
      id: key,
      scope: normalizedScope,
      priority: Number(priority) || 0,
      minIntervalMs: Math.max(0, Number(minIntervalMs) || 0),
      maxSliceMs: Number.isFinite(maxSliceMs) ? Math.max(0.05, Number(maxSliceMs)) : Infinity,
      hasWork: typeof hasWork === "function" ? hasWork : () => Boolean(hasWork),
      run
    });
    this.systems.set(key, system);
    this.runtime.set(key, {
      lastRunMs: -Infinity,
      runs: 0,
      workUnits: 0,
      totalMs: 0,
      maxMs: 0,
      errors: 0,
      skipped: 0
    });
    return () => this.unregisterSystem(key);
  }

  unregisterSystem(id) {
    const key = String(id);
    const removed = this.systems.delete(key);
    this.runtime.delete(key);
    return removed;
  }

  setFocus({ latitude, longitude, mode = this.mode } = {}) {
    const nextMode = normalizeMode(mode);
    const lat = Number(latitude);
    const lon = Number(longitude);
    const hasFocus = Number.isFinite(lat) && Number.isFinite(lon);
    const nextFocus = hasFocus
      ? Object.freeze({ latitude: clamp(lat, -90, 90), longitude: wrapLongitude(lon) })
      : null;
    const signature = `${nextMode}|${nextFocus?.latitude.toFixed(5) ?? "none"}|${nextFocus?.longitude.toFixed(5) ?? "none"}`;
    if (signature === this.lastFocusSignature) return false;
    this.lastFocusSignature = signature;
    this.mode = nextMode;
    this.focus = nextFocus;
    const scopes = hasFocus ? MODE_SCOPES[nextMode] : ["global"];
    const active = new Map();
    for (const scope of scopes) {
      active.set(scope, scope === "global"
        ? Object.freeze([globalCell()])
        : neighborhood(scope, nextFocus.latitude, nextFocus.longitude));
    }
    this.activeByScope = active;
    return true;
  }

  activeCells(scope = "any") {
    if (scope === "any") return Object.freeze([...this.activeByScope.values()].flat());
    return this.activeByScope.get(normalizeScope(scope)) ?? Object.freeze([]);
  }

  isScopeActive(scope) {
    return scope === "any" || this.activeByScope.has(scope);
  }

  pump({ now = this.clock(), budgetMs = this.defaultBudgetMs, context = null } = {}) {
    const budget = Math.max(0.1, Number(budgetMs) || this.defaultBudgetMs);
    const started = this.clock();
    const candidates = [];

    for (const system of this.systems.values()) {
      const runtime = this.runtime.get(system.id);
      if (!this.isScopeActive(system.scope)) {
        runtime.skipped += 1;
        continue;
      }
      if (now - runtime.lastRunMs < system.minIntervalMs) continue;
      const cells = this.activeCells(system.scope);
      let hasWork = false;
      try {
        hasWork = Boolean(system.hasWork({ now, context, cells, scheduler: this }));
      } catch (error) {
        runtime.errors += 1;
        console.warn(`World-stream hasWork failed for ${system.id}.`, error);
        continue;
      }
      if (!hasWork) continue;
      const idleMs = Number.isFinite(runtime.lastRunMs) ? Math.max(0, now - runtime.lastRunMs) : 10_000;
      const starvationBoost = Math.min(160, idleMs / 16.667 * 1.5);
      candidates.push({ system, runtime, cells, score: system.priority + starvationBoost });
    }

    candidates.sort((a, b) =>
      b.score - a.score
      || a.runtime.lastRunMs - b.runtime.lastRunMs
      || a.system.id.localeCompare(b.system.id)
    );

    const systemsRun = [];
    let workUnits = 0;
    for (const candidate of candidates) {
      const elapsedBefore = this.clock() - started;
      const remaining = budget - elapsedBefore;
      if (remaining <= 0) break;
      const sliceMs = Math.min(remaining, candidate.system.maxSliceMs);
      const before = this.clock();
      try {
        const result = candidate.system.run({
          now,
          sliceMs,
          context,
          cells: candidate.cells,
          scheduler: this
        });
        const units = normalizeWorkUnits(result);
        const duration = Math.max(0, this.clock() - before);
        candidate.runtime.lastRunMs = now;
        candidate.runtime.runs += 1;
        candidate.runtime.workUnits += units;
        candidate.runtime.totalMs += duration;
        candidate.runtime.maxMs = Math.max(candidate.runtime.maxMs, duration);
        systemsRun.push(candidate.system.id);
        workUnits += units;
      } catch (error) {
        candidate.runtime.lastRunMs = now;
        candidate.runtime.errors += 1;
        console.warn(`World-stream run failed for ${candidate.system.id}.`, error);
      }
    }

    const elapsedMs = Math.max(0, this.clock() - started);
    this.lastPump = Object.freeze({
      budgetMs: budget,
      elapsedMs,
      workUnits,
      systemsRun: Object.freeze(systemsRun),
      budgetExhausted: elapsedMs >= budget
    });
    return this.lastPump;
  }

  diagnostics() {
    const activeByScope = Object.fromEntries(
      [...this.activeByScope.entries()].map(([scope, cells]) => [scope, cells.length])
    );
    const systems = [...this.systems.values()].map((system) => {
      const runtime = this.runtime.get(system.id);
      return Object.freeze({
        id: system.id,
        scope: system.scope,
        priority: system.priority,
        minIntervalMs: system.minIntervalMs,
        runs: runtime.runs,
        workUnits: runtime.workUnits,
        totalMs: runtime.totalMs,
        maxMs: runtime.maxMs,
        errors: runtime.errors,
        skipped: runtime.skipped,
        lastRunMs: Number.isFinite(runtime.lastRunMs) ? runtime.lastRunMs : null
      });
    });
    return Object.freeze({
      policy: WORLD_STREAM_POLICY,
      mode: this.mode,
      focus: this.focus,
      activeCellCount: Object.values(activeByScope).reduce((sum, count) => sum + count, 0),
      activeByScope: Object.freeze(activeByScope),
      systems: Object.freeze(systems),
      lastPump: this.lastPump
    });
  }
}
