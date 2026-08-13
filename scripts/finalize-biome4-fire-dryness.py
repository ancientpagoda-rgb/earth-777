from pathlib import Path

p = Path("README.md")
s = p.read_text()
s = s.replace(
    "- opt-in selected-region BIOME4 PFT rooting and source-operational phenology diagnostics plus parallel candidate water trials and source-operational 16-evaluation LAI/NPP optimization for climate-eligible PFTs, without altering shared Earth hydrology or categorical biome;",
    "- opt-in selected-region BIOME4 PFT rooting and source-operational phenology diagnostics plus parallel candidate water trials, source-operational 16-evaluation LAI/NPP optimization, and BIOME4 fire/top-layer-dryness diagnostics for productive climate-eligible PFTs, without altering shared Earth hydrology or categorical biome;"
)
old = "These optimized candidates remain parallel and non-authoritative: they do not modify shared Earth hydrology, select occupancy, simulate fire/dryness ranking, perform woody/grass competition, or run the empirical biome classifier, so categorical biome remains the published checkpoint category."
new = "Optimized productive candidates now also carry the source-operational BIOME4 potential-fire-days diagnostic and competition dryness metrics. Fire is computed from the optimized candidate's daily root-zone wetness with the PFT-specific wetness threshold, including the source's narrow transition discontinuity and post hoc NPP scaling; the separately computed litter/burn metric is retained for provenance but is not treated as a competition input because the audited classifier reads `firedays`. Competition dryness is kept distinct and comes from the optimized candidate's monthly top-layer wetness, including mean and driest-month values. PFT 10 follows the source execution order: fire/dryness uses the second/C3 hydrology rerun even when its final monthly NPP later selects some C4 months. Climate-eligible candidates that remain negative at all 16 tested LAIs are explicitly labeled `nonproductive-no-optimum` and receive no fabricated fire/dryness trajectory. These candidates remain parallel and non-authoritative: they do not modify shared Earth hydrology, select occupancy, perform woody/grass competition, or run the empirical biome classifier, so categorical biome remains the published checkpoint category."
assert old in s, "README optimized-candidate paragraph anchor not found"
s = s.replace(old, new, 1)
old = "5. **Integrated PFT growth prerequisites:** independent BIOME4 4.1 climate eligibility, static `tmin` and snow gates, rooting/phenology, C3/C4 photosynthesis, optimum canopy conductance, source-equation candidate hydrology, and selected-region eight-round/16-evaluation LAI/NPP optimization with source-operational monthly NPP objective and explicit deterministic/conservation repairs. Next add BIOME4 fire/dryness diagnostics, then woody/grass competition and the empirical classifier before any categorical biome transition is enabled. A general humidity/VPD field remains desirable for the wider Earth model but is not an input to the audited BIOME4 4.1 hydrology path."
new = "5. **Integrated PFT growth and disturbance prerequisites:** independent BIOME4 4.1 climate eligibility, static `tmin` and snow gates, rooting/phenology, C3/C4 photosynthesis, optimum canopy conductance, source-equation candidate hydrology, selected-region eight-round/16-evaluation LAI/NPP optimization, and source-operational potential-fire-days plus top-layer-dryness diagnostics. Next reproduce BIOME4 woody/grass competition and ranking, then its empirical classifier before any categorical biome transition is enabled. A general humidity/VPD field remains desirable for the wider Earth model but is not an input to the audited BIOME4 4.1 hydrology path."
assert old in s, "README roadmap item 5 anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

p = Path("src/data/checkpoint-777.js")
s = p.read_text()
old = '    vegetation: Object.freeze({ status: "published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility, physiology/rooting/phenology, source-equation candidate hydrology and selected-region LAI/NPP optimization", target: "fire/dryness diagnostics, woody/grass competition, empirical classification and categorical biome transitions", sources: ["krapp-2021", "biome4-4.1-soil"] }),'
new = '    vegetation: Object.freeze({ status: "published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility, physiology/rooting/phenology, source-equation candidate hydrology, selected-region LAI/NPP optimization and fire/dryness diagnostics", target: "woody/grass competition, empirical classification and categorical biome transitions", sources: ["krapp-2021", "biome4-4.1-soil"] }),'
assert old in s, "checkpoint vegetation metadata anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

p = Path("src/data/provenance.js")
s = p.read_text()
old = '    role: "Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration, phenology, photosynthesis/conductance, equilibrium-demand, hydrology, respiration/allocation and LAI-search semantics. Earth 777 preserves source soil floats and `tmin` int16 values and independently implements the climate/snow sieve, C3/C4 physiology, rooting/phenology, parallel source-equation candidate hydrology, and selected-region source-operational LAI/NPP optimization without copying BIOME4 program structure.",\n    status: "integrated · 0.5° soil + tmin + PFT climate/physiology/snow/rooting/phenology + source-equation hydrology + selected-region LAI/NPP optimization"'
new = '    role: "Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration, phenology, photosynthesis/conductance, equilibrium-demand, hydrology, respiration/allocation, LAI-search, potential-fire-days and competition-dryness semantics. Earth 777 preserves source soil floats and `tmin` int16 values and independently implements the climate/snow sieve, C3/C4 physiology, rooting/phenology, parallel source-equation candidate hydrology, selected-region source-operational LAI/NPP optimization, and fire/top-layer-dryness diagnostics without copying BIOME4 program structure.",\n    status: "integrated · 0.5° soil + tmin + PFT climate/physiology/snow/rooting/phenology + source-equation hydrology + LAI/NPP optimization + fire/dryness diagnostics"'
assert old in s, "BIOME4 provenance anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

print("Finalized BIOME4 fire/dryness scientific status.")
