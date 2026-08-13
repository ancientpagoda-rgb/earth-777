import { createFidelityPlan } from "./fidelity-policy.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const clamp01 = (value) => clamp(value, 0, 1);

const TIER_TEMPORAL_SUBSTEPS = Object.freeze({
  high: 4,
  medium: 2,
  background: 1
});

const TIER_SPATIAL_DETAIL = Object.freeze({
  high: 1,
  medium: 0.65,
  background: 0.35
});

const RUNTIME_BOUND_SYSTEMS = new Set([
  "carbon",
  "climate",
  "ice",
  "seaLevel",
  "herbivores",
  "carnivores",
  "hominins",
  "magnetism"
]);

function normalizeObserverRelevance(observerRelevance = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(observerRelevance).map(([id, value]) => [id, clamp01(value)])
  ));
}

export const ADAPTIVE_RUNTIME_POLICY = "consequence-weighted-fidelity-runtime-v1";

export class AdaptiveFidelityController {
  constructor({ budget = 1, observerRelevance = {}, refreshYears = 250 } = {}) {
    this.budget = Math.max(0, Number(budget) || 0);
    this.observerRelevance = normalizeObserverRelevance(observerRelevance);
    this.refreshYears = Math.max(25, Number(refreshYears) || 250);
    this.reset();
  }

  reset() {
    this.lastPlan = null;
    this.lastPlanElapsedYears = -Infinity;
    this.executedSubsteps = Object.create(null);
    return this;
  }

  setBudget(budget) {
    this.budget = Math.max(0, Number(budget) || 0);
    this.lastPlan = null;
    this.lastPlanElapsedYears = -Infinity;
    return this;
  }

  setObserverRelevance(observerRelevance = {}) {
    this.observerRelevance = normalizeObserverRelevance(observerRelevance);
    this.lastPlan = null;
    this.lastPlanElapsedYears = -Infinity;
    return this;
  }

  update(state = {}) {
    const elapsedYears = Number(state.elapsedYears) || 0;
    if (
      this.lastPlan &&
      Math.abs(elapsedYears - this.lastPlanElapsedYears) < this.refreshYears
    ) {
      return this.lastPlan;
    }

    const plan = createFidelityPlan(state, {
      budget: this.budget,
      observerRelevance: this.observerRelevance
    });
    const budgetScale = clamp(this.budget, 0.25, 3);
    const targets = plan.targets.map((target) => {
      const baseSubsteps = TIER_TEMPORAL_SUBSTEPS[target.tier] ?? 1;
      const temporalSubsteps = Math.max(1, Math.min(12, Math.round(baseSubsteps * budgetScale)));
      const spatialDetail = clamp01(
        (TIER_SPATIAL_DETAIL[target.tier] ?? 0.35) * Math.min(1.25, Math.sqrt(budgetScale))
      );
      return Object.freeze({
        ...target,
        temporalSubsteps,
        spatialDetail,
        runtimeBound: RUNTIME_BOUND_SYSTEMS.has(target.id)
      });
    });

    this.lastPlan = Object.freeze({
      ...plan,
      runtimePolicy: ADAPTIVE_RUNTIME_POLICY,
      runtimeEpistemicStatus: "compute-allocation policy; not a scientific measurement",
      refreshYears: this.refreshYears,
      targets: Object.freeze(targets)
    });
    this.lastPlanElapsedYears = elapsedYears;
    return this.lastPlan;
  }

  decisionFor(id) {
    return this.lastPlan?.targets.find((target) => target.id === id) ?? null;
  }

  recordExecution(id, substeps = 1) {
    const count = Math.max(0, Math.floor(Number(substeps) || 0));
    this.executedSubsteps[id] = (this.executedSubsteps[id] || 0) + count;
  }

  execute(id, dt, updater) {
    if (typeof updater !== "function") throw new TypeError("Adaptive fidelity updater must be a function.");
    const decision = this.decisionFor(id);
    const substeps = decision?.runtimeBound ? decision.temporalSubsteps : 1;
    const subDt = dt / substeps;
    for (let index = 0; index < substeps; index += 1) updater(subDt, index, substeps);
    this.recordExecution(id, substeps);
    return substeps;
  }

  diagnostics() {
    return Object.freeze({
      policy: ADAPTIVE_RUNTIME_POLICY,
      budget: this.budget,
      observerRelevance: this.observerRelevance,
      refreshYears: this.refreshYears,
      lastPlanElapsedYears: Number.isFinite(this.lastPlanElapsedYears) ? this.lastPlanElapsedYears : null,
      targets: this.lastPlan?.targets ?? Object.freeze([]),
      executedSubsteps: Object.freeze({ ...this.executedSubsteps })
    });
  }
}
