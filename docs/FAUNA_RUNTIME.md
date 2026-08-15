# Fauna runtime

Earth 777 uses one simple fauna rule:

**far away = population summaries; nearby = herds/packs; very nearby = individuals.**

This preserves large populations without keeping every animal materialized at once.

## One runtime

`src/sim/FaunaRuntime.js` owns the complete provisional fauna model:

- population density from global biomass plus local productivity/water;
- one compact summary per active regional/local cell;
- deterministic herd/pack grouping;
- simple group-level behavior and motion from simulated time;
- individual materialization only inside the observer radius.

There is no separate behavior state machine or collapse/reconstruction memory. A seed, location, environmental state, and simulated time deterministically recreate the same fauna representation.

`SurfaceFaunaManager` only turns that runtime state into paged Three.js instances. Paged pools grow as needed, so there is no fixed animal display count.

## Scheduler

Fauna registers as one `surface-fauna` producer with `WorldStreamScheduler`. The scheduler no longer treats regional fields, local herds, and observed individuals as separate systems.

The runtime receives the currently active cells and derives the appropriate representation itself.

## Ecology separation

`SurfaceEcologyManager` no longer creates a second hidden animal scatter. It is responsible for vegetation, rocks, rivers, hominins, and shelters; fauna has a single rendering path.

## Scientific boundary

Current abundance and behavior remain provisional functional models. They are not yet calibrated to Neotoma or Paleobiology Database occurrence envelopes.

The intended future work is to improve the evidence behind the same simple runtime, not add more runtime layers.
