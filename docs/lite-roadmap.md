# Earth 777 Lite roadmap

This roadmap is the canonical development order for Earth 777 Lite. Performance is part of correctness: a feature that exceeds the accepted regression budget fails even if it otherwise works.

## 1. Acceptance harness — complete

The 22 canonical pass/fail criteria are versioned in `test/lite-acceptance-spec.mjs`, with automated CI proxies plus a full representative-hardware profile.

## 2. Performance baseline #1 — current phase

Record the current known-good Lite build on representative desktop hardware before adding terrain complexity. The baseline must come from a full acceptance run; CI SwiftShader measurements are not a substitute.

The baseline captures average FPS, 1% low FPS, cached load time, 20-minute soak behavior, and 100x/1000x responsiveness. Future full acceptance runs compare against it and fail when average FPS or 1% low regress by more than 10% without explicit approval.

## 3. Living Terrain v1

Keep ETOPO as immutable `baseElevation` and add a deterministic `terrainDelta` field. Evolved elevation becomes `baseElevation + terrainDelta`.

The first terrain model includes bounded uplift, weathering, erosion, river incision, sediment transport/deposition, and coastline response. Evolution runs off the render thread and uses spatial/temporal level of detail so nearby observed terrain gets finer updates while distant or unobserved terrain advances cheaply.

Gate: 30+ consecutive evolution cycles, coherent visible topographic change, deterministic replay, persistent geography, and less than 10% performance regression from baseline #1.

## 4. Dynamic hydrology

Recompute drainage against evolved elevation so watersheds, channels, lakes, sediment pathways, and coastlines respond to terrain change. River migration must emerge from changing topography rather than decorative animation.

## 5. Climate and biome response

Couple terrain and hydrology back into temperature, precipitation, moisture, ice, and vegetation using bounded low-cost responses. Biomes should shift because environmental constraints changed, not because of arbitrary visual cycling.

## 6. Ecology

Add persistent ecological populations and local materialized organisms only after terrain, water, climate, and biome layers remain stable under the Lite performance contract.

Every phase is tested against the canonical acceptance harness before merge. If a richer model breaks Lite performance, simplify the model rather than relaxing the baseline unless the tradeoff is explicitly approved.
