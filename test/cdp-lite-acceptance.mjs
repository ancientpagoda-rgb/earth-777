import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  LITE_ACCEPTANCE_CRITERIA,
  LITE_ACCEPTANCE_THRESHOLDS as T,
} from "./lite-acceptance-spec.mjs";

const endpoint = process.argv.find((arg) => arg.startsWith("ws://") || arg.startsWith("wss://")) || process.env.CDP_ENDPOINT;
if (!endpoint) throw new Error("CDP WebSocket endpoint required");
const profileArg = process.argv.find((arg) => arg.startsWith("--profile="));
const profile = profileArg?.split("=")[1] || process.env.EARTH777_ACCEPTANCE_PROFILE || "ci";
if (!["ci", "full"].includes(profile)) throw new Error(`Unknown acceptance profile: ${profile}`);

const CONFIG = profile === "full"
  ? {
      performanceSampleMs: 10_000,
      hundredXMs: T.hundredXObservationMinutes * 60_000,
      thousandXMs: 10_000,
      soakMs: T.soakMinutes * 60_000,
      soakPoints: 9,
      minimumEvolutionCycles: T.minimumEvolutionCycles,
    }
  : {
      performanceSampleMs: 3_500,
      hundredXMs: 8_000,
      thousandXMs: 3_500,
      soakMs: 15_000,
      soakPoints: 4,
      minimumEvolutionCycles: 15,
    };

const PAGE_URL = "http://127.0.0.1:4173/earth-777/lite/?seed=777&year=0&layer=terrain&lat=0&lon=25";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const socket = new WebSocket(endpoint);
let nextId = 0;
const pending = new Map();
const runtimeMessages = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (["Runtime.exceptionThrown", "Log.entryAdded"].includes(message.method)) runtimeMessages.push(message);
});

await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || "Runtime.evaluate failed");
  return response.result?.result?.value;
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Performance.enable");

async function pageState() {
  return evaluate(`(() => ({
    ready: document.readyState,
    status: document.querySelector('#status')?.textContent ?? 'missing',
    canvas: document.querySelectorAll('canvas').length,
    worker: document.body.dataset.worker ?? '',
    quality: document.body.dataset.quality ?? '',
    textureVersion: Number(document.body.dataset.textureVersion ?? 0),
    mode: document.body.classList.contains('surface') ? 'surface' : 'globe',
    modeButton: document.querySelector('#mode')?.textContent ?? '',
    place: document.querySelector('#place')?.textContent ?? '',
    year: document.querySelector('#year')?.textContent ?? '',
    temperature: document.querySelector('#temperature')?.textContent ?? '',
    sea: document.querySelector('#sea')?.textContent ?? '',
    green: document.querySelector('#green')?.textContent ?? '',
    contextLosses: Number(window.__earth777AcceptanceContextLosses ?? 0)
  }))()`);
}

async function waitForReady(timeoutMs = 15_000) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < timeoutMs) {
    state = await pageState();
    if (state?.ready === "complete" && state.canvas === 1 && state.worker === "ready" && state.status === "") {
      return { elapsedMs: Date.now() - start, state };
    }
    await wait(100);
  }
  throw new Error(`Lite page failed to become interactive: ${JSON.stringify(state)}`);
}

async function navigate(url = PAGE_URL) {
  const started = Date.now();
  await send("Page.navigate", { url });
  const ready = await waitForReady();
  return { wallMs: Date.now() - started, ...ready };
}

async function pauseSimulation() {
  return evaluate(`(() => {
    const button = document.querySelector('#play');
    if (button?.textContent === 'Ⅱ') button.click();
    return button?.textContent ?? '';
  })()`);
}

async function setSpeed(speed, play = true) {
  return evaluate(`(() => {
    document.querySelector('[data-speed="${speed}"]')?.click();
    const button = document.querySelector('#play');
    const isPlaying = button?.textContent === 'Ⅱ';
    if (${play ? "true" : "false"} !== isPlaying) button?.click();
    return { speed: document.querySelector('.speed.on')?.dataset.speed ?? '', play: button?.textContent ?? '' };
  })()`);
}

async function sampleFrames(durationMs) {
  return evaluate(`new Promise((resolve) => {
    const duration = ${Math.round(durationMs)};
    const deltas = [];
    let start = performance.now();
    let previous = start;
    const tick = (now) => {
      if (now !== previous) deltas.push(now - previous);
      previous = now;
      if (now - start >= duration) {
        const useful = deltas.filter((delta) => Number.isFinite(delta) && delta > 0);
        const sorted = [...useful].sort((a, b) => a - b);
        const mean = useful.reduce((sum, value) => sum + value, 0) / Math.max(1, useful.length);
        const p99 = sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * .99) - 1))] || Infinity;
        resolve({
          frames: useful.length,
          averageFps: mean > 0 ? 1000 / mean : 0,
          onePercentLowFps: p99 > 0 ? 1000 / p99 : 0,
          maxFrameMs: useful.length ? Math.max(...useful) : Infinity,
          elapsedMs: now - start
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
}

async function heapUsage() {
  const response = await send("Runtime.getHeapUsage");
  return Number(response.result?.usedSize ?? 0);
}

function percentChange(before, after) {
  if (!(before > 0)) return null;
  return (after - before) / before;
}

function parseSurfacePlace(place) {
  const match = String(place).match(/([\d.]+)°([NS])\s+([\d.]+)°([EW])\s+·\s+([\d.]+)\s+km/);
  if (!match) return null;
  const lat = Number(match[1]) * (match[2] === "S" ? -1 : 1);
  const lon = Number(match[3]) * (match[4] === "W" ? -1 : 1);
  return { lat, lon, spanKm: Number(match[5]) };
}

async function dispatchSurfaceKeys(code, count) {
  return evaluate(`(() => {
    for (let i = 0; i < ${count}; i += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${code}', bubbles: true }));
    }
    return true;
  })()`);
}

async function zoomCycles(count) {
  return evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    for (let i = 0; i < ${count}; i += 1) {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 320, bubbles: true, cancelable: true }));
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -320, bubbles: true, cancelable: true }));
    }
    return true;
  })()`);
}

async function screenshotHash() {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const data = shot.result?.data || "";
  return createHash("sha256").update(data).digest("hex");
}

async function installContextLossCounter() {
  return evaluate(`(() => {
    window.__earth777AcceptanceContextLosses = 0;
    const canvas = document.querySelector('canvas');
    canvas?.addEventListener('webglcontextlost', () => { window.__earth777AcceptanceContextLosses += 1; });
    return Boolean(canvas);
  })()`);
}

function messageText(message) {
  if (message.method === "Runtime.exceptionThrown") return message.params?.exceptionDetails?.text || "Runtime exception";
  return message.params?.entry?.text || "Log error";
}

const results = new Map(LITE_ACCEPTANCE_CRITERIA.map((criterion) => [criterion.id, {
  id: criterion.id,
  label: criterion.label,
  canonical: criterion.canonical,
  status: "MANUAL",
  details: "Requires visual, fault-injection, or hardware-specific review.",
  metrics: {},
}]));
const setResult = (id, status, details, metrics = {}) => {
  const result = results.get(id);
  if (!result) throw new Error(`Unknown acceptance criterion ${id}`);
  Object.assign(result, { status, details, metrics });
};

// Warm cache, then measure a second load.
await navigate();
const cachedLoad = await navigate();
await installContextLossCounter();
await pauseSimulation();
setResult(
  "load-time",
  cachedLoad.wallMs <= T.cachedInteractiveMs ? "PASS" : "FAIL",
  `Cached second navigation became interactive in ${cachedLoad.wallMs} ms (target <=${T.cachedInteractiveMs} ms).`,
  { cachedLoadMs: cachedLoad.wallMs },
);

// Desktop-browser performance. CI uses SwiftShader, so only the full profile can certify the canonical FPS thresholds.
const perfBefore = await sampleFrames(CONFIG.performanceSampleMs);
if (profile === "full") {
  const passed = perfBefore.averageFps >= T.averageFps && perfBefore.onePercentLowFps >= T.onePercentLowFps;
  setResult(
    "performance",
    passed ? "PASS" : "FAIL",
    `Average ${perfBefore.averageFps.toFixed(1)} FPS; 1% low ${perfBefore.onePercentLowFps.toFixed(1)} FPS.`,
    perfBefore,
  );
} else {
  const proxyPassed = perfBefore.averageFps >= 12.5 && perfBefore.maxFrameMs < T.maxEventLoopStallMs;
  setResult(
    "performance",
    proxyPassed ? "PROXY_PASS" : "FAIL",
    `Headless SwiftShader proxy: ${perfBefore.averageFps.toFixed(1)} FPS average, max frame ${perfBefore.maxFrameMs.toFixed(1)} ms. Canonical 55/30 FPS requires --profile=full on representative desktop hardware.`,
    perfBefore,
  );
}

// 100x evolution responsiveness and cycle continuity.
const hundredStart = await pageState();
await setSpeed(100, true);
const hundredFrames = await sampleFrames(CONFIG.hundredXMs);
const hundredEnd = await pageState();
await pauseSimulation();
const hundredTextureCycles = Math.max(0, hundredEnd.textureVersion - hundredStart.textureVersion);
const hundredResponsive = hundredEnd.year !== hundredStart.year && hundredFrames.maxFrameMs < T.maxEventLoopStallMs;

// 1000x responsiveness is sampled separately.
const thousandStart = await pageState();
await setSpeed(1000, true);
const thousandFrames = await sampleFrames(CONFIG.thousandXMs);
const thousandEnd = await pageState();
await pauseSimulation();
const thousandResponsive = thousandEnd.year !== thousandStart.year && thousandFrames.maxFrameMs < T.maxEventLoopStallMs;

if (profile === "full") {
  setResult(
    "high-speed-simulation",
    hundredResponsive && thousandResponsive ? "PASS" : "FAIL",
    `100x ran ${(CONFIG.hundredXMs / 60_000).toFixed(1)} min and 1000x remained interactive; max frame stalls ${hundredFrames.maxFrameMs.toFixed(1)} / ${thousandFrames.maxFrameMs.toFixed(1)} ms.`,
    { hundredX: hundredFrames, thousandX: thousandFrames, hundredTextureCycles },
  );
} else {
  setResult(
    "high-speed-simulation",
    hundredResponsive && thousandResponsive ? "PROXY_PASS" : "FAIL",
    `CI proxy confirmed both 100x and 1000x advance time without >${T.maxEventLoopStallMs} ms frame stalls. Full 5-minute 100x observation requires --profile=full.`,
    { hundredX: hundredFrames, thousandX: thousandFrames, hundredTextureCycles },
  );
}

setResult(
  "continuous-evolution",
  hundredTextureCycles >= CONFIG.minimumEvolutionCycles ? "PROXY_PASS" : "FAIL",
  `Observed ${hundredTextureCycles} fresh world-texture updates while 100x continued running; this detects one-step stalls but does not certify geological coherence.`,
  { textureCycles: hundredTextureCycles, requiredProxyCycles: CONFIG.minimumEvolutionCycles },
);
setResult(
  "simulation-continuity",
  hundredTextureCycles >= CONFIG.minimumEvolutionCycles && hundredEnd.temperature && hundredEnd.sea && hundredEnd.green ? "PROXY_PASS" : "FAIL",
  `Observed ${hundredTextureCycles} distinct rendered simulation updates with finite HUD state and no reset.`,
  { textureCycles: hundredTextureCycles, temperature: hundredEnd.temperature, sea: hundredEnd.sea, green: hundredEnd.green },
);

// Surface entry, persistence proxy, and long-distance movement.
await evaluate(`document.querySelector('#mode')?.click()`);
await wait(700);
const surfaceEntered = await pageState();
const surfaceStartParsed = parseSurfacePlace(surfaceEntered.place);
setResult(
  "region-to-surface",
  surfaceEntered.mode === "surface" && surfaceEntered.modeButton === "RETURN TO GLOBE" && Boolean(surfaceStartParsed) ? "PROXY_PASS" : "FAIL",
  surfaceEntered.mode === "surface"
    ? "One action entered surface mode at the selected coordinates. The Lite build currently has no separately instrumented region scene, so this is a direct-transition proxy."
    : "One action did not enter surface mode.",
  { place: surfaceEntered.place },
);

const firstSurfaceHash = await screenshotHash();
await evaluate(`document.querySelector('#mode')?.click()`);
await wait(250);
await evaluate(`document.querySelector('#mode')?.click()`);
await wait(700);
const returnedSurface = await pageState();
const secondSurfaceHash = await screenshotHash();
const persistentProxy = returnedSurface.place === surfaceEntered.place
  && returnedSurface.mode === "surface"
  && returnedSurface.canvas === 1;
setResult(
  "persistent-geography",
  persistentProxy ? "PROXY_PASS" : "FAIL",
  `Return-to-coordinate proxy ${persistentProxy ? "preserved" : "did not preserve"} the same surface location. Screenshot hash ${firstSurfaceHash === secondSurfaceHash ? "also matched" : "differed (render-only; not treated as failure)"}.`,
  { placeBefore: surfaceEntered.place, placeAfter: returnedSurface.place, screenshotMatch: firstSurfaceHash === secondSurfaceHash },
);

await dispatchSurfaceKeys("ArrowRight", T.minimumSurfaceViewportWidths * 8);
await wait(1200);
const travelled = await pageState();
const travelledParsed = parseSurfacePlace(travelled.place);
const movedDegrees = surfaceStartParsed && travelledParsed ? Math.abs(travelledParsed.lon - surfaceStartParsed.lon) : 0;
const travelProxyPassed = travelled.mode === "surface"
  && travelled.canvas === 1
  && travelled.status === ""
  && movedDegrees > 20;
setResult(
  "infinite-surface",
  travelProxyPassed ? "PROXY_PASS" : "FAIL",
  `Moved the surface camera by the equivalent of ${T.minimumSurfaceViewportWidths} horizontal viewport widths without losing the canvas or entering an error state. Visual edge/void inspection remains manual.`,
  { start: surfaceStartParsed, end: travelledParsed, movedLongitudeDegrees: movedDegrees },
);

await zoomCycles(T.zoomCycles);
await wait(1000);
const zoomed = await pageState();
setResult(
  "zoom",
  zoomed.mode === "surface" && zoomed.canvas === 1 && zoomed.status === "" ? "PROXY_PASS" : "FAIL",
  `Completed ${T.zoomCycles} paired zoom-out/zoom-in cycles without losing surface mode, canvas, or entering an error state. Visual popping remains manual.`,
  { placeAfterZoom: zoomed.place },
);

// Navigation while 100x is active.
const navStart = await pageState();
await setSpeed(100, true);
await dispatchSurfaceKeys("ArrowRight", 16);
const navFrames = await sampleFrames(3_000);
const navEnd = await pageState();
await pauseSimulation();
setResult(
  "navigation",
  navEnd.place !== navStart.place && navEnd.year !== navStart.year && navFrames.maxFrameMs < T.maxEventLoopStallMs ? "PROXY_PASS" : "FAIL",
  `Surface movement and simulation time both advanced at 100x; max observed frame stall ${navFrames.maxFrameMs.toFixed(1)} ms.`,
  { frameStats: navFrames, placeBefore: navStart.place, placeAfter: navEnd.place, yearBefore: navStart.year, yearAfter: navEnd.year },
);

// Return to globe before the soak.
await evaluate(`document.querySelector('#mode')?.click()`);
await wait(300);
await setSpeed(100, true);
const soakPerfBefore = await sampleFrames(Math.min(3_500, CONFIG.performanceSampleMs));
const heapSeries = [];
const soakPointDelay = Math.max(1, Math.floor(CONFIG.soakMs / CONFIG.soakPoints));
for (let point = 0; point <= CONFIG.soakPoints; point += 1) {
  heapSeries.push(await heapUsage());
  if (point < CONFIG.soakPoints) await wait(soakPointDelay);
}
const soakPerfAfter = await sampleFrames(Math.min(3_500, CONFIG.performanceSampleMs));
await pauseSimulation();
const fpsLoss = soakPerfBefore.averageFps > 0
  ? (soakPerfBefore.averageFps - soakPerfAfter.averageFps) / soakPerfBefore.averageFps
  : 1;
const heapChange = percentChange(heapSeries[0], heapSeries.at(-1));
const monotonicallyClimbing = heapSeries.length > 2
  && heapSeries.slice(1).every((value, index) => value > heapSeries[index])
  && (heapChange ?? 0) > 0.10;
const soakPassed = fpsLoss <= T.maxSoakFpsLossFraction && !monotonicallyClimbing;
setResult(
  "no-degradation",
  soakPassed ? (profile === "full" ? "PASS" : "PROXY_PASS") : "FAIL",
  `${profile === "full" ? "20-minute" : "15-second CI proxy"} soak: FPS change ${(fpsLoss * 100).toFixed(1)}%; heap change ${heapChange === null ? "n/a" : `${(heapChange * 100).toFixed(1)}%`}.`,
  { fpsBefore: soakPerfBefore, fpsAfter: soakPerfAfter, fpsLossFraction: fpsLoss, heapSeries, heapChangeFraction: heapChange },
);

const contextState = await pageState();
const fatalMessages = runtimeMessages.filter((message) =>
  message.method === "Runtime.exceptionThrown" || message.params?.entry?.level === "error"
);
const repeatedErrors = new Map();
for (const message of fatalMessages) {
  const text = messageText(message);
  repeatedErrors.set(text, (repeatedErrors.get(text) || 0) + 1);
}
const repeating = [...repeatedErrors.entries()].filter(([, count]) => count >= 3);
const consolePassed = fatalMessages.length === 0 && contextState.contextLosses === 0 && repeating.length === 0;
setResult(
  "console-cleanliness",
  consolePassed ? "PROXY_PASS" : "FAIL",
  `${fatalMessages.length} runtime/log errors, ${contextState.contextLosses} WebGL context losses, ${repeating.length} repeating error signatures during the automated session. Canonical duration is 10 minutes.`,
  { fatalMessages: fatalMessages.map(messageText), contextLosses: contextState.contextLosses, repeating },
);

// No representative-hardware baseline is silently invented. Full runs can supply one explicitly.
const baselineFps = Number(process.env.EARTH777_LITE_BASELINE_FPS || 0);
const baselineLow = Number(process.env.EARTH777_LITE_BASELINE_1P_LOW_FPS || 0);
if (profile === "full" && baselineFps > 0 && baselineLow > 0) {
  const averageRegression = (baselineFps - perfBefore.averageFps) / baselineFps;
  const lowRegression = (baselineLow - perfBefore.onePercentLowFps) / baselineLow;
  const passed = averageRegression <= T.maxPerformanceRegressionFraction && lowRegression <= T.maxPerformanceRegressionFraction;
  setResult(
    "regression-rule",
    passed ? "PASS" : "FAIL",
    `Compared with supplied baseline: average FPS regression ${(averageRegression * 100).toFixed(1)}%, 1% low regression ${(lowRegression * 100).toFixed(1)}%.`,
    { baselineFps, baselineLow, averageRegression, lowRegression },
  );
} else {
  setResult(
    "regression-rule",
    "UNVERIFIED",
    "No representative-hardware baseline was supplied. Run the full profile with EARTH777_LITE_BASELINE_FPS and EARTH777_LITE_BASELINE_1P_LOW_FPS to enforce the <=10% regression rule.",
  );
}

// A dedicated region scene is not exposed by the current Lite DOM, so do not pretend to certify it.
setResult(
  "globe-to-region",
  "UNVERIFIED",
  "The current Lite UI exposes globe selection plus direct DESCEND to surface, not a separately instrumented region transition. This criterion cannot be certified until that transition has an observable contract.",
);

const report = {
  generatedAt: new Date().toISOString(),
  profile,
  page: PAGE_URL,
  thresholds: T,
  summary: {},
  results: [...results.values()],
};
for (const result of report.results) report.summary[result.status] = (report.summary[result.status] || 0) + 1;

writeFileSync("earth-777-lite-acceptance.json", `${JSON.stringify(report, null, 2)}\n`);
const markdown = [
  `# Earth 777 Lite acceptance report`,
  ``,
  `Profile: **${profile}**`,
  `Generated: ${report.generatedAt}`,
  ``,
  `| Status | Criterion | Evidence |`,
  `| --- | --- | --- |`,
  ...report.results.map((result) => `| ${result.status} | ${result.label} | ${String(result.details).replace(/\|/g, "\\|")} |`),
  ``,
  `## Summary`,
  ``,
  ...Object.entries(report.summary).map(([status, count]) => `- ${status}: ${count}`),
  ``,
  `Canonical acceptance requires every criterion to be PASS. PROXY_PASS means CI observed a useful automated proxy but did not certify the full visual, duration, or representative-hardware requirement.`,
  ``,
].join("\n");
writeFileSync("earth-777-lite-acceptance.md", markdown);
console.log(markdown);

socket.close();
const failures = report.results.filter((result) => result.status === "FAIL");
if (failures.length) {
  throw new Error(`Earth 777 Lite acceptance failures: ${failures.map(({ label }) => label).join(", ")}`);
}
