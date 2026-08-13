from pathlib import Path

p = Path("README.md")
s = p.read_text()
s = s.replace(
    "- opt-in selected-region BIOME4 PFT rooting, daily water-supply and source-operational phenology diagnostics over the conserved two-layer soil trace, without yet feeding PFT-specific transpiration back into hydrology;",
    "- opt-in selected-region BIOME4 PFT rooting and source-operational phenology diagnostics plus parallel candidate water trials that independently reproduce BIOME4 4.1 equilibrium atmospheric demand, canopy-conductance saturation, Emax/root-water limitation, degree-day snow forcing, upper-layer percolation and overflow drainage without altering shared Earth hydrology;"
)
old = "These PFT diagnostics do not yet change evapotranspiration or soil water, optimize PFT LAI/NPP, simulate fire/dryness ranking, perform woody/grass competition, or run the empirical biome classifier; the snow calculation currently exists only as the BIOME4 eligibility diagnostic, not as a mass-coupled cryosphere store; categorical biome therefore remains the published checkpoint category."
new = "Selected-region candidate PFT trials now run their own isolated BIOME4-style daily water trajectories: the audited 4.1 `ppeett` equilibrium-demand equations derive atmospheric demand from temperature, cloud and latitude; monthly optimum canopy conductance comes from the independent C3/C4 physiology implementation; source `alpha = 1.4 × (1 − exp(−g/5))` conductance saturation and Emax/root-water supply constrain AET; and the two-year degree-day snow calculation supplies explicit liquid precipitation, melt and snow-storage closure. The audited BIOME4 executable does not consume an external humidity/VPD field in this path and fixes its monthly radiation-anomaly multipliers to 1.0, so Earth 777 does not fabricate such a prerequisite. BIOME4 also assigns but does not use its second percolation coefficient in this hydrology routine; candidate trials therefore use upper-layer `k × wetness⁴` percolation and lower-store overflow drainage exactly as audited. These trials remain parallel and non-authoritative: they do not modify shared Earth hydrology, optimize PFT LAI/NPP, simulate fire/dryness ranking, perform woody/grass competition, or run the empirical biome classifier, so categorical biome remains the published checkpoint category. Earth 777 still lacks a general atmospheric humidity/VPD field for broader climate/ecophysiology applications, and the pressure supplied to PFT photosynthesis remains the existing model-derived elevation-pressure approximation until the original BIOME4/Krapp pressure preparation is pinned."
assert old in s, "README vegetation status paragraph anchor not found"
s = s.replace(old, new, 1)
old = "5. **Integrated prerequisites:** independent BIOME4 4.1 PFT climate eligibility using the pinned static `tmin` driver and degree-day snow gate, selected-region rooting/water-supply/phenology diagnostics, and parallel mass-conserving candidate hydrology trials. Next integrate source-supported humidity/VPD so canopy conductance can constrain candidate transpiration physically, then optimize PFT LAI/NPP, add fire/dryness diagnostics, competition and classification before any categorical biome transition is enabled."
new = "5. **Integrated physiology/hydrology prerequisites:** independent BIOME4 4.1 PFT climate eligibility using the pinned static `tmin` driver and degree-day snow gate, selected-region rooting/phenology diagnostics, independent C3/C4 photosynthesis and optimum canopy conductance, and parallel BIOME4 source-equation candidate hydrology with equilibrium atmospheric demand, conductance-controlled AET, Emax/root-water limitation, snow storage and source percolation/overflow semantics. Next optimize candidate PFT LAI/NPP, then add fire/dryness diagnostics, woody/grass competition and the empirical classifier before any categorical biome transition is enabled. A general humidity/VPD field remains desirable for the wider Earth model but is not an input to the audited BIOME4 4.1 hydrology path."
assert old in s, "README roadmap item 5 anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

p = Path("src/data/checkpoint-777.js")
s = p.read_text()
old = '    vegetation: Object.freeze({ status: "published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility, daily rooting/phenology diagnostics and parallel mass-conserving candidate water trials", target: "humidity/VPD-constrained PFT transpiration, optimized PFT LAI/NPP, fire/dryness diagnostics, competition and categorical biome transitions", sources: ["krapp-2021", "biome4-4.1-soil"] }),'
new = '    vegetation: Object.freeze({ status: "published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility, physiology/rooting/phenology diagnostics and parallel source-equation conductance/snow candidate hydrology", target: "optimized PFT LAI/NPP, fire/dryness diagnostics, woody/grass competition, empirical classification and categorical biome transitions", sources: ["krapp-2021", "biome4-4.1-soil"] }),'
assert old in s, "checkpoint vegetation metadata anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

p = Path("src/data/provenance.js")
s = p.read_text()
old = '    role: "Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration and phenology parameter semantics. Earth 777 preserves source soil floats and `tmin` int16 values, independently implements the climate/snow sieve plus selected-region daily rooting/phenology diagnostics and parallel mass-conserving candidate water trials, and does not copy BIOME4 program structure.",\n    status: "integrated · 0.5° soil + tmin drivers + PFT climate/snow/rooting/phenology + parallel candidate hydrology"'
new = '    role: "Static 0.5° two-layer water-holding-capacity/percolation inputs, the static absolute-minimum-temperature (`tmin`) driver, and factual BIOME4 4.1 PFT climate, rooting, transpiration, phenology, photosynthesis/conductance, equilibrium-demand and hydrology semantics. Earth 777 preserves source soil floats and `tmin` int16 values and independently implements the climate/snow sieve, C3/C4 physiology, selected-region rooting/phenology diagnostics, and parallel source-equation conductance-controlled candidate water trials without copying BIOME4 program structure.",\n    status: "integrated · 0.5° soil + tmin + PFT climate/physiology/snow/rooting/phenology + source-equation parallel candidate hydrology"'
assert old in s, "BIOME4 provenance anchor not found"
s = s.replace(old, new, 1)
p.write_text(s)

print("Finalized BIOME4 conductance-driven candidate hydrology scientific status.")
