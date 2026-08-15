import { EVIDENCE_RELATIONS, harvestEvidence } from "./EvidenceHarvester.js";
import { topographyEvidenceSourceById } from "./TopographyEvidenceSources.js";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export const TOPOGRAPHY_EVIDENCE_HARVEST_POLICY = "source-catalog-normalized-topography-harvest-v2";

function inferredRelation(record, source) {
  if (record?.relation) return record.relation;
  if (record?.transformedToTarget) return EVIDENCE_RELATIONS.TRANSFORMED_HINDCAST;
  return source?.relation ?? EVIDENCE_RELATIONS.NEARBY_PALEO;
}

function inferredField(record, source) {
  if (record?.field) return record.field;
  if (source?.fields?.includes("bedrockElevationMeters")) return "bedrockElevationMeters";
  if (source?.fields?.length) return source.fields[0];
  return "bedrockElevationMeters";
}

export function normalizeTopographyEvidenceRecord(record = {}) {
  const catalogSourceId = record.archiveSourceId ?? record.sourceId;
  const source = topographyEvidenceSourceById(catalogSourceId);
  const relation = inferredRelation(record, source);
  return Object.freeze({
    ...record,
    field: inferredField(record, source),
    relation,
    catalogSourceId,
    sourceQuality: finite(record.sourceQuality) ? Number(record.sourceQuality) : source?.sourceQuality ?? 0.72,
    sourceFamily: record.sourceFamily ?? source?.family ?? null,
    sourceResolution: record.sourceResolution ?? source?.spatialResolution ?? null,
    sourceAccess: record.sourceAccess ?? source?.access ?? null,
    doi: record.doi ?? source?.doi ?? null,
    note: record.note ?? source?.note ?? null,
    sourceCatalogMatched: Boolean(source),
    normalizationPolicy: TOPOGRAPHY_EVIDENCE_HARVEST_POLICY
  });
}

export function harvestTopographyEvidenceAt(latitude, longitude, records = [], options = {}) {
  const normalized = records.map(normalizeTopographyEvidenceRecord);
  const harvest = harvestEvidence(normalized, {
    targetYearBP: options.targetYearBP ?? 777_000,
    latitude,
    longitude,
    field: options.field ?? "bedrockElevationMeters",
    uncertaintyScale: options.uncertaintyScaleMeters ?? 100
  });
  return Object.freeze({
    ...harvest,
    policy: TOPOGRAPHY_EVIDENCE_HARVEST_POLICY,
    genericRankingPolicy: harvest.policy,
    normalizedRecordCount: normalized.length,
    normalizedRecords: Object.freeze(normalized),
    sourceCatalogMatchedCount: normalized.filter((record) => record.sourceCatalogMatched).length,
    sourceCatalogUnmatchedCount: normalized.filter((record) => !record.sourceCatalogMatched).length
  });
}
