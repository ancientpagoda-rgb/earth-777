from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    return text.replace(old, new, 1)

# Remove expensive live backdrop blur over WebGL.
styles = Path("styles.css")
css = styles.read_text()
marker = "/* Earth 777 performance v2: avoid live backdrop blur over WebGL. */"
if marker not in css:
    css += f'''\n\n{marker}\n.epoch,\n.panel,\n.modal {{\n  backdrop-filter: none !important;\n  -webkit-backdrop-filter: none !important;\n}}\n\nbody.is-orbiting .epoch,\nbody.is-orbiting .panel {{\n  box-shadow: none;\n}}\n'''
styles.write_text(css)

# Make the renderer much cheaper while preserving the same scientific state.
view = Path("src/render/earth-view.js")
text = view.read_text()
text = replace_once(text,
'''const TEXTURE_WIDTH = 512;\nconst TEXTURE_HEIGHT = 256;\nconst STATIC_PIXEL_RATIO_CAP = 1.25;\nconst INTERACTION_PIXEL_RATIO_CAP = 1.0;''',
'''const TEXTURE_WIDTH = 384;\nconst TEXTURE_HEIGHT = 192;\nconst STATIC_PIXEL_RATIO_CAP = 1.0;\nconst INTERACTION_PIXEL_RATIO_CAP = 0.65;''', "render constants")
text = replace_once(text,
'''  canvas.width = 1024;\n  canvas.height = 512;''',
'''  canvas.width = 512;\n  canvas.height = 256;''', "cloud texture size")
text = replace_once(text,
'''    this.lastTextureRefreshMs = 0;\n\n    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });''',
'''    this.lastTextureRefreshMs = 0;\n    this.pendingTextureForce = false;\n    this.textureRefreshTimer = null;\n\n    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });''', "renderer setup")
text = replace_once(text,
'''    this.controls.addEventListener("start", () => {\n      this.interacting = true;\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, INTERACTION_PIXEL_RATIO_CAP));\n      this.resize();\n    });\n    this.controls.addEventListener("end", () => {\n      this.interacting = false;\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, STATIC_PIXEL_RATIO_CAP));\n      this.resize();\n      this.updateState(this.lastState, false, this.spatialDetail);\n    });''',
'''    this.controls.addEventListener("start", () => {\n      this.interacting = true;\n      document.body.classList.add("is-orbiting");\n      clearTimeout(this.textureRefreshTimer);\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, INTERACTION_PIXEL_RATIO_CAP));\n      this.resize();\n    });\n    this.controls.addEventListener("end", () => {\n      this.interacting = false;\n      document.body.classList.remove("is-orbiting");\n      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, STATIC_PIXEL_RATIO_CAP));\n      this.resize();\n      const force = this.pendingTextureForce;\n      this.pendingTextureForce = false;\n      clearTimeout(this.textureRefreshTimer);\n      this.textureRefreshTimer = setTimeout(() => {\n        if (!this.interacting) this.updateState(this.lastState, force, this.spatialDetail);\n      }, 350);\n    });''', "controls interaction")
text = text.replace('new THREE.SphereGeometry(1.42, 96, 64)', 'new THREE.SphereGeometry(1.42, 64, 40)', 1)
text = text.replace('new THREE.SphereGeometry(1.438, 64, 48)', 'new THREE.SphereGeometry(1.438, 48, 32)', 1)
text = text.replace('new THREE.SphereGeometry(1.55, 64, 48)', 'new THREE.SphereGeometry(1.55, 48, 32)', 1)
text = replace_once(text,
'''  focusSelection() {\n    if (!this.selectedNormal) return;''',
'''  isInteracting() {\n    return this.interacting;\n  }\n\n  focusSelection() {\n    if (!this.selectedNormal) return;''', "interaction query")
text = replace_once(text,
'''    const now = performance.now();\n    if (!force && this.interacting) return;''',
'''    const now = performance.now();\n    if (this.interacting) {\n      this.pendingTextureForce = this.pendingTextureForce || force;\n      return;\n    }''', "defer all texture work during interaction")
view.write_text(text)

# Freeze simulation/science work while the user is manipulating the camera.
main = Path("src/main.js")
text = main.read_text()
old = '''  if (playing) {\n    pendingSimulationYears += deltaSeconds * speed;\n    if (now - lastSimulationUpdate >= SIMULATION_INTERVAL_MS) {\n      const state = engine.advance(pendingSimulationYears);\n      pendingSimulationYears = 0;\n      lastSimulationUpdate = now;\n      if (state.yearBP <= 0) setPlaying(false);\n      if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {\n        updateInterface(state);\n        lastUiUpdate = now;\n      }\n    }\n  }\n  earthView.render(deltaSeconds);'''
new = '''  const interacting = earthView.isInteracting();\n  if (playing && !interacting) {\n    pendingSimulationYears += deltaSeconds * speed;\n    if (now - lastSimulationUpdate >= SIMULATION_INTERVAL_MS) {\n      const state = engine.advance(pendingSimulationYears);\n      pendingSimulationYears = 0;\n      lastSimulationUpdate = now;\n      if (state.yearBP <= 0) setPlaying(false);\n      if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {\n        updateInterface(state);\n        lastUiUpdate = now;\n      }\n    }\n  } else if (interacting) {\n    // Camera responsiveness wins over background simulation work.\n    // Do not build up a catch-up burst that would hitch immediately after release.\n    pendingSimulationYears = 0;\n    lastSimulationUpdate = now;\n  }\n  earthView.render(deltaSeconds);'''
text = replace_once(text, old, new, "interaction simulation freeze")
main.write_text(text)
