import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const dist = resolve("dist");
const manifestPath = resolve(dist, ".vite/manifest.json");
const MAX_EAGER_RAW_BYTES = 665_000;
const MAX_EAGER_GZIP_BYTES = 195_000;

if (!existsSync(manifestPath)) throw new Error("Vite manifest missing; build with build.manifest enabled before checking bundle budget.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entries = Object.entries(manifest);

function findKeyBySource(suffix) {
  return entries.find(([key, entry]) => key.endsWith(suffix) || String(entry?.src ?? "").endsWith(suffix))?.[0] ?? null;
}

const bootstrapKey = findKeyBySource("src/bootstrap.js")
  ?? entries.find(([key, entry]) => entry?.isEntry && (key === "index.html" || entry?.src === "index.html"))?.[0]
  ?? entries.find(([, entry]) => entry?.isEntry)?.[0]
  ?? null;
if (!bootstrapKey || !manifest[bootstrapKey]) throw new Error("Could not find Earth 777's browser entry in the Vite manifest.");
const bootstrap = manifest[bootstrapKey];

const bootstrapDynamicImports = bootstrap.dynamicImports ?? [];
const mainKey = bootstrapDynamicImports.find((key) => key.endsWith("src/main.js") || String(manifest[key]?.src ?? "").endsWith("src/main.js"))
  ?? findKeyBySource("src/main.js");
if (!mainKey || !manifest[mainKey]) throw new Error("Could not find src/main.js in the Vite manifest.");
if (!bootstrapDynamicImports.includes(mainKey)) throw new Error("src/main.js is no longer the bootstrap's immediate deferred application import.");

const includedKeys = new Set();
function collectStatic(key) {
  if (!key || includedKeys.has(key)) return;
  const entry = manifest[key];
  if (!entry) return;
  includedKeys.add(key);
  for (const dependency of entry.imports ?? []) collectStatic(dependency);
}
collectStatic(bootstrapKey);
collectStatic(mainKey);

const files = [...new Set([...includedKeys].map((key) => manifest[key]?.file).filter(Boolean))];
let rawBytes = 0;
let gzipBytes = 0;
for (const file of files) {
  const bytes = readFileSync(resolve(dist, file));
  rawBytes += bytes.byteLength;
  gzipBytes += gzipSync(bytes, { level: 9 }).byteLength;
}

const surfaceKey = findKeyBySource("src/render/SurfacePresentation.js");
if (!surfaceKey || !manifest[surfaceKey]) throw new Error("SurfacePresentation is missing from the Vite manifest.");
const surfaceDeferred = !includedKeys.has(surfaceKey);
const report = {
  entry: bootstrapKey,
  app: mainKey,
  eagerFiles: files.length,
  rawBytes,
  gzipBytes,
  rawLimit: MAX_EAGER_RAW_BYTES,
  gzipLimit: MAX_EAGER_GZIP_BYTES,
  surfaceDeferred
};
console.log(`EARTH_777_BUNDLE_BUDGET ${JSON.stringify(report)}`);

if (rawBytes > MAX_EAGER_RAW_BYTES) throw new Error(`Eager JS ${rawBytes} bytes exceeds ${MAX_EAGER_RAW_BYTES}-byte budget.`);
if (gzipBytes > MAX_EAGER_GZIP_BYTES) throw new Error(`Eager gzip JS ${gzipBytes} bytes exceeds ${MAX_EAGER_GZIP_BYTES}-byte budget.`);
if (!surfaceDeferred) throw new Error("SurfacePresentation is no longer a deferred main-thread import.");
