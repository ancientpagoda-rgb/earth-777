import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/quiet-defaults.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("default globe keeps world, journal and performance data off the canvas", () => {
  assert.doesNotMatch(html, /class="[^"]*state-panel[^"]*"/);
  assert.doesNotMatch(html, /class="[^"]*journal panel[^"]*"/);
  assert.match(html, /id="sources-modal"[\s\S]*id="stage-readout"/);
  assert.match(html, /id="sources-modal"[\s\S]*id="journal-list"/);
  assert.match(html, /id="sources-modal"[\s\S]*id="perf-hud"/);
  assert.match(css, /\.location-panel:not\(\[open\]\)/);
  assert.match(css, /\.location-panel #location-detail\s*\{[\s\S]*display:\s*none/);
});

test("timeline defaults to 1x while retaining higher speed choices", () => {
  assert.match(html, /<select id="speed-select"/);
  assert.match(html, /<option value="1" selected>1×<\/option>/);
  assert.match(html, /<option value="10000">10K×<\/option>/);
  assert.doesNotMatch(html, /data-speed=/);
  assert.match(main, /let speed = 1;/);
  assert.match(main, /ui\.speedSelect\.addEventListener\("change"/);
  assert.match(main, /setSpeed\(Number\(ui\.speedSelect\.value\) \|\| 1\)/);
});

test("region selection opens one compact observation card", () => {
  assert.match(html, /<details class="location-panel panel drawer-panel"/);
  assert.match(main, /ui\.locationPanel\.open = true/);
  assert.match(css, /\.location-panel\s*\{[\s\S]*width:\s*218px/);
  assert.match(css, /\.location-panel #location-detail\s*\{[\s\S]*display:\s*none/);
});

test("performance diagnostics only work when their DATA detail is opened", () => {
  assert.match(html, /<details class="data-section perf-hud" id="perf-hud"/);
  assert.match(main, /!ui\.perfHud\.open/);
  assert.match(main, /addEventListener\("toggle"/);
  assert.doesNotMatch(main, /updatePerformanceHud\(performance\.now\(\), true\);\s*requestFrame\(\);\s*$/m);
});

test("source ledger and journal content are populated only when DATA opens", () => {
  assert.match(main, /let sourcesPopulated = false/);
  assert.match(main, /if \(!sourcesPopulated\)\s*\{\s*populateSources\(\)/);
  assert.match(main, /if \(isSourcesOpen\(\)\) updateJournal\(state\)/);
  assert.doesNotMatch(main, /\npopulateSources\(\);\nupdateInteractionHint/);
});

test("world data still exposes aggregate hominin state inside DATA", () => {
  assert.match(html, /id="sources-modal"[\s\S]*id="hominin-readout"/);
  assert.match(main, /state\.homininPopulationIndex/);
});
