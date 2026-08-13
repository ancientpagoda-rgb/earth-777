from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    return text.replace(old, new, 1)

# --- earth-view.js: keep heavy science out of the visual texture path ---
p = Path("src/render/earth-view.js")
s = p.read_text()
s = replace_once(
    s,
    'const STATIC_PIXEL_RATIO_CAP = 1.25;\nconst INTERACTION_PIXEL_RATIO_CAP = 1.0;\nconst MIN_TEXTURE_REFRESH_INTERVAL_MS = 1_500;',
    'const STATIC_PIXEL_RATIO_CAP = 1.0;\nconst MIN_TEXTURE_REFRESH_INTERVAL_MS = 3_000;',
    'render caps',
)
s = replace_once(s, 'function createStars(count = 1700)', 'function createStars(count = 900)', 'star count')
s = replace_once(s, 'new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })', 'new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })', 'antialias')
s = replace_once(
    s,
    '''    this.controls.addEventListener("start", () => {\n      this.interacting = true;\n      this.textureBuildVersion += 1;\n      this.textureBuildInFlight = false;\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, INTERACTION_PIXEL_RATIO_CAP));\n      this.resize();\n    });\n    this.controls.addEventListener("end", () => {\n      this.interacting = false;\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, STATIC_PIXEL_RATIO_CAP));\n      this.resize();\n      this.updateState(this.lastState, false, this.spatialDetail);\n    });''',
    '''    this.controls.addEventListener("start", () => {\n      this.interacting = true;\n      this.textureBuildVersion += 1;\n      this.textureBuildInFlight = false;\n    });\n    this.controls.addEventListener("end", () => {\n      this.interacting = false;\n    });''',
    'control listeners',
)
s = replace_once(s, 'new THREE.SphereGeometry(1.42, 96, 64)', 'new THREE.SphereGeometry(1.42, 72, 48)', 'earth geometry')
s = replace_once(s, 'new THREE.SphereGeometry(1.438, 64, 48)', 'new THREE.SphereGeometry(1.438, 48, 32)', 'cloud geometry')
s = replace_once(s, 'new THREE.SphereGeometry(1.55, 64, 48)', 'new THREE.SphereGeometry(1.55, 48, 32)', 'atmosphere geometry')
s = replace_once(
    s,
    '''  const branchClimate = hydroClimate?.sample?.(state, latitude, longitude, spatialDetail) ?? null;\n  const vegetationState = vegetation?.sample?.(state, latitude, longitude, spatialDetail) ?? null;\n  const checkpointClimate = branchClimate ? null : climate?.annualAt?.(latitude, longitude) ?? null;\n  const checkpointGlobalAnomaly = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;\n  const freeEarthTemperatureDelta = (state.temperatureAnomaly ?? checkpointGlobalAnomaly) - checkpointGlobalAnomaly;\n  const temperature = Number.isFinite(branchClimate?.temperatureCelsius)\n    ? branchClimate.temperatureCelsius\n    : Number.isFinite(checkpointClimate?.temperatureCelsius)\n      ? checkpointClimate.temperatureCelsius + freeEarthTemperatureDelta\n      : 28 - absLat * 0.58 + state.temperatureAnomaly * (1 + absLat / 110);\n  const moisture = Number.isFinite(branchClimate?.soilMoistureIndex)\n    ? branchClimate.soilMoistureIndex\n    : Number.isFinite(checkpointClimate?.precipitationMmPerYear)\n      ? moistureFromCheckpoint(checkpointClimate.precipitationMmPerYear, checkpointClimate.cloudCoverPercent)\n      : clamp(0.58 + Math.cos(latitude * Math.PI / 45) * 0.18 + noise(longitude, latitude) * 0.28, 0, 1);''',
    '''  // Presentation must stay cheap: use the published checkpoint rasters directly here.\n  // Full branch hydrology/PFT science remains available through regional inspection.\n  const checkpointClimate = climate?.annualAt?.(latitude, longitude) ?? null;\n  const vegetationState = vegetation?.checkpoint?.annualAt?.(latitude, longitude) ?? null;\n  const checkpointGlobalAnomaly = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;\n  const freeEarthTemperatureDelta = (state.temperatureAnomaly ?? checkpointGlobalAnomaly) - checkpointGlobalAnomaly;\n  const temperature = Number.isFinite(checkpointClimate?.temperatureCelsius)\n    ? checkpointClimate.temperatureCelsius + freeEarthTemperatureDelta\n    : 28 - absLat * 0.58 + state.temperatureAnomaly * (1 + absLat / 110);\n  const moisture = Number.isFinite(checkpointClimate?.precipitationMmPerYear)\n    ? moistureFromCheckpoint(checkpointClimate.precipitationMmPerYear, checkpointClimate.cloudCoverPercent)\n    : clamp(0.58 + Math.cos(latitude * Math.PI / 45) * 0.18 + noise(longitude, latitude) * 0.28, 0, 1);''',
    'visual science sampling',
)
s = replace_once(
    s,
    '''    const branchCloud = hydroClimate?.sample?.(state, latitude, longitude, spatialDetail)?.cloudCoverPercent;\n    const checkpointCloud = Number.isFinite(branchCloud)\n      ? branchCloud\n      : climate?.annualValueAt?.("cloudCover", latitude, longitude);''',
    '''    const checkpointCloud = climate?.annualValueAt?.("cloudCover", latitude, longitude);''',
    'cloud sampling',
)
# Public interaction state lets the app suspend science while camera controls are active.
needle = '''  focusSelection() {\n    if (!this.selectedNormal) return;'''
replacement = '''  isInteracting() {\n    return this.interacting;\n  }\n\n  focusSelection() {\n    if (!this.selectedNormal) return;'''
s = replace_once(s, needle, replacement, 'isInteracting method')
p.write_text(s)

# --- regional-state.js: deep PFT diagnostics become opt-in ---
p = Path("src/sim/regional-state.js")
s = p.read_text()
s = replace_once(
    s,
    '{ climateLayer = null, hydroClimate = null, vegetation = null, spatialDetail = 0.35 } = {}',
    '{ climateLayer = null, hydroClimate = null, vegetation = null, spatialDetail = 0.35, includePftDiagnostics = false } = {}',
    'regional options',
)
s = replace_once(
    s,
    '  const pftWaterPhenology = vegetation?.pftDiagnostics?.(globalState, latitude, longitude, spatialDetail) ?? null;',
    '  const pftWaterPhenology = includePftDiagnostics\n    ? vegetation?.pftDiagnostics?.(globalState, latitude, longitude, spatialDetail) ?? null\n    : null;',
    'pft diagnostics opt-in',
)
p.write_text(s)

# --- main.js: do not advance science while the user manipulates the camera ---
p = Path("src/main.js")
s = p.read_text()
s = replace_once(s, 'const REGION_UPDATE_INTERVAL_MS = 1_000;', 'const REGION_UPDATE_INTERVAL_MS = 5_000;', 'region interval')
s = replace_once(
    s,
    '''  if (playing) {\n    pendingSimulationYears += deltaSeconds * speed;\n    if (now - lastSimulationUpdate >= SIMULATION_INTERVAL_MS) {\n      const state = engine.advance(pendingSimulationYears);\n      pendingSimulationYears = 0;\n      lastSimulationUpdate = now;\n      if (state.yearBP <= 0) setPlaying(false);\n      if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {\n        updateInterface(state);\n        lastUiUpdate = now;\n      }\n    }\n  }''',
    '''  if (playing) {\n    if (earthView.isInteracting()) {\n      // Camera responsiveness wins over wall-clock catch-up. Simulation time pauses\n      // while the user manipulates the globe, so no science burst follows pointer-up.\n      pendingSimulationYears = 0;\n      lastSimulationUpdate = now;\n    } else {\n      pendingSimulationYears += deltaSeconds * speed;\n      if (now - lastSimulationUpdate >= SIMULATION_INTERVAL_MS) {\n        const state = engine.advance(pendingSimulationYears);\n        pendingSimulationYears = 0;\n        lastSimulationUpdate = now;\n        if (state.yearBP <= 0) setPlaying(false);\n        if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {\n          updateInterface(state);\n          lastUiUpdate = now;\n        }\n      }\n    }\n  }''',
    'frame interaction isolation',
)
p.write_text(s)
