import test from "node:test";
import assert from "node:assert/strict";
import { WorldStreamScheduler, WORLD_STREAM_POLICY } from "../src/sim/WorldStreamScheduler.js";

test("world stream hierarchy expands only around an observed focus", () => {
  const scheduler = new WorldStreamScheduler({ clock: () => 0 });

  let diagnostics = scheduler.diagnostics();
  assert.equal(diagnostics.policy, WORLD_STREAM_POLICY);
  assert.equal(diagnostics.activeCellCount, 1);
  assert.deepEqual(diagnostics.activeByScope, { global: 1 });

  scheduler.setFocus({ latitude: 39, longitude: -95, mode: "globe" });
  diagnostics = scheduler.diagnostics();
  assert.equal(diagnostics.activeByScope.global, 1);
  assert.equal(diagnostics.activeByScope.regional, 9);
  assert.equal(diagnostics.activeCellCount, 10);

  scheduler.setFocus({ latitude: 39, longitude: -95, mode: "surface" });
  diagnostics = scheduler.diagnostics();
  assert.equal(diagnostics.activeByScope.global, 1);
  assert.equal(diagnostics.activeByScope.regional, 9);
  assert.equal(diagnostics.activeByScope.local, 9);
  assert.equal(diagnostics.activeByScope.observed, 9);
  assert.equal(diagnostics.activeCellCount, 28);
});

test("scope gating prevents observed systems from running while only globe scopes are active", () => {
  let now = 0;
  let runs = 0;
  const scheduler = new WorldStreamScheduler({ clock: () => now });
  scheduler.registerSystem({
    id: "individual-fauna",
    scope: "observed",
    run() { runs += 1; return 1; }
  });

  scheduler.setFocus({ latitude: 39, longitude: -95, mode: "globe" });
  scheduler.pump({ now, budgetMs: 2 });
  assert.equal(runs, 0);

  scheduler.setFocus({ latitude: 39, longitude: -95, mode: "surface" });
  scheduler.pump({ now, budgetMs: 2 });
  assert.equal(runs, 1);
});

test("minimum intervals provide temporal scheduling without catch-up loops", () => {
  let now = 0;
  let runs = 0;
  const scheduler = new WorldStreamScheduler({ clock: () => now });
  scheduler.registerSystem({
    id: "regional-climate",
    scope: "global",
    minIntervalMs: 100,
    run() { runs += 1; return 1; }
  });

  scheduler.pump({ now, budgetMs: 2 });
  assert.equal(runs, 1);

  now = 50;
  scheduler.pump({ now, budgetMs: 2 });
  assert.equal(runs, 1);

  now = 100;
  scheduler.pump({ now, budgetMs: 2 });
  assert.equal(runs, 2);
});

test("the frame budget stops lower-priority work after expensive higher-priority work", () => {
  let now = 0;
  const order = [];
  const scheduler = new WorldStreamScheduler({ clock: () => now });
  scheduler.registerSystem({
    id: "terrain",
    scope: "global",
    priority: 100,
    run() {
      order.push("terrain");
      now += 1.2;
      return 3;
    }
  });
  scheduler.registerSystem({
    id: "ecology",
    scope: "global",
    priority: 70,
    run() {
      order.push("ecology");
      now += 0.2;
      return 2;
    }
  });

  const result = scheduler.pump({ now, budgetMs: 1 });
  assert.deepEqual(order, ["terrain"]);
  assert.equal(result.workUnits, 3);
  assert.equal(result.budgetExhausted, true);
});

test("starvation boost gives deferred lower-priority work a turn on a later pump", () => {
  let now = 0;
  const order = [];
  const scheduler = new WorldStreamScheduler({ clock: () => now });
  scheduler.registerSystem({
    id: "terrain",
    scope: "global",
    priority: 100,
    run() {
      order.push("terrain");
      now += 0.8;
      return 1;
    }
  });
  scheduler.registerSystem({
    id: "ecology",
    scope: "global",
    priority: 70,
    run() {
      order.push("ecology");
      now += 0.1;
      return 1;
    }
  });

  scheduler.pump({ now, budgetMs: 0.7 });
  assert.deepEqual(order, ["terrain"]);

  scheduler.pump({ now, budgetMs: 0.7 });
  assert.equal(order[1], "ecology");
});
