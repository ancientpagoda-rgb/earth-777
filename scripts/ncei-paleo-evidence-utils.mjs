export const NCEI_PALEO_API_BASE = "https://www.ncei.noaa.gov/access/paleo-search/study/search.json";
export const NCEI_TARGET_YEAR_BP = 777_000;
export const NCEI_DEFAULT_WINDOW_YEARS = 25_000;
export const NCEI_PAGE_LIMIT = 10;

export const NCEI_TOPOGRAPHY_DATA_TYPES = Object.freeze({
  9: Object.freeze({ name: "lake levels", field: "lakeLevelEvidence" }),
  10: Object.freeze({ name: "loess", field: "loessPaleosolEvidence" }),
  13: Object.freeze({ name: "paleolimnology", field: "lakeSedimentEvidence" }),
  14: Object.freeze({ name: "paleoceanography", field: "marineSedimentEvidence" }),
  15: Object.freeze({ name: "plant macrofossils", field: "plantMacrofossilEvidence" }),
  16: Object.freeze({ name: "pollen", field: "pollenEvidence" }),
  17: Object.freeze({ name: "speleothems", field: "speleothemEvidence" }),
  19: Object.freeze({ name: "other collections", field: "otherPaleoEvidence" })
});

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const asNumber = (value) => finite(value) ? Number(value) : null;
const first = (...values) => values.find((value) => value !== null && value !== undefined && value !== "") ?? null;
const firstNumber = (...values) => {
  for (const value of values) if (finite(value)) return Number(value);
  return null;
};

export function buildNceiPaleoSearchUrl({
  targetYearBP = NCEI_TARGET_YEAR_BP,
  windowYears = NCEI_DEFAULT_WINDOW_YEARS,
  dataTypeIds = Object.keys(NCEI_TOPOGRAPHY_DATA_TYPES).map(Number),
  skip = 0,
  limit = NCEI_PAGE_LIMIT,
  minLat = null,
  maxLat = null,
  minLon = null,
  maxLon = null
} = {}) {
  const target = Math.max(0, Number(targetYearBP) || NCEI_TARGET_YEAR_BP);
  const window = Math.max(0, Number(windowYears) || 0);
  const params = new URLSearchParams({
    dataPublisher: "NOAA",
    dataTypeId: [...new Set(dataTypeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))].join("|"),
    earliestYear: String(Math.round(target + window)),
    latestYear: String(Math.max(0, Math.round(target - window))),
    timeFormat: "BP",
    timeMethod: "overAny",
    limit: String(Math.max(1, Math.min(NCEI_PAGE_LIMIT, Math.round(Number(limit) || NCEI_PAGE_LIMIT)))),
    skip: String(Math.max(0, Math.round(Number(skip) || 0)))
  });
  for (const [key, value] of [["minLat", minLat], ["maxLat", maxLat], ["minLon", minLon], ["maxLon", maxLon]]) {
    if (finite(value)) params.set(key, String(Number(value)));
  }
  return `${NCEI_PALEO_API_BASE}?${params.toString()}`;
}

function studyAgeRangeBP(study) {
  const coverage = study?.dataCoverage ?? study?.coverage ?? study?.time ?? {};
  const older = firstNumber(
    study?.earliestYear,
    study?.earliestYearBP,
    study?.earliestYearBp,
    coverage?.earliestYear,
    coverage?.earliestYearBP,
    coverage?.maximumAge,
    coverage?.maxAge
  );
  const younger = firstNumber(
    study?.mostRecentYear,
    study?.latestYear,
    study?.latestYearBP,
    study?.latestYearBp,
    coverage?.mostRecentYear,
    coverage?.latestYear,
    coverage?.minimumAge,
    coverage?.minAge
  );
  if (older == null && younger == null) return null;
  if (older == null) return Object.freeze([younger, younger]);
  if (younger == null) return Object.freeze([older, older]);
  return Object.freeze([Math.min(younger, older), Math.max(younger, older)]);
}

function studyDataTypeIds(study) {
  const raw = [
    study?.dataTypeId,
    study?.dataTypeIds,
    study?.dataType?.id,
    ...(Array.isArray(study?.dataType) ? study.dataType.map((entry) => entry?.id ?? entry) : []),
    ...(Array.isArray(study?.dataTypes) ? study.dataTypes.map((entry) => entry?.id ?? entry) : [])
  ];
  const ids = [];
  for (const value of raw.flat()) {
    if (typeof value === "string" && value.includes("|")) {
      for (const token of value.split("|")) if (Number.isInteger(Number(token))) ids.push(Number(token));
    } else if (Number.isInteger(Number(value))) ids.push(Number(value));
  }
  return [...new Set(ids)];
}

function siteCoordinates(site) {
  const geo = site?.geo ?? {};
  const coordinates = geo?.geometry?.coordinates;
  // NCEI's own API example treats coordinates[0] as latitude.
  const latitude = firstNumber(site?.latitude, site?.lat, geo?.latitude, geo?.lat, Array.isArray(coordinates) ? coordinates[0] : null);
  const longitude = firstNumber(site?.longitude, site?.lon, site?.lng, geo?.longitude, geo?.lon, Array.isArray(coordinates) ? coordinates[1] : null);
  return { latitude, longitude };
}

function siteElevationMeters(site) {
  return firstNumber(
    site?.elevation,
    site?.elevationMeters,
    site?.geo?.elevation,
    site?.geo?.properties?.elevation,
    site?.geo?.properties?.elevationMeters,
    site?.minElev,
    site?.maxElev
  );
}

function idFor(study, site, index) {
  const studyId = first(study?.NOAAStudyId, study?.noaaStudyId, study?.studyId, study?.xmlId, study?.id, "unknown-study");
  const siteId = first(site?.siteId, site?.id, site?.siteName, site?.name, index);
  return `ncei-${String(studyId)}-${String(siteId)}`.replace(/\s+/g, "-");
}

function sourceUrlFor(study) {
  const id = first(study?.NOAAStudyId, study?.noaaStudyId, study?.studyId);
  if (id != null) return `https://www.ncei.noaa.gov/access/paleo-search/study/${id}`;
  const xmlId = first(study?.xmlId, study?.id);
  if (xmlId != null) return `${NCEI_PALEO_API_BASE}?xmlId=${encodeURIComponent(xmlId)}`;
  return null;
}

export function normalizeNceiStudySites(study) {
  if (!study || typeof study !== "object") return [];
  const ageRangeBP = studyAgeRangeBP(study);
  const dataTypeIds = studyDataTypeIds(study);
  const typeId = dataTypeIds.find((id) => NCEI_TOPOGRAPHY_DATA_TYPES[id]) ?? null;
  const type = typeId == null ? null : NCEI_TOPOGRAPHY_DATA_TYPES[typeId];
  const sites = Array.isArray(study.site) && study.site.length ? study.site : [{}];
  const title = first(study?.studyName, study?.studyTitle, study?.title, study?.name);
  const studyUrl = sourceUrlFor(study);
  return sites.map((site, index) => {
    const { latitude, longitude } = siteCoordinates(site);
    const elevationMeters = siteElevationMeters(site);
    return Object.freeze({
      sourceId: idFor(study, site, index),
      archiveSourceId: "ncei-paleo-search",
      provider: "NOAA/WDS Paleoclimatology",
      sourceFamily: "paleo-record-discovery",
      relation: "nearby-age-paleo-evidence",
      field: type?.field ?? "paleoStudyEvidence",
      sourceQuality: 0.88,
      relevance: 0.78,
      latitude,
      longitude,
      siteElevationMeters: elevationMeters,
      ageRangeBP,
      dataTypeId: typeId,
      dataTypeName: type?.name ?? null,
      noaaStudyId: first(study?.NOAAStudyId, study?.noaaStudyId, study?.studyId),
      xmlId: first(study?.xmlId, study?.id),
      siteId: first(site?.siteId, site?.id),
      title,
      studyUrl,
      note: title ? `NCEI study metadata overlapping the 777 ka discovery window: ${title}` : "NCEI study metadata overlapping the 777 ka discovery window.",
      ingestionRule: "Discovery metadata only. It cannot alter terrain until a proxy-specific transform produces a target-epoch bedrock/elevation estimate."
    });
  });
}

export function normalizeNceiSearchResponse(payload) {
  const studies = Array.isArray(payload?.study) ? payload.study : [];
  return studies.flatMap(normalizeNceiStudySites);
}

export function nextNceiPageUrl(payload) {
  const pages = Array.isArray(payload?.page) ? payload.page : payload?.page ? [payload.page] : [];
  const next = pages.map((page) => page?.next).find((value) => typeof value === "string" && value.trim());
  return next?.trim() || null;
}

export function nceiSearchResponseSummary(payload) {
  const studies = Array.isArray(payload?.study) ? payload.study : [];
  const records = normalizeNceiSearchResponse(payload);
  return Object.freeze({
    studyCount: studies.length,
    siteRecordCount: records.length,
    geolocatedSiteCount: records.filter((record) => finite(record.latitude) && finite(record.longitude)).length,
    ageBoundedSiteCount: records.filter((record) => Array.isArray(record.ageRangeBP)).length,
    nextPage: nextNceiPageUrl(payload)
  });
}
