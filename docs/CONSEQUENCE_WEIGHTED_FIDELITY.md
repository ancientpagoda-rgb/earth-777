# Consequence-Weighted Fidelity

Earth 777 uses **Consequence-Weighted Fidelity (CWF)** as a simulation policy for deciding where additional compute, data quality, solver detail, and validation effort are most valuable.

The policy is intentionally separate from scientific provenance. A CWF score is **not** a measured physical quantity and must never be displayed as if it were one.

## Principle

> Spend computation and scientific effort in proportion to causal importance.

The initial policy score is:

```text
priority = causal influence
         × downstream sensitivity
         × uncertainty
         × systems affected
         × current relevance
         ÷ computational cost
```

This is a scheduling heuristic, not a law of nature. Its role is to make approximation explicit and adaptive rather than uniform and accidental.

## Runtime use

The simulator can use CWF allocation to decide which systems deserve:

- smaller time steps;
- higher spatial resolution;
- more expensive solvers;
- more ensemble members;
- richer individual materialization;
- more frequent updates;
- tighter numerical tolerances;
- more detailed rendering only when rendering corresponds to simulated state.

Low-priority systems remain causal, but can be represented with coarser models until their downstream consequences become important.

## Scientific-development use

The same policy can rank research work. A variable with large propagated uncertainty and broad downstream reach can be more valuable to improve than a visually prominent but causally isolated subsystem.

The companion causal graph estimates **research leverage** by reducing a node's local uncertainty by 35%, rerunning uncertainty propagation, and measuring how much uncertainty is removed from other nodes. The target node's own reduction is excluded from leverage.

## Current implementation

- `src/sim/CausalDependencyGraph.js` represents feedback-capable causal networks and propagates bounded uncertainty to a fixed point.
- `src/sim/ConsequenceWeightedFidelity.js` scores and allocates fidelity budget.
- `src/sim/fidelity-policy.js` maps the current Earth 777 phase-one state into the policy.
- `test/fidelity.test.js` checks convergence, boundedness, intervention behavior, ranking, and deterministic allocation.

The initial edge strengths, sensitivities, compute costs, and non-source-derived uncertainty priors are **policy metadata**. They are deliberately labeled as such and should eventually be calibrated by perturbing real subsystem solvers and measuring response.
