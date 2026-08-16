# Emergent categories

Earth 777 should increasingly treat familiar biological and behavioral categories as **observer labels derived from continuous simulated state**, not as commands that cause the state.

## Core rule

> **Reality causes the label; the label should not cause reality.**

Categories such as `predator`, `herbivore`, `herd`, `pack`, `hunt`, `flee`, `graze`, `drink`, and `rest` are useful for diagnostics, UI, inspection, testing, and human interpretation. They are dangerous when they become the primary causal mechanism.

The long-term target is:

```text
traits + physiology + energy needs + perception + environment + nearby organisms
                              ↓
                  continuous drives / affordances
                              ↓
                       physical actions
                              ↓
                interactions and consequences
                              ↓
                    observer classification
                              ↓
            "predation", "fleeing", "herding", etc.
```

not:

```text
predefined role
    ↓
predefined behavior state
    ↓
physical action
```

## Fauna implications

The current fauna runtime still uses provisional categories. For example, trophic level is thresholded into herbivore/carnivore roles, those roles become herd/pack representations, and named states such as `hunt`, `stalk`, `graze`, `flee`, and `rest` directly influence motion.

Those abstractions are acceptable as temporary functional scaffolding, but future Phase C work should gradually dissolve them into lower-level causes rather than build more systems on top of them.

Preferred migrations include:

| Current causal category | Long-term underlying state | Diagnostic label may remain |
| --- | --- | --- |
| herbivore / carnivore | continuous feeding ecology, digestive traits, resource acquisition, prey/carrion/plant intake | herbivore, omnivore, predator, scavenger |
| herd / pack | social attraction, kin preference, spacing, local resource geometry, threat pressure, coordinated movement | herd, pack, flock, aggregation |
| hunt | prey-directed movement, pursuit effort, encounter geometry, energetic need | hunting / stalking |
| flee | movement vector that increases separation from a perceived threat | fleeing |
| graze | plant-resource acquisition and intake | grazing / browsing |
| drink | water need plus water-seeking and intake | drinking |
| rest | low activity driven by recovery / energy state | resting |

This also allows behaviors and ecological roles that were never explicitly enumerated: omnivory, scavenging, browsing, insectivory, opportunistic predation, mixed diets, solitary hunting, temporary aggregations, and other strategies can emerge from continuous state.

## Architectural consequence

Before adding a new behavior or ecological role, ask:

1. Can the phenomenon be represented as continuous traits, needs, perception, geometry, resource acquisition, or physical interaction?
2. Can a human-readable category be computed afterward from those quantities?
3. Would adding the category as a causal state artificially prevent intermediate or unexpected strategies?

If the answer to the third question is yes, prefer the continuous representation.

## Current boundary

Recent predator-prey work already provides a useful example of the intended direction: encounter contact is derived from final group positions and radii. The simulation does not currently roll a separate `successfulHunt` outcome.

Before predation begins changing authoritative population state, the project should avoid deepening dependence on hard-coded `predator`, `herd`, or named-behavior categories. Population consequences should ultimately arise from lower-level interaction while aggregate ecology remains the authoritative population owner.

## Scope

This principle does **not** require removing all labels immediately. Labels remain valuable for:

- inspector/UI text;
- diagnostics and telemetry;
- regression tests;
- scientific comparison;
- debugging;
- coarse summaries at distant levels of detail.

The requirement is directional: as fidelity increases, labels should become increasingly **descriptive rather than prescriptive**.
