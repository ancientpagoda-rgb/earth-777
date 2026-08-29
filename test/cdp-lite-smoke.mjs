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
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return response.result?.result?.value;
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.navigate", { url: "http://127.0.0.1:4173/earth-777/lite/?seed=777&year=0&layer=terrain&lat=0&lon=25" });

let initial = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await wait(250);
  initial = await evaluate(`(() => ({
    ready: document.readyState,
    title: document.title,
    status: document.querySelector("#status")?.textContent ?? "missing",
    canvas: document.querySelectorAll("canvas").length,
    year: document.querySelector("#year")?.textContent ?? "",
    temperature: document.querySelector("#temperature")?.textContent ?? "—",
    sea: document.querySelector("#sea")?.textContent ?? "—",
    mode: document.querySelector("#mode")?.textContent ?? "",
    worker: document.body.dataset.worker ?? "",
    quality: document.body.dataset.quality ?? "",
    texture: document.body.dataset.texture ?? "",
    layers: document.querySelectorAll(".layer").length
  }))()`);
  if (initial?.ready === "complete" && initial?.canvas > 0 && initial?.status === "") break;
}

await evaluate(`document.querySelector('[data-speed="1000"]')?.click()`);
const acceleratedSpeed = await evaluate(`document.querySelector('.speed.on')?.dataset.speed ?? ""`);
const accelerationStarted = Date.now();
let acceleratedYear = initial?.year ?? "";
for (let attempt = 0; attempt < 20; attempt += 1) {
  await wait(100);
  acceleratedYear = await evaluate(`document.querySelector("#year")?.textContent ?? ""`);
  if (acceleratedYear && acceleratedYear !== initial?.year) break;
}
const accelerationLatencyMs = Date.now() - accelerationStarted;
const historyDrawn = await evaluate(`document.querySelector("#history-temp")?.getAttribute("points")?.length > 0`);

await evaluate(`document.querySelector("#mode")?.click()`);
await wait(350);
const surface = await evaluate(`(() => ({
  active: document.body.classList.contains("surface"),
  button: document.querySelector("#mode")?.textContent ?? "",
  place: document.querySelector("#place")?.textContent ?? "",
  canvas: document.querySelectorAll("canvas").length,
  plants: Number(document.body.dataset.surfacePlants ?? 0),
  rivers: Number(document.body.dataset.surfaceRivers ?? 0),
  spanKm: Number(document.body.dataset.surfaceSpanKm ?? 0),
  zoomBlend: Number(document.body.dataset.surfaceZoomBlend ?? -1),
  planetaryZoom: document.body.dataset.planetaryZoom ?? ""
}))()`);

// The accepted planetary-zoom contract must stay in surface mode all the way to
// a complete Earth view, then return to the same geographic center without a
// second canvas or explicit mode switch.
await evaluate(`(() => {
  const canvas = document.querySelector('canvas');
  for (let i = 0; i < 10; i += 1) {
    canvas?.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true, cancelable: true }));
  }
  return true;
})()`);
await wait(350);
const planetarySurface = await evaluate(`(() => ({
  active: document.body.classList.contains("surface"),
  button: document.querySelector("#mode")?.textContent ?? "",
  canvas: document.querySelectorAll("canvas").length,
  status: document.querySelector("#status")?.textContent ?? "",
  spanKm: Number(document.body.dataset.surfaceSpanKm ?? 0),
  zoomBlend: Number(document.body.dataset.surfaceZoomBlend ?? -1),
  planetaryZoom: document.body.dataset.planetaryZoom ?? ""
}))()`);

await evaluate(`(() => {
  const canvas = document.querySelector('canvas');
  for (let i = 0; i < 10; i += 1) {
    canvas?.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true, cancelable: true }));
  }
  return true;
})()`);
await wait(500);
const surfaceReturnedFromPlanet = await evaluate(`(() => ({
  active: document.body.classList.contains("surface"),
  button: document.querySelector("#mode")?.textContent ?? "",
  place: document.querySelector("#place")?.textContent ?? "",
  canvas: document.querySelectorAll("canvas").length,
  plants: Number(document.body.dataset.surfacePlants ?? 0),
  spanKm: Number(document.body.dataset.surfaceSpanKm ?? 0),
  zoomBlend: Number(document.body.dataset.surfaceZoomBlend ?? -1),
  planetaryZoom: document.body.dataset.planetaryZoom ?? ""
}))()`);
const surfaceCoordinate = String(surface?.place ?? "").split(" · ").slice(0, 2).join(" · ");
const returnedCoordinate = String(surfaceReturnedFromPlanet?.place ?? "").split(" · ").slice(0, 2).join(" · ");

await evaluate(`document.querySelector("#mode")?.click()`);
await wait(150);
const returned = await evaluate(`!document.body.classList.contains("surface") && document.querySelector("#mode")?.textContent === "DESCEND"`);

const viewport = await evaluate(`({ width: innerWidth, height: innerHeight })`);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: viewport.width / 2, y: viewport.height / 2, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: viewport.width / 2, y: viewport.height / 2, button: "left", clickCount: 1 });
await wait(120);
const selectedUrl = await evaluate(`location.href`);

await evaluate(`document.querySelector('[data-layer="temperature"]')?.click()`);
await wait(120);
const layerState = await evaluate(`({
  active: document.body.dataset.layer,
  pressed: document.querySelector('[data-layer="temperature"]')?.classList.contains("on"),
  ariaPressed: document.querySelector('[data-layer="temperature"]')?.getAttribute("aria-pressed"),
  url: location.href
})`);

const frameTime = await evaluate(`new Promise((resolve) => {
  let frames = 0;
  const start = performance.now();
  const tick = (now) => {
    frames += 1;
    if (frames >= 20) resolve((now - start) / frames);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`);

await evaluate(`document.querySelector("#play")?.click()`);
const textureBeforePausedReset = await evaluate(`Number(document.body.dataset.textureVersion ?? 0)`);
await evaluate(`document.querySelector("#branch")?.click()`);
await wait(350);
const pausedResetTexture = await evaluate(`Number(document.body.dataset.textureVersion ?? 0)`);

const fatalMessages = runtimeMessages.filter((message) =>
  message.method === "Runtime.exceptionThrown" || message.params?.entry?.level === "error"
);
const checks = [
  [initial?.ready === "complete", "Lite page did not finish loading"],
  [initial?.title === "Earth 777 Lite", "Lite title missing"],
  [initial?.status === "", `Lite load status reported ${initial?.status ?? "unknown"}`],
  [initial?.canvas === 1, "Lite renderer did not create exactly one canvas"],
  [initial?.temperature !== "—" && initial?.sea !== "—", "Lite climate readouts did not initialize"],
  [initial?.worker === "ready", "Lite worker did not initialize"],
  [["lean", "full"].includes(initial?.quality), "Lite adaptive quality did not resolve"],
  [/^(384x192|512x256)$/.test(initial?.texture ?? ""), `Lite globe texture is not using the smoother render path (${initial?.texture ?? "missing"})`],
  [initial?.layers === 5, "Lite visual layer controls are incomplete"],
  [acceleratedSpeed === "1000", `1K× speed control did not activate (${acceleratedSpeed || "missing"})`],
  [acceleratedYear && acceleratedYear !== initial?.year, `1K× playback did not advance the year within ${accelerationLatencyMs} ms`],
  [historyDrawn, "Lite history graph did not draw"],
  [surface?.active && surface?.button === "RETURN TO GLOBE", "Lite surface mode did not activate"],
  [Boolean(surface?.place), "Lite surface location readout is empty"],
  [surface?.canvas === 1, "Lite surface transition replaced or duplicated the canvas"],
  [surface?.plants > 0, "Lite surface vegetation did not instantiate"],
  [surface?.rivers >= 0, "Lite surface river diagnostics are invalid"],
  [surface?.spanKm > 0 && surface?.zoomBlend === 0 && surface?.planetaryZoom === "surface", "Lite local surface zoom diagnostics did not initialize"],
  [planetarySurface?.active && planetarySurface?.button === "RETURN TO GLOBE", "Planetary zoom switched out of surface mode"],
  [planetarySurface?.canvas === 1 && planetarySurface?.status === "", "Planetary zoom lost the renderer or entered an error state"],
  [planetarySurface?.spanKm >= 39000, `Planetary zoom did not reach globe scale (${planetarySurface?.spanKm ?? 0} km)`],
  [planetarySurface?.zoomBlend >= 0.999 && planetarySurface?.planetaryZoom === "globe", "Planetary zoom did not complete the local-to-globe handoff"],
  [surfaceReturnedFromPlanet?.active && surfaceReturnedFromPlanet?.button === "RETURN TO GLOBE", "Zooming back in left surface mode"],
  [surfaceReturnedFromPlanet?.canvas === 1 && surfaceReturnedFromPlanet?.planetaryZoom === "surface", "Zooming back in did not restore the local surface presentation"],
  [surfaceReturnedFromPlanet?.spanKm <= 100 && surfaceReturnedFromPlanet?.zoomBlend === 0, `Zooming back in did not reach local scale (${surfaceReturnedFromPlanet?.spanKm ?? 0} km)`],
  [surfaceCoordinate && surfaceCoordinate === returnedCoordinate, "Planetary zoom did not return to the same geographic center"],
  [surfaceReturnedFromPlanet?.plants > 0, "Local ecology did not restore after returning from planetary scale"],
  [returned, "Lite surface mode did not return to globe"],
  [selectedUrl.includes("lat=") && selectedUrl.includes("lon="), "Lite globe selection did not update the shareable URL"],
  [layerState?.active === "temperature", "Lite temperature layer did not activate"],
  [layerState?.url.includes("layer=temperature"), "Lite layer state was not written to the URL"],
  [Number(frameTime) > 0 && Number(frameTime) < 80, `Lite animation frames were too slow (${frameTime} ms)`],
  [pausedResetTexture > textureBeforePausedReset, "Lite paused world reset did not force a fresh globe texture"],
  [fatalMessages.length === 0, "Lite runtime errors were reported"]
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

console.log(JSON.stringify({ initial, acceleratedSpeed, acceleratedYear, accelerationLatencyMs, historyDrawn, surface, planetarySurface, surfaceReturnedFromPlanet, returned, selectedUrl, layerState, frameTime, pausedResetTexture, messages: runtimeMessages }, null, 2));
socket.close();
if (failures.length) throw new Error(failures.join("; "));
