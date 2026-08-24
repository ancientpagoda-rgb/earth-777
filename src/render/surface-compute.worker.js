import { loadRuntimeRegionalTerrainPatch } from "../reconstruction/RuntimeRegionalTerrainPatch.js";
import { buildEcologyChunkPlan, buildTerrainChunkData } from "./SurfaceComputeKernel.js";

let contextId = 0;
let context = null;
let regionalTerrainPatch = null;
let regionalTerrainPatches = [];
let regionalTerrainGeneration = 0;
let regionalTerrainRequestGeneration = 0;
const REGIONAL_TERRAIN_ATLAS_LIMIT = 6;

function transferListForTerrain(result) {
  return [result.positions.buffer, result.colors.buffer, result.elevations.buffer, result.indices.buffer, result.normals.buffer];
}

function transferListForEcology(result) {
  return Object.values(result).map((array) => array.buffer);
}

function activeContext() {
  if (!context) return null;
  if (!regionalTerrainPatches.length || context.regionalTerrainPatchActive === false) return context;
  const smoothingRadiusCells = Number(context.regionalTerrainSmoothingRadiusCells) || 0;
  const activePatches = regionalTerrainPatches.map((patch) => ({ ...patch, smoothingRadiusCells }));
  return {
    ...context,
    regionalTerrainPatch: activePatches.at(-1),
    regionalTerrainPatches: activePatches
  };
}

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  try {
    if (message.type === "context") {
      contextId = Number(message.contextId) || 0;
      context = message.context ?? null;
      return;
    }
    if (message.type === "clearRegionalTerrain") {
      regionalTerrainGeneration += 1;
      regionalTerrainRequestGeneration += 1;
      regionalTerrainPatch = null;
      regionalTerrainPatches = [];
      return;
    }
    if (message.type === "invalidateRegionalTerrainRequest") {
      regionalTerrainRequestGeneration += 1;
      return;
    }
    if (message.type === "regionalTerrain") {
      const terrainGeneration = regionalTerrainGeneration;
      const requestGeneration = ++regionalTerrainRequestGeneration;
      const started = performance.now();
      const patch = await loadRuntimeRegionalTerrainPatch(message.latitude, message.longitude, message.options ?? {});
      if (terrainGeneration !== regionalTerrainGeneration || requestGeneration !== regionalTerrainRequestGeneration) {
        self.postMessage({ type: "stale", id: message.id, contextId: message.contextId });
        return;
      }
      regionalTerrainPatch = patch;
      const existingIndex = regionalTerrainPatches.findIndex((candidate) => candidate.requestUrl === patch.requestUrl);
      if (existingIndex >= 0) regionalTerrainPatches.splice(existingIndex, 1);
      regionalTerrainPatches.push(patch);
      if (regionalTerrainPatches.length > REGIONAL_TERRAIN_ATLAS_LIMIT) regionalTerrainPatches.shift();
      const { values, ...metadata } = patch;
      self.postMessage({
        type: "regionalTerrain",
        id: message.id,
        contextId: message.contextId,
        milliseconds: performance.now() - started,
        patch: metadata
      });
      return;
    }
    if (!context || Number(message.contextId) !== contextId) {
      self.postMessage({ type: "stale", id: message.id, contextId: message.contextId });
      return;
    }
    if (message.type === "terrain") {
      const started = performance.now();
      const requestedSegments = Math.max(6, Math.min(56, Math.round(Number(message.options?.segments) || Number(context.segments) || 18)));
      const baseContext = activeContext();
      const smoothingRadiusCells = Math.max(0, Math.min(16, Math.round(Number(message.options?.regionalTerrainSmoothingRadiusCells) || 0)));
      const terrainContext = {
        ...baseContext,
        segments: requestedSegments,
        regionalTerrainPatch: baseContext?.regionalTerrainPatch
          ? { ...baseContext.regionalTerrainPatch, smoothingRadiusCells }
          : null
      };
      const result = buildTerrainChunkData(terrainContext, message.chunkX, message.chunkZ);
      self.postMessage({
        type: "terrain",
        id: message.id,
        contextId,
        chunkX: message.chunkX,
        chunkZ: message.chunkZ,
        segments: requestedSegments,
        milliseconds: performance.now() - started,
        ...result
      }, transferListForTerrain(result));
      return;
    }
    if (message.type === "ecology") {
      const started = performance.now();
      const pools = buildEcologyChunkPlan(activeContext(), message.payload ?? {});
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
