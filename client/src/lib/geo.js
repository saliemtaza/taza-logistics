// Rough bounding box around Gauteng (all of Johannesburg, Pretoria, the
// East/West Rand, Vereeniging). Deliberately a simple rectangle, not the
// real provincial border — it exists to catch geocodes that landed in the
// wrong PROVINCE (e.g. a "Newlands" address with no city that Google puts
// in Cape Town), not to police suburb boundaries. All Taza customers are in
// Johannesburg, so anything outside this box is almost certainly a bad
// geocode or a bad address. Returns false when coordinates are missing —
// "not geocoded" is a separate, already-shown warning.
const GAUTENG_BOUNDS = { minLat: -26.95, maxLat: -25.1, minLng: 27.2, maxLng: 29.0 };

export function isOutsideGauteng(lat, lng) {
  if (lat == null || lng == null) return false;
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return la < GAUTENG_BOUNDS.minLat || la > GAUTENG_BOUNDS.maxLat || lo < GAUTENG_BOUNDS.minLng || lo > GAUTENG_BOUNDS.maxLng;
}

export const NOT_IN_GAUTENG_LABEL = '\u26A0 not in Gauteng \u2014 check address';
