const smoothstep = (value) => {
  const t = Math.min(1, Math.max(0, Number(value) || 0));
  return t * t * (3 - 2 * t);
};

function compatibleAttribute(a, b) {
  return Boolean(a?.array && b?.array && a.itemSize === b.itemSize && a.array.length === b.array.length);
}

function blendAttribute(attribute, from, to, amount) {
  const output = attribute.array;
  for (let index = 0; index < output.length; index += 1) output[index] = from[index] + (to[index] - from[index]) * amount;
  attribute.needsUpdate = true;
}

export class TerrainEpochMorpher {
  constructor({ durationMs = 1_250 } = {}) {
    this.durationMs = Math.max(120, Number(durationMs) || 1_250);
    this.morphs = new Map();
    this.completed = 0;
  }

  start(key, mesh, targetMesh, { now = performance.now(), durationMs = this.durationMs } = {}) {
    const current = mesh?.geometry;
    const target = targetMesh?.geometry;
    const attributes = ["position", "normal", "color", "elevationMeters"];
    if (!current || !target || attributes.some((name) => !compatibleAttribute(current.getAttribute(name), target.getAttribute(name)))) return false;
    this.cancel(key);
    const channels = Object.fromEntries(attributes.map((name) => {
      const fromAttribute = current.getAttribute(name);
      const toAttribute = target.getAttribute(name);
      return [name, { attribute: fromAttribute, from: fromAttribute.array.slice(), to: toAttribute.array }];
    }));
    mesh.userData.epochMorphing = true;
    this.morphs.set(key, {
      mesh,
      targetMesh,
      channels,
      startedAt: Number(now) || 0,
      durationMs: Math.max(120, Number(durationMs) || this.durationMs)
    });
    return true;
  }

  cancel(key) {
    const morph = this.morphs.get(key);
    if (!morph) return false;
    morph.targetMesh?.geometry?.dispose?.();
    if (morph.mesh?.userData) morph.mesh.userData.epochMorphing = false;
    this.morphs.delete(key);
    return true;
  }

  update(now = performance.now(), { isCurrent = () => true } = {}) {
    let updated = 0;
    for (const [key, morph] of this.morphs) {
      if (!isCurrent(key, morph.mesh)) {
        this.cancel(key);
        continue;
      }
      const progress = Math.min(1, Math.max(0, (now - morph.startedAt) / morph.durationMs));
      const amount = smoothstep(progress);
      for (const channel of Object.values(morph.channels)) blendAttribute(channel.attribute, channel.from, channel.to, amount);
      updated += 1;
      if (progress < 1) continue;
      morph.mesh.userData = { ...morph.mesh.userData, ...morph.targetMesh.userData, epochMorphing: false };
      morph.mesh.geometry.computeBoundingSphere?.();
      morph.targetMesh.geometry.dispose();
      this.morphs.delete(key);
      this.completed += 1;
    }
    return updated;
  }

  hasWork() { return this.morphs.size > 0; }
  dispose() { for (const key of [...this.morphs.keys()]) this.cancel(key); }
  diagnostics() { return Object.freeze({ active: this.morphs.size, completed: this.completed, durationMs: this.durationMs }); }
}
