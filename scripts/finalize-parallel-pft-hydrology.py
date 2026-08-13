#!/usr/bin/env python3
from pathlib import Path

p=Path('README.md')
s=p.read_text()
old='''- a selected-region daily BIOME4 PFT rooting/water-supply/phenology diagnostic over the conserved two-layer soil trace, still prevented from feeding back into hydrology or changing the published biome;
'''
new='''- selected-region daily BIOME4 PFT rooting/water-supply/phenology diagnostics plus parallel mass-conserving candidate water trials; every candidate uses the same climate/soil forcing, closes its own budget, and is prevented from feeding back into shared hydrology before competition selects occupancy;
'''
if old in s:
    s=s.replace(old,new,1)

old='''These PFT diagnostics do not yet change evapotranspiration or soil water, optimize PFT LAI/NPP, simulate fire/dryness ranking, perform woody/grass competition, or run the empirical biome classifier; the snow calculation currently exists only as the BIOME4 eligibility diagnostic, not as a mass-coupled cryosphere store; therefore no categorical biome transition is enabled. The source audit also identified parameter inconsistencies that are reported rather than silently “fixed.”
'''
new='''PFT candidates now also run in parallel through independent daily water trials using their LAI-derived canopy cover, source phenology, root fractions and maximum-transpiration parameter. These virtual trials preserve the same BIOME4 soil transfer semantics as the shared hydrology and close precipitation into soil evaporation, candidate transpiration, runoff/deep drainage and storage change. They deliberately do **not** alter shared Earth hydrology or select the occupying PFT. The independently implemented photosynthesis/conductance foundation remains a physiology diagnostic: Earth 777 does not convert canopy conductance into transpiration flux until a source-supported atmospheric humidity/vapor-pressure-deficit driver is integrated. PFT LAI/NPP optimization, fire/dryness ranking, woody/grass competition and the empirical biome classifier remain disabled; therefore no categorical biome transition is enabled. The source audit also identified parameter inconsistencies that are reported rather than silently “fixed.”
'''
if old in s:
    s=s.replace(old,new,1)

old='''5. **Integrated prerequisites:** independent BIOME4 4.1 PFT climate eligibility using the pinned static `tmin` driver and degree-day snow gate, plus selected-region rooting/water-supply/phenology diagnostics. Next couple PFT-specific water demand back into the conserved hydrology, then implement optimized PFT LAI/NPP, fire/dryness diagnostics, competition and classification before enabling categorical biome transitions.
'''
new='''5. **Integrated prerequisites:** independent BIOME4 4.1 PFT climate eligibility using the pinned static `tmin` driver and degree-day snow gate, selected-region rooting/water-supply/phenology diagnostics, and parallel mass-conserving candidate hydrology trials. Next integrate source-supported humidity/VPD so canopy conductance can constrain candidate transpiration physically, then optimize PFT LAI/NPP, add fire/dryness diagnostics, competition and classification before any categorical biome transition is enabled.
'''
if old in s:
    s=s.replace(old,new,1)
p.write_text(s)

p=Path('src/data/checkpoint-777.js')
s=p.read_text()
old='published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility using static tmin/snow diagnostics and daily rooting/water/phenology diagnostics'
new='published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility, daily rooting/phenology diagnostics and parallel mass-conserving candidate water trials'
if old in s:
    s=s.replace(old,new,1)
old='PFT-specific hydrology feedback, optimized PFT LAI/NPP, fire/dryness diagnostics, competition and categorical biome transitions'
new='humidity/VPD-constrained PFT transpiration, optimized PFT LAI/NPP, fire/dryness diagnostics, competition and categorical biome transitions'
if old in s:
    s=s.replace(old,new,1)
p.write_text(s)

p=Path('src/data/provenance.js')
s=p.read_text()
old='Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration and phenology parameter semantics. Earth 777 preserves source soil floats and `tmin` int16 values, independently implements the climate/snow sieve plus selected-region daily rooting/water/phenology diagnostics, and does not copy BIOME4 program structure.'
new='Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration and phenology parameter semantics. Earth 777 preserves source soil floats and `tmin` int16 values, independently implements the climate/snow sieve plus selected-region daily rooting/phenology diagnostics and parallel mass-conserving candidate water trials, and does not copy BIOME4 program structure.'
if old in s:
    s=s.replace(old,new,1)
old='integrated · 0.5° soil + tmin drivers + PFT climate/snow/rooting/phenology compatibility'
new='integrated · 0.5° soil + tmin drivers + PFT climate/snow/rooting/phenology + parallel candidate hydrology'
if old in s:
    s=s.replace(old,new,1)
p.write_text(s)

print('parallel PFT hydrology scientific status finalized')
