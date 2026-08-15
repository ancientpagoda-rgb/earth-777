import test from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_RELATIONS } from "../src/reconstruction/EvidenceHarvester.js";
import { topographyEvidenceSourceById } from "../src/reconstruction/TopographyEvidenceSources.js";

test("polar bed and bathymetry anchors are explicitly cataloged", () => {
  const greenland = topographyEvidenceSourceById("bedmachine-greenland-v6");
  const antarctica = topographyEvidenceSourceById("bedmachine-antarctica-v4");
  const rema = topographyEvidenceSourceById("rema-mosaic-v2");
  const ibcao = topographyEvidenceSourceById("ibcao-5.1");
  for (const source of [greenland, antarctica, rema, ibcao]) {
    assert.ok(source);
    assert.equal(source.relation, EVIDENCE_RELATIONS.MODERN_ANCHOR);
  }
  assert.equal(greenland.spatialResolution, "150 m");
  assert.equal(antarctica.spatialResolution, "500 m");
  assert.equal(rema.spatialResolution, "2 m");
  assert.equal(ibcao.spatialResolution, "100 m");
  assert.ok(greenland.fields.includes("bedrockElevationMeters"));
  assert.ok(antarctica.fields.includes("bedrockElevationMeters"));
});
