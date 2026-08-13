from pathlib import Path

p = Path("src/sim/Biome4PftGrowth.js")
s = p.read_text()
anchor = 'import { atmosphericPressureKPa } from "./WaterBalance.js";\n'
addition = anchor + 'import { biome4FireDrynessDiagnostic } from "./Biome4FireDryness.js";\n'
assert anchor in s, "growth import anchor not found"
if 'Biome4FireDryness.js' not in s:
    s = s.replace(anchor, addition, 1)

old = '''    const objectiveNpp = monthlyNpp.reduce((sum, value) => sum + value, 0);
    return Object.freeze({
'''
new = '''    const objectiveNpp = monthlyNpp.reduce((sum, value) => sum + value, 0);
    // Source fire is called after the second (C3) rerun, so PFT 10 uses the
    // C3 wet trajectory even when monthly NPP later selects some C4 months.
    const fireDryness = biome4FireDrynessDiagnostic({
      pftId: pft.id,
      lai: leafArea,
      npp: objectiveNpp,
      hydrology: c3.hydrology
    });
    return Object.freeze({
'''
assert old in s, "PFT10 objective return anchor not found"
s = s.replace(old, new, 1)
anchor = '''      c3,
      c4,
'''
assert anchor in s, "PFT10 result anchor not found"
s = s.replace(anchor, anchor + '''      fireDryness,
''', 1)

old = '''  const pathway = pft.id === 9 ? "c4" : "c3";
  const evaluated = evaluatePathway({ elevationMeters, co2Ppm }, pft, leafArea, pathway, shared);
  return Object.freeze({
'''
new = '''  const pathway = pft.id === 9 ? "c4" : "c3";
  const evaluated = evaluatePathway({ elevationMeters, co2Ppm }, pft, leafArea, pathway, shared);
  const fireDryness = biome4FireDrynessDiagnostic({
    pftId: pft.id,
    lai: leafArea,
    npp: evaluated.carbon.operationalMonthlySumNpp,
    hydrology: evaluated.hydrology
  });
  return Object.freeze({
'''
assert old in s, "normal pathway return anchor not found"
s = s.replace(old, new, 1)
anchor = '''    carbon: evaluated.carbon,
'''
assert anchor in s, "normal growth result anchor not found"
s = s.replace(anchor, anchor + '''    fireDryness,
''', 1)

anchor = '''    checkpointCategoryMutationEnabled: false,
'''
assert anchor in s, "optimizer category flag anchor not found"
s = s.replace(anchor, '''    checkpointCategoryMutationEnabled: false,
    fireDrynessIntegrated: true,
    fireDryness: search.optimumEvaluation?.fireDryness ?? null,
''', 1)
s = s.replace(
    "The result is not yet a competitive occupancy decision and cannot change the published checkpoint biome category.",
    "The optimized result now carries source-operational fire and top-layer dryness diagnostics, but is not yet a competitive occupancy decision and cannot change the published checkpoint biome category.",
    1
)
p.write_text(s)

p = Path("src/sim/SpatialVegetation.js")
s = p.read_text()
old = '''        virtualHydrology,
        laiNppOptimization
'''
new = '''        virtualHydrology,
        laiNppOptimization,
        fireDryness: laiNppOptimization?.fireDryness ?? null
'''
assert old in s, "SpatialVegetation candidate result anchor not found"
s = s.replace(old, new, 1)
anchor = '''      laiNppOptimizationEnabled: true,
      competitiveOccupancyEnabled: false,
'''
assert anchor in s, "SpatialVegetation resolved flags anchor not found"
s = s.replace(anchor, '''      laiNppOptimizationEnabled: true,
      fireDrynessDiagnosticsEnabled: true,
      competitiveOccupancyEnabled: false,
''', 1)
anchor = '''      pftLaiNppOptimizationIntegrated: true,
      pftCompetitionEnabled: false,
'''
assert anchor in s, "SpatialVegetation global flags anchor not found"
s = s.replace(anchor, '''      pftLaiNppOptimizationIntegrated: true,
      pftFireDrynessDiagnosticsIntegrated: true,
      pftCompetitionEnabled: false,
''', 1)
s = s.replace(
    "selected-region source-operational LAI/NPP optimization for eligible candidates; occupancy competition, shared hydrology feedback, and categorical biome transitions remain disabled",
    "selected-region source-operational LAI/NPP optimization plus fire/top-layer-dryness diagnostics for eligible candidates; occupancy competition, shared hydrology feedback, and categorical biome transitions remain disabled",
    1
)
p.write_text(s)

p = Path("test/pft-growth-optimization.test.js")
s = p.read_text()
needle = '''  assert.ok(Math.abs(a.hydrology.waterBalanceResidualMm) < 1e-6);
'''
assert needle in s, "fixed-LAI growth assertion anchor not found"
s = s.replace(needle, needle + '''  assert.ok(a.fireDryness);
  assert.ok(a.fireDryness.fire.scaledPotentialFireDays >= 0);
  assert.ok(a.fireDryness.dryness.driestMonthNumber >= 1 && a.fireDryness.dryness.driestMonthNumber <= 12);
  assert.equal(a.fireDryness.occupancyFeedbackEnabled, false);
''', 1)
needle = '''  assert.equal(result.mixedC3C4MonthsEnabled, result.c4AdvantageMonths >= 3);
'''
assert needle in s, "PFT10 assertion anchor not found"
s = s.replace(needle, needle + '''  assert.ok(result.fireDryness);
  assert.equal(result.fireDryness.occupancyFeedbackEnabled, false);
''', 1)
needle = '''  assert.equal(optimized.checkpointCategoryMutationEnabled, false);
'''
assert needle in s, "optimizer assertion anchor not found"
s = s.replace(needle, needle + '''  assert.equal(optimized.fireDrynessIntegrated, true);
  assert.ok(optimized.fireDryness);
  assert.equal(optimized.fireDryness.categoricalBiomeTransitionsEnabled, false);
''', 1)
p.write_text(s)

p = Path("test/pft-water-phenology-integration.test.js")
s = p.read_text()
needle = '''  assert.equal(diagnostics.laiNppOptimizationEnabled, true);
'''
assert needle in s, "selected-region LAI flag anchor not found"
s = s.replace(needle, needle + '''  assert.equal(diagnostics.fireDrynessDiagnosticsEnabled, true);
''', 1)
needle = '''      assert.ok(candidate.laiNppOptimization);
'''
assert needle in s, "eligible candidate optimization anchor not found"
s = s.replace(needle, needle + '''      assert.ok(candidate.fireDryness);
      assert.equal(candidate.fireDryness.occupancyFeedbackEnabled, false);
''', 1)
needle = '''  assert.equal(info.pftLaiNppOptimizationIntegrated, true);
'''
assert needle in s, "diagnostics integration anchor not found"
s = s.replace(needle, needle + '''  assert.equal(info.pftFireDrynessDiagnosticsIntegrated, true);
''', 1)
p.write_text(s)

print("Integrated source-operational fire/dryness diagnostics into optimized PFT candidates.")
