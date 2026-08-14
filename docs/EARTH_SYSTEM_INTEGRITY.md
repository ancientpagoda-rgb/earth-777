# Earth-system integrity policy

Earth 777 is a free branch initialized from a study-constrained 777 ka checkpoint. The checkpoint is a boundary condition, not a trajectory target. After initialization, internal state should evolve because of modeled causes rather than being silently held at checkpoint values or pulled toward the history that happened on real Earth.

## Rules

1. **No arbitrary concentration caps.** Atmospheric CO2, CH4 and N2O must be positive because they are inventories, but there is no late-Pleistocene concentration ceiling. Stability comes from reservoirs, source/sink fluxes and feedbacks.
2. **Conserve what is explicitly tracked.** Carbon moves among atmospheric CO2, atmospheric CH4, land, surface ocean, deep ocean and sediment. Nitrogen moves among atmospheric N2, terrestrial/ocean reactive nitrogen and atmospheric N2O. Numerical guardrails prevent a transfer from removing more mass than a source reservoir contains; they do not cap the resulting climate state.
3. **Observed/reconstructed histories are references, not attractors.** La2004 orbit remains an exogenous forcing for this Earth/Solar-System branch. Spratt-Lisiecki sea level remains available as a comparison trajectory, but simulated sea level is driven by simulated ice and ocean heat.
4. **Checkpoint spatial fields may seed patterns, not freeze them.** Krapp 777 ka temperature, precipitation and cloud fields are the spatial baseline. Branch temperature, ice and orbital seasonality perturb those fields through the hydroclimate materializer.
5. **Bounded variables must be bounded by definition.** Ice volume index and fractional moisture/coverage variables may remain on 0-1 domains. A gas concentration or biomass does not get a hidden maximum simply because a previous emulator was tuned to a narrow range.
6. **Incomplete systems must be explicit.** `EarthSystemIntegrity.js` declares fixed reference layers and partial systems. “Not yet simulated” is preferable to a constant variable presented as if it were dynamic.

## Atmosphere and biogeochemistry

`EarthBiogeochemistry.js` implements an intermediate-complexity global model:

- carbon reservoirs: atmospheric CO2, atmospheric CH4 carbon, terrestrial carbon, surface-ocean carbon, deep-ocean carbon and sedimentary carbon;
- carbon fluxes: air-sea exchange, deep-ocean mixing, terrestrial uptake/release, silicate-weathering proxy, carbonate burial and geologic degassing;
- methane sources: wetlands, inland/ocean waters and geological release; methane oxidation returns its carbon to atmospheric CO2;
- nitrogen reservoirs: atmospheric N2, terrestrial reactive N, ocean reactive N and atmospheric N2O-N;
- nitrogen fluxes: biological fixation, terrestrial/ocean N2O production and stratospheric destruction returning nitrogen to N2;
- greenhouse forcing: CO2, CH4 and N2O all contribute to the global climate target.

The compact greenhouse expressions are intentionally intermediate complexity. They follow the standard logarithmic/square-root forcing family introduced by Myhre et al. (1998) and later refined for gas overlap by Etminan et al. (2016). A future radiative-transfer layer can replace these expressions without changing the reservoir architecture.

Primary references:

- Myhre, G. et al. (1998), *New estimates of radiative forcing due to well mixed greenhouse gases*, Geophysical Research Letters, doi:10.1029/98GL01908.
- Etminan, M. et al. (2016), *Radiative forcing of carbon dioxide, methane, and nitrous oxide: A significant revision of the methane radiative forcing*, Geophysical Research Letters, doi:10.1002/2016GL071930.
- Saunois, M. et al. (2020), *The Global Methane Budget 2000-2017*, Earth System Science Data, doi:10.5194/essd-12-1561-2020.
- Tian, H. et al. (2020), *A comprehensive quantification of global nitrous oxide sources and sinks*, Nature, doi:10.1038/s41586-020-2780-0.
- Archer, D. et al. (2009), *Atmospheric Lifetime of Fossil Fuel Carbon Dioxide*, Annual Review of Earth and Planetary Sciences, doi:10.1146/annurev.earth.031208.100206.

## What this pass fixes

- removes the old 170-330 ppm CO2 clamp;
- replaces direct noisy CO2 relaxation with explicit carbon reservoirs and fluxes;
- makes CH4 dynamic and carbon-coupled rather than permanently 631 ppb;
- makes N2O dynamic through reactive-nitrogen reservoirs rather than permanently 270 ppb;
- makes all three greenhouse gases drive climate;
- adds lagged ocean temperature as an explicit state;
- stops reconstructed sea level from pulling the branch toward actual Earth history;
- removes artificial 0.25-1.8 style carrying-capacity clamps from herbivores, carnivores and hominins;
- replaces the fixed post-reversal magnetic target of 0.78 modern with a stochastic secular-field recovery around modern-scale strength;
- advances the geological stage label with time;
- makes regional precipitation/cloud response include evolving climate, ice and precessional seasonality;
- expands consequence-weighted fidelity to account for geology, methane, nitrogen and ocean coupling;
- adds trajectory auditing so dynamic fields that become accidentally frozen are visible to tests.

## Explicit remaining partial/reference systems

This pass does **not** pretend to finish every Earth process. The registry deliberately keeps these visible:

- **Terrain:** modern ETOPO bedrock is still a fixed reference. Time-varying tectonics, erosion, sedimentation, isostasy and paleo-shoreline topography remain future work.
- **Vegetation:** continuous NPP/LAI/PFT climate and water responses are dynamic, but fully closed competitive biome-category transitions are still partial.
- **Fauna:** aggregate herbivore/carnivore carrying-capacity dynamics are not yet species-resolved populations, migration, evolution or food webs.
- **Hominins:** aggregate ecological support is not yet species-resolved demography, cognition, culture or technology.
- **Ocean:** global heat and carbon reservoirs are explicit, but circulation, alkalinity, carbonate chemistry, nutrients and spatial ocean ecology remain reduced-order.
- **Geology:** degassing varies causally, but there is not yet a plate-tectonic mantle/crust model underneath it.

Those are intentionally declared limitations rather than hidden constants. Each can now be replaced behind a stable causal interface without reintroducing a forced march toward historical Earth.
