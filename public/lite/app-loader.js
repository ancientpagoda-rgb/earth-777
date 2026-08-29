const chunks = 6;
const parts = await Promise.all(Array.from({ length: chunks }, (_, index) =>
  fetch(`./app-${index}.b64`, { cache: 'force-cache' }).then((response) => {
    if (!response.ok) throw new Error(`Lite app source ${index}: ${response.status}`);
    return response.text();
  })
));
const binary = atob(parts.join(''));
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

// The sharded app source is generated as one compact module. Keep the worker
// scheduler's one-in-flight-state contract explicit here: every successful
// worker state must release simBusy, otherwise the initial `init` response
// leaves playback permanently locked and no later `step` can be posted.
const sourceText = new TextDecoder().decode(bytes);
const workerReadyMarker = "document.body.dataset.worker='ready';";
if (!sourceText.includes(workerReadyMarker)) {
  throw new Error('Lite worker-ready contract missing from generated app source');
}
let source = sourceText.replace(
  workerReadyMarker,
  `simBusy=false;${workerReadyMarker}`,
);

// Surface mode is a direct-manipulation map: the terrain under the pointer must
// follow the mouse on both axes. Longitude already has that grab-and-pan sign,
// but the generated vertical formula used the opposite sign, so dragging up/down
// moved the terrain away from the pointer. Correct only that generated expression;
// touch pinch and wheel zoom semantics remain unchanged.
const surfacePanMarker = "surfaceLat=clamp(surfaceLat-(now.y-old.y)/innerHeight*surfaceSpanKm/111,-89,89);";
if (!source.includes(surfacePanMarker)) {
  throw new Error('Lite surface mouse-pan contract missing from generated app source');
}
source = source.replace(
  surfacePanMarker,
  "surfaceLat=clamp(surfaceLat+(now.y-old.y)/innerHeight*surfaceSpanKm/111,-89,89);",
);

const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
try {
  await import(url);
} finally {
  URL.revokeObjectURL(url);
}
