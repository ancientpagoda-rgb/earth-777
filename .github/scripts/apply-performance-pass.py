from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

# ---- earth-view.js ----
p = Path("src/render/earth-view.js")
s = p.read_text()
s = replace_once(s,
    'const TEXTURE_WIDTH = 1024;\nconst TEXTURE_HEIGHT = 512;',
    'const TEXTURE_WIDTH = 512;\nconst TEXTURE_HEIGHT = 256;\nconst STATIC_PIXEL_RATIO_CAP = 1.25;\nconst INTERACTION_PIXEL_RATIO_CAP = 1.0;\nconst MIN_TEXTURE_REFRESH_INTERVAL_MS = 1_500;',
    'texture constants')
s = replace_once(s,
    '  canvas.width = 1024;\n  canvas.height = 512;',
    '  canvas.width = TEXTURE_WIDTH;\n  canvas.height = TEXTURE_HEIGHT;',
    'cloud texture size')
s = replace_once(s,
    '    this.selectedNormal = null;\n\n    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });\n    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));',
    '    this.selectedNormal = null;\n    this.interacting = false;\n    this.lastTextureRefreshMs = 0;\n\n    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });\n    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, STATIC_PIXEL_RATIO_CAP));',
    'renderer pixel ratio')
s = replace_once(s,
    '    this.controls.rotateSpeed = 0.48;\n    this.controls.zoomSpeed = 0.7;\n\n    this.earthMaterial = new THREE.MeshStandardMaterial({',
    '    this.controls.rotateSpeed = 0.48;\n    this.controls.zoomSpeed = 0.7;\n    this.controls.addEventListener("start", () => {\n      this.interacting = true;\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, INTERACTION_PIXEL_RATIO_CAP));\n      this.resize();\n    });\n    this.controls.addEventListener("end", () => {\n      this.interacting = false;\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, STATIC_PIXEL_RATIO_CAP));\n      this.resize();\n      this.updateState(this.lastState, false, this.spatialDetail);\n    });\n\n    this.earthMaterial = new THREE.MeshStandardMaterial({',
    'interaction DPR')
s = replace_once(s,
    '    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1.42, 128, 80), this.earthMaterial);',
    '    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1.42, 96, 64), this.earthMaterial);',
    'earth geometry')
s = replace_once(s,
    '    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.438, 96, 64), this.cloudMaterial);',
    '    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.438, 64, 48), this.cloudMaterial);',
    'cloud geometry')
s = replace_once(s,
    '    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.55, 96, 64), atmosphereMaterial);',
    '    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.55, 64, 48), atmosphereMaterial);',
    'atmosphere geometry')
s = replace_once(s,
    '  setHydroClimate(hydroClimate, spatialDetail = this.spatialDetail) {\n    this.hydroClimate = hydroClimate;\n    this.climate = hydroClimate?.baseline ?? this.climate;\n    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);\n    this.updateState(this.lastState, true, this.spatialDetail);\n  }\n\n  setVegetation(vegetation, spatialDetail = this.spatialDetail) {\n    this.vegetation = vegetation;\n    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);\n    this.updateState(this.lastState, true, this.spatialDetail);\n  }',
    '  setHydroClimate(hydroClimate, spatialDetail = this.spatialDetail, refresh = true) {\n    this.hydroClimate = hydroClimate;\n    this.climate = hydroClimate?.baseline ?? this.climate;\n    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);\n    if (refresh) this.updateState(this.lastState, true, this.spatialDetail);\n  }\n\n  setVegetation(vegetation, spatialDetail = this.spatialDetail, refresh = true) {\n    this.vegetation = vegetation;\n    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);\n    if (refresh) this.updateState(this.lastState, true, this.spatialDetail);\n  }',
    'layer setter refresh coalescing')
s = replace_once(s,
    '  updateState(state, force = false, spatialDetail = this.spatialDetail) {\n    this.lastState = state;\n    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);\n    if (!force && Math.abs(state.yearBP - this.lastTextureYear) < 2_500) return;\n    const next = createEarthTexture(state, this.climate, this.hydroClimate, this.vegetation, this.spatialDetail);',
    '  updateState(state, force = false, spatialDetail = this.spatialDetail) {\n    this.lastState = state;\n    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);\n    const now = performance.now();\n    if (!force && this.interacting) return;\n    if (!force && Math.abs(state.yearBP - this.lastTextureYear) < 2_500) return;\n    if (!force && now - this.lastTextureRefreshMs < MIN_TEXTURE_REFRESH_INTERVAL_MS) return;\n    const next = createEarthTexture(state, this.climate, this.hydroClimate, this.vegetation, this.spatialDetail);',
    'texture refresh guards')
s = replace_once(s,
    '    this.lastTextureYear = state.yearBP;\n  }',
    '    this.lastTextureYear = state.yearBP;\n    this.lastTextureRefreshMs = performance.now();\n  }',
    'texture refresh timestamp')
p.write_text(s)

# ---- main.js ----
p = Path("src/main.js")
s = p.read_text()
s = replace_once(s,
    'let lastFrame = performance.now();\nlet lastUiUpdate = 0;\nlet selected = null;',
    'let lastFrame = performance.now();\nlet lastSimulationUpdate = lastFrame;\nlet lastUiUpdate = 0;\nlet lastRegionUpdate = 0;\nlet pendingSimulationYears = 0;\nconst SIMULATION_INTERVAL_MS = 100;\nconst UI_UPDATE_INTERVAL_MS = 250;\nconst REGION_UPDATE_INTERVAL_MS = 1_000;\nlet selected = null;',
    'main timing state')
s = replace_once(s,
    'function updateInterface(state, forceTexture = false) {',
    'function updateInterface(state, forceTexture = false, forceRegion = false) {',
    'updateInterface signature')
s = replace_once(s,
    '  updateJournal(state);\n  if (selected) renderRegion(state, selected.latitude, selected.longitude);\n  const surfaceDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"));',
    '  updateJournal(state);\n  const now = performance.now();\n  if (selected && (forceRegion || now - lastRegionUpdate >= REGION_UPDATE_INTERVAL_MS)) {\n    renderRegion(state, selected.latitude, selected.longitude);\n    lastRegionUpdate = now;\n  }\n  const surfaceDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"));',
    'regional throttle')
s = replace_once(s,
    '  renderRegion(engine.snapshot(), region.latitude, region.longitude);\n}',
    '  renderRegion(engine.snapshot(), region.latitude, region.longitude);\n  lastRegionUpdate = performance.now();\n}',
    'selection region timestamp')
s = replace_once(s,
    'function setPlaying(next) {\n  playing = next;\n  ui.play.textContent = playing ? "Ⅱ" : "▶";',
    'function setPlaying(next) {\n  playing = next;\n  pendingSimulationYears = 0;\n  lastSimulationUpdate = performance.now();\n  ui.play.textContent = playing ? "Ⅱ" : "▶";',
    'setPlaying clock reset')
s = replace_once(s,
    '  updateInterface(engine.snapshot(), true);\n}',
    '  updateInterface(engine.snapshot(), true, true);\n}',
    'seed forced interface')
s = replace_once(s,
    '  const state = engine.seek(Number(ui.range.value));\n  updateInterface(state, true);\n});',
    '  const state = engine.seek(Number(ui.range.value));\n  updateInterface(state, true, true);\n});',
    'seek forced interface')
s = replace_once(s,
    'function frame(now) {\n  const deltaSeconds = Math.min(0.1, (now - lastFrame) / 1000);\n  lastFrame = now;\n  if (playing) {\n    const state = engine.advance(deltaSeconds * speed);\n    if (state.yearBP <= 0) setPlaying(false);\n    if (now - lastUiUpdate > 160) {\n      updateInterface(state);\n      lastUiUpdate = now;\n    }\n  }\n  earthView.render(deltaSeconds);\n  requestAnimationFrame(frame);\n}',
    'function frame(now) {\n  const deltaSeconds = Math.min(0.1, (now - lastFrame) / 1000);\n  lastFrame = now;\n  if (playing) {\n    pendingSimulationYears += deltaSeconds * speed;\n    if (now - lastSimulationUpdate >= SIMULATION_INTERVAL_MS) {\n      const state = engine.advance(pendingSimulationYears);\n      pendingSimulationYears = 0;\n      lastSimulationUpdate = now;\n      if (state.yearBP <= 0) setPlaying(false);\n      if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {\n        updateInterface(state);\n        lastUiUpdate = now;\n      }\n    }\n  }\n  earthView.render(deltaSeconds);\n  requestAnimationFrame(frame);\n}',
    'decoupled simulation clock')
s = replace_once(s,
    '    earthView.setHydroClimate(hydroClimate, surfaceDetail);\n    try {\n      const vegetationLayer = await loadKrapp777Vegetation();\n      spatialVegetation = new SpatialVegetation(vegetationLayer, hydroClimate, pftDrivers);\n      earthView.setVegetation(spatialVegetation, surfaceDetail);\n    } catch (error) {\n      console.warn("Krapp 777 ka BIOME4 vegetation layer unavailable; using hydroclimate vegetation fallback.", error);\n    }',
    '    earthView.setHydroClimate(hydroClimate, surfaceDetail, false);\n    try {\n      const vegetationLayer = await loadKrapp777Vegetation();\n      spatialVegetation = new SpatialVegetation(vegetationLayer, hydroClimate, pftDrivers);\n      earthView.setVegetation(spatialVegetation, surfaceDetail, true);\n    } catch (error) {\n      console.warn("Krapp 777 ka BIOME4 vegetation layer unavailable; using hydroclimate vegetation fallback.", error);\n      earthView.updateState(engine.snapshot(), true, surfaceDetail);\n    }',
    'coalesced layer texture refresh')
p.write_text(s)

print("performance patch applied")
