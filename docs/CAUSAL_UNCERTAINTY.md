# Causal Dependency and Uncertainty Propagation

Earth 777 separates **local uncertainty** from **propagated uncertainty**.

- **Local uncertainty** belongs to a subsystem's own evidence/model state.
- **Propagated uncertainty** is imported from upstream systems through causal dependencies.
- **Total uncertainty** is bounded to `[0, 1]` and combines both without double-counting local uncertainty as a simple additive percentage.

## Why a feedback graph

The Earth system is not a directed acyclic graph. Climate affects ice; ice affects climate. Vegetation affects carbon; carbon affects vegetation. The implementation therefore supports feedback loops and solves uncertainty iteratively to a bounded fixed point.

For a node with local uncertainty `L` and imported uncertainty `I`, the current policy combines them as:

```text
T = L + (1 - L) × I × damping
```

Incoming edge contributions are combined probabilistically:

```text
I = 1 - Π(1 - source_total × edge_strength)
```

The default damping is `0.72`. This is policy metadata chosen for stable bounded propagation, not a scientific constant.

## Research leverage

For each node, Earth 777 can perform a counterfactual intervention:

1. compute baseline propagated uncertainty;
2. reduce that node's local uncertainty by 35%;
3. solve the graph again;
4. sum the reduction in all *other* nodes.

The result is a research-leverage estimate: how much downstream uncertainty could plausibly be removed by improving that subsystem under the current graph assumptions.

## Calibration roadmap

The graph should become increasingly empirical. For each real subsystem solver:

1. perturb an input within its uncertainty range;
2. run a deterministic ensemble;
3. measure the response of downstream state variables;
4. estimate local sensitivities and response times;
5. replace hand-set edge strengths with measured response coefficients;
6. retain provenance for every calibrated coefficient.

This lets the graph evolve from a transparent scheduling prior into a measured approximation of actual simulator coupling while preserving the distinction between scientific evidence and runtime policy.
