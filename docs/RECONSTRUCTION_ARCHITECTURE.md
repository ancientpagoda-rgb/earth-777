# Earth 777 reconstruction-first architecture

Earth 777's primary scientific product is a high-resolution, uncertainty-aware reconstruction of Earth near **777,000 years BP**. The core objective is no longer to spend equal fidelity simulating every year from 777 ka to the present. Long-timescale alternate histories remain possible as an experimental branch, but they do not determine the resolution of the canonical 777 ka world.

## Constraint directions

Each reconstructed field may draw from four evidence directions:

1. **Modern Earth anchor → backward hindcast**
   - high-resolution modern DEM/bathymetry, drainage, geology, soils, climate normals, coast geometry, ecological structure and other present-day observations;
   - these data do not become 777 ka values directly;
   - an explicit physical/process transform must convert the modern anchor into a target-epoch estimate.

2. **Historical observations → process calibration**
   - instrumental climate records, repeated surveys, old maps, shoreline and channel migration, glacier change, sedimentation/erosion observations, vegetation recovery, ecological range change and other time series;
   - these primarily calibrate rates, sensitivities, response times and stochastic structure;
   - recent trends must not be linearly multiplied across 777 kyr.

3. **Paleo evidence → target-epoch constraints**
   - dated climate reconstructions, marine/lake sediments, pollen, fossils, isotopes, speleothems, loess, terraces, paleomagnetism, archaeological evidence, paleoshorelines and other proxy observations;
   - observations close to 777 ka may directly constrain the target epoch with explicit uncertainty.

4. **Physics/model completion → unresolved detail**
   - where neither modern hindcasts nor paleo observations determine the value, physically plausible models complete the field;
   - model-completed detail remains explicitly lower-confidence and must never masquerade as observed fact.

## Common field contract

Every reconstructed scalar should be able to expose:

- `value`
- `sigma`
- `lower95` / `upper95`
- `confidence`
- target epoch
- contributing estimates
- source IDs
- reconstruction method
- historical calibration evidence
- provenance stream

The first implementation is `src/reconstruction/ReconstructionAssimilation.js`.

## Example: terrain

A future high-resolution terrain cell should conceptually be solved as:

```text
modern DEM/bathymetry
+ tectonic/uplift hindcast
+ erosion/deposition hindcast
+ glacial/isostatic correction
+ paleo shoreline/terrace/elevation constraints
+ uncertainty-aware assimilation
= reconstructed 777 ka terrain
```

The modern DEM is an anchor, not a claim that modern topography existed unchanged at 777 ka.

## Example: climate

```text
modern high-resolution spatial structure
+ historical process calibration
+ orbital/greenhouse/ice/sea-surface boundary conditions
+ published 777 ka climate reconstruction
+ physical downscaling / data assimilation
= high-resolution 777 ka atmosphere and surface climate
```

Published Krapp 777 ka fields remain authoritative constraints where available; modern data can add spatial detail only through an explicit transformation that remains consistent with those constraints.

## Canonical versus experimental time

### Canonical Earth 777

- centered on 777 ka;
- highest spatial and process fidelity;
- intended for local descent, weather, hydrology, ecology, fauna and hominin experience;
- time advances over days, seasons, years and potentially centuries without sacrificing the reconstruction baseline.

### Experimental long-timescale branch

- retains deterministic future/alternate-Earth evolution work;
- may use coarser temporal/spatial fidelity far from 777 ka;
- civilization and technological emergence live here unless/until a later project specifically targets another high-resolution epoch;
- never rewrites the canonical 777 ka evidence layer.

## Non-negotiable epistemic rules

- No named geographic outcome hacks.
- No linear deep-time projection of short historical trends.
- No hidden observational attractor after the canonical reconstruction is initialized.
- Modern data must be transformed before being treated as paleo state.
- Historical data calibrates processes unless a process model explicitly transforms it to a target-epoch estimate.
- Model completion is allowed but labeled.
- Uncertainty and provenance travel with reconstructed values.
- Higher visual resolution must not imply higher scientific certainty.
