# Fauna runtime

Earth 777 uses one simple fauna rule:

**far away = population summaries; nearby = herds/packs; very nearby = individuals.**

This preserves large populations without keeping every animal materialized at once.

## One runtime

`src/sim/FaunaRuntime.js` owns the provisional fauna model:

- population density from global biomass plus local productivity/water;
- compact regional/local summaries around the observer;
- deterministic herd/pack grouping;
- simple group-level behavior and motion from simulated time;
- individual materialization only inside the observer radius.

There is no separate behavior state machine or collapse/reconstruction memory. Seed, location, environmental state, and simulated time recreate the same fauna representation.

`SurfaceFaunaManager` only turns that runtime state into paged Three.js instances. Paged pools grow as needed, so there is no fixed animal display count.

Final predator/prey envelope overlap also produces a bounded, deterministic **encounter-to-ecology proposal**. It combines multiple packs contacting the same herd without counting that herd twice and exposes only dimensionless contact pressure. The proposal is explicitly diagnostic: it does not remove local animals, mutate aggregate biomass, or let an observer's camera alter global history. A future aggregate-ecology owner may consume an equivalent spatially scheduled forcing independently of observation.

The aggregate ecology owner also retains a bounded, short-lived **predation exposure index** from prior aggregate pressure. Demand-driven fauna may read that index when deriving current herd threat, but observed groups cannot write it. This is provisional aggregate ecological persistence, not organism memory, and it has no spatial or camera-dependent encounter history.

## Surface work

The surface now uses a small direct work loop shared by terrain, environment, and fauna. Each producer receives part of the current frame budget, and the starting producer rotates each frame so one busy queue cannot permanently starve the others.

Only the regional and local fauna grids that are actually consumed are generated around the camera. There is no generic runtime registration framework or unused global/observed cell layer.

## Ecology separation

`SurfaceEcologyManager` handles vegetation, rocks, and rivers. Fauna has one rendering path. Hominins and built-environment presentation remain outside the surface stack until their dedicated evidence phase.

## Emergent category direction

The current runtime still uses provisional labels such as herbivore/carnivore, herd/pack, hunt, flee, graze, drink, and rest as causal shortcuts. These are scaffolding, not the intended final ontology.

Future higher-fidelity work should increasingly derive those labels from continuous feeding ecology, traits, needs, perception, geometry, resource acquisition, and physical interaction. Labels may remain for UI, diagnostics, testing, and coarse summaries, but should become descriptive rather than prescriptive.

See [`EMERGENT_CATEGORIES.md`](./EMERGENT_CATEGORIES.md) for the project rule and migration direction.

## Scientific boundary

Current abundance and behavior remain provisional functional models. They are not yet calibrated to Neotoma or Paleobiology Database occurrence envelopes.

Future work should improve the evidence behind this same simple runtime rather than add more runtime layers.
