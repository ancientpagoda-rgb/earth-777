const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;

function childOffset(childId) {
  const digits = Number(String(childId ?? "").replace(/\D+/g, "")) || 1;
  const angle = ((digits * 137.507764) % 360) * Math.PI / 180;
  const distanceDegrees = 0.45 + (digits % 7) * 0.12;
  return {
    latitude: Math.sin(angle) * distanceDegrees,
    longitude: Math.cos(angle) * distanceDegrees
  };
}

export function inheritDemographyForChildren(state, children) {
  if (!Array.isArray(children) || !children.length || !Array.isArray(state?.homininLineages)) return 0;
  state.homininDemes ??= [];
  let transferredTotal = 0;

  for (const child of children) {
    const parent = state.homininLineages.find((lineage) => lineage.id === child.parentId);
    if (!parent || !(Number(parent.populationPersons) > 2)) continue;

    const transferred = Math.max(2, Math.round(parent.populationPersons * 0.31));
    parent.populationPersons = Math.max(1, Math.round(parent.populationPersons - transferred));
    child.populationPersons = transferred;
    transferredTotal += transferred;

    const parentDemes = state.homininDemes.filter((deme) => deme.lineageId === parent.id && deme.headcount > 0);
    if (!parentDemes.length) continue;
    const originalTotal = parentDemes.reduce((sum, deme) => sum + deme.headcount, 0);
    let moved = 0;
    for (let index = 0; index < parentDemes.length; index += 1) {
      const deme = parentDemes[index];
      const share = index === parentDemes.length - 1
        ? transferred - moved
        : Math.max(0, Math.round(transferred * deme.headcount / Math.max(1, originalTotal)));
      deme.headcount = Math.max(0, deme.headcount - share);
      moved += share;
    }

    const anchor = [...parentDemes].sort((a, b) => b.headcount - a.headcount)[0];
    const offset = childOffset(child.id);
    state.homininDemes.push({
      id: `${child.id}-D1`,
      lineageId: child.id,
      latitude: clamp(anchor.latitude + offset.latitude, -89.5, 89.5),
      longitude: wrapLongitude(anchor.longitude + offset.longitude),
      headcount: transferred,
      foundedYearBP: Math.round(Number(state.yearBP) || 0),
      lastFissionYearBP: Math.round(Number(state.yearBP) || 0)
    });
  }

  state.homininDemes = state.homininDemes.filter((deme) => deme.headcount > 0);
  return transferredTotal;
}
