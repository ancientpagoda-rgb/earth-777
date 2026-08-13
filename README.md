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

The vegetation checkpoint is the authors’ published BIOME4 output at exactly 777 ka: categorical biome, annual NPP, annual LAI, and twelve signed monthly NPP fields. Earth 777 verifies all 13 original OSF files, preserves negative monthly NPP, and compacts the checkpoint to a deterministic 1.14 MB gzip layer. At the checkpoint those values are used directly. After the checkpoint, NPP and LAI respond continuously to the branch water budget and CO₂; the published categorical biome is retained as a reference until dynamic plant-functional-type competition is implemented. The official BIOME4 source audit shows that faithful categorical transitions require 13 PFTs, PFT-specific climate eligibility, optimized LAI/NPP, daily water state, growing-degree-day/fire/dryness diagnostics, woody/grass competition, and the empirical biome classifier. The new spatial soil layer is therefore a prerequisite, not a claim that this full PFT competition is already implemented. NPP source files do not declare a units attribute, so the interface reports BIOME4 NPP in source units rather than inventing units.

## Run

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Test and build

```bash
npm test
npm run build
```

## Rebuild the compact scientific layers

```bash
npm run data:ingest
```

The paleo ingestion path downloads the official forcing sources when absent, rejects checksum changes, parses only 0–777 ka, and writes the compact browser forcing module plus [`data/manifest.json`](data/manifest.json). The terrain ingestion path requests a centered OPeNDAP hyperslab from NOAA's ETOPO 2022 Bedrock grid, rejects source-subset checksum changes, and writes `src/data/generated/etopo-2022.generated.js` plus [`data/terrain-manifest.json`](data/terrain-manifest.json). The climate ingestion path downloads the 36 final Krapp monthly NetCDFs one at a time, verifies pinned SHA-256 hashes, extracts only the exact 777 ka slice, deletes each large source immediately, and writes the compact browser asset plus [`data/climate-manifest.json`](data/climate-manifest.json). The vegetation path does the same for the 13 BIOME4 annual/monthly files and writes [`data/vegetation-manifest.json`](data/vegetation-manifest.json). The soil path downloads the official BIOME4 4.1 package, verifies its pinned hash and the exact `inputdata.nc` hash, preserves the four static two-layer soil float grids, and writes [`data/biome4-soil-manifest.json`](data/biome4-soil-manifest.json). Rebuilding the Krapp/BIOME4 NetCDF layers requires Python `netCDF4` and `numpy`. Large raw scientific datasets remain preprocessing inputs rather than browser dependencies.

Individual ingestion commands are also available:

```bash
npm run data:paleo
npm run data:terrain
npm run data:climate
npm run data:vegetation
npm run data:soil
```

## Data-ingestion roadmap

1. **Integrated:** NOAA ETOPO 2022 bedrock relief and bathymetry, with simulated sea-level shoreline response.
2. **Integrated:** Krapp et al. 777 ka monthly temperature, precipitation, and cloud cover at 0.5°.
3. **Integrated phase two:** official BIOME4 static two-layer 0.5° soil, closed daily land-water budget, and upstream-accumulating ETOPO river discharge with explicit forcing coverage and conservation closure; groundwater/baseflow, lakes, snow/floodplain/channel storage and hydraulics remain future work.
4. **Integrated checkpoint:** Krapp BIOME4 777 ka biome, annual NPP/LAI, and signed monthly NPP, with deliberately limited continuous branch productivity response.
5. Implement the remaining BIOME4-compatible PFT prerequisites and then dynamic PFT competition/categorical vegetation transitions: PFT-specific climate eligibility, rooting/water use, optimized LAI/NPP, GDD/fire/dryness diagnostics, competition and classification.
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

`public/data/biome4-soil.bin.gz` is a transformed subset of the BIOME4 4.1 comprehensive driver dataset and retains the upstream **GPL-2.0-only** terms. The upstream license text is preserved at [`data/licenses/BIOME4-GPL-2.0.txt`](data/licenses/BIOME4-GPL-2.0.txt), with transformation/source details in [`data/licenses/BIOME4-SOIL-NOTICE.md`](data/licenses/BIOME4-SOIL-NOTICE.md). This separate data-license status does not change the MIT license of Earth 777's application code.
