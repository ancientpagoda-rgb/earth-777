# Conservative terrestrial hydrology v1

Earth 777's first routed hydrology layer converts the branch-evolving Krapp climate into a monthly terrestrial water budget and routes generated runoff downhill over the ETOPO bedrock surface.

This layer is **model derived**. It is designed to close water numerically and preserve causal direction; it is not a reconstruction of 777 ka river discharge, groundwater, lake levels, or floodplains.

## Inputs

- **Climate:** the integrated Krapp et al. (2021) 777 ka monthly temperature and precipitation fields, plus the model-derived Free Earth spatial response after the checkpoint.
- **Relief:** the compact NOAA ETOPO 2022 modern-bedrock baseline with Earth 777's simulated sea level applied as the land/ocean threshold.
- **Orbital state:** branch obliquity controls the seasonal solar-declination amplitude used for potential evapotranspiration.
- **Potential evapotranspiration:** Oudin et al. (2005), DOI `10.1016/j.jhydrol.2004.08.026`, using mean temperature and extraterrestrial radiation. Earth 777 evaluates the formula on the Krapp 360-day calendar.

ETOPO is modern bedrock, not 777 ka paleotopography. That limitation is carried in the layer metadata rather than hidden.

## Monthly water bucket

Each active terrestrial cell tracks two explicit stores:

- soil water, capped at 180 mm in v1;
- snow water equivalent.

For each 30-day month:

1. Precipitation is partitioned linearly from all snow at −1 °C to all rain at +1 °C.
2. Positive temperature melts available snow with a 3 mm °C⁻¹ day⁻¹ degree-day factor.
3. Rain and snowmelt enter the soil store.
4. Actual evapotranspiration is the lesser of Oudin PET and available soil water.
5. Water above soil capacity becomes saturation runoff.
6. Thirty-five percent of soil water above 65% of capacity drains during the month and joins runoff.
7. Remaining water stays in soil or snow storage.

The capacity, rain/snow transition, melt factor, field-capacity fraction, and drainage fraction are **provisional model priors**. They are intentionally isolated constants so later soil, permafrost, vegetation, and groundwater work can replace them without changing the conservation contract.

For every cell-month, the implementation checks the identity

`precipitation = actual ET + generated runoff + change in soil/snow storage`.

## Downhill routing

The browser solver builds an 8-neighbor drainage graph from ETOPO cell-center elevation. A land cell can route only to a strictly lower neighbor. If the lowest descending neighbor is ocean, the cell is an ocean outlet; if no lower neighbor exists, it is an explicit endorheic sink.

Runoff depth is converted to cubic meters using spherical cell area before routing. Cells are processed from highest to lowest elevation, so upstream flow can be accumulated in one pass without cycles.

The routed conservation identity is

`sum(local runoff volume) = ocean discharge volume + endorheic retained volume`.

The full terrestrial annual budget therefore closes as

`precipitation volume = actual ET volume + ocean discharge + endorheic retention + storage change`.

Endorheic retention is a terminal bookkeeping reservoir in v1; there is not yet a lake-level or evaporation model for those basins.

## Resolution and CWF

Drainage routing is intentionally coarser than the underlying climate/terrain data:

- low/background hydrology detail: 4° routing;
- elevated hydrology detail: 2° routing;
- observed regional climate can still materialize at 0.5°.

This prevents global river routing from becoming the dominant browser cost. In the UI, expensive routed snapshots are also keyed to deterministic bins of temperature, ice volume, sea level, and obliquity, so tiny solver fluctuations do not rebuild the whole drainage network every frame.

The 2° ceiling is compute policy, not a scientific claim. Sub-degree drainage geometry is a future target.

## What is integrated now

Regional inspection can report:

- annual precipitation;
- Oudin potential ET and water-limited actual ET;
- local generated runoff;
- final soil and snow storage;
- routed mean discharge and peak monthly discharge;
- whether the local drainage path continues over land, reaches the ocean, or terminates in an endorheic sink;
- global and routing budget closure errors.

## Explicit next limitations

The next hydrology work should add, in roughly this causal order:

1. paleotopographic/isostatic correction rather than modern ETOPO bedrock alone;
2. groundwater and baseflow stores;
3. explicit endorheic lakes and lake evaporation;
4. floodplain storage and overbank flow;
5. sub-degree river geometry near observation;
6. vegetation-dependent evapotranspiration and soil properties;
7. sediment transport and erosion feedbacks.
