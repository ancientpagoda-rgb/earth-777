import * as THREE from "three";

export function wireGlobePicking(canvas, getCamera, getEarth, onHit) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, getCamera());
    onHit(raycaster.intersectObject(getEarth())[0] ?? null);
  });
}
