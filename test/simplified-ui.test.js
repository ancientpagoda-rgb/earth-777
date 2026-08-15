import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("secondary HUD panels are collapsed native drawers by default", () => {
  for (const className of ["state-panel", "location-panel", "perf-hud", "journal"]) {
    assert.match(html, new RegExp(`<details class="[^"]*${className}[^"]*"`));
  }
  assert.doesNotMatch(html, /<details[^>]+\sopen(?:\s|>)/i);
  assert.match(css, /\.drawer-panel\s*>\s*summary/);
});

test("timeline uses one speed selector instead of a row of speed buttons", () => {
  assert.match(html, /<select id="speed-select"/);
  assert.match(html, /<option value="100" selected>100×<\/option>/);
  assert.doesNotMatch(html, /data-speed=/);
  assert.match(main, /ui\.speedSelect\.addEventListener\("change"/);
  assert.doesNotMatch(main, /querySelectorAll\("\[data-speed\]"\)/);
});

test("region selection opens observation while surface mode collapses diagnostics", () => {
  assert.match(main, /ui\.locationPanel\.open = true/);
  assert.match(main, /ui\.statePanel\.open = false/);
  assert.match(main, /ui\.journalPanel\.open = false/);
  assert.match(main, /ui\.perfHud\.open = false/);
});

test("collapsed performance panel does not keep doing HUD work", () => {
  assert.match(main, /!ui\.perfHud\.open/);
  assert.match(main, /addEventListener\("toggle"/);
});

test("compact world summary exposes aggregate hominin state", () => {
  assert.match(html, /id="hominin-readout"/);
  assert.match(main, /state\.homininPopulationIndex/);
  assert.match(html, /<i>hominins<\/i>/);
});
