from pathlib import Path

# Conservation repair: source k1*w1^4 transfer cannot move more water than
# physically exists in the top layer.
p = Path("src/sim/Biome4PftGrowth.js")
s = p.read_text()
old = "        percolation = upperPercolationMm(topWetness, soil.topPercolationCoefficient);"
new = "        percolation = Math.min(topStorage, upperPercolationMm(topWetness, soil.topPercolationCoefficient));"
assert old in s, "growth percolation line not found"
s = s.replace(old, new, 1)
p.write_text(s)

# Selected-region integration only. Normal vegetation sampling remains cheap.
p = Path("src/sim/SpatialVegetation.js")
s = p.read_text()
anchor = 'import { runBiome4VirtualPftHydrologyTrial } from "./Biome4VirtualPftHydrology.js";\n'
addition = anchor + 'import { optimizeBiome4PftLaiNpp } from "./Biome4PftGrowth.js";\n'
assert anchor in s, "SpatialVegetation import anchor not found"
if 'optimizeBiome4PftLaiNpp' not in s:
    s = s.replace(anchor, addition, 1)

old = '''      let virtualHydrology = null;
      if (diagnostic.status === "resolved-diagnostic" && soilProfile?.validSoil) {
        virtualHydrology = runBiome4VirtualPftHydrologyTrial({
          pftId,
          lai: annual.lai ?? annual.checkpointLai ?? 0,
          soilProfile,
          baselineDailyWaterTrace: trace.dailyWaterTrace,
          phenologyDaily: diagnostic.daily,
          latitude: trace.latitude,
          monthlyTemperatureCelsius: trace.monthlyTemperatureCelsius,
          monthlyCloudCoverPercent: trace.monthlyCloudCoverPercent,
          monthlyPrecipitationMmPerYear: trace.monthlyPrecipitationMmPerYear,
          elevationMeters: trace.elevationMeters,
          co2Ppm: globalState.co2
        });
      }
      return Object.freeze({
        ...diagnostic,
        climateEligibilityStatus: climateEligible.has(pftId) ? "eligible" : climateUnresolved.has(pftId) ? "unresolved" : "unknown",
        virtualHydrology
      });
'''
new = '''      let virtualHydrology = null;
      let laiNppOptimization = null;
      const isClimateEligible = climateEligible.has(pftId);
      if (diagnostic.status === "resolved-diagnostic" && soilProfile?.validSoil) {
        virtualHydrology = runBiome4VirtualPftHydrologyTrial({
          pftId,
          lai: annual.lai ?? annual.checkpointLai ?? 0,
          soilProfile,
          baselineDailyWaterTrace: trace.dailyWaterTrace,
          phenologyDaily: diagnostic.daily,
          latitude: trace.latitude,
          monthlyTemperatureCelsius: trace.monthlyTemperatureCelsius,
          monthlyCloudCoverPercent: trace.monthlyCloudCoverPercent,
          monthlyPrecipitationMmPerYear: trace.monthlyPrecipitationMmPerYear,
          elevationMeters: trace.elevationMeters,
          co2Ppm: globalState.co2
        });
        if (isClimateEligible) {
          laiNppOptimization = optimizeBiome4PftLaiNpp({
            pftId,
            soilProfile,
            latitude: trace.latitude,
            monthlyTemperatureCelsius: trace.monthlyTemperatureCelsius,
            monthlyCloudCoverPercent: trace.monthlyCloudCoverPercent,
            monthlyPrecipitationMmPerYear: trace.monthlyPrecipitationMmPerYear,
            elevationMeters: trace.elevationMeters,
            co2Ppm: globalState.co2
          });
        }
      }
      return Object.freeze({
        ...diagnostic,
        climateEligibilityStatus: isClimateEligible ? "eligible" : climateUnresolved.has(pftId) ? "unresolved" : "unknown",
        virtualHydrology,
        laiNppOptimization
      });
'''
assert old in s, "candidate diagnostic integration block not found"
s = s.replace(old, new, 1)

s = s.replace(
    '''        parallelVirtualHydrologyEnabled: false,
        candidateCount: candidateIds.length,
''',
    '''        parallelVirtualHydrologyEnabled: false,
        laiNppOptimizationEnabled: false,
        competitiveOccupancyEnabled: false,
        candidateCount: candidateIds.length,
''',
    1
)
s = s.replace(
    '''      parallelVirtualHydrologyEnabled: true,
      candidateCount: candidates.length,
''',
    '''      parallelVirtualHydrologyEnabled: true,
      laiNppOptimizationEnabled: true,
      competitiveOccupancyEnabled: false,
      optimizedCandidateCount: candidates.filter((candidate) => candidate.laiNppOptimization).length,
      candidateCount: candidates.length,
''',
    1
)
old_status = '''      epistemicStatus: "BIOME4-parameter daily rooting/phenology diagnostics plus independent parallel PFT water trials over the same climate and soil forcing; each candidate closes its own water budget and cannot alter shared Earth hydrology before competition selects occupancy. LAI/NPP optimization, competition, and categorical biome transitions remain disabled."
'''
new_status = '''      epistemicStatus: "BIOME4-parameter daily rooting/phenology diagnostics, parallel source-equation candidate water trials, and source-operational 16-evaluation LAI/NPP optimization for climate-eligible candidates only. Optimized productivity is diagnostic: no candidate is selected for occupancy, shared Earth hydrology is unchanged, and categorical biome transitions remain disabled."
'''
assert old_status in s, "resolved PFT diagnostic status not found"
s = s.replace(old_status, new_status, 1)

anchor = '''      pftParallelVirtualHydrologyIntegrated: true,
'''
assert anchor in s, "SpatialVegetation diagnostics integration anchor not found"
s = s.replace(anchor, anchor + '''      pftLaiNppOptimizationIntegrated: true,
      pftCompetitionEnabled: false,
      categoricalBiomeTransitionsEnabled: false,
''', 1)
old_diag = '''      epistemicStatus: "published BIOME4 checkpoint with continuous branch productivity response, independently implemented BIOME4 climate candidate sieve, daily PFT rooting/phenology diagnostics, and parallel BIOME4 conductance/equilibrium-demand candidate water trials; shared hydrology feedback, LAI/NPP competition and categorical biome transitions remain disabled"
'''
new_diag = '''      epistemicStatus: "published BIOME4 checkpoint with continuous branch productivity response, independently implemented BIOME4 climate candidate sieve, daily PFT rooting/phenology diagnostics, parallel conductance/equilibrium-demand water trials, and selected-region source-operational LAI/NPP optimization for eligible candidates; occupancy competition, shared hydrology feedback, and categorical biome transitions remain disabled"
'''
assert old_diag in s, "SpatialVegetation diagnostics status not found"
s = s.replace(old_diag, new_diag, 1)
p.write_text(s)

# Integration assertions.
p = Path("test/pft-water-phenology-integration.test.js")
s = p.read_text()
needle = '''  assert.equal(diagnostics.parallelVirtualHydrologyEnabled, true);
'''
assert needle in s, "integration test virtual-hydrology assertion not found"
s = s.replace(needle, needle + '''  assert.equal(diagnostics.laiNppOptimizationEnabled, true);
  assert.equal(diagnostics.competitiveOccupancyEnabled, false);
''', 1)
needle = '''    assert.equal(candidate.virtualHydrology.sharedHydrologyMutated, false);
'''
assert needle in s, "candidate virtual hydrology assertion not found"
s = s.replace(needle, needle + '''    if (candidate.climateEligibilityStatus === "eligible") {
      assert.ok(candidate.laiNppOptimization);
      assert.equal(candidate.laiNppOptimization.evaluationCount, 16);
      assert.equal(candidate.laiNppOptimization.checkpointCategoryMutationEnabled, false);
      assert.ok(Number.isFinite(candidate.laiNppOptimization.optimumNpp));
      assert.ok(candidate.laiNppOptimization.optimumLai >= 0);
    } else {
      assert.equal(candidate.laiNppOptimization, null);
    }
''', 1)
needle = '''  assert.equal(info.pftHydrologyFeedbackEnabled, false);
'''
assert needle in s, "diagnostics test anchor not found"
s = s.replace(needle, needle + '''  assert.equal(info.pftLaiNppOptimizationIntegrated, true);
  assert.equal(info.pftCompetitionEnabled, false);
  assert.equal(info.categoricalBiomeTransitionsEnabled, false);
''', 1)
p.write_text(s)

print("Integrated source-operational PFT LAI/NPP optimization into selected-region diagnostics.")
