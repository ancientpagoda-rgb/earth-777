import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NCEI_PALEO_EVIDENCE_RECORDS } from "../src/data/generated/ncei-paleo-evidence.generated.js";
import { buildGmrtPointUrl, normalizeGmrtPointResponse } from "./gmrt-modern-anchor-utils.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = resolve(ROOT, "data/raw");
const GENERATED_DIR = resolve(ROOT, "src/data/generated");
const RAW_PATH = resolve(RAW_DIR, "gmrt-modern-anchors.json");
const OUTPUT_PATH = resolve(GENERATED_DIR, "gmrt-modern-anchors.generated.js");
const MANIFEST_PATH = resolve(ROOT, "data/gmrt-anchor-manifest.json");
const REFRESH = process.argv.includes("--refresh");
const MAX_POINTS_ARG = process.argv.find((arg) => arg.startsWith("--max-points="));
const MAX_POINTS = MAX_POINTS_ARG ? Math.max(1, Number(MAX_POINTS_ARG.split("=")[1]) || 1) : Number.POSITIVE_INFINITY;
const CONCURRENCY = 6;

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Path = async (path) => sha256Bytes(await readFile(path));
const coordKey = (lat, lon) => `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;

function evidenceCoordinates() {
  const grouped = new Map();
  for (const record of NCEI_PALEO_EVIDENCE_RECORDS) {
    if (!Number.isFinite(Number(record.latitude)) || !Number.isFinite(Number(record.longitude))) continue;
    const key = coordKey(record.latitude, record.longitude);
    const existing = grouped.get(key) ?? {
      latitude: Number(record.latitude),
      longitude: Number(record.longitude),
      evidenceSourceIds: []
    };
    existing.evidenceSourceIds.push(record.sourceId ?? record.studyId ?? null);
    grouped.set(key, existing);
  }
  return [...grouped.values()].sort((a, b) => a.latitude - b.latitude || a.longitude - b.longitude);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "earth-777-gmrt-ingestion/1.0 (scientific reconstruction modern-anchor cache)" }
  });
  if (!response.ok) throw new Error(`GMRT request failed (${response.status}) ${url}`);
  return response.json();
}

async function mapConcurrent(items, mapper, concurrency = CONCURRENCY) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return output;
}

async function retrieveAllPoints() {
  const allCoordinates = evidenceCoordinates();
  const coordinates = allCoordinates.slice(0, Number.isFinite(MAX_POINTS) ? MAX_POINTS : undefined);
  const points = await mapConcurrent(coordinates, async (coordinate) => {
    const url = buildGmrtPointUrl(coordinate.latitude, coordinate.longitude);
    try {
      const payload = await fetchJson(url);
      return { ...coordinate, url, payload, error: null };
    } catch (error) {
      return { ...coordinate, url, payload: null, error: String(error?.message ?? error) };
    }
  });
  return {
    schemaVersion: 1,
    retrievedAt: new Date().toISOString(),
    sourceId: "gmrt-4.5.0",
    sourceService: "GMRT PointServer",
    inputEvidenceRecordCount: NCEI_PALEO_EVIDENCE_RECORDS.length,
    uniqueEvidenceCoordinateCount: allCoordinates.length,
    requestedPointCount: coordinates.length,
    truncatedByMaxPoints: Number.isFinite(MAX_POINTS) && coordinates.length < allCoordinates.length,
    points
  };
}

async function loadOrRetrieveRaw() {
  if (!REFRESH) {
    try {
      return JSON.parse(await readFile(RAW_PATH, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const payload = await retrieveAllPoints();
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(RAW_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function normalizeAll(raw) {
  return raw.points
    .map((point) => normalizeGmrtPointResponse(point.payload, point))
    .filter(Boolean)
    .sort((a, b) => a.latitude - b.latitude || a.longitude - b.longitude);
}

await mkdir(GENERATED_DIR, { recursive: true });
const raw = await loadOrRetrieveRaw();
const records = normalizeAll(raw);
const directCount = records.filter((record) => record.directMeasurement).length;
const meta = {
  schemaVersion: 1,
  generatedBy: "scripts/ingest-gmrt-modern-anchors.mjs",
  sourceId: "gmrt-4.5.0",
  generated: true,
  retrievedAt: raw.retrievedAt,
  inputEvidenceRecordCount: raw.inputEvidenceRecordCount,
  uniqueEvidenceCoordinateCount: raw.uniqueEvidenceCoordinateCount,
  requestedPointCount: raw.requestedPointCount,
  recordCount: records.length,
  directMeasurementCount: directCount,
  truncated: Boolean(raw.truncatedByMaxPoints),
  scientificRole: "present-day high-resolution spatial anchors at paleo-evidence sites; explicit 777 ka hindcast still required"
};

const moduleText = `// Generated by scripts/ingest-gmrt-modern-anchors.mjs. Do not edit by hand.\nexport const GMRT_MODERN_ANCHOR_META = Object.freeze(${JSON.stringify(meta, null, 2)});\n\nexport const GMRT_MODERN_ANCHORS = Object.freeze(${JSON.stringify(records)}.map((record) => Object.freeze(record)));\n`;
await writeFile(OUTPUT_PATH, moduleText);

const manifest = {
  schemaVersion: 1,
  generatedBy: "scripts/ingest-gmrt-modern-anchors.mjs",
  source: {
    id: "gmrt-4.5.0",
    service: "https://www.gmrt.org/services/PointServer",
    documentation: "https://www.gmrt.org/services/pointserverinfo.php",
    retrievedAt: raw.retrievedAt,
    rawSha256: await sha256Path(RAW_PATH)
  },
  input: {
    file: "src/data/generated/ncei-paleo-evidence.generated.js",
    evidenceRecords: raw.inputEvidenceRecordCount,
    uniqueCoordinates: raw.uniqueEvidenceCoordinateCount
  },
  output: {
    file: "src/data/generated/gmrt-modern-anchors.generated.js",
    sha256: await sha256Path(OUTPUT_PATH),
    records: records.length,
    directMeasurementRecords: directCount
  },
  epistemicRule: "GMRT points improve only the present-day spatial anchor. They do not become 777 ka elevation until the reconstruction hindcast transforms them; unknown attribution remains mixed rather than direct."
};
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote ${records.length} GMRT modern anchors for ${raw.uniqueEvidenceCoordinateCount} unique NCEI evidence coordinates.`);
console.log(`Direct-attribution anchors: ${directCount}.`);
if (meta.truncated) console.warn("Warning: GMRT ingestion was truncated by --max-points and should not be treated as a complete evidence-site anchor cache.");
