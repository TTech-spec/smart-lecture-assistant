import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, MapPin, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { distanceMeters, type Coords } from "@/lib/geo";
import { currentWeather, reverseGeocode, stampPhoto, type StampInfo } from "@/lib/photo-stamp";

type Props = {
  /** Called with the stamped JPEG (data URL) and the info used, or null when retaking. */
  onChange: (photo: { dataUrl: string; info: StampInfo; pos: Coords } | null) => void;
  /** Fallback one-shot location reader (used if live tracking is unavailable). */
  getPosition: () => Promise<Coords>;
};

type Weather = { temperatureC: number | null; weather: string };

/**
 * Live-camera selfie (no gallery uploads). While the camera is open, the
 * student's live address, time and weather are shown over the preview and
 * update as they move; the same details are stamped onto the captured photo.
 */
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
        // Keep the last 20 s of readings and use the most accurate ones,
        // averaged — indoor GPS wobbles, and the first fix is usually rough.
        const nowMs = Date.now();
        samplesRef.current = [...samplesRef.current, { pos: sample, at: nowMs }].filter((x) => nowMs - x.at < 20_000);
        const sorted = [...samplesRef.current].sort((a, b) => (a.pos.accuracy ?? 999) - (b.pos.accuracy ?? 999));
        const best = sorted.slice(0, Math.min(3, sorted.length));
        const pos: Coords = {
          lat: best.reduce((t, x) => t + x.pos.lat, 0) / best.length,
          lng: best.reduce((t, x) => t + x.pos.lng, 0) / best.length,
          accuracy: best[0].pos.accuracy,
          source: "gps",
        };
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
      setState("live");
      startLocationWatch();
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setError("Camera access is required. Allow camera permission and try again.");
    }
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const frame = document.createElement("canvas");
    frame.width = v.videoWidth;
    frame.height = v.videoHeight;
    frame.getContext("2d")!.drawImage(v, 0, 0);
    const posAtCapture = livePos;
    const addrAtCapture = liveAddress;
    const weatherAtCapture = liveWeather;
    stopAll();
    setState("processing");
    try {
      const pos = posAtCapture ?? (await getPosition());
      const [address, w] = await Promise.all([
        addrAtCapture ?? reverseGeocode(pos),
        weatherAtCapture ?? currentWeather(pos),
      ]);
      const info: StampInfo = { address, ...w, takenAt: new Date() };
      const dataUrl = await stampPhoto(frame, pos, info);
      setPreview(dataUrl);
      setState("done");
      onChange({ dataUrl, info, pos });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read your location.");
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
  const canCapture = Boolean(livePos) && (acc <= 50 || (waited > 12_000 && acc <= 150));

  const timeStr =
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    ", " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="rounded-xl border bg-secondary/30 p-3">
      {state === "idle" && (
        <Button type="button" variant="outline" className="w-full h-11" onClick={start}>
          <Camera className="mr-2 h-4 w-4" /> Take live photo
        </Button>
      )}

      {state === "live" && (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} playsInline muted className="w-full [transform:scaleX(-1)]" />
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
          <Button type="button" className="w-full h-11" onClick={capture} disabled={!canCapture}>
            {!livePos
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Waiting for location…</>
              : !canCapture
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Improving accuracy… ±{Math.round(acc)} m</>
                : <><Camera className="mr-2 h-4 w-4" /> Capture</>}
          </Button>
          {livePos && acc > 100 && (
            <p className="text-center text-xs text-amber-700 dark:text-amber-400">
              Weak signal (±{Math.round(acc)} m). Turn on WiFi and move near a window or the door.
            </p>
          )}
        </div>
      )}

      {state === "processing" && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Stamping your photo…
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
