import { fuseFixes } from "@/lib/geo";
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, MapPin, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { distanceMeters, type Coords } from "@/lib/geo";
import { currentWeather, reverseGeocode, stampPhoto, type StampInfo } from "@/lib/photo-stamp";

type Props = {
  /** Called with the stamped JPEG (data URL) and the info used, or null when retaking. */
  onChange: (photo: { dataUrl: string; info: StampInfo; pos: Coords; frame: HTMLCanvasElement; gps: GpsStats } | null) => void;
  /** Fallback one-shot location reader (used if live tracking is unavailable). */
  getPosition: () => Promise<Coords>;
};

type Weather = { temperatureC: number | null; weather: string };

/**
 * Live-camera selfie (no gallery uploads). While the camera is open, the
 * student's live address, time and weather are shown over the preview and
 * update as they move; the same details are stamped onto the captured photo.
 */
/** How the raw GPS readings behaved while the camera was open (fake-GPS apps tend to be perfectly still). */
export type GpsStats = { n: number; coordDistinct: number; accDistinct: number; spreadM: number };

function gpsStats(samples: { pos: Coords }[]): GpsStats {
  const n = samples.length;
  if (!n) return { n: 0, coordDistinct: 0, accDistinct: 0, spreadM: 0 };
  const coords = new Set(samples.map((x) => `${x.pos.lat.toFixed(7)},${x.pos.lng.toFixed(7)}`));
  const accs = new Set(samples.map((x) => Math.round((x.pos.accuracy ?? 0) * 10)));
  const lat = samples.reduce((t, x) => t + x.pos.lat, 0) / n;
  const lng = samples.reduce((t, x) => t + x.pos.lng, 0) / n;
  const spreadM = Math.max(...samples.map((x) => distanceMeters({ lat, lng }, x.pos)));
  return { n, coordDistinct: coords.size, accDistinct: accs.size, spreadM: Math.round(spreadM * 10) / 10 };
}

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

/** Resolve with `fallback` if the promise takes longer than `ms` */
function within<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return Promise.race([p, new Promise<F>((r) => setTimeout(() => r(fallback), ms))]);
}

export function StampedSelfie({ onChange, getPosition }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastGeocodeRef = useRef<{ pos: Coords; at: number } | null>(null);

  const [state, setState] = useState<"idle" | "live" | "processing" | "done">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live data
  const [livePos, setLivePos] = useState<Coords | null>(null);
  const samplesRef = useRef<{ pos: Coords; at: number }[]>([]);
  const [watchStarted, setWatchStarted] = useState(0);
  const [liveAddress, setLiveAddress] = useState<string | null>(null);
  const [liveWeather, setLiveWeather] = useState<Weather | null>(null);
  const [now, setNow] = useState(() => new Date());

  function stopAll() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (watchRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation?.clearWatch(watchRef.current);
    }
    watchRef.current = null;
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

  function startLocationWatch() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let weatherLoaded = false;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const sample: Coords = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          source: "gps",
        };
        // Keep the last 30 s of readings and combine them into one stronger
        // fix (clear readings count more, GPS jumps are dropped).
        const nowMs = Date.now();
        samplesRef.current = [...samplesRef.current, { pos: sample, at: nowMs }].filter((x) => nowMs - x.at < 30_000);
        const pos = fuseFixes(samplesRef.current.map((x) => x.pos)) ?? sample;
        setLivePos(pos);
        refreshAddress(pos);
        if (!weatherLoaded) {
          weatherLoaded = true;
          currentWeather(pos).then(setLiveWeather);
        }
      },
      () => {
        // Live tracking failed — fall back to a one-shot reading
        getPosition()
          .then((pos) => {
            setLivePos(pos);
            refreshAddress(pos);
            currentWeather(pos).then(setLiveWeather);
          })
          .catch(() => setError("Location is required. Allow location access and try again."));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }

  async function start() {
    setError(null);
    setLivePos(null);
    setLiveAddress(null);
    setLiveWeather(null);
    lastGeocodeRef.current = null;
    samplesRef.current = [];
    setWatchStarted(Date.now());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamReady(false);
      setState("live");
      startLocationWatch();
    } catch {
      setError("Camera access is required. Allow camera permission and try again.");
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
    const posAtCapture = livePos;
    const gps = gpsStats(samplesRef.current);
    const addrAtCapture = liveAddress;
    const weatherAtCapture = liveWeather;
    stopAll();
    setState("processing");
    try {
      const pos = posAtCapture ?? (await within(getPosition().catch(() => null), 8_000, null));
      if (!pos) throw new Error("Couldn't find your location. Turn on Location (Precise), then tap Take live photo again.");
      // Address and weather are nice to have: never let a slow network block the photo
      const [address, w] = await Promise.all([
        addrAtCapture ?? within(reverseGeocode(pos).catch(() => null), 4000, null),
        weatherAtCapture ?? within(currentWeather(pos).catch(() => null), 3000, null),
      ]);
      const info: StampInfo = {
        address: address ?? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
        temperatureC: w?.temperatureC ?? null,
        weather: w?.weather ?? "",
        takenAt: new Date(),
      };
      const dataUrl = await stampPhoto(frame, pos, info);
      setPreview(dataUrl);
      setState("done");
      onChange({ dataUrl, info, pos, frame, gps });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read your location.");
      setPreview(null);
      setState("idle");
    }
  }

  function retake() {
    setPreview(null);
    onChange(null);
    start();
  }

  // Allow capture once accuracy is good (≤50 m), or after 12 s if it is at
  // least usable (≤150 m — the server refuses anything worse).
  const acc = livePos?.accuracy ?? 999;
  const waited = now.getTime() - watchStarted;
  // Wait for a strong signal first; accept weaker ones only after giving the GPS time
  // After 15 s the button opens whatever the signal; the server still checks distance
  void waited;

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
            {!livePos ? "Finding your location… you can still capture." : acc <= 30 ? `Strong location signal · ±${Math.round(acc)} m` : `Location ±${Math.round(acc)} m. Capture now, or wait a few seconds for a stronger signal.`}
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
          {livePos && acc > 100 && (
            <p className="text-center text-xs text-amber-700 dark:text-amber-400">
              Weak signal (±{Math.round(acc)} m). Turn on WiFi and move near a window or the door.
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

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
