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
