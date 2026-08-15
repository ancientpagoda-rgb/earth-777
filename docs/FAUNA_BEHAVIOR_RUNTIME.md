# Fauna movement and behavior runtime

Earth 777 now advances fauna behavior in **simulated time**, not as an unrelated wall-clock animation.

## Representation hierarchy

- regional cells retain population density and predator/prey pressure;
- local cells retain herd/pack counts plus a modeled migration bearing;
- observed cells deterministically decompose those aggregates into herds, packs, and nearby individuals;
- only animals within the configured individual radius become individual Three.js instances.

There is no entity-count cutoff in the fauna model. Detail is gated spatially by observation.

## Behavior

`FaunaBehaviorDynamics` assigns provisional functional behavior from modeled forage, water access, predator/prey pressure, prior energy/stress, deterministic identity, and simulated time.

Herbivore states currently include:

- graze;
- drink;
- travel;
- flee;
- rest.

Carnivore states currently include:

- hunt;
- stalk;
- travel;
- rest.

Herd and pack centroids shift with simulated seasonal time. Materialized individuals move around those centroids according to their current behavior.

## Collapse and re-materialization

Before an observed fauna plan is replaced because the camera moves, time advances, or the surface context changes, the individual/group behavior state is reduced to a compact aggregate prior containing:

- mean energy;
- mean stress;
- behavior-weighted population counts;
- represented population;
- simulated time.

That prior is stored by deterministic seed and 0.1-degree observed cell. Re-entering the same area on the same Free Earth branch uses the aggregate prior when materializing fauna again. A new branch seed clears the runtime aggregate memory.

This is the first persistence bridge between individual observed behavior and aggregate unobserved state. It deliberately does **not** serialize every animal.

## Scientific boundary

The movement and behavior rules are provisional functional models. Fauna abundance is still model-derived and has not yet been calibrated to Neotoma/Paleobiology Database occurrence envelopes. The behavior layer is therefore a runtime/scaling mechanism and hypothesis-bearing model, not direct paleontological evidence.
