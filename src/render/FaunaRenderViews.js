const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export function observedGroupViews(observed = {}) {
  const canonical = Array.isArray(observed?.groups) ? observed.groups : null;
  const source = canonical ?? [
    ...(Array.isArray(observed?.herds) ? observed.herds : []),
    ...(Array.isArray(observed?.packs) ? observed.packs : [])
  ];
  const seen = new Set();
  const groups = [];
  for (const group of source) {
    if (!group) continue;
    const id = group.id ?? group.groupId ?? null;
    if (id != null) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    groups.push(group);
  }
  return Object.freeze(groups);
}

export function faunaGroupRenderShape(group = {}) {
  const explicitAffinity = Number(group?.predationAffinity);
  const legacyPredator = group?.role === "carnivore" || group?.representation === "pack";
  const predationAffinity = Number.isFinite(explicitAffinity) ? clamp01(explicitAffinity) : legacyPredator ? 1 : 0;
  return Object.freeze({
    predationAffinity,
    longitudinalScale: 2.3 - predationAffinity * 0.7,
    verticalScale: 0.72 - predationAffinity * 0.10,
    lateralScale: 1
  });
}
