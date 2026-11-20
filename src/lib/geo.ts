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
        // IP geolocation is inherently imprecise — treat it as ±2000m accuracy.
        // It is only used to stamp the selfie; it is never sent as a check-in location.
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

/** Middle value of a list (average of the two middle ones for an even count). */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Value below which the fraction `p` (0 to 1) of the list falls, interpolated between neighbours. */
function percentile(values: number[], p: number): number {
  const v = [...values].sort((a, b) => a - b);
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

/** Readings worse than this are too rough to help place a phone. */
const FUSE_MAX_ACCURACY_M = 1500;
/** No phone is trusted to better than this, whatever it claims. */
const FUSE_MIN_ACCURACY_M = 25;

/**
 * Combine several GPS readings into one steadier fix:
 * - readings rougher than 1500 m are left out,
 * - the centre is the middle (median) reading, so one GPS "jump" cannot drag it,
 * - readings farther than max(40 m, 2 x the middle accuracy) from the centre are dropped,
 * - the accuracy reported is the largest of: the middle claimed accuracy, how far
 *   the kept readings really scatter (75th percentile) and 25 m.
 * A reading that merely claims to be very exact is never picked on its own.
 * With no usable reading the least rough one is returned unchanged (null when empty).
 */
export function fuseFixes(samples: Coords[]): Coords | null {
  if (!samples.length) return null;
  const usable = samples.filter(
    (s) =>
      Number.isFinite(s.lat) && Number.isFinite(s.lng) &&
      s.accuracy != null && s.accuracy > 0 && s.accuracy <= FUSE_MAX_ACCURACY_M,
  );
  if (!usable.length) {
    const rank = (s: Coords) => (s.accuracy != null && s.accuracy > 0 ? s.accuracy : Infinity);
    return samples.reduce((m, s) => (rank(s) < rank(m) ? s : m));
  }
  const centreOf = (list: Coords[]): Coords => ({ lat: median(list.map((s) => s.lat)), lng: median(list.map((s) => s.lng)) });
  const first = centreOf(usable);
  const limit = Math.max(40, 2 * median(usable.map((s) => s.accuracy as number)));
  const near = usable.filter((s) => distanceMeters(s, first) <= limit);
  // The middle lat and middle lng can land between two clusters; never end up with nothing
  const kept = near.length ? near : usable;
  const centre = centreOf(kept);
  const accuracy = Math.max(
    median(kept.map((s) => s.accuracy as number)),
    percentile(kept.map((s) => distanceMeters(s, centre)), 0.75),
    FUSE_MIN_ACCURACY_M,
  );
  return { lat: centre.lat, lng: centre.lng, accuracy, source: "gps" };
}

/* ── Shared GPS sampler ───────────────────────────────────────────────────
 * One GPS watch for the whole page, started as early as possible and shared
 * by everything that needs the student's position. Each caller holds it open
 * with startGpsSampler() and releases it with the function returned.
 */

/** How the raw GPS readings behaved (fake-GPS apps tend to be perfectly still). */
export type GpsStats = { n: number; coordDistinct: number; accDistinct: number; spreadM: number };

type GpsSample = { pos: Coords; at: number };

/** Readings older than this, counted back from the newest reading, are forgotten. */
const SAMPLER_WINDOW_MS = 45_000;

let samplerSamples: GpsSample[] = [];
let samplerRefs = 0;
let samplerWatchId: number | null = null;
let samplerLastTimestamp: number | null = null;
let samplerError: number | null = null;
const samplerListeners = new Set<() => void>();

function notifySampler() {
  for (const cb of [...samplerListeners]) {
    try { cb(); } catch { /* a listener must never break the GPS */ }
  }
}

function onSamplerPosition(p: GeolocationPosition) {
  // Some phones repeat the same reading; counting it twice would make an honest phone look frozen
  if (samplerLastTimestamp != null && p.timestamp === samplerLastTimestamp) return;
  samplerLastTimestamp = p.timestamp;
  const lat = p.coords.latitude;
  const lng = p.coords.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const at = Date.now();
  // The window is counted back from the newest reading, so a phone lying still
  // (which gets very few readings) keeps its last fix instead of losing it.
  samplerSamples = [...samplerSamples, { pos: { lat, lng, accuracy: p.coords.accuracy, source: "gps" as const }, at }]
    .filter((x) => at - x.at < SAMPLER_WINDOW_MS);
  samplerError = null;
  notifySampler();
}

function onSamplerFailure(err: GeolocationPositionError) {
  // Readings already collected stay valid: a late error never wipes a fix
  samplerError = err.code;
  notifySampler();
}

function startSamplerWatch() {
  if (samplerWatchId != null) return;
  // A new watch starts with a clean slate: an old "denied" must not outlive the permission being given
  samplerError = null;
  try {
    samplerWatchId = navigator.geolocation.watchPosition(onSamplerPosition, onSamplerFailure, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 60_000,
    });
  } catch {
    samplerError = 2;
  }
}

function stopSamplerWatch() {
  if (samplerWatchId == null) return;
  try { navigator.geolocation.clearWatch(samplerWatchId); } catch { /* already gone */ }
  samplerWatchId = null;
}

/** Phones pause the GPS while the page is in the background; start it afresh on return. */
function onSamplerVisibility() {
  if (samplerRefs === 0 || document.visibilityState !== "visible") return;
  stopSamplerWatch();
  startSamplerWatch();
}

/**
 * Start (or join) the shared GPS sampler. Returns a stop function; the GPS
 * keeps running until every caller has stopped. Safe to call on the server.
 */
export function startGpsSampler(): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return () => {};
  if (!navigator.geolocation) {
    samplerError = 2;
    return () => {};
  }
  samplerRefs += 1;
  if (samplerRefs === 1) {
    // Readings left over from an earlier visit to the page are too old to trust
    const nowMs = Date.now();
    samplerSamples = samplerSamples.filter((x) => nowMs - x.at < SAMPLER_WINDOW_MS);
    startSamplerWatch();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onSamplerVisibility);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    samplerRefs -= 1;
    if (samplerRefs > 0) return;
    stopSamplerWatch();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onSamplerVisibility);
  };
}

/** True when the GPS has reported a problem and has not given a single reading. */
function samplerStuck(): boolean {
  return samplerError != null && !samplerSamples.length;
}

/**
 * Ask the phone for its location afresh. After "permission denied" the running
 * watch is dead for good, so this is how location switched on later (site
 * settings, the phone's quick settings) is picked up without reloading the page.
 * By default it only does anything when the GPS is stuck (an error and no
 * reading yet); pass `force` to restart regardless. Returns true when restarted.
 */
export function restartGpsSampler(force = false): boolean {
  if (typeof navigator === "undefined" || !navigator.geolocation || samplerRefs === 0) return false;
  if (!force && !samplerStuck()) return false;
  stopSamplerWatch();
  startSamplerWatch();
  notifySampler();
  return true;
}

/** The best position from the readings collected so far, or null when there are none yet. */
export function getFusedFix(): Coords | null {
  return fuseFixes(samplerSamples.map((x) => x.pos));
}

/** How the readings collected so far behaved (sent with the check-in). */
export function getSamplerStats(): GpsStats {
  const samples = samplerSamples;
  const n = samples.length;
  if (!n) return { n: 0, coordDistinct: 0, accDistinct: 0, spreadM: 0 };
  const coords = new Set(samples.map((x) => `${x.pos.lat.toFixed(7)},${x.pos.lng.toFixed(7)}`));
  const accs = new Set(samples.map((x) => Math.round((x.pos.accuracy ?? 0) * 10)));
  const lat = samples.reduce((t, x) => t + x.pos.lat, 0) / n;
  const lng = samples.reduce((t, x) => t + x.pos.lng, 0) / n;
  const spreadM = Math.max(...samples.map((x) => distanceMeters({ lat, lng }, x.pos)));
  return { n, coordDistinct: coords.size, accDistinct: accs.size, spreadM: Math.round(spreadM * 10) / 10 };
}

/** Milliseconds since the oldest reading still kept (0 when there are none). */
export function getSamplerAgeMs(): number {
  return samplerSamples.length ? Date.now() - samplerSamples[0].at : 0;
}

/**
 * The last GPS error, cleared by the next good reading:
 * 1 = permission denied, 2 = location unavailable (or not supported), 3 = timed out, null = none.
 */
export function getSamplerError(): number | null {
  return samplerError;
}

/** Call `cb` after every new reading or error. Returns an unsubscribe function. */
export function onSamplerUpdate(cb: () => void): () => void {
  samplerListeners.add(cb);
  return () => { samplerListeners.delete(cb); };
}

/**
 * Give the GPS a little longer, then return the best position (null if there is none).
 * - Default: returns as soon as there are `minSamples` readings covering `minMs`
 *   of time, or after `maxMs` at the latest. Returns at once when that is already true.
 * - When `minMs` is not smaller than `maxMs` it is a plain wait of `maxMs` for
 *   fresh readings (the quiet re-check after the server asks for more proof).
 * When location permission was denied the phone is asked once more first (it may
 * have been allowed since); if it is still denied this returns early, since
 * nothing more will arrive.
 */
export function waitForFix(
  { minSamples = 3, minMs = 6000, maxMs = 8000 }: { minSamples?: number; minMs?: number; maxMs?: number } = {},
): Promise<Coords | null> {
  if (typeof window === "undefined" || maxMs <= 0) return Promise.resolve(getFusedFix());
  const plainWait = minMs >= maxMs;
  const enough = () => !plainWait && samplerSamples.length >= minSamples && getSamplerAgeMs() >= minMs;
  const hopeless = () => samplerError === 1 && !samplerSamples.length;
  if (enough()) return Promise.resolve(getFusedFix());
  return new Promise((resolve) => {
    // Denied earlier: the old watch is dead, so start a new one. A phone that is
    // still denied reports it again within a moment and the wait ends early.
    if (hopeless()) restartGpsSampler();
    // Hold the sampler open for the wait, in case nobody else has started it
    // (a watch started here begins with the old error cleared)
    const stop = startGpsSampler();
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (!enough() && !hopeless() && Date.now() - startedAt < maxMs) return;
      clearInterval(tick);
      stop();
      resolve(getFusedFix());
    }, 200);
  });
}

/** Start the phone's GPS early so it has a steady fix by the time it's needed. Returns a stop function. */
export function warmUpGps(): () => void {
  return startGpsSampler();
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/* ── Lecturer: surveying the class spot ───────────────────────────────── */

/** A surveyed spot: the fused position, how many readings went into it and when it was taken (ms since epoch). */
export type AnchorSurvey = Coords & { n: number; takenAt: number };
/** Progress while surveying: readings so far and the accuracy of the position they give together. */
export type SurveyProgress = { n: number; accuracy: number };

/**
 * Reads the lecturer's position properly: watches the GPS for at least `minMs`
 * (a quick first reading is not trusted), stops after that once there are 5 or
 * more readings, otherwise at `maxMs`, and fuses them with fuseFixes.
 * Never falls back to IP location. Rejects when no reading arrived.
 */
export function surveyAnchor(
  { minMs = 12_000, maxMs = 25_000 }: { minMs?: number; maxMs?: number } = {},
  onProgress?: (progress: SurveyProgress) => void,
): Promise<AnchorSurvey> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device."));
      return;
    }
    const samples: Coords[] = [];
    const startedAt = Date.now();
    let lastTimestamp: number | null = null;
    let lastError: Error | null = null;
    let done = false;
    let id: number | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      done = true;
      if (id != null) navigator.geolocation.clearWatch(id);
      if (tick != null) clearInterval(tick);
    };
    const finish = () => {
      if (done) return;
      cleanup();
      const fused = fuseFixes(samples);
      if (!fused) {
        reject(lastError ?? new Error("Could not get a GPS reading. Turn on Location (Precise) and try again."));
        return;
      }
      resolve({ ...fused, n: samples.length, takenAt: Date.now() });
    };
    const check = () => {
      if (done) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxMs) finish();
      // After the minimum time: enough readings, or a GPS that has only reported errors
      else if (elapsed >= minMs && (samples.length >= 5 || (!samples.length && lastError))) finish();
    };
    id = navigator.geolocation.watchPosition(
      (p) => {
        if (done) return;
        if (lastTimestamp != null && p.timestamp === lastTimestamp) return;
        lastTimestamp = p.timestamp;
        if (!Number.isFinite(p.coords.latitude) || !Number.isFinite(p.coords.longitude)) return;
        const c: Coords = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: "gps" };
        samples.push(c);
        onProgress?.({ n: samples.length, accuracy: fuseFixes(samples)?.accuracy ?? c.accuracy ?? 0 });
        check();
      },
      (err) => {
        if (done || samples.length) return;
        if (err.code === 1) {
          cleanup();
          reject(new Error("Location permission denied. Allow location access and try again."));
          return;
        }
        lastError = new Error(err.code === 3
          ? "Could not get a GPS reading. Turn on Location (Precise) and try again."
          : err.message || "Unable to read your location.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs },
    );
    tick = setInterval(check, 250);
    if (done) cleanup();
  });
}

/**
 * Older name for surveyAnchor, kept for existing callers. Watches the GPS for
 * at least 12 s (up to `maxWaitMs`) and returns the fused position. Never falls
 * back to IP location. `onProgress` reports the fused accuracy so far.
 */
export function getPrecisePosition(
  { maxWaitMs = 25_000 }: { maxWaitMs?: number; targetAccuracy?: number } = {},
  onProgress?: (accuracy: number) => void,
): Promise<Coords> {
  return surveyAnchor(
    { minMs: Math.min(12_000, maxWaitMs), maxMs: maxWaitMs },
    (p) => onProgress?.(p.accuracy),
  ).then(({ lat, lng, accuracy, source }) => ({ lat, lng, accuracy, source }));
}
