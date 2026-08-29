import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";

const reportPath = process.argv[2] || "earth-777-lite-acceptance.json";
const outputPath = process.argv[3] || "earth-777-lite-baseline.json";
const report = JSON.parse(readFileSync(reportPath, "utf8"));

if (report.profile !== "full") {
  throw new Error(`Refusing to record a canonical performance baseline from profile '${report.profile}'. Run the full profile on representative desktop hardware.`);
}

const byId = new Map((report.results || []).map((result) => [result.id, result]));
const performance = byId.get("performance");
const stability = byId.get("no-degradation");
const highSpeed = byId.get("high-speed-simulation");

for (const [name, result] of [["performance", performance], ["20-minute stability", stability], ["high-speed simulation", highSpeed]]) {
  if (!result || result.status !== "PASS") {
    throw new Error(`Refusing to record baseline because ${name} is ${result?.status || "missing"}.`);
  }
}

const averageFps = Number(performance.metrics?.averageFps);
const onePercentLowFps = Number(performance.metrics?.onePercentLowFps);
if (!(averageFps > 0) || !(onePercentLowFps > 0)) {
  throw new Error("Full report is missing usable average FPS / 1% low metrics.");
}

let sourceCommit = process.env.GITHUB_SHA || null;
if (!sourceCommit) {
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    sourceCommit = "unknown";
  }
}

const cpus = os.cpus();
const baseline = {
  schemaVersion: 1,
  name: process.env.EARTH777_LITE_BASELINE_NAME || "Earth 777 Lite performance baseline #1",
  purpose: "Representative-hardware baseline for the accepted <=10% performance-regression rule.",
  recordedAt: new Date().toISOString(),
  acceptanceReportGeneratedAt: report.generatedAt,
  sourceCommit,
  sourceReport: reportPath,
  hardware: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model || "unknown",
    logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
  },
  thresholds: report.thresholds,
  metrics: {
    averageFps,
    onePercentLowFps,
    maxFrameMs: Number(performance.metrics?.maxFrameMs),
    cachedLoadMs: Number(byId.get("load-time")?.metrics?.cachedLoadMs),
    soakFpsLossFraction: Number(stability.metrics?.fpsLossFraction),
    soakHeapChangeFraction: stability.metrics?.heapChangeFraction ?? null,
    hundredXMaxFrameMs: Number(highSpeed.metrics?.hundredX?.maxFrameMs),
    thousandXMaxFrameMs: Number(highSpeed.metrics?.thousandX?.maxFrameMs),
  },
};

writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Recorded ${baseline.name}`);
console.log(`  average FPS: ${averageFps.toFixed(1)}`);
console.log(`  1% low FPS: ${onePercentLowFps.toFixed(1)}`);
console.log(`  commit: ${sourceCommit}`);
console.log(`  file: ${outputPath}`);
console.log("Future full runs can enforce this baseline with npm run test:acceptance:lite:baseline -- <CDP_ENDPOINT> --profile=full");
