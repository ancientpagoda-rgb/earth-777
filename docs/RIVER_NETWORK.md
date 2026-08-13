# Upstream-accumulating river network v1

Earth 777's river-network layer turns the already closed local land-water budgets into a conserved coarse drainage network.

## Causal chain

`Krapp monthly climate → branch hydroclimate → closed soil-water budget → local runoff depth → runoff volume → D8 downhill routing → accumulated river discharge`

The network does not invent an independent river amount. Every cubic meter entering the network comes from local runoff produced by `MassConservingHydrology`.

## Topology

The network uses the same steepest-downhill eight-neighbor rule as the existing parcel router, over the compact ETOPO modern-bedrock baseline with simulated sea level applied separately.

Every terrestrial routing link must descend in elevation. A cell terminates as either:

- an ocean outlet when its steepest lower neighbor is below simulated sea level; or
- a closed-basin sink when no lower neighbor exists.

Strictly descending links make the graph acyclic. Sorting land cells from highest to lowest elevation therefore provides a deterministic topological order for accumulation.

ETOPO is modern bedrock, not a reconstructed 777 ka paleotopography. Closed depressions in this coarse grid are retained explicitly rather than silently breached or filled.

## Conservation

For each climate-forced land cell, annual local runoff depth is converted to volume using spherical cell area:

`local volume = runoff depth × cell area`

The solver then propagates local plus upstream volume to the downstream cell. It simultaneously propagates total upstream drainage area, contributing-cell count, climate-forced upstream area, and climate-forced contributing-cell count.

At the whole-network scale the invariant is:

`sum(generated local runoff volume) = ocean discharge + closed-basin retention`

`accumulateRunoffNetwork()` reports the absolute and relative closure error and a boolean conservation check. Tests exercise both a synthetic network and the real 777 ka 4° ETOPO/Krapp network.

## Climate-forcing coverage

The ETOPO land mask and the published Krapp terrestrial climate mask are not identical, and the closed annual water balance requires valid climate for all twelve monthly fields. Consequently, some routed ETOPO land cells do not have sufficient Krapp forcing to generate a modeled runoff value.

Those cells are **not described as fully constrained zero-runoff cells**. The network carries an explicit forcing mask and reports:

- climate-forced land area and cell count globally;
- global climate-forcing coverage as a fraction of routed ETOPO land area;
- climate-forced upstream area and contributing-cell count for every network cell;
- basin/upstream forcing coverage as `climate-forced upstream area / total upstream area`.

Unforced cells contribute zero generated runoff numerically, but that zero means **missing hydrologic forcing**, not a scientific claim of zero runoff. River discharge is therefore complete only over the explicitly reported climate-forced fraction of its drainage area. The conservation invariant applies exactly to the runoff actually generated on that forced domain.

## CWF / browser resolution

Whole-network accumulation is deliberately coarser than selected-region climate:

- normal/background network: 4°;
- high observer hydrology relevance: 2°;
- local climate and water-balance inspection can still use 0.5°.

The network solve also uses deterministic forcing bins of 0.1 K global temperature anomaly, 0.01 ice index, and 2 m sea level. This is **compute policy**, not a scientific precision claim. It prevents the entire drainage network from being rebuilt for numerically tiny frame-to-frame changes.

## What the regional inspector can report

For the coarse network cell containing the selected point:

- local runoff depth and volume;
- accumulated annual upstream volume;
- mean discharge in m³/s;
- total upstream drainage area;
- climate-forced upstream drainage area and its coverage fraction;
- total and climate-forced upstream grid-cell counts;
- terminal outlet type and routed cell count;
- whole-network conservation error.

## Still missing

This is an accumulating runoff network, not full river hydraulics. It does not yet simulate:

- groundwater/baseflow exchange;
- snowpack and glacier melt routing;
- explicit lake levels or lake evaporation;
- floodplain and wetland storage;
- channel width, depth, velocity, roughness, or travel time;
- transmission losses;
- sediment transport or erosion;
- sub-degree channel geometry near observation;
- paleotopographic/isostatic correction of the modern ETOPO bedrock baseline.

Those remain downstream phases and should preserve the same conservation contract.
