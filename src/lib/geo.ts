export type Coords = { lat: number; lng: number; accuracy?: number };

/** Haversine distance in meters between two coordinates. */
export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Effective distance accounting for device GPS accuracy.
 * Subtracts up to 40 m of reported accuracy so a student in the same room
 * isn't rejected because their phone's GPS drifted by the usual 10–50 m.
 */
export function effectiveDistance(studentPos: Coords, classPos: Coords): number {
  const raw = distanceMeters(studentPos, classPos);
  const buffer = Math.min(studentPos.accuracy ?? 0, 40);
  return Math.max(0, raw - buffer);
}

export function getCurrentPosition(options?: PositionOptions): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? undefined,
      }),
      (err) => reject(new Error(err.message || "Unable to read your location.")),
      // maximumAge: 30 s — allows a recent cached fix which is often more stable
      // than forcing a brand-new cold reading every time
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000, ...options },
    );
  });
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}
