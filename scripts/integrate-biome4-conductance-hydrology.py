from pathlib import Path

# Export the existing Earth 777 elevation-pressure approximation so PFT
# photosynthesis/conductance uses the same atmospheric convention as the water
# balance instead of duplicating a second formula.
p = Path("src/sim/WaterBalance.js")
s = p.read_text()
old = "function pressureKPa(elevationMeters = 0) {"
new = "export function atmosphericPressureKPa(elevationMeters = 0) {"
assert old in s, "WaterBalance pressure helper not found"
s = s.replace(old, new, 1)
s = s.replace("pressureKPa(elevationMeters)", "atmosphericPressureKPa(elevationMeters)")
p.write_text(s)

# Expose the same monthly precipitation forcing already used to solve the
# shared water balance. Candidate BIOME4 snow/hydrology needs the original
# annualized monthly precipitation rates rather than the generic daily bucket
# precipitation.
p = Path("src/sim/MassConservingHydrology.js")
s = p.read_text()
anchor = "        monthlyCloudCoverPercent: solved?.monthlyClimate?.map((month) => month?.cloudCoverPercent ?? null) ?? null,\n"
addition = anchor + "        monthlyPrecipitationMmPerYear: solved?.monthlyClimate?.map((month) => month?.precipitationMmPerYear ?? null) ?? null,\n"
assert anchor in s, "unresolved monthly climate anchor not found"
s = s.replace(anchor, addition, 1)
anchor = "      monthlyCloudCoverPercent: Object.freeze(solved.monthlyClimate.map((month) => month.cloudCoverPercent)),\n"
addition = anchor + "      monthlyPrecipitationMmPerYear: Object.freeze(solved.monthlyClimate.map((month) => month.precipitationMmPerYear)),\n"
assert anchor in s, "resolved monthly climate anchor not found"
s = s.replace(anchor, addition, 1)
p.write_text(s)

# Supply source-equation atmospheric/snow forcing and the explicit pressure
# approximation to each opt-in PFT candidate trial.
p = Path("src/sim/SpatialVegetation.js")
s = p.read_text()
old = '''        virtualHydrology = runBiome4VirtualPftHydrologyTrial({
          pftId,
          lai: annual.lai ?? annual.checkpointLai ?? 0,
          soilProfile,
          baselineDailyWaterTrace: trace.dailyWaterTrace,
          phenologyDaily: diagnostic.daily
        });
'''
new = '''        virtualHydrology = runBiome4VirtualPftHydrologyTrial({
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
'''
assert old in s, "SpatialVegetation virtual-hydrology call not found"
s = s.replace(old, new, 1)
s = s.replace(
    "parallel mass-conserving candidate water trials; shared hydrology feedback, PFT competition and categorical biome transitions remain disabled",
    "parallel BIOME4 conductance/equilibrium-demand candidate water trials; shared hydrology feedback, LAI/NPP competition and categorical biome transitions remain disabled",
)
p.write_text(s)

print("Integrated BIOME4 conductance-driven candidate hydrology inputs.")
