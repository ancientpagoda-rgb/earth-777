# Bounded World Memory

Earth 777 keeps the live simulation state authoritative and treats historical context as a compact, hierarchical view. This is analogous to context compaction in a long-running conversation: recent detail is retained, while older detail is merged into summaries instead of accumulating one full record per simulated step.

## Retention tiers

`WorldMemory` records only selected scientific and ecological indicators:

- **Hot:** recent samples, normally covering the last 1,000 simulated years.
- **Warm:** 100-year aggregates for older history, capped at 100 bins.
- **Cold:** older aggregates, capped at 256 summaries. When the cap is reached, the oldest summaries merge into a coarser summary.

Event text is retained only as a bounded set of recent highlights. Older events remain represented by category counts such as lineage changes, extinctions, and magnetic events.

The default limits are fixed and deterministic:

```js
{
  hotWindowYears: 1000,
  maxHotSamples: 64,
  warmBinYears: 100,
  maxWarmBins: 100,
  maxColdBins: 256,
  maxEventHighlights: 64
}
```

The history therefore has a bounded record count even when the simulation advances through the full 777,000-year timeline. The current state, active lineages, and scientific source layers are not replaced by the summaries.

## Determinism and seeking

Summaries are generated from the same deterministic state and event stream as the simulation. Resetting or seeking backward resets world memory and reconstructs it along with the simulation, so equal seeds and runtime policies produce equal world-memory output.

World memory is a presentation and inspection history, not a second simulation state. If exact old detail is needed later, the engine can replay from a checkpoint and seed rather than keeping every intermediate snapshot in memory.

The current snapshot exposes the compact history at `state.worldMemory`, with `tiers.hot`, `tiers.warm`, `tiers.cold`, recent `eventHighlights`, and bounded `diagnostics`.
