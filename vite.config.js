import { defineConfig } from "vite";

function scienceChunks(id) {
  const path = id.replaceAll("\\", "/");
  if (path.includes("/src/data/generated/etopo-2022.generated.js")) return "terrain-etopo";
  if (path.includes("/src/sim/DynamicLithosphere.js")) return "dynamic-lithosphere";
  if (path.includes("/src/reconstruction/")) return "terrain-reconstruction";
  return undefined;
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/earth-777/" : "/",
  build: {
    target: "es2022",
    rollupOptions: {
      output: { manualChunks: scienceChunks }
    }
  },
  worker: {
    format: "es"
  }
}));
