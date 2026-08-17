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
  return response.result?.result?.value;
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await wait(2_500);

// Keep the performance HUD live so the smoke test can prove that WebGL and
// the raster worker did real work instead of merely loading static HTML.
await evaluate(`(() => {
  const hud = document.querySelector("#perf-hud");
  if (hud) hud.open = true;
  return Boolean(hud);
})()`);

let renderDiagnostics = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  await wait(500);
  renderDiagnostics = await evaluate(`(() => {
    const calls = Number(document.querySelector("#perf-calls")?.textContent?.replace(/,/g, "")) || 0;
    const triangles = Number(document.querySelector("#perf-triangles")?.textContent?.replace(/,/g, "")) || 0;
    const worker = document.querySelector("#perf-worker")?.textContent ?? "";
    return { calls, triangles, worker };
  })()`);
  if (renderDiagnostics?.calls > 0
      && renderDiagnostics?.triangles > 0
      && !/(starting|unavailable|error)/i.test(renderDiagnostics?.worker ?? "")) break;
}

const bounds = await evaluate(`(() => {
  const bounds = document.querySelector("#earth").getBoundingClientRect();
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
})()`);
const canvasBeforeFirstClick = await evaluate(`(() => {
  const canvas = document.querySelector("#earth");
  return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
})()`);
const clickX = bounds.x + bounds.width * 0.5;
const clickY = bounds.y + bounds.height * 0.5;
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1 });
await wait(180);
const canvasAfterFirstClick = await evaluate(`(() => {
  const canvas = document.querySelector("#earth");
  return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
})()`);
const firstClickBufferStable = canvasBeforeFirstClick.width === canvasAfterFirstClick.width
  && canvasBeforeFirstClick.height === canvasAfterFirstClick.height;

await evaluate(`document.querySelector("#sources-button").click()`);
await wait(80);
const sourcesOpened = await evaluate(`document.querySelector("#sources-modal").classList.contains("is-open")`);
await evaluate(`document.querySelector("#sources-close").click()`);

await evaluate(`document.querySelector("#play-button").click()`);
await wait(450);
await evaluate(`document.querySelector("#play-button").click()`);

const page = await evaluate(`({
  ready: document.readyState,
  canvas: (() => {
    const canvas = document.querySelector("#earth");
    return {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight
    };
  })(),
  sourceCount: document.querySelectorAll(".source-item").length,
  integratedSourceCount: [...document.querySelectorAll(".source-item em")].filter((node) => node.textContent.startsWith("integrated")).length,
  sourcesOpened: ${sourcesOpened},
  regionSelected: !document.querySelector("#surface-button").disabled,
  location: document.querySelector("#location-coordinates").textContent,
  yearAdvanced: document.querySelector("#year-readout").textContent !== "777,000 BP",
  orbitReadout: document.querySelector("#orbit-readout").textContent,
  seaLevelProvenance: document.querySelector("#sea-readout").title,
  webgl: (() => {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
  })()
})`);

const fallbackMessages = runtimeMessages.filter((message) => {
  const text = message.params?.entry?.text ?? "";
  return /checkpoint (?:climate|vegetation).*?(?:unavailable|fallback)|(?:climate|vegetation).*visual fallback/i.test(text);
});
const fatalMessages = runtimeMessages.filter((message) =>
  message.method === "Runtime.exceptionThrown" || message.params?.entry?.level === "error"
);
const checks = [
  [page.ready === "complete", "page did not finish loading"],
  [page.webgl, "WebGL unavailable"],
  [page.canvas.width > 0 && page.canvas.height > 0 && page.canvas.clientWidth > 0 && page.canvas.clientHeight > 0, "globe canvas has zero size"],
  [firstClickBufferStable, "first globe selection click changed the WebGL drawing-buffer size"],
  [renderDiagnostics?.calls > 0, "renderer produced no draw calls"],
  [renderDiagnostics?.triangles > 0, "renderer produced no triangles"],
  [!/(starting|unavailable|error)/i.test(renderDiagnostics?.worker ?? "starting"), "raster worker did not become usable"],
  [page.sourceCount >= 10, "source ledger did not populate"],
  [page.integratedSourceCount >= 4, "integrated-source statuses missing"],
  [page.sourcesOpened, "sources modal did not open"],
  [page.regionSelected, "globe region selection failed"],
  [page.yearAdvanced, "timeline did not advance"],
  [page.orbitReadout.includes("tilt"), "orbital forcing readout missing"],
  [page.seaLevelProvenance.includes("Spratt–Lisiecki"), "sea-level provenance missing"],
  [fallbackMessages.length === 0, "published Krapp reconstruction fell back to synthetic visuals"],
  [fatalMessages.length === 0, "runtime errors were reported"]
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

console.log(JSON.stringify({
  page,
  firstClick: { before: canvasBeforeFirstClick, after: canvasAfterFirstClick, bufferStable: firstClickBufferStable },
  renderDiagnostics,
  fallbackMessages,
  messages: runtimeMessages
}, null, 2));
socket.close();
if (failures.length) throw new Error(failures.join("; "));
