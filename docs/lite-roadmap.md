# Earth 777 Lite roadmap

This roadmap is the canonical development order for Earth 777 Lite. Performance is part of correctness: a feature that exceeds the accepted regression budget fails even if it otherwise works.

## 1. Acceptance harness — complete

The 22 canonical pass/fail criteria are versioned in `test/lite-acceptance-spec.mjs`, with automated CI proxies plus a full representative-hardware profile.

## 2. Performance baseline #1 — tooling complete, representative measurement pending

The baseline recorder and baseline-aware acceptance runner are merged. The numerical baseline still must come from a full acceptance run on representative desktop hardware; CI SwiftShader measurements are not a substitute.

The baseline captures average FPS, 1% low FPS, cached load time, 20-minute soak behavior, and 100x/1000x responsiveness. Future full acceptance runs compare against it and fail when average FPS or 1% low regress by more than 10% without explicit approval.

## 3. Living Terrain v1 — implementation complete

ETOPO remains immutable `baseElevation`. Lite now adds a deterministic, bounded, model-derived `terrainDelta` field so rendered elevation is `baseElevation + terrainDelta`.

The v1 field combines spatially coherent uplift, weathering, baseline-drainage river incision, low-gradient deposition, and long-period relief pulses. It is calculated in the simulation worker as a deterministic function of seed and elapsed simulated time, preserving reloadable geography without replaying every intermediate geological step.

Gate status: automated model tests and browser CI can verify determinism, continued updates, finite state, and responsiveness. Canonical performance and the manual visual/coherence checks remain pending the representative baseline run.

## 4. Dynamic hydrology — implementation complete

Drainage is recomputed against evolved elevation in the worker. Flow direction, accumulation, lake/sink cells, surface river lines, and coastline state therefore respond to topographic change. Hydrology is intentionally updated less often than climate to keep the main thread cheap.

## 5. Climate and biome response — implementation complete

Evolved elevation now feeds temperature lapse-rate and moisture/orographic response. Dynamic drainage adds lowland/river moisture feedback. Vegetation and ice continue to respond continuously, and a deterministic biome classifier converts those environmental constraints into ocean, ice, tundra, desert, grassland, shrubland, temperate forest, rainforest, boreal forest, and alpine states.

The PLANTS layer now visualizes the biome state rather than simply cycling decorative colors.

## 6. Ecology — implementation complete

Lite now derives a bounded fauna-density field from vegetation productivity, moisture, freezing stress, temperature, biome state, spatial habitat heterogeneity, and slow population pulses. Surface mode materializes only a small deterministic sample of organisms near the camera, keeping global ecology cheap.

This ecology is a model-derived occupancy/population proxy, not a claim to reconstruct exact species distributions at 777 ka.

## Acceptance status

Implementation through ecology is complete, but that is not the same as canonical acceptance. Before calling these phases fully accepted, run the full representative-hardware profile, record baseline #1, enforce the <=10% regression budget, and complete the visual checks for readable topography, coherent change, seams, LOD behavior, and overall lo-fi character.

If a richer model breaks Lite performance, simplify the model rather than relaxing the baseline unless the tradeoff is explicitly approved.
