import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMERGENT_CULTURE_CLASSIFIER_POLICY,
  classifyEmergentCulture
} from "../src/render/EmergentCultureClassifier.js";

const classifierUrl = new URL("../src/render/EmergentCultureClassifier.js", import.meta.url);
const lineageUrl = new URL("../src/sim/HomininLineages.js", import.meta.url);
const waterUrl = new URL("../src/sim/HomininWaterTransport.js", import.meta.url);
const conflictUrl = new URL("../src/sim/HomininConflictConstruction.js", import.meta.url);

test("observer classifier is silent when generic mechanisms have not produced the phenomena", () => {
  const result = classifyEmergentCulture({
    highDefensePersistentSiteCount: 0,
    waterborneSeizureEdgeCount: 0
  });
  assert.equal(result.policy, EMERGENT_CULTURE_CLASSIFIER_POLICY);
  assert.deepEqual(result.observations, []);
});

test("observer can recognize castle-like and pirate-like outcomes after generic mechanisms produce them", () => {
  const telemetry = Object.freeze({
    highDefensePersistentSiteCount: 2,
    waterborneSeizureEdgeCount: 3
  });
  const before = JSON.stringify(telemetry);
  const result = classifyEmergentCulture(telemetry);
  assert.equal(JSON.stringify(telemetry), before);
  assert.equal(result.observations.length, 2);
  assert.ok(result.observations.some((entry) => entry.id === "castle-like" && entry.count === 2));
  assert.ok(result.observations.some((entry) => entry.id === "pirate-like" && entry.count === 3));
  assert.match(result.epistemicStatus, /presentation-only/);
});

test("familiar labels exist only in the observer layer and never feed the simulation mechanisms", () => {
  const classifier = readFileSync(classifierUrl, "utf8");
  const lineage = readFileSync(lineageUrl, "utf8");
  const water = readFileSync(waterUrl, "utf8");
  const conflict = readFileSync(conflictUrl, "utf8");
  assert.match(classifier, /castle-like/);
  assert.match(classifier, /pirate-like/);
  assert.doesNotMatch(`${lineage}\n${water}\n${conflict}`, /EmergentCultureClassifier/);
  assert.doesNotMatch(`${water}\n${conflict}`, /pirate|castle/i);
});
