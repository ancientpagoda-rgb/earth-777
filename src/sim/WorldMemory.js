const DEFAULTS = Object.freeze({
  hotWindowYears: 1_000,
  maxHotSamples: 64,
  warmBinYears: 100,
  maxWarmBins: 100,
  maxColdBins: 256,
  maxEventHighlights: 64
});

export const WORLD_MEMORY_POLICY = "hierarchical-world-memory-v1";

const METRIC_KEYS = Object.freeze([
  "temperatureAnomaly",
  "co2",
  "iceIndex",
  "seaLevel",
  "productivityIndex",
  "animalBiomass",
  "speciesRichness",
  "homininPopulationIndex",
  "cognitionIndex",
  "cultureIndex",
  "technologyIndex",
  "magneticStrength"
]);

const round = (value, digits = 6) => Number.isFinite(Number(value))
  ? Number(Number(value).toFixed(digits))
  : null;

function compactSample(state, events = []) {
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const value = Number(state?.[key]);
    if (Number.isFinite(value)) metrics[key] = value;
  }

  return {
    elapsedYears: Number(state?.elapsedYears) || 0,
    yearBP: Number(state?.yearBP) || 0,
    stage: String(state?.stage ?? "unknown"),
    metrics,
    events: events
      .filter((event) => event && typeof event.text === "string")
      .slice(-8)
      .map((event) => ({ yearBP: Number(event.yearBP) || 0, text: event.text }))
  };
}

function createAggregate() {
  return {
    startElapsedYears: null,
    endElapsedYears: null,
    startYearBP: null,
    endYearBP: null,
    startStage: null,
    endStage: null,
    count: 0,
    eventCount: 0,
    eventKinds: Object.create(null),
    metrics: Object.fromEntries(METRIC_KEYS.map((key) => [key, {
      min: Infinity,
      max: -Infinity,
      sum: 0,
      first: null,
      last: null,
      count: 0
    }]))
  };
}

function eventKind(text) {
  if (/extinct/i.test(text)) return "extinctions";
  if (/branches from|lineage/i.test(text)) return "lineage changes";
  if (/Matuyama|polarity|magnetic/i.test(text)) return "magnetic events";
  return "other events";
}

function addEventKinds(target, events = []) {
  for (const event of events) {
    const kind = eventKind(event.text);
    target[kind] = (target[kind] || 0) + 1;
  }
}

function addSample(aggregate, sample) {
  if (aggregate.count === 0) {
    aggregate.startElapsedYears = sample.elapsedYears;
    aggregate.startYearBP = sample.yearBP;
    aggregate.startStage = sample.stage;
  }

  aggregate.count += 1;
  aggregate.endElapsedYears = sample.elapsedYears;
  aggregate.endYearBP = sample.yearBP;
  aggregate.endStage = sample.stage;
  aggregate.eventCount += sample.events.length;
  addEventKinds(aggregate.eventKinds, sample.events);

  for (const key of METRIC_KEYS) {
    const value = Number(sample.metrics[key]);
    if (!Number.isFinite(value)) continue;
    const metric = aggregate.metrics[key];
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    metric.sum += value;
    metric.first ??= value;
    metric.last = value;
    metric.count += 1;
  }
}

function mergeAggregates(first, second) {
  const merged = createAggregate();
  merged.startElapsedYears = first.startElapsedYears ?? second.startElapsedYears;
  merged.endElapsedYears = second.endElapsedYears ?? first.endElapsedYears;
  merged.startYearBP = first.startYearBP ?? second.startYearBP;
  merged.endYearBP = second.endYearBP ?? first.endYearBP;
  merged.startStage = first.startStage ?? second.startStage;
  merged.endStage = second.endStage ?? first.endStage;
  merged.count = first.count + second.count;
  merged.eventCount = first.eventCount + second.eventCount;

  for (const [kind, count] of Object.entries(first.eventKinds)) {
    merged.eventKinds[kind] = (merged.eventKinds[kind] || 0) + count;
  }
  for (const [kind, count] of Object.entries(second.eventKinds)) {
    merged.eventKinds[kind] = (merged.eventKinds[kind] || 0) + count;
  }

  for (const key of METRIC_KEYS) {
    const target = merged.metrics[key];
    const left = first.metrics[key];
    const right = second.metrics[key];
    target.min = Math.min(left.min, right.min);
    target.max = Math.max(left.max, right.max);
    target.sum = left.sum + right.sum;
    target.first = left.count > 0 ? left.first : right.first;
    target.last = right.count > 0 ? right.last : left.last;
    target.count = left.count + right.count;
  }

  return merged;
}

function summaryFromAggregate(aggregate) {
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const metric = aggregate.metrics[key];
    if (!metric.count) continue;
    metrics[key] = {
      min: round(metric.min),
      max: round(metric.max),
      mean: round(metric.sum / metric.count),
      start: round(metric.first),
      end: round(metric.last)
    };
  }

  return Object.freeze({
    type: "summary",
    startElapsedYears: aggregate.startElapsedYears,
    endElapsedYears: aggregate.endElapsedYears,
    startYearBP: aggregate.startYearBP,
    endYearBP: aggregate.endYearBP,
    startStage: aggregate.startStage,
    endStage: aggregate.endStage,
    samples: aggregate.count,
    eventCount: aggregate.eventCount,
    eventKinds: Object.freeze({ ...aggregate.eventKinds }),
    metrics: Object.freeze(metrics)
  });
}

function compactHotSample(sample) {
  return Object.freeze({
    type: "sample",
    elapsedYears: sample.elapsedYears,
    yearBP: sample.yearBP,
    stage: sample.stage,
    metrics: Object.freeze(Object.fromEntries(
      Object.entries(sample.metrics).map(([key, value]) => [key, round(value)])
    )),
    events: Object.freeze(sample.events.map((event) => Object.freeze({ ...event })))
  });
}

export class WorldMemory {
  constructor(options = {}) {
    this.options = Object.freeze({
      ...DEFAULTS,
      ...options,
      hotWindowYears: Math.max(1, Number(options.hotWindowYears ?? DEFAULTS.hotWindowYears)),
      maxHotSamples: Math.max(2, Math.floor(Number(options.maxHotSamples ?? DEFAULTS.maxHotSamples))),
      warmBinYears: Math.max(1, Number(options.warmBinYears ?? DEFAULTS.warmBinYears)),
      maxWarmBins: Math.max(1, Math.floor(Number(options.maxWarmBins ?? DEFAULTS.maxWarmBins))),
      maxColdBins: Math.max(1, Math.floor(Number(options.maxColdBins ?? DEFAULTS.maxColdBins))),
      maxEventHighlights: Math.max(1, Math.floor(Number(options.maxEventHighlights ?? DEFAULTS.maxEventHighlights)))
    });
    this.reset();
  }

  reset() {
    this.hot = [];
    this.warm = new Map();
    this.cold = [];
    this.eventHighlights = [];
    this.compactedEventKinds = Object.create(null);
    this.totalSamples = 0;
    return this;
  }

  record(state, events = []) {
    const sample = compactSample(state, events);
    this.totalSamples += 1;
    this.hot.push(sample);

    while (
      this.hot.length > 1
      && this.hot.length > this.options.maxHotSamples
    ) {
      this._moveHotSampleToWarm(this.hot.shift());
    }
    while (
      this.hot.length > 1
      && sample.elapsedYears - this.hot[0].elapsedYears > this.options.hotWindowYears
    ) {
      this._moveHotSampleToWarm(this.hot.shift());
    }

    for (const event of sample.events) this._rememberEvent(event);
    return this;
  }

  _moveHotSampleToWarm(sample) {
    const bin = Math.floor(sample.elapsedYears / this.options.warmBinYears);
    const existing = this.warm.get(bin) ?? createAggregate();
    addSample(existing, sample);
    this.warm.set(bin, existing);

    while (this.warm.size > this.options.maxWarmBins) {
      const oldestKey = this.warm.keys().next().value;
      const oldest = this.warm.get(oldestKey);
      this.warm.delete(oldestKey);
      this._moveWarmSummaryToCold(oldest);
    }
  }

  _moveWarmSummaryToCold(aggregate) {
    if (!aggregate || aggregate.count === 0) return;
    let summary = aggregate;
    while (this.cold.length >= this.options.maxColdBins) {
      if (this.cold.length === 1) {
        summary = mergeAggregates(this.cold.shift(), summary);
        break;
      }
      const first = this.cold.shift();
      const second = this.cold.shift();
      this.cold.unshift(mergeAggregates(first, second));
    }
    this.cold.push(summary);
  }

  _rememberEvent(event) {
    this.eventHighlights.push(event);
    while (this.eventHighlights.length > this.options.maxEventHighlights) {
      const compacted = this.eventHighlights.shift();
      const kind = eventKind(compacted.text);
      this.compactedEventKinds[kind] = (this.compactedEventKinds[kind] || 0) + 1;
    }
  }

  diagnostics() {
    return Object.freeze({
      policy: WORLD_MEMORY_POLICY,
      totalSamples: this.totalSamples,
      hotSamples: this.hot.length,
      warmBins: this.warm.size,
      coldBins: this.cold.length,
      eventHighlights: this.eventHighlights.length,
      compactedEventKinds: Object.freeze({ ...this.compactedEventKinds }),
      limits: Object.freeze({
        hotWindowYears: this.options.hotWindowYears,
        maxHotSamples: this.options.maxHotSamples,
        warmBinYears: this.options.warmBinYears,
        maxWarmBins: this.options.maxWarmBins,
        maxColdBins: this.options.maxColdBins,
        maxEventHighlights: this.options.maxEventHighlights
      })
    });
  }

  snapshot() {
    const warm = [...this.warm.values()].map(summaryFromAggregate);
    const cold = this.cold.map((aggregate) => summaryFromAggregate(aggregate));
    return Object.freeze({
      policy: WORLD_MEMORY_POLICY,
      tiers: Object.freeze({
        hot: Object.freeze(this.hot.map(compactHotSample)),
        warm: Object.freeze(warm),
        cold: Object.freeze(cold)
      }),
      eventHighlights: Object.freeze(this.eventHighlights.map((event) => Object.freeze({ ...event }))),
      compactedEventKinds: Object.freeze({ ...this.compactedEventKinds }),
      diagnostics: this.diagnostics()
    });
  }
}
