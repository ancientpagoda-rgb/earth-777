# Earth 777 Lite living-world runtime

Earth 777 Lite keeps the 777 ka scientific checkpoint separate from its forward-running Free Earth dynamics. The ETOPO 2022 bedrock grid is the immutable physical relief baseline. Everything described here that changes that relief after the checkpoint is explicitly **model derived**.

## Living Terrain v1

The browser keeps the high-resolution ETOPO surface for local shape and adds a coarse 256 × 128 `terrainDelta` field calculated off the render thread. `terrainDelta` is deterministic from the branch seed and elapsed simulated time, so the same seed and time reproduce the same large-scale evolved relief without replaying every intermediate frame.

The bounded v1 model combines broad coherent uplift/subsidence, relief-sensitive weathering, baseline-drainage incision, low-gradient deposition, and long-period relief pulses. The field is deliberately bounded to protect recognizable geography and avoid the noisy or runaway behavior that would violate the Lite acceptance criteria.

## Dynamic hydrology

The worker periodically rebuilds eight-neighbor drainage from `baseElevation + terrainDelta`. It derives flow direction, upstream accumulation, sinks/lakes, and river-cell diagnostics from the evolved surface. The renderer consumes those dynamic arrays for river lines and water coloring, so drainage changes are consequences of topography rather than animation pasted over a static map.

Hydrology updates are temporally decimated relative to climate updates. This is an intentional Lite level-of-detail decision: rivers need to react to geological change, but they do not need to be re-sorted every render frame.

## Climate and biome response

Temperature uses evolved elevation in its lapse-rate term. Moisture uses evolved elevation for orographic drying and dynamic drainage for river/lowland moisture feedback. Ice and vegetation continue to relax toward the resulting environmental state.

A compact biome classifier then maps temperature, moisture, freezing, elevation, sea level, and vegetation constraints into ten broad states. These categories are runtime diagnostics and visual/ecological drivers, not a replacement for the published BIOME4 checkpoint layer used by the full scholarly model.

## Ecology

The Lite ecology layer is a bounded fauna-density proxy, not a species-level reconstruction. Habitat capacity comes from vegetation, moisture, freezing stress, temperature, and biome state; deterministic broad spatial variation and slow herbivore/predator-style pulses prevent the world from looking static without requiring expensive individual-based simulation everywhere.

Only a small sample of organisms is materialized as surface instances near the camera. Unobserved ecology stays as a compact field, preserving the Lite performance contract.

## Instrumentation

The page exposes diagnostic counters on `document.body.dataset` for terrain, hydrology, biome, and ecology versions, terrain-change magnitude, drainage changes, fauna density, and materialized surface organisms. These are intended for the acceptance harness and regression debugging rather than gameplay UI.

The model is not canonically accepted until the full representative-hardware acceptance profile confirms the 55 FPS average / 30 FPS 1% low targets, 20-minute stability, and <=10% regression budget, and the remaining visual criteria are reviewed manually.
