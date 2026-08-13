from pathlib import Path

p = Path("README.md")
s = p.read_text()
s = s.replace(
    "- opt-in selected-region BIOME4 PFT rooting and source-operational phenology diagnostics plus parallel candidate water trials that independently reproduce BIOME4 4.1 equilibrium atmospheric demand, canopy-conductance saturation, Emax/root-water limitation, degree-day snow forcing, upper-layer percolation and overflow drainage without altering shared Earth hydrology;",
    "- opt-in selected-region BIOME4 PFT rooting and source-operational phenology diagnostics plus parallel candidate water trials and source-operational 16-evaluation LAI/NPP optimization for climate-eligible PFTs, without altering shared Earth hydrology or categorical biome;"
)
old = "These trials remain parallel and non-authoritative: they do not modify shared Earth hydrology, optimize PFT LAI/NPP, simulate fire/dryness ranking, perform woody/grass competition, or run the empirical biome classifier, so categorical biome remains the published checkpoint category."
new = "Climate-eligible selected-region PFTs now also run an independent reproduction of BIOME4 4.1 `findnpp`: eight search rounds evaluate two LAIs per round, each LAI reruns two-year PFT-specific hydrology/phenology, conductance-constrained photosynthesis and respiration, and the search retains the source-operational monthly-sum NPP objective. Earth 777 exposes rather than hides source quirks: the executable replaces its annual allocation NPP with the monthly NPP sum, PFT 10's code requires at least three C4-advantage months despite a comment saying two, and woody raingreen first-day `fvc` is undefined in the source so Earth 777 deterministically seeds it leafless. Layer-specific water extraction and upper-layer percolation are capped by available storage to prevent the source's post-subtraction clamps from destroying mass. These optimized candidates remain parallel and non-authoritative: they do not modify shared Earth hydrology, select occupancy, simulate fire/dryness ranking, perform woody/grass competition, or run the empirical biome classifier, so categorical biome remains the published checkpoint category."
assert old in s, "README trial status anchor not found"
s = s.replace(old, new, 1)
old = "5. **Integrated physiology/hydrology prerequisites:** independent BIOME4 4.1 PFT climate eligibility using the pinned static `tmin` driver and degree-day snow gate, selected-region rooting/phenology diagnostics, independent C3/C4 photosynthesis and optimum canopy conductance, and parallel BIOME4 source-equation candidate hydrology with equilibrium atmospheric demand, conductance-controlled AET, Emax/root-water limitation, snow storage and source percolation/overflow semantics. Next optimize candidate PFT LAI/NPP, then add fire/dryness diagnostics, woody/grass competition and the empirical classifier before any categorical biome transition is enabled. A general humidity/VPD field remains desirable for the wider Earth model but is not an input to the audited BIOME4 4.1 hydrology path."
new = "5. **Integrated PFT growth prerequisites:** independent BIOME4 4.1 climate eligibility, static `tmin` and snow gates, rooting/phenology, C3/C4 photosynthesis, optimum canopy conductance, source-equation candidate hydrology, and selected-region eight-round/16-evaluation LAI/NPP optimization with source-operational monthly NPP objective and explicit deterministic/conservation repairs. Next add BIOME4 fire/dryness diagnostics, then woody/grass competition and the empirical classifier before any categorical biome transition is enabled. A general humidity/VPD field remains desirable for the wider Earth model but is not an input to the audited BIOME4 4.1 hydrology path."
assert old in s, "README roadmap item 5 anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

p = Path("src/data/checkpoint-777.js")
s = p.read_text()
old = '    vegetation: Object.freeze({ status: "published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility, physiology/rooting/phenology diagnostics and parallel source-equation conductance/snow candidate hydrology", target: "optimized PFT LAI/NPP, fire/dryness diagnostics, woody/grass competition, empirical classification and categorical biome transitions", sources: ["krapp-2021", "biome4-4.1-soil"] }),'
new = '    vegetation: Object.freeze({ status: "published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility, physiology/rooting/phenology, source-equation candidate hydrology and selected-region LAI/NPP optimization", target: "fire/dryness diagnostics, woody/grass competition, empirical classification and categorical biome transitions", sources: ["krapp-2021", "biome4-4.1-soil"] }),'
assert old in s, "checkpoint vegetation metadata anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

p = Path("src/data/provenance.js")
s = p.read_text()
old = '    role: "Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration, phenology, photosynthesis/conductance, equilibrium-demand and hydrology semantics. Earth 777 preserves source soil floats and `tmin` int16 values and independently implements the climate/snow sieve, C3/C4 physiology, selected-region rooting/phenology diagnostics, and parallel source-equation conductance-controlled candidate water trials without copying BIOME4 program structure.",\n    status: "integrated · 0.5° soil + tmin + PFT climate/physiology/snow/rooting/phenology + source-equation parallel candidate hydrology"'
new = '    role: "Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration, phenology, photosynthesis/conductance, equilibrium-demand, hydrology, respiration/allocation and LAI-search semantics. Earth 777 preserves source soil floats and `tmin` int16 values and independently implements the climate/snow sieve, C3/C4 physiology, rooting/phenology, parallel source-equation candidate hydrology, and selected-region source-operational LAI/NPP optimization without copying BIOME4 program structure.",\n    status: "integrated · 0.5° soil + tmin + PFT climate/physiology/snow/rooting/phenology + source-equation hydrology + selected-region LAI/NPP optimization"'
assert old in s, "BIOME4 provenance anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

print("Finalized BIOME4 PFT LAI/NPP optimization scientific status.")
