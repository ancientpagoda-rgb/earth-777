import { buildEcologyChunkPlan, buildTerrainChunkData } from "./SurfaceComputeKernel.js";

let contextId = 0;
let context = null;

function transferListForTerrain(result) {
  return [result.positions.buffer, result.colors.buffer, result.elevations.buffer, result.indices.buffer, result.normals.buffer];
}

function transferListForEcology(result) {
  return Object.values(result).map((array) => array.buffer);
}

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  try {
    if (message.type === "context") {
      contextId = Number(message.contextId) || 0;
      context = message.context ?? null;
      return;
    }
    if (!context || Number(message.contextId) !== contextId) {
      self.postMessage({ type: "stale", id: message.id, contextId: message.contextId });
      return;
    }
    if (message.type === "terrain") {
      const started = performance.now();
      const result = buildTerrainChunkData(context, message.chunkX, message.chunkZ);
      self.postMessage({
        type: "terrain",
        id: message.id,
        contextId,
        chunkX: message.chunkX,
        chunkZ: message.chunkZ,
        milliseconds: performance.now() - started,
        ...result
      }, transferListForTerrain(result));
      return;
    }
    if (message.type === "ecology") {
      const started = performance.now();
      const pools = buildEcologyChunkPlan(context, message.payload ?? {});
      self.postMessage({
        type: "ecology",
        id: message.id,
        contextId,
        chunkX: message.payload?.chunkX,
        chunkZ: message.payload?.chunkZ,
        milliseconds: performance.now() - started,
        pools
      }, transferListForEcology(pools));
      return;
    }
    throw new Error(`Unknown surface compute task ${String(message.type)}`);
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, contextId: message.contextId, message: error?.message ?? String(error) });
  }
});
