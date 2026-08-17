import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const dist = resolve("dist");
const manifestPath = resolve(dist, ".vite/manifest.json");
const MAX_EAGER_RAW_BYTES = 665_000;
const MAX_EAGER_GZIP_BYTES = 195_000;

if (!existsSync(manifestPath)) throw new Error("Vite manifest missing; build with build.manifest enabled before checking bundle budget.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bootstrapKey = Object.keys(manifest).find((key) => key.endsWith("src/bootstrap.js")) ?? "src/bootstrap.js";
const bootstrap = manifest[bootstrapKey];
if (!bootstrap) throw new Error("Could not find src/bootstrap.js in Vite manifest.");
const mainKey = (bootstrap.dynamicImports ?? []).find((key) => key.endsWith("src/main.js"));
if (!mainKey || !manifest[mainKey]) throw new Error("Bootstrap no longer has the expected immediate dynamic import of src/main.js.");

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

const deferredSourceKeys = new Set([...(manifest[mainKey]?.dynamicImports ?? [])]);
const deferredSurface = [...deferredSourceKeys].some((key) => key.includes("SurfacePresentation"));
const report = {
  eagerFiles: files.length,
  rawBytes,
  gzipBytes,
  rawLimit: MAX_EAGER_RAW_BYTES,
  gzipLimit: MAX_EAGER_GZIP_BYTES,
  surfaceDeferred: deferredSurface
};
console.log(`EARTH_777_BUNDLE_BUDGET ${JSON.stringify(report)}`);

if (rawBytes > MAX_EAGER_RAW_BYTES) throw new Error(`Eager JS ${rawBytes} bytes exceeds ${MAX_EAGER_RAW_BYTES}-byte budget.`);
if (gzipBytes > MAX_EAGER_GZIP_BYTES) throw new Error(`Eager gzip JS ${gzipBytes} bytes exceeds ${MAX_EAGER_GZIP_BYTES}-byte budget.`);
if (!deferredSurface) throw new Error("SurfacePresentation is no longer a deferred main-thread import.");
