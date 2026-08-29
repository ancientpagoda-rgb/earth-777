import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const baselinePath = process.env.EARTH777_LITE_BASELINE_FILE || "earth-777-lite-baseline.json";
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const averageFps = Number(baseline.metrics?.averageFps);
const onePercentLowFps = Number(baseline.metrics?.onePercentLowFps);

if (!(averageFps > 0) || !(onePercentLowFps > 0)) {
  throw new Error(`Baseline ${baselinePath} is missing valid FPS metrics.`);
}

const child = spawnSync(
  process.execPath,
  ["test/cdp-lite-acceptance.mjs", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EARTH777_LITE_BASELINE_FPS: String(averageFps),
      EARTH777_LITE_BASELINE_1P_LOW_FPS: String(onePercentLowFps),
    },
  },
);

if (child.error) throw child.error;
process.exit(child.status ?? 1);
