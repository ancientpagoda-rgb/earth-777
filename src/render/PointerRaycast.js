import * as THREE from "three";

export function isTapGesture(start, end, {
  maxDistance = 12,
  maxDurationMs = 700
} = {}) {
  if (!start || !end) return false;
  const dx = Number(end.clientX) - Number(start.clientX);
  const dy = Number(end.clientY) - Number(start.clientY);
  const distance = Math.hypot(dx, dy);
  const duration = Math.max(0, Number(end.timeStamp) - Number(start.timeStamp));
  return distance <= Math.max(0, Number(maxDistance) || 0)
    && duration <= Math.max(0, Number(maxDurationMs) || 0);
}

export function wireGlobePicking(canvas, getCamera, getEarth, onHit) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Set();
  let gestureStart = null;
  let moved = false;
  let multiPointerGesture = false;

  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) multiPointerGesture = true;
    if (activePointers.size === 1) {
      gestureStart = { clientX: event.clientX, clientY: event.clientY, timeStamp: event.timeStamp };
      moved = false;
      multiPointerGesture = false;
    }
  };

  const onPointerMove = (event) => {
    if (!gestureStart || !activePointers.has(event.pointerId)) return;
    moved ||= !isTapGesture(gestureStart, {
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: gestureStart.timeStamp
    });
  };

  const onPointerUp = (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);
    if (activePointers.size > 0 || !gestureStart) return;

    const tap = !moved && !multiPointerGesture && isTapGesture(gestureStart, event);
    gestureStart = null;
    moved = false;
    multiPointerGesture = false;
    if (!tap) return;

    updatePointer(event);
    raycaster.setFromCamera(pointer, getCamera());
    onHit(raycaster.intersectObject(getEarth())[0] ?? null);
  };

  const onPointerCancel = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) {
      gestureStart = null;
      moved = false;
      multiPointerGesture = false;
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerup", onPointerUp, { passive: true });
  canvas.addEventListener("pointercancel", onPointerCancel, { passive: true });

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
  };
}
