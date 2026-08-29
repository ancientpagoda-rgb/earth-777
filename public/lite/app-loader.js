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
const source = sourceText.replace(
  workerReadyMarker,
  `simBusy=false;${workerReadyMarker}`,
);

const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
try {
  await import(url);
} finally {
  URL.revokeObjectURL(url);
}
