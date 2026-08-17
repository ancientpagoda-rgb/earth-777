const endpoint = process.argv[2];
if (!endpoint) throw new Error("CDP WebSocket endpoint required");

const socket = new WebSocket(endpoint);
let nextId = 0;
const pending = new Map();
const runtimeMessages = [];
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (["Runtime.exceptionThrown", "Log.entryAdded"].includes(message.method)) {
    runtimeMessages.push(message);
  }
});

await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || "Runtime.evaluate failed");
  return response.result?.result?.value;
};
const quantile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
};
const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Performance.enable");
await send("Page.reload", { ignoreCache: true });
await wait(2_500);

const performanceMetrics = async () => {
  const response = await send("Performance.getMetrics");
  return Object.fromEntries((response.result?.metrics ?? []).map(({ name, value }) => [name, Number(value) || 0]));
};
const metricDelta = (before, after) => Object.fromEntries([
  "TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "JSHeapUsedSize"
].map((key) => [key, round((after[key] ?? 0) - (before[key] ?? 0), key === "JSHeapUsedSize" ? 0 : 4)]));

await evaluate(`(() => {
  const metrics = window.__earth777Playtest = { segments: [], current: null, longTasks: [] };
  window.__earth777StartPlaytestSegment = () => {
    const segment = { frames: [], last: null, active: true, startedAt: performance.now() };
    metrics.current = segment;
    metrics.segments.push(segment);
    const tick = (now) => {
      if (!segment.active) return;
      if (segment.last != null) segment.frames.push(now - segment.last);
      segment.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  };
  window.__earth777StopPlaytestSegment = () => {
    const segment = metrics.current;
    if (!segment) return { frames: [], startedAt: 0, endedAt: 0, durationMs: 0 };
    segment.active = false;
    segment.endedAt = performance.now();
    metrics.current = null;
    return { frames: segment.frames, startedAt: segment.startedAt, endedAt: segment.endedAt, durationMs: segment.endedAt - segment.startedAt };
  };
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    });
    observer.observe({ entryTypes: ["longtask"] });
    metrics.observer = observer;
  } catch {}
  return true;
})()`);

const bounds = await evaluate(`(() => {
  const rect = document.querySelector("#earth").getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
})()`);
if (!bounds?.width || !bounds?.height) throw new Error("globe canvas has no usable bounds");

const point = (rx, ry) => ({ x: bounds.x + bounds.width * rx, y: bounds.y + bounds.height * ry });
const center = point(0.5, 0.5);
const gestures = [
  [center, point(0.78, 0.33)],
  [point(0.63, 0.48), point(0.24, 0.68)],
  [point(0.45, 0.55), point(0.77, 0.73)],
  [point(0.56, 0.46), point(0.25, 0.29)],
  [point(0.42, 0.52), point(0.72, 0.43)]
];

async function summarize(segments, pointerMoves) {
  const frames = segments.flatMap((segment) => segment.frames || []).filter((value) => value > 0 && value < 1_000);
  const allLongTasks = await evaluate(`window.__earth777Playtest?.longTasks ?? []`);
  const longTasks = (allLongTasks ?? []).filter((task) => segments.some((segment) => {
    const taskEnd = task.startTime + task.duration;
    return task.startTime < segment.endedAt && taskEnd > segment.startedAt;
  }));
  const p50 = quantile(frames, 0.5);
  const p95 = quantile(frames, 0.95);
  const p99 = quantile(frames, 0.99);
  const maxFrame = frames.length ? Math.max(...frames) : 0;
  const over33ms = frames.filter((value) => value > 33.4).length;
  const over50ms = frames.filter((value) => value > 50).length;
  const maxLongTask = longTasks.length ? Math.max(...longTasks.map((task) => task.duration)) : 0;
  return {
    gestures: gestures.length,
    pointerMoves,
    sampledFrames: frames.length,
    frameMs: { p50: round(p50), p95: round(p95), p99: round(p99), max: round(maxFrame) },
    over33ms,
    over50ms,
    over33Pct: round(frames.length ? over33ms / frames.length * 100 : 0),
    over50Pct: round(frames.length ? over50ms / frames.length * 100 : 0),
    estimatedDroppedFrames: frames.reduce((total, frameMs) => total + Math.max(0, Math.round(frameMs / (1000 / 60)) - 1), 0),
    longTasks: { count: longTasks.length, maxMs: round(maxLongTask), entries: longTasks.map((task) => ({ startTime: round(task.startTime), duration: round(task.duration) })) },
    smoothness: p95 <= 20 ? "smooth" : p95 <= 33.4 ? "mostly-smooth" : p95 <= 50 ? "visible-stutter-likely" : "heavy-stutter"
  };
}

async function runGestureSet() {
  const segments = [];
  let pointerMoves = 0;
  for (const [start, end] of gestures) {
    await evaluate(`window.__earth777StartPlaytestSegment()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
    const steps = 22;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const curve = Math.sin(t * Math.PI) * bounds.height * 0.035;
      const x = start.x + (end.x - start.x) * t;
      const y = start.y + (end.y - start.y) * t + (step % 2 ? curve : -curve * 0.35);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      pointerMoves += 1;
      await wait(12);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1 });
    await wait(80);
    segments.push(await evaluate(`window.__earth777StopPlaytestSegment()`));
    await wait(120);
  }
  return { summary: await summarize(segments, pointerMoves), segments };
}

const idleMetricsBefore = await performanceMetrics();
const idleRun = await runGestureSet();
const idleMetricsAfter = await performanceMetrics();
const idleDrag = { ...idleRun.summary, browser: metricDelta(idleMetricsBefore, idleMetricsAfter) };
await wait(1_000);

const elapsedBefore = await evaluate(`Number(document.querySelector("#timeline-range")?.value) || 0`);
const playStarted = await evaluate(`(() => {
  const button = document.querySelector("#play-button");
  button.click();
  return button.classList.contains("is-playing");
})()`);
await wait(300);
const playMetricsBefore = await performanceMetrics();
const playRun = await runGestureSet();
const playMetricsAfter = await performanceMetrics();
const playDrag = { ...playRun.summary, browser: metricDelta(playMetricsBefore, playMetricsAfter) };

await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: -180 });
await wait(100);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: 120 });
await wait(1_250);
const playbackState = await evaluate(`({
  elapsed: Number(document.querySelector("#timeline-range")?.value) || 0,
  playing: document.querySelector("#play-button")?.classList.contains("is-playing") === true
})`);
await evaluate(`document.querySelector("#play-button")?.click()`);
await wait(100);

await send("Input.dispatchMouseEvent", { type: "mousePressed", x: center.x, y: center.y, button: "left", buttons: 1, clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: center.x, y: center.y, button: "left", buttons: 0, clickCount: 1 });
await wait(180);
const regionSelected = await evaluate(`document.querySelector("#surface-button")?.disabled === false`);

const fatalMessages = runtimeMessages.filter((message) =>
  message.method === "Runtime.exceptionThrown" || message.params?.entry?.level === "error"
);
const report = {
  environment: "GitHub Actions headless Chrome / SwiftShader; useful for regression detection, not a direct measurement of the user's GPU",
  profiler: "long-task entries are attributed by startTime/duration overlap; CDP Performance deltas accompany each gesture set",
  playStarted,
  playStayedActive: playbackState?.playing === true,
  playbackResumedAfterInteraction: Number(playbackState?.elapsed) > elapsedBefore,
  elapsedBefore,
  elapsedAfter: playbackState?.elapsed,
  regionSelected,
  idleDrag,
  playDrag,
  playPenaltyMs: {
    p50: round(playDrag.frameMs.p50 - idleDrag.frameMs.p50),
    p95: round(playDrag.frameMs.p95 - idleDrag.frameMs.p95)
  },
  fatalRuntimeMessages: fatalMessages.length
};

const checks = [
  [playStarted, "Play did not start"],
  [playbackState?.playing === true, "Play stopped unexpectedly during interaction"],
  [Number(playbackState?.elapsed) > elapsedBefore, "simulation did not resume after globe interaction settled"],
  [regionSelected, "region selection failed after repeated drag/zoom interaction"],
  [idleDrag.pointerMoves >= 100 && playDrag.pointerMoves >= 100, "playtest did not generate enough pointer movement"],
  [idleDrag.sampledFrames >= 30 && playDrag.sampledFrames >= 30, "playtest captured too few animation frames"],
  [playDrag.frameMs.p95 < 100, `catastrophic interaction frame time: p95 ${playDrag.frameMs.p95} ms`],
  [playDrag.frameMs.max < 250, `catastrophic single-frame hitch: ${playDrag.frameMs.max} ms`],
  [fatalMessages.length === 0, "runtime errors were reported during playtest"]
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

console.log("EARTH_777_PLAYTEST " + JSON.stringify(report));
socket.close();
if (failures.length) throw new Error(failures.join("; "));
