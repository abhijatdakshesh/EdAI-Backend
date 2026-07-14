export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two coordinates (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Estimated minutes for a bus at `from` moving at `speedKmph` to reach `to`.
 * Falls back to a nominal 20 km/h in traffic when speed is missing/zero.
 * Returns null if coordinates are absent.
 */
export function etaMinutes(from: LatLng | null, to: LatLng | null, speedKmph?: number | null): number | null {
  if (!from || !to) return null;
  const speed = speedKmph && speedKmph > 5 ? speedKmph : 20;
  const km = haversineKm(from, to);
  return Math.round((km / speed) * 60);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
