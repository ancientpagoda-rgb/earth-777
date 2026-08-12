const endpoint = process.argv[2];
if (!endpoint) throw new Error("CDP WebSocket endpoint required");

const socket = new WebSocket(endpoint);
let nextId = 0;
const pending = new Map();
const runtimeMessages = [];

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

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 2_500));

const boundsResult = await send("Runtime.evaluate", {
  expression: `(() => {
    const bounds = document.querySelector("#earth").getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  })()`,
  returnByValue: true
});
const bounds = boundsResult.result.result.value;
const clickX = bounds.x + bounds.width * 0.5;
const clickY = bounds.y + bounds.height * 0.5;
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 180));

await send("Runtime.evaluate", { expression: `document.querySelector("#sources-button").click()` });
await new Promise((resolve) => setTimeout(resolve, 80));
const sourcesOpenResult = await send("Runtime.evaluate", {
  expression: `document.querySelector("#sources-modal").classList.contains("is-open")`,
  returnByValue: true
});
await send("Runtime.evaluate", { expression: `document.querySelector("#sources-close").click()` });

await send("Runtime.evaluate", { expression: `document.querySelector("#play-button").click()` });
await new Promise((resolve) => setTimeout(resolve, 450));
await send("Runtime.evaluate", { expression: `document.querySelector("#play-button").click()` });

const evaluation = await send("Runtime.evaluate", {
  expression: `({
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
    sourcesOpened: ${sourcesOpenResult.result.result.value},
    regionSelected: !document.querySelector("#surface-button").disabled,
    location: document.querySelector("#location-coordinates").textContent,
    yearAdvanced: document.querySelector("#year-readout").textContent !== "777,000 BP",
    orbitReadout: document.querySelector("#orbit-readout").textContent,
    seaLevelProvenance: document.querySelector("#sea-readout").title,
    webgl: (() => {
      const probe = document.createElement("canvas");
      return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    })()
  })`,
  returnByValue: true
});

const page = evaluation.result.result.value;
const fatalMessages = runtimeMessages.filter((message) =>
  message.method === "Runtime.exceptionThrown" || message.params?.entry?.level === "error"
);
const checks = [
  [page.ready === "complete", "page did not finish loading"],
  [page.webgl, "WebGL unavailable"],
  [page.sourceCount === 10, "source ledger count changed"],
  [page.integratedSourceCount >= 4, "integrated-source statuses missing"],
  [page.sourcesOpened, "sources modal did not open"],
  [page.regionSelected, "globe region selection failed"],
  [page.yearAdvanced, "timeline did not advance"],
  [page.orbitReadout.includes("tilt"), "orbital forcing readout missing"],
  [page.seaLevelProvenance.includes("Spratt–Lisiecki"), "sea-level provenance missing"],
  [fatalMessages.length === 0, "runtime errors were reported"]
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

console.log(JSON.stringify({
  page,
  messages: runtimeMessages
}, null, 2));
socket.close();
if (failures.length) throw new Error(failures.join("; "));
