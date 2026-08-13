const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const QUALITY_TIERS = Object.freeze([
  Object.freeze({ name: "low", quality: 0.55, pixelRatioCap: 0.7, terrainRadius: 1, terrainSegments: 10, cloudScale: 0.55 }),
  Object.freeze({ name: "balanced", quality: 0.72, pixelRatioCap: 0.82, terrainRadius: 2, terrainSegments: 14, cloudScale: 0.72 }),
  Object.freeze({ name: "high", quality: 0.86, pixelRatioCap: 0.92, terrainRadius: 2, terrainSegments: 18, cloudScale: 0.86 }),
  Object.freeze({ name: "ultra", quality: 1, pixelRatioCap: 1, terrainRadius: 3, terrainSegments: 22, cloudScale: 1 })
]);

export class AdaptivePerformanceController {
  constructor({ targetFps = 60, initialTier = "ultra" } = {}) {
    this.targetFps = clamp(Number(targetFps) || 60, 30, 120);
    this.targetFrameMs = 1000 / this.targetFps;
    this.tierIndex = Math.max(0, QUALITY_TIERS.findIndex((tier) => tier.name === initialTier));
    if (this.tierIndex < 0) this.tierIndex = QUALITY_TIERS.length - 1;
    this.emaFrameMs = this.targetFrameMs;
    this.lastChangeMs = 0;
    this.slowSinceMs = null;
    this.fastSinceMs = null;
    this.lastReason = "initial";
  }

  sample(frameMs, now = performance.now()) {
    const sample = clamp(Number(frameMs) || this.targetFrameMs, 1, 80);
    this.emaFrameMs += (sample - this.emaFrameMs) * 0.08;

    const slowThreshold = this.targetFrameMs * 1.16;
    const fastThreshold = this.targetFrameMs * 0.82;
    if (this.emaFrameMs > slowThreshold) {
      this.slowSinceMs ??= now;
      this.fastSinceMs = null;
    } else if (this.emaFrameMs < fastThreshold) {
      this.fastSinceMs ??= now;
      this.slowSinceMs = null;
    } else {
      this.slowSinceMs = null;
      this.fastSinceMs = null;
    }

    const cooldownDone = now - this.lastChangeMs > 1_500;
    if (cooldownDone && this.slowSinceMs != null && now - this.slowSinceMs > 900 && this.tierIndex > 0) {
      this.tierIndex -= 1;
      this.lastChangeMs = now;
      this.lastReason = `frame pressure ${this.emaFrameMs.toFixed(1)} ms`;
      this.slowSinceMs = null;
      return true;
    }
    if (cooldownDone && this.fastSinceMs != null && now - this.fastSinceMs > 4_000 && this.tierIndex < QUALITY_TIERS.length - 1) {
      this.tierIndex += 1;
      this.lastChangeMs = now;
      this.lastReason = `headroom ${this.emaFrameMs.toFixed(1)} ms`;
      this.fastSinceMs = null;
      return true;
    }
    return false;
  }

  settings(scienceDetail = 1) {
    const tier = QUALITY_TIERS[this.tierIndex];
    const science = clamp(Number(scienceDetail) || 0.35, 0.25, 1);
    return Object.freeze({
      ...tier,
      visualLod: tier.name,
      scienceDetail: science,
      effectiveTerrainSegments: Math.max(8, Math.round(tier.terrainSegments * (0.72 + science * 0.28))),
      effectiveTerrainRadius: Math.max(1, Math.round(tier.terrainRadius * (0.75 + science * 0.25)))
    });
  }

  diagnostics() {
    const tier = QUALITY_TIERS[this.tierIndex];
    return Object.freeze({
      targetFps: this.targetFps,
      targetFrameMs: this.targetFrameMs,
      averageFrameMs: this.emaFrameMs,
      visualLod: tier.name,
      quality: tier.quality,
      lastReason: this.lastReason
    });
  }
}

export { QUALITY_TIERS };
