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
- deterministic Free Earth branches with replayable seeds;
- a guarded phase-one climate, ice, carbon, ecosystem, hominin, and magnetic-field emulator;
- consequence-weighted fidelity that allocates bounded temporal refinement to higher-consequence simulated systems;
- globe-to-region inspection with modeled regional temperature, moisture, and biome;
- multiscale time controls from 1 to 1,000 simulated years per real second;
- a scientific source ledger visible inside the application;
- automated tests for checkpoint integrity, determinism, backward seeking, physical bounds, adaptive fidelity, and terrain ingestion.

The canonical orbit comes from the Vavrus et al. CCSM4 experiment. Its values differ slightly from the nominal La2004 row at 777 ka, so the simulator applies La2004 anomalies to that checkpoint and tapers the offset over the paper's 2.3 kyr dating-uncertainty window. After that window, the orbital forcing is the direct La2004 series. Sea level uses the continuous five-record Spratt–Lisiecki stack as a reconstructed reference; Free Earth branches can diverge from it through modeled ice-volume feedback.

The physical relief baseline now comes from NOAA NCEI ETOPO 2022 **Bedrock**. The browser layer is a reproducibly generated half-degree sampling of the official 60-arc-second grid, encoded as integer-meter elevations with the source subset SHA-256 recorded in [`data/terrain-manifest.json`](data/terrain-manifest.json). ETOPO 2022 represents modern bedrock, not a direct reconstruction of 777 ka topography. Earth 777 therefore labels the source as study constrained, the compact preprocessing as model derived, applies simulated paleo sea level separately, and reserves glacial isostasy, sediment/shoreline evolution, and time-varying ice loading for later terrain phases.

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

The paleo ingestion path downloads the official forcing sources when absent, rejects checksum changes, parses only 0–777 ka, and writes the compact browser forcing module plus [`data/manifest.json`](data/manifest.json). The terrain ingestion path requests a centered OPeNDAP hyperslab from NOAA's ETOPO 2022 Bedrock grid, rejects source-subset checksum changes, and writes `src/data/generated/etopo-2022.generated.js` plus [`data/terrain-manifest.json`](data/terrain-manifest.json). Large raw scientific datasets remain preprocessing inputs rather than browser dependencies.

Individual ingestion commands are also available:

```bash
npm run data:paleo
npm run data:terrain
```

## Data-ingestion roadmap

1. **Integrated:** NOAA ETOPO 2022 bedrock relief and bathymetry, with simulated sea-level shoreline response.
2. Extract the 777 ka monthly fields from Krapp et al. (2021), retaining source metadata and uncertainty.
3. Add LR04 as an independent validation track for the integrated Spratt–Lisiecki layer.
4. Build probabilistic fauna envelopes from Neotoma/PBDB occurrences.
5. Build hominin evidence envelopes from ROCEEH ROAD.
6. Calibrate aggregate ecosystem dynamics against the open Madingley model.
7. Materialize representative individual animals and hominins only inside observed regions.

Large scientific datasets are preprocessing inputs, not browser dependencies. The app ships compact, versioned, cited layers with checksums and reproducible generation scripts.

## Core references

- Vavrus et al. (2018), *Glacial Inception in Marine Isotope Stage 19*. DOI: [10.1038/s41598-018-28419-5](https://doi.org/10.1038/s41598-018-28419-5)
- Krapp et al. (2021), *A statistics-based reconstruction of high-resolution global terrestrial climate for the last 800,000 years*. DOI: [10.1038/s41597-021-01009-3](https://doi.org/10.1038/s41597-021-01009-3)
- Laskar et al. (2004), *A long-term numerical solution for the insolation quantities of the Earth*. DOI: [10.1051/0004-6361:20041335](https://doi.org/10.1051/0004-6361:20041335)
- Spratt & Lisiecki (2016), *Global sea-level reconstruction using stacked records from 0–800 ka*. [NOAA record](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=noaa-ocean-19982)
- NOAA NCEI (2022), *ETOPO 2022 15 Arc-Second Global Relief Model*. DOI: [10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74)
- Lisiecki & Raymo (2005), *LR04 benthic stack*. DOI: [10.1029/2004PA001071](https://doi.org/10.1029/2004PA001071)
- Haneda et al. (2020), *A full sequence of the Matuyama–Brunhes geomagnetic reversal*. DOI: [10.1186/s40645-020-00354-y](https://doi.org/10.1186/s40645-020-00354-y)

## License

Application code is released under the MIT License. Scientific inputs retain their original terms and attribution requirements. Raw inputs are not committed; each compact transformed layer carries source attribution and a reproducible manifest.
