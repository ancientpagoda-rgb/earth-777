# Earth 777

Earth 777 is a scholarly grounded **Free Earth** simulation beginning at a canonical checkpoint 777,000 years before present, near the close of Marine Isotope Stage 19c.

It is not an exact replay of history. It creates deterministic, physically bounded alternate Earth trajectories from a checkpoint constrained by published paleoclimate research. Every field is classified as:

- **study constrained** — directly reported by a source;
- **model derived** — calculated from a published model or reconstruction;
- **provisional prior** — a transparent placeholder with uncertainty, scheduled for replacement by direct data ingestion.

## Current milestone

Version 0.2 establishes:

- the immutable 777 ka checkpoint and its provenance contract;
- published MIS 19 orbital and greenhouse-gas boundary values;
- 778 checksum-verified La2004 orbital records at 1 kyr spacing;
- 778 Spratt–Lisiecki sea-level records with 1σ and 95% uncertainty;
- a checksum-pinned NOAA ETOPO 2022 Bedrock layer compacted to a 360 × 720 half-degree global grid;
- coastlines and ocean depth rendered from ETOPO bedrock against the simulated paleo sea level rather than a decorative land mask;
- the exact published Krapp et al. 777 ka 0.5° monthly temperature, precipitation, and cloud-cover fields, compacted from 36 SHA-256-pinned author NetCDFs into a 3.94 MB browser layer;
- the authors’ published BIOME4 777 ka biome, annual NPP, LAI, and 12 signed monthly NPP fields, compacted from 13 pinned NetCDFs into a 1.14 MB browser layer;
- the official BIOME4 4.1 static 0.5° two-layer water-holding-capacity and percolation fields, preserved as source float32 values in a 138 KB compressed browser layer;
- an independently implemented BIOME4 4.1 PFT climate-eligibility sieve for all 13 PFT parameter records, using source coldest/warmest-month and GDD constraints, the pinned 0.5° static `tmin` driver, and the model-compatible two-year degree-day snow diagnostic;
- opt-in selected-region BIOME4 PFT rooting and source-operational phenology diagnostics plus parallel candidate water trials, source-operational 16-evaluation LAI/NPP optimization, and BIOME4 fire/top-layer-dryness diagnostics for productive climate-eligible PFTs, without altering shared Earth hydrology or categorical biome;
- a closed daily two-layer land-water budget with Priestley–Taylor/FAO radiation PET and an upstream-accumulating ETOPO river-discharge network;
- deterministic Free Earth branches with replayable seeds;
- a guarded phase-one climate, ice, carbon, ecosystem, hominin, and magnetic-field emulator;
- consequence-weighted fidelity that allocates bounded temporal refinement to higher-consequence simulated systems;
- globe-to-region inspection grounded in the published Krapp 777 ka climate where source coverage exists, with later Free Earth temperature divergence explicitly model derived;
- multiscale time controls from 1 to 1,000 simulated years per real second;
- a scientific source ledger visible inside the application;
- automated tests for checkpoint integrity, determinism, backward seeking, physical bounds, adaptive fidelity, terrain ingestion, climate/vegetation assets, water conservation, soil fidelity, and river-network closure.

The canonical orbit comes from the Vavrus et al. CCSM4 experiment. Its values differ slightly from the nominal La2004 row at 777 ka, so the simulator applies La2004 anomalies to that checkpoint and tapers the offset over the paper's 2.3 kyr dating-uncertainty window. After that window, the orbital forcing is the direct La2004 series. Sea level uses the continuous five-record Spratt–Lisiecki stack as a reconstructed reference; Free Earth branches can diverge from it through modeled ice-volume feedback.

The physical relief baseline now comes from NOAA NCEI ETOPO 2022 **Bedrock**. The browser layer is a reproducibly generated half-degree sampling of the official 60-arc-second grid, encoded as integer-meter elevations with the source subset SHA-256 recorded in [`data/terrain-manifest.json`](data/terrain-manifest.json). ETOPO 2022 represents modern bedrock, not a direct reconstruction of 777 ka topography. Earth 777 therefore labels the source as study constrained, the compact preprocessing as model derived, applies simulated paleo sea level separately, and reserves glacial isostasy, sediment/shoreline evolution, and time-varying ice loading for later terrain phases.

The spatial climate checkpoint comes directly from the final published Krapp et al. (2021) 0.5° monthly reconstruction. Earth 777 extracts only the exact −777,000-year time slice from each of the authors’ 36 temperature, precipitation, and cloud-cover NetCDFs, verifies every source SHA-256, masks the CDO missing-data sentinel, and compacts the result into a deterministic 3.94 MB gzip layer. After the checkpoint, a CWF-driven virtual grid produces explicitly model-derived spatial temperature, precipitation, and cloud responses.

Land hydrology now uses the static two-layer soil driver distributed with official BIOME4 4.1. Earth 777 pins the package and `inputdata.nc` hashes, preserves the two water-holding-capacity and two percolation fields as source float32 values, and keeps BIOME4's `-9999` water/missing, `-4` land-ice, and `-1` barren states categorical. BIOME4's source code operationally passes each water-holding-capacity value as a layer capacity in millimetres even though `inputdata.nc` declares `mm/m`; its daily soil routine applies each percolation coefficient as `k × wetness⁴` once per day even though the NetCDF declares `mm/hr`. Earth 777 follows those source-model operational semantics and documents the metadata mismatch rather than silently applying a unit conversion BIOME4 itself does not use. Where BIOME4 has no valid soil profile, Earth 777 keeps the earlier uniform bucket as an explicit fallback rather than fabricating spatial soil.

The soil-aware water solver distributes each monthly Krapp precipitation total uniformly across that month's model days, computes Priestley–Taylor/FAO PET, conserves water into actual evapotranspiration, top/bottom storage, surface runoff and deep drainage, and feeds total runoff to the accumulating ETOPO drainage network. **Deep drainage currently joins routed runoff immediately**; it is not yet a groundwater/baseflow simulation. The river network reports upstream area, discharge, forcing coverage and whole-network closure. Groundwater/baseflow, lakes, snow/glacier melt routing, floodplain/channel storage, channel hydraulics and paleo-isostatic drainage topography remain future work.

The vegetation checkpoint is the authors’ published BIOME4 output at exactly 777 ka: categorical biome, annual NPP, annual LAI, and twelve signed monthly NPP fields. Earth 777 verifies all 13 original OSF files, preserves negative monthly NPP, and compacts the checkpoint to a deterministic 1.14 MB gzip layer. At the checkpoint those values are used directly. After the checkpoint, NPP and LAI respond continuously to the branch water budget and CO₂; the published categorical biome remains authoritative at the checkpoint. Earth 777 now also independently reproduces BIOME4 4.1’s 13-PFT climatic eligibility sieve from the distributed parameter semantics: coldest and warmest monthly temperature, absolute-minimum temperature, GDD0/GDD5, and the snow-depth gate are evaluated with the model’s source boundary conventions and monthly-to-daily interpolation. The official static `tmin` field is checksum-pinned as source int16 and operationally divided by 10 exactly as BIOME4 does; a two-year degree-day snow diagnostic uses the authors’ monthly precipitation convention to resolve the tundra-shrub snow gate. BIOME4 PFT 1 remains disabled as in that distribution. Climate eligibility is only a candidate sieve. Selected regions now also evaluate BIOME4 root-weighted two-layer wetness, maximum daily water-supply capacity and source-operational evergreen/summergreen/raingreen phenology from the conserved 365-day soil trace. Two source quirks are preserved and documented rather than silently corrected: BIOME4 4.1 assigns parameter 4 to both raingreen leaf-off and leaf-on thresholds despite documenting parameter 5 as leaf-on, and its summergreen canopy ramp gates accumulation by 0/5 °C but then adds the full positive daily temperature rather than temperature above the threshold. Selected-region candidate PFT trials now run their own isolated BIOME4-style daily water trajectories: the audited 4.1 `ppeett` equilibrium-demand equations derive atmospheric demand from temperature, cloud and latitude; monthly optimum canopy conductance comes from the independent C3/C4 physiology implementation; source `alpha = 1.4 × (1 − exp(−g/5))` conductance saturation and Emax/root-water supply constrain AET; and the two-year degree-day snow calculation supplies explicit liquid precipitation, melt and snow-storage closure. The audited BIOME4 executable does not consume an external humidity/VPD field in this path and fixes its monthly radiation-anomaly multipliers to 1.0, so Earth 777 does not fabricate such a prerequisite. BIOME4 also assigns but does not use its second percolation coefficient in this hydrology routine; candidate trials therefore use upper-layer `k × wetness⁴` percolation and lower-store overflow drainage exactly as audited. Climate-eligible selected-region PFTs now also run an independent reproduction of BIOME4 4.1 `findnpp`: eight search rounds evaluate two LAIs per round, each LAI reruns two-year PFT-specific hydrology/phenology, conductance-constrained photosynthesis and respiration, and the search retains the source-operational monthly-sum NPP objective. Earth 777 exposes rather than hides source quirks: the executable replaces its annual allocation NPP with the monthly NPP sum, PFT 10's code requires at least three C4-advantage months despite a comment saying two, and woody raingreen first-day `fvc` is undefined in the source so Earth 777 deterministically seeds it leafless. Layer-specific water extraction and upper-layer percolation are capped by available storage to prevent the source's post-subtraction clamps from destroying mass. Optimized productive candidates now also carry the source-operational BIOME4 potential-fire-days diagnostic and competition dryness metrics. Fire is computed from the optimized candidate's daily root-zone wetness with the PFT-specific wetness threshold, including the source's narrow transition discontinuity and post hoc NPP scaling; the separately computed litter/burn metric is retained for provenance but is not treated as a competition input because the audited classifier reads `firedays`. Competition dryness is kept distinct and comes from the optimized candidate's monthly top-layer wetness, including mean and driest-month values. PFT 10 follows the source execution order: fire/dryness uses the second/C3 hydrology rerun even when its final monthly NPP later selects some C4 months. Climate-eligible candidates that remain negative at all 16 tested LAIs are explicitly labeled `nonproductive-no-optimum` and receive no fabricated fire/dryness trajectory. Optimized candidates remain isolated from shared hydrology, but their source-grounded `competition2` selection now feeds an independently reproduced `newassignbiome` category. That category is only the destination of a lagged, model-derived branch succession state; it does not replace the published checkpoint category at 777 ka. Earth 777 still lacks a general atmospheric humidity/VPD field for broader climate/ecophysiology applications, and the pressure supplied to PFT photosynthesis remains the existing model-derived elevation-pressure approximation until the original BIOME4/Krapp pressure preparation is pinned. NPP source files do not declare a units attribute, so the interface reports BIOME4 NPP in source units rather than inventing units.

## Run

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Controls

- Mouse / touchpad: drag to orbit, scroll to zoom, click the globe to inspect a region.
- Keyboard: arrow keys orbit, `+` and `-` zoom, `Enter` selects the center reticle, `F` descends, `Space` plays or pauses, `S` opens sources.
- Gamepad: left stick orbits, right stick or triggers zoom, `A` selects, `X` descends, `Start` plays or pauses, `Y` opens sources, `LB`/`RB` change speed, D-pad left/right scrubs the timeline.

## Test and build

```bash
npm test
npm run build
```

## Rebuild the compact scientific layers

```bash
npm run data:ingest
```

The paleo ingestion path downloads the official forcing sources when absent, rejects checksum changes, parses only 0–777 ka, and writes the compact browser forcing module plus [`data/manifest.json`](data/manifest.json). The terrain ingestion path requests a centered OPeNDAP hyperslab from NOAA's ETOPO 2022 Bedrock grid, rejects source-subset checksum changes, and writes `src/data/generated/etopo-2022.generated.js` plus [`data/terrain-manifest.json`](data/terrain-manifest.json). The climate ingestion path downloads the 36 final Krapp monthly NetCDFs one at a time, verifies pinned SHA-256 hashes, extracts only the exact 777 ka slice, deletes each large source immediately, and writes the compact browser asset plus [`data/climate-manifest.json`](data/climate-manifest.json). The vegetation path does the same for the 13 BIOME4 annual/monthly files and writes [`data/vegetation-manifest.json`](data/vegetation-manifest.json). The soil path downloads the official BIOME4 4.1 package, verifies its pinned hash and the exact `inputdata.nc` hash, preserves the four static two-layer soil float grids, and writes [`data/biome4-soil-manifest.json`](data/biome4-soil-manifest.json). The PFT-driver path reuses the same pinned source and preserves its static `tmin` int16 field in a separate 90.8 KB asset described by [`data/biome4-pft-drivers-manifest.json`](data/biome4-pft-drivers-manifest.json). Rebuilding the Krapp/BIOME4 NetCDF layers requires Python `netCDF4` and `numpy`. Large raw scientific datasets remain preprocessing inputs rather than browser dependencies.

Individual ingestion commands are also available:

```bash
npm run data:paleo
npm run data:terrain
npm run data:climate
npm run data:vegetation
npm run data:soil
npm run data:pft-drivers
```

## Data-ingestion roadmap

1. **Integrated:** NOAA ETOPO 2022 bedrock relief and bathymetry, with simulated sea-level shoreline response.
2. **Integrated:** Krapp et al. 777 ka monthly temperature, precipitation, and cloud cover at 0.5°.
3. **Integrated phase two:** official BIOME4 static two-layer 0.5° soil, closed daily land-water budget, and upstream-accumulating ETOPO river discharge with explicit forcing coverage and conservation closure; groundwater/baseflow, lakes, snow/floodplain/channel storage and hydraulics remain future work.
4. **Integrated checkpoint:** Krapp BIOME4 777 ka biome, annual NPP/LAI, and signed monthly NPP, with deliberately limited continuous branch productivity response.
5. **Integrated PFT growth, competition and classification:** independent BIOME4 4.1 climate eligibility, static `tmin` and snow gates, rooting/phenology, C3/C4 photosynthesis, optimum canopy conductance, source-equation candidate hydrology, selected-region eight-round/16-evaluation LAI/NPP optimization, potential-fire-days, top-layer dryness, `competition2`, and the empirical `newassignbiome` rule order. The classifier is diagnostic at the checkpoint and supplies only the destination of a lagged, model-derived branch succession state. A seven-cell broad-latitude check resolves with **6/7** category agreement; a deterministic 26-category valid-soil stratified check resolves with **14/26** agreement. Both retain the complete category confusion table, and neither supplies calibration feedback. The lower stratified agreement is an explicit statement of current physiology/competition/input limits, not a value to hide or fit away. Next identify the dominant causal sources of those mismatches, then couple vegetation occupancy conservatively to shared water/biogeochemistry. A general humidity/VPD field remains desirable for the wider Earth model but is not an input to the audited BIOME4 4.1 hydrology path.
6. Add LR04 as an independent validation track for the integrated Spratt–Lisiecki layer.
7. Build probabilistic fauna envelopes from Neotoma/PBDB occurrences.
8. Build hominin evidence envelopes from ROCEEH ROAD.
9. Calibrate aggregate ecosystem dynamics against the open Madingley model.
10. Materialize representative individual animals and hominins only inside observed regions.

Large scientific datasets are preprocessing inputs, not browser dependencies. The app ships compact, versioned, cited layers with checksums and reproducible generation scripts.

## Core references

- Vavrus et al. (2018), *Glacial Inception in Marine Isotope Stage 19*. DOI: [10.1038/s41598-018-28419-5](https://doi.org/10.1038/s41598-018-28419-5)
- Krapp et al. (2021), *A statistics-based reconstruction of high-resolution global terrestrial climate for the last 800,000 years*. DOI: [10.1038/s41597-021-01009-3](https://doi.org/10.1038/s41597-021-01009-3)
- BIOME4 4.1 official PMIP distribution, including `inputdata.nc` and GPL-2.0 `COPYING`.
- Priestley & Taylor (1972), *On the Assessment of Surface Heat Flux and Evaporation Using Large-Scale Parameters*. DOI: [10.1175/1520-0493(1972)100%3C0081:OTAOSH%3E2.3.CO;2](https://doi.org/10.1175/1520-0493(1972)100%3C0081:OTAOSH%3E2.3.CO;2)
- Allen et al. (1998), *FAO Irrigation and Drainage Paper 56: Crop evapotranspiration*.
- Laskar et al. (2004), *A long-term numerical solution for the insolation quantities of the Earth*. DOI: [10.1051/0004-6361:20041335](https://doi.org/10.1051/0004-6361:20041335)
- Spratt & Lisiecki (2016), *Global sea-level reconstruction using stacked records from 0–800 ka*. [NOAA record](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=noaa-ocean-19982)
- NOAA NCEI (2022), *ETOPO 2022 15 Arc-Second Global Relief Model*. DOI: [10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74)
- Lisiecki & Raymo (2005), *LR04 benthic stack*. DOI: [10.1029/2004PA001071](https://doi.org/10.1029/2004PA001071)
- Haneda et al. (2020), *A full sequence of the Matuyama–Brunhes geomagnetic reversal*. DOI: [10.1186/s40645-020-00354-y](https://doi.org/10.1186/s40645-020-00354-y)

## License

Application code is released under the MIT License. Scientific inputs retain their original terms and attribution requirements. Raw inputs are not committed; each compact transformed layer carries source attribution and a reproducible manifest.

`public/data/biome4-soil.bin.gz` and `public/data/biome4-pft-drivers.bin.gz` are transformed subsets of the BIOME4 4.1 comprehensive driver dataset and retain the upstream **GPL-2.0-only** terms. The upstream license text is preserved at [`data/licenses/BIOME4-GPL-2.0.txt`](data/licenses/BIOME4-GPL-2.0.txt), with transformation/source details in [`data/licenses/BIOME4-SOIL-NOTICE.md`](data/licenses/BIOME4-SOIL-NOTICE.md) and [`data/licenses/BIOME4-PFT-DRIVERS-NOTICE.md`](data/licenses/BIOME4-PFT-DRIVERS-NOTICE.md). This separate data-license status does not change the MIT license of Earth 777's application code.
