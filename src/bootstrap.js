import "./quiet-defaults.css";

await import("./main.js");

// UI invariant: once a location card is open, a globe-mode surface action that
// visibly says DESCEND TO REGION must be interactive. Loading/descent states use
// different labels and remain disabled normally. This guards against stale UI
// state after asynchronous surface prewarm or mode recovery.
const surfaceButton = document.querySelector("#surface-button");
const locationPanel = document.querySelector(".location-panel");

function syncSurfaceActionState() {
  if (!surfaceButton || !locationPanel) return;
  const label = surfaceButton.textContent?.trim();
  if (locationPanel.open && label === "DESCEND TO REGION" && surfaceButton.disabled) {
    surfaceButton.disabled = false;
  }
}

if (surfaceButton && locationPanel && typeof MutationObserver === "function") {
  const observer = new MutationObserver(syncSurfaceActionState);
  observer.observe(surfaceButton, { attributes: true, childList: true, subtree: true });
  observer.observe(locationPanel, { attributes: true, attributeFilter: ["open"] });
  syncSurfaceActionState();
}
