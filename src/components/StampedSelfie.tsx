import { CameraHelp } from "@/components/CameraHelp";
import { studentError } from "@/lib/friendly-error";
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, MapPin, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  distanceMeters,
  getFusedFix,
  getSamplerError,
  getSamplerStats,
  onSamplerUpdate,
  restartGpsSampler,
  startGpsSampler,
  waitForFix,
  type Coords,
  type GpsStats,
} from "@/lib/geo";
import { currentWeather, reverseGeocode, stampPhoto, type StampInfo, prefetchMiniMap } from "@/lib/photo-stamp";

type Props = {
  /**
   * Called with the stamped JPEG (data URL) and the info used, or null when retaking.
   * `pos` is null when the phone gave no position at all (the photo then says "Location unavailable").
   */
  onChange: (photo: { dataUrl: string; info: StampInfo; pos: Coords | null; frame: HTMLCanvasElement; gps: GpsStats } | null) => void;
  /** Fallback one-shot location reader (used if live tracking is unavailable). Should answer within a few seconds. */
  getPosition: () => Promise<Coords>;
};

type Weather = { temperatureC: number | null; weather: string };

/**
 * Live-camera selfie (no gallery uploads). While the camera is open, the
 * student's live address, time and weather are shown over the preview and
 * update as they move; the same details are stamped onto the captured photo.
 */
/** How the raw GPS readings behaved (now worked out by the shared sampler in lib/geo). */
export type { GpsStats };

/** Decode a photo file; falls back to an <img> on older iPhones */
async function decodePhoto(file: File): Promise<{ width: number; height: number } & CanvasImageSource> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

/** True when a frame is (almost) completely black */
function isBlackFrame(c: HTMLCanvasElement): boolean {
  try {
    const w = Math.min(c.width, 64), h = Math.min(c.height, 48);
    const small = document.createElement("canvas"); small.width = w; small.height = h;
    small.getContext("2d")!.drawImage(c, 0, 0, w, h);
    const d = small.getContext("2d")!.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3 < 10;
  } catch { return false; }
}

/** With no GPS reading this long after the page opened, fetch a rough position for the stamp */
const ROUGH_AFTER_MS = 7000;

/** Resolve with `fallback` if the promise takes longer than `ms` */
function within<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return Promise.race([p, new Promise<F>((r) => setTimeout(() => r(fallback), ms))]);
}

export function StampedSelfie({ onChange, getPosition }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastGeocodeRef = useRef<{ pos: Coords; at: number } | null>(null);

  const [state, setState] = useState<"idle" | "live" | "processing" | "done">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Camera blocked: show the step-by-step "turn it on" box
  const [camHelp, setCamHelp] = useState(false);

  // Live data
  const [livePos, setLivePos] = useState<Coords | null>(null);
  const mapPrefetched = useRef(false);
  const weatherLoaded = useRef(false);
  const fallbackTried = useRef(false);
  const [locBlocked, setLocBlocked] = useState(false);
  const [liveAddress, setLiveAddress] = useState<string | null>(null);
  const [liveWeather, setLiveWeather] = useState<Weather | null>(null);
  const [now, setNow] = useState(() => new Date());

  /** Stops the camera only. Location keeps running so the check-in has the freshest readings. */
  function stopAll() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => stopAll, []);

  // Attach the camera to the <video> once it is on screen (a timing race here
  // left some phones with a black, uncapturable preview)
  const [camReady, setCamReady] = useState(false);
  useEffect(() => {
    if (state !== "live") return;
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream) return;
    // iPhone Safari only shows a live camera when the video is muted and plays
    // inline; React doesn't always set the muted attribute, so set both here
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.autoplay = true;
    if (v.srcObject !== stream) v.srcObject = stream;
    const ready = () => { if (v.videoWidth > 0) setCamReady(true); };
    v.addEventListener("loadedmetadata", ready);
    v.addEventListener("playing", ready);
    v.play().then(ready).catch(() => {});
    const poll = setInterval(ready, 300);
    return () => { v.removeEventListener("loadedmetadata", ready); v.removeEventListener("playing", ready); clearInterval(poll); };
  }, [state]);

  // Black preview (common in WhatsApp / Instagram browsers or when another app holds the camera)
  const [black, setBlack] = useState(false);
  useEffect(() => {
    if (state !== "live") { setBlack(false); return; }
    const started = Date.now();
    const t = setInterval(() => {
      const v = videoRef.current;
      const waitedMs = Date.now() - started;
      if (!v || !v.videoWidth) { if (waitedMs > 5000) setBlack(true); return; }
      const c = document.createElement("canvas"); c.width = 24; c.height = 18;
      c.getContext("2d")!.drawImage(v, 0, 0, 24, 18);
      if (isBlackFrame(c)) { if (waitedMs > 3000) setBlack(true); } else setBlack(false);
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  const nativeRef = useRef<HTMLInputElement>(null);
  /** Photo from the phone's own camera app; must be taken just now (no gallery photos) */
  async function useNativePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) { setError("That isn't a photo. Tap Use phone camera and take a selfie."); return; }
    if (Date.now() - file.lastModified > 3 * 60_000) {
      setError("Please take a new selfie now. Photos from your gallery can't be used.");
      return;
    }
    try {
      const bmp = await decodePhoto(file);
      const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
      const frame = document.createElement("canvas");
      frame.width = Math.round(bmp.width * scale); frame.height = Math.round(bmp.height * scale);
      frame.getContext("2d")!.drawImage(bmp, 0, 0, frame.width, frame.height);
      await processFrame(frame);
    } catch {
      setError("Couldn't read that photo. Try Use phone camera again.");
    }
  }

  /** Wait (up to 3 s) for the camera picture, nudging it to play */
  async function waitForVideo(v: HTMLVideoElement): Promise<boolean> {
    for (let i = 0; i < 15 && !v.videoWidth; i++) {
      v.play().catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }
    return v.videoWidth > 0;
  }

  // Ticking clock while the camera is open
  useEffect(() => {
    if (state !== "live") return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [state]);

  async function refreshAddress(pos: Coords) {
    const last = lastGeocodeRef.current;
    const moved = last ? distanceMeters(last.pos, pos) : Infinity;
    // Re-look-up only when moved >20 m or every 30 s, to stay inside free limits
    if (last && moved < 20 && Date.now() - last.at < 30_000) return;
    lastGeocodeRef.current = { pos, at: Date.now() };
    const address = await reverseGeocode(pos);
    setLiveAddress(address);
  }

  // Location runs from the moment this appears (not only while the camera is
  // open), so the "Use phone camera" path has readings too.
  const getPositionRef = useRef(getPosition);
  getPositionRef.current = getPosition;
  useEffect(() => {
    let alive = true;
    const loadWeather = (pos: Coords) => {
      if (weatherLoaded.current) return;
      weatherLoaded.current = true;
      currentWeather(pos).then((w) => { if (alive) setLiveWeather(w); }).catch(() => { weatherLoaded.current = false; });
    };
    const sync = () => {
      if (!alive) return;
      const fix = getFusedFix();
      setLocBlocked(!fix && getSamplerError() === 1);
      if (fix) {
        setLivePos(fix);
        void refreshAddress(fix);
        if (!mapPrefetched.current) { mapPrefetched.current = true; prefetchMiniMap(fix); }
        loadWeather(fix);
        return;
      }
      // No reading at all, and the GPS reported a problem or has been silent for
      // a while: get a rough position once, only so the photo can be stamped.
      // It never replaces a real fix.
      if ((getSamplerError() == null && !slow) || fallbackTried.current) return;
      fallbackTried.current = true;
      getPositionRef.current()
        .then((pos) => {
          if (!alive || getFusedFix()) return;
          setLivePos(pos);
          void refreshAddress(pos);
          loadWeather(pos);
        })
        .catch(() => { /* the photo step asks again if it still has nothing */ });
    };
    // A phone indoors with location on can stay silent for a minute before it
    // reports anything; don't make the photo wait for that
    let slow = false;
    const slowTimer = setTimeout(() => { slow = true; sync(); }, ROUGH_AFTER_MS);
    const stop = startGpsSampler();
    const off = onSamplerUpdate(sync);
    sync();
    return () => { alive = false; fallbackTried.current = false; clearTimeout(slowTimer); off(); stop(); };
  }, []);

  async function start() {
    setError(null);
    // Location refused earlier and allowed since: ask the phone again (this is the "try again")
    restartGpsSampler();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamReady(false);
      setState("live");
      setCamHelp(false);
    } catch {
      setError("Your camera is switched off for this page.");
      setCamHelp(true);
    }
  }

  async function capture() {
    const v = videoRef.current;
    setError(null);
    if (!v || !(await waitForVideo(v))) {
      setError("The camera isn't showing a picture yet. Wait a second and tap Capture again, or tap Retake.");
      return;
    }
    const frame = document.createElement("canvas");
    frame.width = v.videoWidth;
    frame.height = v.videoHeight;
    frame.getContext("2d")!.drawImage(v, 0, 0);
    if (isBlackFrame(frame)) {
      setBlack(true);
      setError("Your camera is showing a black screen. Tap \"Use phone camera\" below.");
      return;
    }
    await processFrame(frame);
  }

  /** Stamp a captured frame with time and location and hand it to the form */
  async function processFrame(frame: HTMLCanvasElement) {
    // Instant feedback: show the frozen photo straight away and buzz the phone
    try { navigator.vibrate?.(40); } catch { /* not supported */ }
    setPreview(frame.toDataURL("image/jpeg", 0.7));
    const roughAtCapture = livePos;
    const addrAtCapture = liveAddress;
    const weatherAtCapture = liveWeather;
    stopAll();
    setState("processing");
    try {
      // Best GPS position so far; if there is none yet, give it a few more seconds
      // (less when a rough position is already in hand). Meanwhile fetch a rough
      // position, so the two waits run side by side: at most about 8 s in all.
      let fix = getFusedFix();
      let rough = roughAtCapture;
      if (!fix) {
        const startedAt = Date.now();
        const roughJob = rough ? null : getPosition().catch(() => null);
        fix = await waitForFix({ minSamples: 1, minMs: 0, maxMs: rough ? 4000 : 8000 });
        if (!fix && roughJob) rough = await within(roughJob, Math.max(500, 8000 - (Date.now() - startedAt)), null);
      }
      // A rough position is enough to stamp the photo. It is never sent as the check-in location.
      // With no position at all the photo is still kept: the check-in then explains the
      // location problem and offers the lecturer scan, instead of the photo being thrown away.
      const pos = fix ?? rough;
      const gps = getSamplerStats();
      // Address and weather are nice to have: never let a slow network block the photo
      const [address, w] = pos
        ? await Promise.all([
            addrAtCapture ?? within(reverseGeocode(pos).catch(() => null), 4000, null),
            weatherAtCapture ?? within(currentWeather(pos).catch(() => null), 3000, null),
          ])
        : [null, null];
      const info: StampInfo = {
        address: address ?? (pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : "Location unavailable"),
        temperatureC: w?.temperatureC ?? null,
        weather: w?.weather ?? "",
        takenAt: new Date(),
      };
      const dataUrl = await stampPhoto(frame, pos, info);
      setPreview(dataUrl);
      setState("done");
      onChange({ dataUrl, info, pos, frame, gps });
    } catch (e) {
      setError(studentError(e, "We couldn't finish your photo. Tap Take live photo and try again."));
      setPreview(null);
      setState("idle");
    }
  }

  function retake() {
    setPreview(null);
    onChange(null);
    start();
  }

  // Capture is never held back by location: the check-in uses the readings
  // gathered up to the moment the form is sent, and the server decides.
  const hasFix = livePos?.source === "gps";
  const acc = livePos?.accuracy ?? 0;

  const timeStr =
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    ", " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="rounded-xl border bg-secondary/30 p-3">
      <input ref={nativeRef} type="file" accept="image/*" capture="user" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void useNativePhoto(f); }} />
      {state === "idle" && (
        <Button type="button" variant="outline" className="w-full h-11" onClick={start}>
          <Camera className="mr-2 h-4 w-4" /> Take live photo
        </Button>
      )}
      {state === "idle" && (
        <button type="button" onClick={() => nativeRef.current?.click()}
          className="mt-2 w-full text-center text-xs font-medium text-primary underline-offset-4 hover:underline">
          Camera not working? Use your phone's camera app
        </button>
      )}

      {state === "live" && (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full [transform:scaleX(-1)]" />
            {/* Live overlay */}
            <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-white">
              <p className="flex items-start justify-center gap-1 text-xs leading-snug sm:text-sm">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                <span>{liveAddress ?? (livePos ? "Finding address…" : "Getting your location…")}</span>
              </p>
              <p className="mt-1 text-sm font-semibold text-sky-300">{timeStr}</p>
              <p className="mt-0.5 text-[11px] text-gray-300">
                {livePos
                  ? `Lat ${livePos.lat.toFixed(5)}  Lng ${livePos.lng.toFixed(5)}  ±${Math.round(livePos.accuracy ?? 0)} m`
                  : ""}
                {liveWeather?.temperatureC != null &&
                  `  ·  ${liveWeather.weather} ${liveWeather.temperatureC.toFixed(1)} °C`}
              </p>
            </div>
          </div>
          <Button type="button" className="h-12 w-full text-base" onClick={capture}>
            {camReady ? <><Camera className="mr-2 h-5 w-5" /> Capture</> : <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting camera… tap to capture</>}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {hasFix ? "Location found" : "Finding your location… you can capture now"}
          </p>
          {black && (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <p className="font-semibold">Camera showing a black screen?</p>
              <p className="text-xs">Use your phone's own camera instead. If you opened this link inside WhatsApp, Instagram or Facebook, opening it in Chrome or Safari also fixes it.</p>
              <Button type="button" variant="outline" className="h-11 w-full bg-card" onClick={() => nativeRef.current?.click()}>
                <Camera className="mr-2 h-4 w-4" /> Use phone camera
              </Button>
            </div>
          )}
          {hasFix && acc > 100 && acc <= 1000 && (
            <p className="text-center text-xs text-amber-700 dark:text-amber-400">
              Weak location signal. Turn on WiFi and move near a window or the door.
            </p>
          )}
          {livePos && acc > 1000 && (
            <p className="text-center text-xs text-amber-700 dark:text-amber-400">
              iPhone: turn on Precise Location for Safari. Android: turn on Google Location Accuracy.
            </p>
          )}
        </div>
      )}

      {state === "processing" && (
        <div className="relative overflow-hidden rounded-lg">
          {preview && <img src={preview} alt="Your photo" className="w-full [transform:scaleX(-1)]" />}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/60 py-3 text-sm font-medium text-white">
            <Loader2 className="h-4 w-4 animate-spin" /> Photo taken · adding location stamp…
          </div>
        </div>
      )}

      {state === "done" && preview && (
        <div className="space-y-2">
          <img src={preview} alt="Your stamped attendance photo" className="w-full rounded-lg" />
          <Button type="button" variant="outline" size="sm" onClick={retake}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Retake
          </Button>
        </div>
      )}

      {locBlocked && state !== "done" && state !== "processing" && (
        <p className="mt-2 text-xs text-destructive">
          Location is required. Allow location access, then{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => restartGpsSampler()}>
            tap here to try again
          </button>.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {camHelp && (
        <CameraHelp
          onRetry={() => { void start(); }}
          onUsePhoneCamera={() => { setCamHelp(false); setError(null); nativeRef.current?.click(); }}
          onClose={() => setCamHelp(false)}
        />
      )}
    </div>
  );
}
