export const ICE_777_EVIDENCE_POLICY = "target-climate-inception-evidence-not-thickness-v1";

export const ICE_777_SOURCES = Object.freeze({
  ruddiman2018: Object.freeze({
    sourceId: "ruddiman-2018-mis19",
    publication: "Glacial Inception in Marine Isotope Stage 19: An Orbital Analog for a Natural Holocene Climate",
    doi: "10.1038/s41598-018-28419-5",
    targetYearBP: 777_000,
    model: "CCSM4",
    evidenceRole: "target-epoch climate and glacial-inception validation",
    dynamicIceSheetSimulated: false,
    directIceThicknessConstraint: false,
    note: "The 777 ka experiment produces expanded sea ice, year-round snow and inferred regions of glacial inception, but it does not supply a physically evolved ice-sheet thickness field."
  })
});

export const ICE_777_INCEPTION_REGIONS = Object.freeze([
  Object.freeze({
    id: "northeastern-siberia-inception",
    sourceId: "ruddiman-2018-mis19",
    phenomenon: "inferred-glacial-inception",
    regionDescription: "northeastern Siberia",
    directIceThicknessMeters: null
  }),
  Object.freeze({
    id: "northwestern-north-america-inception",
    sourceId: "ruddiman-2018-mis19",
    phenomenon: "inferred-glacial-inception",
    regionDescription: "northwestern North America",
    directIceThicknessMeters: null
  }),
  Object.freeze({
    id: "canadian-archipelago-inception",
    sourceId: "ruddiman-2018-mis19",
    phenomenon: "inferred-glacial-inception",
    regionDescription: "Canadian Archipelago including Baffin Island and the northeast archipelago",
    directIceThicknessMeters: null
  })
]);

export function ice777EvidenceSummary() {
  return Object.freeze({
    policy: ICE_777_EVIDENCE_POLICY,
    targetYearBP: 777_000,
    sources: ICE_777_SOURCES,
    inceptionRegions: ICE_777_INCEPTION_REGIONS,
    directThicknessConstraintCount: ICE_777_INCEPTION_REGIONS.filter((record) => Number.isFinite(record.directIceThicknessMeters)).length,
    rule: "Target-epoch snow persistence and glacial-inception evidence may seed or validate an ice-sheet reconstruction, but cannot be converted directly into ice thickness or GIA loading without a separate dynamic ice/load model."
  });
}

export function assertIceThicknessEvidence(record) {
  if (!record || !Number.isFinite(Number(record.iceThicknessMeters))) return false;
  return Boolean(record.directThicknessConstraint || record.transformedToTargetIceLoad);
}
