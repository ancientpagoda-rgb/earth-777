# Adaptive CWF Runtime

Earth 777 uses Consequence-Weighted Fidelity (CWF) to decide where additional numerical work is most valuable. The runtime controller is a simulation-policy layer, not a scientific observation or reconstructed field.

## Current runtime binding

The phase-one Free Earth engine advances in deterministic 25-year outer steps. CWF now assigns each modeled subsystem a fidelity tier and a bounded temporal refinement count:

- high consequence: more internal substeps;
- medium consequence: moderate internal refinement;
- background consequence: at least one update per outer step.

No subsystem is dropped solely because it receives a low CWF rank. Carbon, climate, ice, branched sea level, herbivores, carnivores, hominins, and magnetic-field evolution are currently bound to the runtime controller. Orbital forcing remains directly evaluated every outer step because it is cheap and externally constrained. Vegetation productivity is currently an algebraic state update, so repeating it within the same outer step would add cost without adding numerical information.

Hydrology remains a causal-policy node but does not yet have a dedicated dynamical solver in v0.2. The controller therefore reports a hydrology allocation without pretending that a hydrology solver already exists.

## Spatial fidelity

Each CWF target also receives a bounded `spatialDetail` policy signal. The current v0.2 engine does not yet have a true gridded climate/topography solver, so this signal is intentionally not used to fabricate extra spatial detail. It is reserved for the ETOPO 2022 and Krapp gridded-data phases, where it can control tile resolution, active-region density, interpolation detail, and update frequency.

## Determinism and random streams

Adaptive refinement can change the numerical approximation of a stochastic process, so Earth 777 isolates stochastic streams by purpose. Carbon variability and exogenous event sampling use separate deterministic random streams derived from the branch seed. Changing temporal refinement therefore does not reshuffle the event sequence merely because one subsystem consumed more random numbers.

For a fixed seed and runtime policy, replay remains deterministic. Seeking backward resets both the simulation state and the fidelity controller before reconstructing the requested time.

## Runtime controls

`FreeEarthEngine` accepts optional runtime settings:

```js
const earth = new FreeEarthEngine(777001, {
  fidelityBudget: 1,
  observerRelevance: { climate: 1, hominins: 0.8 },
  fidelityRefreshYears: 250
});
```

The engine also exposes:

```js
earth.setFidelityBudget(1.5);
earth.setObserverRelevance({ climate: 1, ice: 0.9 });
earth.fidelityDiagnostics();
```

`fidelityDiagnostics()` reports the current policy targets, temporal substeps, future-facing spatial-detail signal, and actual executed substep counts.

## Epistemic status

CWF rankings, causal edge strengths, compute costs, temporal refinement counts, and spatial-detail values are **simulation policy metadata; not scientific measurements**. Scientific state variables retain their existing source classifications (`study constrained`, `model derived`, or `provisional prior`).
