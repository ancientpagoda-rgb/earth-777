import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function report(profile = "full") {
  return {
    generatedAt: "2026-08-29T00:00:00.000Z",
    profile,
    thresholds: { averageFps: 55, onePercentLowFps: 30, maxPerformanceRegressionFraction: 0.1 },
    results: [
      { id: "performance", status: profile === "full" ? "PASS" : "PROXY_PASS", metrics: { averageFps: 61.5, onePercentLowFps: 42.1, maxFrameMs: 31 } },
      { id: "no-degradation", status: profile === "full" ? "PASS" : "PROXY_PASS", metrics: { fpsLossFraction: 0.03, heapChangeFraction: 0.02 } },
      { id: "high-speed-simulation", status: profile === "full" ? "PASS" : "PROXY_PASS", metrics: { hundredX: { maxFrameMs: 28 }, thousandX: { maxFrameMs: 44 } } },
      { id: "load-time", status: "PASS", metrics: { cachedLoadMs: 910 } },
    ],
  };
}

test("records a baseline only from a passing full-profile report", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "earth777-baseline-"));
  try {
    const input = path.join(dir, "report.json");
    const output = path.join(dir, "baseline.json");
    writeFileSync(input, JSON.stringify(report()));
    const run = spawnSync(process.execPath, ["scripts/record-lite-baseline.mjs", input, output], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const baseline = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(baseline.schemaVersion, 1);
    assert.equal(baseline.metrics.averageFps, 61.5);
    assert.equal(baseline.metrics.onePercentLowFps, 42.1);
    assert.equal(baseline.metrics.cachedLoadMs, 910);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to promote a CI proxy report to representative baseline", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "earth777-baseline-ci-"));
  try {
    const input = path.join(dir, "report.json");
    const output = path.join(dir, "baseline.json");
    writeFileSync(input, JSON.stringify(report("ci")));
    const run = spawnSync(process.execPath, ["scripts/record-lite-baseline.mjs", input, output], { encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}${run.stderr}`, /Refusing to record a canonical performance baseline/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
