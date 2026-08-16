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

function renderPredationAffinity(actor = {}, parentGroup = null) {
  const explicitAffinity = Number(actor?.predationAffinity ?? parentGroup?.predationAffinity);
  const legacyPredator = actor?.role === "carnivore"
    || actor?.representation === "pack"
    || parentGroup?.role === "carnivore"
    || parentGroup?.representation === "pack";
  return Number.isFinite(explicitAffinity) ? clamp01(explicitAffinity) : legacyPredator ? 1 : 0;
}

export function faunaGroupRenderShape(group = {}) {
  const predationAffinity = renderPredationAffinity(group);
  return Object.freeze({
    predationAffinity,
    longitudinalScale: 2.3 - predationAffinity * 0.7,
    verticalScale: 0.72 - predationAffinity * 0.10,
    lateralScale: 1
  });
}

export function faunaIndividualRenderShape(animal = {}, parentGroup = null) {
  const predationAffinity = renderPredationAffinity(animal, parentGroup);
  return Object.freeze({
    predationAffinity,
    longitudinalScale: 1.8 - predationAffinity * 0.25,
    verticalScale: 1,
    lateralScale: 0.8
  });
}
