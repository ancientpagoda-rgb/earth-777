import test from "node:test";
import assert from "node:assert/strict";

import {
  direct777Datasets,
  reconstructionDatasetBySourceId,
  reconstructionDatasetsForField
} from "../src/reconstruction/ReconstructionDatasetCatalog.js";
import { RECONSTRUCTION_STREAMS } from "../src/reconstruction/ReconstructionAssimilation.js";

test("modern ETOPO is an anchor requiring hindcast rather than a direct 777 ka terrain claim", () => {
  const etopo = reconstructionDatasetBySourceId("etopo-2022");
  assert.equal(etopo.stream, RECONSTRUCTION_STREAMS.MODERN);
  assert.equal(etopo.direct777Constraint, false);
  assert.match(etopo.targetRelation, /requires-hindcast/);
});

test("published exact-777-ka climate remains a direct paleo constraint", () => {
  const krapp = reconstructionDatasetBySourceId("krapp-2021");
  assert.equal(krapp.stream, RECONSTRUCTION_STREAMS.PALEO);
  assert.equal(krapp.direct777Constraint, true);
  assert.ok(reconstructionDatasetsForField("monthlyTemperature").some((entry) => entry.sourceId === "krapp-2021"));
});

test("canonical direct target datasets never include modern ETOPO", () => {
  const direct = direct777Datasets().map((entry) => entry.sourceId);
  assert.ok(direct.includes("krapp-2021"));
  assert.ok(direct.includes("ruddiman-2018-mis19"));
  assert.ok(direct.includes("la2004"));
  assert.ok(direct.includes("spratt-lisiecki-2016"));
  assert.ok(!direct.includes("etopo-2022"));
});
