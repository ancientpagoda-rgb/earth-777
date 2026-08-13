# Snowpack and seasonal melt v1

Earth 777 now inserts an explicit seasonal snow store between monthly precipitation and the terrestrial soil-water bucket.

This layer is **model derived**. It is intended to conserve water and prevent cold-season precipitation from becoming instantaneous liquid runoff. It is not a reconstruction of 777 ka snow depth, snow density, glacier geometry, or calibrated melt factors.

## Causal chain

`Krapp monthly precipitation + temperature → rain/snow partition → snow-water-equivalent storage → seasonal melt → liquid soil input → ET / soil storage / runoff → river network`

Before this phase, all monthly precipitation was immediately available to the soil bucket even below freezing. That created the wrong seasonal causal order in cold regions.

## Rain/snow partition

A transparent provisional transition is used:

- temperature ≤ −1 °C: 100% snow;
- temperature ≥ +1 °C: 100% rain;
- between −1 and +1 °C: linear mixture.

The threshold interval is a **provisional prior**, not a study-constrained 777 ka parameter.

## Snow-water-equivalent store

Snowfall is added to an explicit SWE store before liquid soil water is computed. Snow storage can persist across months and across the repeated climatological spin-up years used by the annual bucket.

There is no arbitrary snow-storage cap. If the climate remains cold enough that accumulation exceeds melt, the annual water budget records the increase as snow-storage change. This preserves mass and exposes where a later glacier/ice-sheet mass-balance layer is required.

## Temperature-index melt

Seasonal melt uses a simple positive-degree-day / temperature-index form:

`potential melt = max(T, 0) × melt factor × days in month`

Actual melt is capped by available SWE. The default melt factor is **3 mm water equivalent °C⁻¹ day⁻¹**.

Temperature-index melt is a widely used sparse-data approach reviewed by Hock (2003), DOI `10.1016/S0022-1694(03)00257-9`. Earth 777's numerical coefficient is deliberately classified as a **provisional model prior**; it has not been calibrated to MIS 19 snow or glacier observations.

## Conservation

For every annual solution the closed terrestrial budget is now:

`precipitation = actual ET + runoff + change in soil water + change in snow water equivalent`

Rain and snow are both included in precipitation. Snowmelt is an internal transfer from the snow store to liquid water, so it is not added as an external source.

The monthly output records:

- rainfall;
- snowfall and snowfall fraction;
- snowmelt;
- starting and ending SWE;
- potential and actual ET;
- runoff;
- starting and ending soil water.

The annual output adds total rainfall, snowfall and snowmelt, mean/max/end SWE, separate soil and snow storage changes, and the combined mass-balance residual.

## Integration with river discharge

`MassConservingHydrology` now computes runoff from this soil+snow budget before the existing upstream-accumulating ETOPO river network receives it. That means winter precipitation can be delayed into a later melt season instead of becoming immediate river input.

The river network's existing climate-forcing coverage metadata and exact generated-runoff conservation remain unchanged.

## Explicit limitations

This phase still does not simulate:

- glacier or ice-sheet geometry and flow;
- snow density, compaction, albedo, sublimation, or refreezing;
- rain-on-snow energetics;
- spatially calibrated melt factors;
- wind redistribution of snow;
- groundwater/baseflow;
- lakes/floodplains/channel storage;
- sub-degree river hydraulics;
- paleotopographic/isostatic correction of ETOPO.

The next cryosphere/hydrology step should promote persistent multi-year SWE into an explicit glacier/ice mass-balance reservoir rather than allowing the seasonal snow store to stand in for glacier ice indefinitely.
