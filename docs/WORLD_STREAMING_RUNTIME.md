# World streaming and runtime scheduling

Earth 777 cannot scale by keeping every future organism, terrain patch, settlement, and physical subsystem materialized at maximum fidelity everywhere. The runtime therefore treats **existence** and **active representation** as different things.

## Policy

`WorldStreamScheduler` is the first shared runtime layer for bounded spatial activation and per-frame work allocation.

The scheduler maintains four nested scopes around the observer:

| Scope | Cell size | Active neighborhood | Intended use |
| --- | ---: | ---: | --- |
| `global` | whole Earth | 1 | planetary aggregates and forcing |
| `regional` | 10° | up to 3×3 | climate/ecosystem population fields |
| `local` | 1° | up to 3×3 | watersheds, migration, landscape processes |
| `observed` | 0.1° | up to 3×3 | materialized terrain, organisms, structures |

Moving from globe → descent → surface activates progressively finer scopes. Cells outside the active hierarchy are not required to stay materialized. Their persistent consequences should be represented by aggregate state, checkpoint data, deterministic seeds, and causal summaries.

This is **not a population cap** and it is not a claim that unobserved entities cease to exist. It is a compute-allocation policy.

## Work scheduling

Runtime systems register:

- an ID;
- the finest spatial scope they require;
- a priority;
- an optional minimum update interval;
- an optional maximum time slice;
- a `hasWork` predicate;
- a bounded synchronous `run` function.

Each pump receives a real-time budget. Due systems compete for that budget. Higher-priority work runs first, while a starvation boost prevents repeatedly deferred work from being permanently excluded. Expensive work is therefore degraded in **update frequency or spatial activation**, rather than by inventing an arbitrary entity-count limit.

## Current integration

`SurfaceTerrainSystem` now uses the shared scheduler for two live producers:

1. terrain chunk generation;
2. surface ecology generation.

Previously those systems received a fixed 62/38 split of every surface-frame streaming budget. They now share one budget dynamically. If terrain has no queued work, ecology can use the remaining budget; if terrain construction consumes the frame budget, deferred ecology work receives increasing scheduling pressure on subsequent pumps.

The scheduler focus follows the surface camera geographically. Its diagnostics are exposed under:

```js
earthView.diagnostics().terrain.worldStreaming
```

through the existing terrain diagnostics chain.

## Next integrations

The scheduler is intentionally generic so later phases can register without changing the policy:

- regional fauna population fields;
- herd materialization in local cells;
- individual animals in observed cells;
- hominin groups and settlements;
- fire/flood/event refinement;
- high-resolution hydrology or atmospheric patches;
- background persistence/serialization work.

The existing `AdaptiveFidelityController` remains responsible for consequence-weighted temporal substeps inside the global Free Earth model. `WorldStreamScheduler` complements it by controlling **where** detailed work is active and **when** runtime producers receive frame budget.

Together the intended hierarchy is:

```text
global aggregate state
        ↓ observation / consequence
regional population and process fields
        ↓
local landscape and group state
        ↓
observed individual/materialized state
```

The target invariant is: **everything can remain causally represented without everything being fully materialized at once.**
