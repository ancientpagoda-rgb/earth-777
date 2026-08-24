import { defineConfig } from "vite";

function scienceChunks(id) {
  const path = id.replaceAll("\\", "/");
  if (path.includes("/node_modules/three/")) return "vendor-three";
  if (path.includes("/src/data/generated/etopo-2022.generated.js")) return "terrain-etopo";
  if (path.includes("/src/sim/DynamicLithosphere.js")) return "dynamic-lithosphere";
  if (path.includes("/src/reconstruction/")) return "terrain-reconstruction";
  return undefined;
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/earth-777/" : "/",
  build: {
    target: "es2022",
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: scienceChunks,
        onlyExplicitManualChunks: true,
        // Large terrain science is shared by deferred surface/region chunks.
        // Do not hoist those transitive imports into the eager application entry.
        hoistTransitiveImports: false
      }
    }
  },
  worker: {
    format: "es"
  }
}));
