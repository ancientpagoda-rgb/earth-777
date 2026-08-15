# Hierarchical fauna runtime

Earth 777 now has a first proof-of-scale fauna representation built on the world-stream scheduler.

The scientific fauna data-ingestion roadmap is unchanged: occurrence-calibrated fauna envelopes from Neotoma and the Paleobiology Database remain a later evidence phase. The current runtime is therefore explicitly **model derived and provisional**. It demonstrates representation and compute scaling, not a claim about exact 777 ka species abundance.

## Representation hierarchy

Fauna uses three different representations at the same time:

```text
regional cells
  population fields only
        ↓
local cells
  population + estimated herd summaries
        ↓
observed surface window
  deterministic herd locations
        ↓ near camera
individual animals
```

Regional and local cells never allocate one JavaScript object per animal. A cell with ten animals and a cell with ten million animals are both represented by one bounded aggregate record at those scales.

## Observed materialization

Inside the surface window, the aggregate density is deterministically decomposed into herds. Herds outside the individual-materialization radius remain a single herd proxy that carries their represented population. Herds intersecting the near-observer radius are expanded into individual animal transforms.

The materialization boundary is spatial, not an entity-count cap. The code does not specify a maximum number of animals that may exist or be materialized. Individual rendering uses paged `InstancedMesh` pools: when one page fills, another page is allocated.

Leaving an area allows those individual render instances to collapse back to deterministic herd/population state. Returning to the same place with the same simulation state and seed reconstructs the same plan.

## Scheduler integration

Three fauna producers register with `WorldStreamScheduler`:

- `fauna-regional-fields` — `regional` scope;
- `fauna-local-herds` — `local` scope;
- `fauna-observed-materialization` — `observed` scope.

They compete with terrain and vegetation streaming for the same bounded surface-frame budget. This allows higher-detail fauna to be deferred across frames instead of forcing a giant synchronous materialization spike.

Diagnostics are exposed at:

```js
earthView.diagnostics().terrain.fauna
earthView.diagnostics().terrain.worldStreaming
```

The fauna diagnostic reports aggregate regional population, local estimated herds, observed visible population, materialized individuals, aggregate-only population, render queue depth, and dynamically allocated instance pages.

## Scientific boundary

The initial density mapping uses the existing Free Earth herbivore/carnivore biomass state plus local vegetation productivity, biome and water availability. It is labeled:

`model-derived provisional functional fauna; not yet calibrated to fossil occurrence envelopes`

It should later be replaced or constrained by the planned Neotoma/PBDB evidence envelopes and Madingley ecosystem calibration without changing the streaming/materialization architecture.
