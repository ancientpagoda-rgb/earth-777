#!/usr/bin/env python3
from pathlib import Path

p = Path('src/sim/SpatialVegetation.js')
s = p.read_text()

import_line = 'import { runBiome4VirtualPftHydrologyTrial } from "./Biome4VirtualPftHydrology.js";\n'
anchor = 'import { evaluateBiome4PftWaterPhenology } from "./Biome4PftWaterPhenology.js";\n'
if import_line not in s:
    if anchor not in s:
        raise RuntimeError('water/phenology import anchor not found')
    s = s.replace(anchor, anchor + import_line, 1)

start_marker = '    const candidates = candidateIds.map((pftId) => Object.freeze({'
start = s.find(start_marker)
if start < 0:
    raise RuntimeError('candidate map start not found')
end_marker = '    }));\n'
end = s.find(end_marker, start)
if end < 0:
    raise RuntimeError('candidate map end not found')
end += len(end_marker)
replacement = '''    const soilProfile = this.hydrology.soil?.profileAt?.(trace.latitude, trace.longitude) ?? null;
    const candidates = candidateIds.map((pftId) => {
      const diagnostic = evaluateBiome4PftWaterPhenology(pftId, {
        latitude: trace.latitude,
        monthlyTemperatureCelsius: trace.monthlyTemperatureCelsius,
        monthlyCloudCoverPercent: trace.monthlyCloudCoverPercent,
        dailyWaterTrace: trace.dailyWaterTrace
      });
      let virtualHydrology = null;
      if (diagnostic.status === "resolved-diagnostic" && soilProfile?.validSoil) {
        virtualHydrology = runBiome4VirtualPftHydrologyTrial({
          pftId,
          lai: annual.lai ?? annual.checkpointLai ?? 0,
          soilProfile,
          baselineDailyWaterTrace: trace.dailyWaterTrace,
          phenologyDaily: diagnostic.daily
        });
      }
      return Object.freeze({
        ...diagnostic,
        climateEligibilityStatus: climateEligible.has(pftId) ? "eligible" : climateUnresolved.has(pftId) ? "unresolved" : "unknown",
        virtualHydrology
      });
    });
'''
s = s[:start] + replacement + s[end:]

unresolved_anchor = '''        hydrologyFeedbackEnabled: false,
        candidateCount: candidateIds.length,
'''
if unresolved_anchor in s:
    s = s.replace(unresolved_anchor, '''        hydrologyFeedbackEnabled: false,
        parallelVirtualHydrologyEnabled: false,
        candidateCount: candidateIds.length,
''', 1)

resolved_anchor = '''      hydrologyFeedbackEnabled: false,
      candidateCount: candidates.length,
'''
if resolved_anchor not in s:
    raise RuntimeError('resolved diagnostic status anchor not found')
s = s.replace(resolved_anchor, '''      hydrologyFeedbackEnabled: false,
      parallelVirtualHydrologyEnabled: true,
      candidateCount: candidates.length,
''', 1)

old_status = '''      epistemicStatus: "BIOME4-parameter daily rooting, water-supply and source-operational phenology diagnostics over Earth 777's conserved two-layer soil trace; no PFT-specific transpiration feedback, LAI/NPP optimization, competition, or categorical biome transition is enabled."
'''
new_status = '''      epistemicStatus: "BIOME4-parameter daily rooting/phenology diagnostics plus independent parallel PFT water trials over the same climate and soil forcing; each candidate closes its own water budget and cannot alter shared Earth hydrology before competition selects occupancy. LAI/NPP optimization, competition, and categorical biome transitions remain disabled."
'''
if old_status not in s:
    raise RuntimeError('resolved epistemic status anchor not found')
s = s.replace(old_status, new_status, 1)

diag_anchor = '''      pftHydrologyFeedbackEnabled: false,
'''
if diag_anchor not in s:
    raise RuntimeError('diagnostics hydrology flag anchor not found')
s = s.replace(diag_anchor, '''      pftHydrologyFeedbackEnabled: false,
      pftParallelVirtualHydrologyIntegrated: true,
''', 1)

old_diag = '''      epistemicStatus: "published BIOME4 checkpoint with continuous branch productivity response, independently implemented BIOME4 climate candidate sieve, and opt-in daily PFT rooting/water/phenology diagnostics; no claim of full BIOME4 PFT competition or categorical biome transitions after 777 ka"
'''
new_diag = '''      epistemicStatus: "published BIOME4 checkpoint with continuous branch productivity response, independently implemented BIOME4 climate candidate sieve, daily PFT rooting/phenology diagnostics, and parallel mass-conserving candidate water trials; shared hydrology feedback, PFT competition and categorical biome transitions remain disabled"
'''
if old_diag not in s:
    raise RuntimeError('diagnostics epistemic status anchor not found')
s = s.replace(old_diag, new_diag, 1)
p.write_text(s)

# Extend the existing selected-region integration test when its stable assertion
# is present; standalone trial tests still provide the core conservation checks.
for candidate in sorted(Path('test').glob('*.test.js')):
    if candidate.name == 'pft-virtual-hydrology.test.js':
        continue
    text = candidate.read_text()
    needle = 'assert.equal(diagnostics.hydrologyFeedbackEnabled, false);'
    if needle in text and 'parallelVirtualHydrologyEnabled' not in text:
        extra = needle + '''
  assert.equal(diagnostics.parallelVirtualHydrologyEnabled, true);
  for (const candidate of diagnostics.candidates) {
    if (!candidate.virtualHydrology) continue;
    assert.ok(Math.abs(candidate.virtualHydrology.massBalanceResidualMm) < 1e-6);
    assert.equal(candidate.virtualHydrology.sharedHydrologyMutated, false);
  }'''
        candidate.write_text(text.replace(needle, extra, 1))
        print('extended integration test', candidate)
        break

print('parallel PFT hydrology integration applied')
