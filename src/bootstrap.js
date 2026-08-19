import "./quiet-defaults.css";

await import("./main.js");

// The regional surface runtime is intentionally lazy, but waiting until the
// DESCEND button is clicked makes the first activation feel unresponsive while
// its modules are fetched. A globe selection is the earliest reliable signal
// that the user may descend, so warm those modules immediately after selection.
let surfaceWarmupPromise = null;
function warmSurfaceRuntime() {
  surfaceWarmupPromise ??= Promise.allSettled([
    import("./render/SurfacePresentation.js"),
    import("./render/ViewTransitions.js")
  ]);
  return surfaceWarmupPromise;
}

document.querySelector("#earth")?.addEventListener("click", warmSurfaceRuntime, { passive: true });

// Pointer devices should begin the already-wired descent action on the first
// press. The main click handler synchronously disables the button as soon as
// surface loading starts, which suppresses the later native click and prevents
// duplicate descent requests. Keyboard activation continues to use normal click.
const surfaceButton = document.querySelector("#surface-button");
surfaceButton?.addEventListener("pointerdown", (event) => {
  if (surfaceButton.disabled || event.button !== 0) return;
  warmSurfaceRuntime();
  surfaceButton.click();
});
