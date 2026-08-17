import assert from "node:assert/strict";
import test from "node:test";
import { SimulationWorkerClient } from "../src/sim/SimulationWorkerClient.js";

class FakeWorker {
  constructor() {
    this.sent = [];
    this.listeners = { message: [], error: [] };
  }

  addEventListener(type, listener) {
    this.listeners[type]?.push(listener);
  }

  postMessage(message) {
    this.sent.push(message);
  }

  emit(message) {
    for (const listener of this.listeners.message) listener({ data: message });
  }

  terminate() {}
}

function readyClient() {
  const worker = new FakeWorker();
  const states = [];
  const client = new SimulationWorkerClient({ worker, seed: 777001, onState: (result) => states.push(result) });
  const init = worker.sent[0];
  worker.emit({
    type: "ready",
    requestId: init.requestId,
    version: init.version,
    state: { yearBP: 777000 },
    fidelity: { targets: [] },
    durationMs: 1
  });
  return { worker, client, states };
}

test("coalesces advance requests while one worker advance is in flight", async () => {
  const { worker, client } = readyClient();
  await client.ready;

  client.queueAdvance(5);
  const firstAdvance = worker.sent.at(-1);
  assert.equal(firstAdvance.type, "advance");
  assert.equal(firstAdvance.years, 5);

  client.queueAdvance(7);
  client.queueAdvance(9);
  assert.equal(worker.sent.filter((message) => message.type === "advance").length, 1);
  assert.equal(client.diagnostics().pendingAdvanceYears, 16);

  worker.emit({
    type: "advance",
    requestId: firstAdvance.requestId,
    version: firstAdvance.version,
    state: { yearBP: 776995 },
    fidelity: { targets: [] },
    durationMs: 4
  });

  const advances = worker.sent.filter((message) => message.type === "advance");
  assert.equal(advances.length, 2);
  assert.equal(advances[1].years, 16);
});

test("discards stale advance state after a version-changing seek", async () => {
  const { worker, client, states } = readyClient();
  await client.ready;

  client.queueAdvance(10);
  const advance = worker.sent.at(-1);
  const seekPromise = client.seek(2000);
  const seek = worker.sent.at(-1);
  assert.equal(seek.type, "seek");
  assert.notEqual(seek.version, advance.version);

  worker.emit({
    type: "advance",
    requestId: advance.requestId,
    version: advance.version,
    state: { yearBP: 776990 },
    fidelity: { targets: [] },
    durationMs: 8
  });
  assert.equal(states.length, 0);

  worker.emit({
    type: "seek",
    requestId: seek.requestId,
    version: seek.version,
    state: { yearBP: 775000 },
    fidelity: { targets: [] },
    durationMs: 12
  });
  const result = await seekPromise;
  assert.equal(result.state.yearBP, 775000);
  assert.equal(states.length, 1);
  assert.equal(states[0].type, "seek");
});

test("clearPendingAdvance removes work that has not been sent yet", async () => {
  const { worker, client } = readyClient();
  await client.ready;

  client.queueAdvance(5);
  const firstAdvance = worker.sent.at(-1);
  client.queueAdvance(25);
  client.clearPendingAdvance();
  assert.equal(client.diagnostics().pendingAdvanceYears, 0);

  worker.emit({
    type: "advance",
    requestId: firstAdvance.requestId,
    version: firstAdvance.version,
    state: { yearBP: 776995 },
    fidelity: { targets: [] },
    durationMs: 5
  });
  assert.equal(worker.sent.filter((message) => message.type === "advance").length, 1);
});
