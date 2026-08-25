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
await send("Page.navigate", { url: "http://127.0.0.1:4173/earth-777/lite/" });

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
    mode: document.querySelector("#mode")?.textContent ?? ""
  }))()`);
  if (initial?.ready === "complete" && initial?.canvas > 0 && initial?.status === "") break;
}

await evaluate(`document.querySelector('[data-speed="1000"]')?.click()`);
await wait(650);
const acceleratedYear = await evaluate(`document.querySelector("#year")?.textContent ?? ""`);

await evaluate(`document.querySelector("#mode")?.click()`);
await wait(350);
const surface = await evaluate(`(() => ({
  active: document.body.classList.contains("surface"),
  button: document.querySelector("#mode")?.textContent ?? "",
  place: document.querySelector("#place")?.textContent ?? "",
  canvas: document.querySelectorAll("canvas").length
}))()`);
await evaluate(`document.querySelector("#mode")?.click()`);
await wait(150);
const returned = await evaluate(`!document.body.classList.contains("surface") && document.querySelector("#mode")?.textContent === "DESCEND"`);

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

const fatalMessages = runtimeMessages.filter((message) =>
  message.method === "Runtime.exceptionThrown" || message.params?.entry?.level === "error"
);
const checks = [
  [initial?.ready === "complete", "Lite page did not finish loading"],
  [initial?.title === "Earth 777 Lite", "Lite title missing"],
  [initial?.status === "", `Lite load status reported ${initial?.status ?? "unknown"}`],
  [initial?.canvas === 1, "Lite renderer did not create exactly one canvas"],
  [initial?.temperature !== "—" && initial?.sea !== "—", "Lite climate readouts did not initialize"],
  [acceleratedYear && acceleratedYear !== initial?.year, "1K× playback did not advance the year"],
  [surface?.active && surface?.button === "RETURN TO GLOBE", "Lite surface mode did not activate"],
  [Boolean(surface?.place), "Lite surface location readout is empty"],
  [surface?.canvas === 1, "Lite surface transition replaced or duplicated the canvas"],
  [returned, "Lite surface mode did not return to globe"],
  [Number(frameTime) > 0 && Number(frameTime) < 80, `Lite animation frames were too slow (${frameTime} ms)`],
  [fatalMessages.length === 0, "Lite runtime errors were reported"]
];
const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

console.log(JSON.stringify({ initial, acceleratedYear, surface, returned, frameTime, messages: runtimeMessages }, null, 2));
socket.close();
if (failures.length) throw new Error(failures.join("; "));
