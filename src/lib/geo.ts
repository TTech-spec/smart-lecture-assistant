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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000, ...options },
    );
  });
}

/**
 * Combine several GPS readings into one stronger fix:
 * - readings far from the clearest one (a GPS "jump") are dropped,
 * - the rest are averaged, each weighted by how clear it is (1 / accuracy²),
 * - the accuracy reported is the clearest single reading's, never better.
 */
export function fuseFixes(samples: Coords[]): Coords | null {
  const gps = samples.filter((s) => s.accuracy != null && s.accuracy > 0);
  if (!gps.length) return samples[0] ?? null;
  const best = gps.reduce((m, s) => ((s.accuracy as number) < (m.accuracy as number) ? s : m));
  const limit = Math.max(30, 2 * (best.accuracy as number));
  const keep = gps.filter((s) => distanceMeters(s, best) <= limit && (s.accuracy as number) <= 3 * (best.accuracy as number));
  let wSum = 0, lat = 0, lng = 0;
  for (const s of keep) {
    const w = 1 / ((s.accuracy as number) ** 2);
    wSum += w; lat += s.lat * w; lng += s.lng * w;
  }
  return { lat: lat / wSum, lng: lng / wSum, accuracy: best.accuracy, source: "gps" };
}

/** Start the phone's GPS early so it has a strong fix by the time it's needed. Returns a stop function. */
export function warmUpGps(): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(() => {}, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 60_000 });
  return () => navigator.geolocation.clearWatch(id);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/**
 * Reads a precise GPS fix for the lecturer: watches the GPS for up to
 * `maxWaitMs`, keeps the best readings and averages them. Never falls back
 * to IP location. `onProgress` reports the best accuracy seen so far.
 */
export function getPrecisePosition(
  { maxWaitMs = 20_000, targetAccuracy = 25 }: { maxWaitMs?: number; targetAccuracy?: number } = {},
  onProgress?: (accuracy: number) => void,
): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device."));
      return;
    }
    const samples: Coords[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      if (!samples.length) {
        reject(new Error("Could not get a GPS reading. Turn on Location (Precise) and try again."));
        return;
      }
      resolve(fuseFixes(samples) as Coords);
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const c: Coords = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: "gps" };
        samples.push(c);
        onProgress?.(Math.min(...samples.map((s) => s.accuracy ?? 999)));
        const good = samples.filter((s) => (s.accuracy ?? 999) <= targetAccuracy);
        if (good.length >= 3) finish();
      },
      (err) => {
        if (!samples.length) {
          done = true;
          navigator.geolocation.clearWatch(id);
          clearTimeout(timer);
          reject(new Error(err.code === 1
            ? "Location permission denied. Allow location access and try again."
            : err.message || "Unable to read your location."));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
    const timer = setTimeout(finish, maxWaitMs);
  });
}

/**
 * Distance check between a student and the lecturer's verified spot.
 * Both GPS readings can be off indoors, so part of each reported accuracy
 * (capped) is allowed as tolerance.
 */
export function isNearAnchor(student: Coords, anchor: Coords, radius: number) {
  const raw = distanceMeters(student, anchor);
  const tolerance = Math.min(student.accuracy ?? 0, 75) + Math.min(anchor.accuracy ?? 0, 50);
  return { raw, inside: raw - tolerance <= radius };
}
