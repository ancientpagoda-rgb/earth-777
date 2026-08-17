const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class InteractionQualityController {
  constructor({
    initialCap = 0.72,
    minCap = 0.55,
    maxCap = 1,
    slowFrameMs = 22,
    fastFrameMs = 18.2,
    downStep = 0.08,
    upStep = 0.04,
    slowBudgetMs = 120,
    fastBudgetMs = 500,
    adjustmentCooldownMs = 300
  } = {}) {
    this.minCap = clamp(Number(minCap) || 0.55, 0.35, 1);
    this.maxCap = clamp(Number(maxCap) || 1, this.minCap, 1);
    this.learnedCap = clamp(Number(initialCap) || 0.72, this.minCap, this.maxCap);
    this.slowFrameMs = Math.max(16.8, Number(slowFrameMs) || 22);
    this.fastFrameMs = clamp(Number(fastFrameMs) || 18.2, 8, this.slowFrameMs - 0.5);
    this.downStep = clamp(Number(downStep) || 0.08, 0.01, 0.25);
    this.upStep = clamp(Number(upStep) || 0.04, 0.01, 0.2);
    this.slowBudgetTargetMs = Math.max(50, Number(slowBudgetMs) || 120);
    this.fastBudgetTargetMs = Math.max(150, Number(fastBudgetMs) || 500);
    this.adjustmentCooldownMs = Math.max(100, Number(adjustmentCooldownMs) || 300);
    this.emaFrameMs = 16.7;
    this.slowBudget = 0;
    this.fastBudget = 0;
    this.lastAdjustmentMs = -Infinity;
    this.active = false;
    this.lastReason = "initial";
  }

  ratio(restingRatio = 1) {
    return Math.min(clamp(Number(restingRatio) || 1, 0.1, 2), this.learnedCap);
  }

  begin(restingRatio = 1) {
    this.active = true;
    return this.ratio(restingRatio);
  }

  end() {
    this.active = false;
  }

  sample(frameMs, now = performance.now(), restingRatio = 1) {
    if (!this.active) return null;
    const frame = clamp(Number(frameMs) || 16.7, 4, 100);
    this.emaFrameMs += (frame - this.emaFrameMs) * 0.18;

    if (this.emaFrameMs > this.slowFrameMs) {
      this.slowBudget += frame;
      this.fastBudget = Math.max(0, this.fastBudget - frame * 2);
    } else if (this.emaFrameMs < this.fastFrameMs) {
      this.fastBudget += frame;
      this.slowBudget = Math.max(0, this.slowBudget - frame * 2);
    } else {
      this.slowBudget = Math.max(0, this.slowBudget - frame);
      this.fastBudget = Math.max(0, this.fastBudget - frame);
    }

    if (now - this.lastAdjustmentMs < this.adjustmentCooldownMs) return null;

    if (this.slowBudget >= this.slowBudgetTargetMs && this.learnedCap > this.minCap) {
      const previous = this.learnedCap;
      this.learnedCap = Math.max(this.minCap, this.learnedCap - this.downStep);
      this.lastAdjustmentMs = now;
      this.slowBudget = 0;
      this.fastBudget = 0;
      this.lastReason = `frame pressure ${this.emaFrameMs.toFixed(1)} ms`;
      const next = this.ratio(restingRatio);
      return next < Math.min(restingRatio, previous) - 0.005 ? next : null;
    }

    if (this.fastBudget >= this.fastBudgetTargetMs && this.learnedCap < this.maxCap) {
      const previousRatio = this.ratio(restingRatio);
      this.learnedCap = Math.min(this.maxCap, this.learnedCap + this.upStep);
      this.lastAdjustmentMs = now;
      this.slowBudget = 0;
      this.fastBudget = 0;
      this.lastReason = `headroom ${this.emaFrameMs.toFixed(1)} ms`;
      const next = this.ratio(restingRatio);
      return next > previousRatio + 0.005 ? next : null;
    }

    return null;
  }

  diagnostics(restingRatio = 1) {
    return Object.freeze({
      active: this.active,
      learnedCap: this.learnedCap,
      effectiveRatio: this.ratio(restingRatio),
      averageFrameMs: this.emaFrameMs,
      lastReason: this.lastReason
    });
  }
}
