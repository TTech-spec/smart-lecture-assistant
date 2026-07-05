export type Coords = { lat: number; lng: number; accuracy?: number; source?: "gps" | "ip" };

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY as string | undefined;

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
 * Uses a dynamic buffer based on reported GPS accuracy to handle indoor scenarios
 * where GPS can be off by hundreds of meters. The buffer scales up to 1000m for
 * very poor GPS signals (>100m accuracy reported).
 *
 * IP-based location (accuracy=2000) gets a 2000m buffer — it is only used when
 * the browser denies GPS, so attendance is still prevented from far-away locations
 * by requiring the class code or other controls.
 */
export function effectiveDistance(studentPos: Coords, classPos: Coords): number {
  const raw = distanceMeters(studentPos, classPos);
  const accuracy = studentPos.accuracy ?? 0;

  // IP-based fallback: accuracy is set to 2000. Give a generous buffer since
  // IP geolocation in Nigeria can be 500–2000m off even on the same campus.
  // The effective check becomes: is the IP suggesting you're in the same city/area?
  if (studentPos.source === "ip") {
    // Allow up to 2000m buffer for IP location — blocks people clearly in other cities
    const buffer = Math.min(accuracy, 2000);
    return Math.max(0, raw - buffer);
  }

  // Hardware GPS: dynamic buffer based on reported accuracy
  // - Good GPS (<20m): buffer up to 20m
  // - Fair GPS (20-50m): buffer up to 50m
  // - Poor GPS (50-100m): buffer up to 200m
  // - Very poor GPS (>100m): buffer up to 1000m (indoor GPS can be completely wrong)
  let buffer: number;
  if (accuracy < 20) {
    buffer = Math.min(accuracy, 20);
  } else if (accuracy < 50) {
    buffer = Math.min(accuracy, 50);
  } else if (accuracy < 100) {
    buffer = Math.min(accuracy * 2, 200);
  } else {
    buffer = Math.min(accuracy * 3, 1000);
  }

  return Math.max(0, raw - buffer);
}

/**
 * Gets current position using browser GPS first (most accurate).
 * If the browser GPS is denied, unavailable, or times out, falls back to
 * Geoapify IP-based location so the app still works without GPS permission.
 */
export function getCurrentPosition(options?: PositionOptions): Promise<Coords> {
  return getBrowserPosition(options).catch((err) => {
    console.warn("Browser GPS unavailable, falling back to Geoapify IP location:", err.message);
    return getGeoapifyPosition(options);
  });
}

async function getGeoapifyPosition(options?: PositionOptions): Promise<Coords> {
  try {
    // Get IP-based location using Geoapify
    const response = await fetch(
      `https://api.geoapify.com/v1/ipinfo?apiKey=${GEOAPIFY_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error("Geoapify API request failed");
    }
    
    const data = await response.json();
    
    if (data.location && data.location.latitude && data.location.longitude) {
      return {
        lat: data.location.latitude,
        lng: data.location.longitude,
        // IP geolocation is inherently imprecise — treat it as ±2000m accuracy
        // so effectiveDistance gives a large buffer and doesn't reject nearby students
        accuracy: 2000,
        source: "ip" as const,
      };
    }
    
    throw new Error("No location data from Geoapify");
  } catch (error) {
    console.warn("Geoapify location failed, falling back to browser GPS:", error);
    // Fall back to browser GPS if Geoapify fails
    return getBrowserPosition(options);
  }
}

function getBrowserPosition(options?: PositionOptions): Promise<Coords> {
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
        source: "gps" as const,
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
