import {
  NCEI_PALEO_EVIDENCE_META,
  NCEI_PALEO_EVIDENCE_RECORDS
} from "../data/generated/ncei-paleo-evidence.generated.js";
import { harvestTopographyEvidenceAt } from "./TopographyEvidenceHarvester.js";

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const wrapLongitudeDelta = (value) => ((Number(value) + 540) % 360) - 180;

export const NCEI_EVIDENCE_CACHE_POLICY = "offline-generated-spatial-paleo-discovery-cache-v1";

function greatCircleDistanceKm(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(finite)) return null;
  const p1 = Number(latA) * DEG;
  const p2 = Number(latB) * DEG;
  const dp = (Number(latB) - Number(latA)) * DEG;
  const dl = wrapLongitudeDelta(Number(lonB) - Number(lonA)) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function nceiEvidenceCacheMeta() {
  return NCEI_PALEO_EVIDENCE_META;
}

export function cachedNceiEvidenceNear(latitude, longitude, { radiusKm = 500 } = {}) {
  const radius = Math.max(1, Number(radiusKm) || 500);
  const records = [];
  for (const record of NCEI_PALEO_EVIDENCE_RECORDS) {
    const distanceKm = greatCircleDistanceKm(latitude, longitude, record.latitude, record.longitude);
    if (distanceKm == null || distanceKm > radius) continue;
    records.push(Object.freeze({ ...record, distanceKm }));
  }
  return Object.freeze(records.sort((a, b) => a.distanceKm - b.distanceKm || String(a.sourceId).localeCompare(String(b.sourceId))));
}

export function harvestCachedNceiTopographyEvidenceAt(latitude, longitude, { radiusKm = 500, targetYearBP = 777_000 } = {}) {
  const records = cachedNceiEvidenceNear(latitude, longitude, { radiusKm });
  const harvest = harvestTopographyEvidenceAt(latitude, longitude, records, { targetYearBP });
  return Object.freeze({
    ...harvest,
    cachePolicy: NCEI_EVIDENCE_CACHE_POLICY,
    cacheMeta: NCEI_PALEO_EVIDENCE_META,
    radiusKm: Math.max(1, Number(radiusKm) || 500),
    cachedRecordCount: NCEI_PALEO_EVIDENCE_RECORDS.length,
    nearbyCachedRecordCount: records.length,
    scientificRole: "Evidence discovery only. Cached NCEI metadata is not a terrain value and cannot alter bedrock until a proxy-specific target transformation exists."
  });
}
