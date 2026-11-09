import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Coords } from "@/lib/geo";
import { currentWeather, reverseGeocode, stampPhoto, type StampInfo } from "@/lib/photo-stamp";

type Props = {
  /** Called with the stamped JPEG (data URL) and the info used, or null when retaking. */
  onChange: (photo: { dataUrl: string; info: StampInfo; pos: Coords } | null) => void;
  /** Gets the student's current location (GPS). */
  getPosition: () => Promise<Coords>;
};

/**
 * Live-camera selfie (no gallery uploads) stamped with map, address,
 * date/time and weather, like a GPS map camera.
 */
export function StampedSelfie({ onChange, getPosition }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "live" | "processing" | "done">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => stop, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setState("live");
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
    stop();
    setState("processing");
    try {
      const pos = await getPosition();
      const [address, w] = await Promise.all([reverseGeocode(pos), currentWeather(pos)]);
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

  return (
    <div className="rounded-xl border bg-secondary/30 p-3">
      {state === "idle" && (
        <Button type="button" variant="outline" className="w-full h-11" onClick={start}>
          <Camera className="mr-2 h-4 w-4" /> Take live photo
        </Button>
      )}

      {state === "live" && (
        <div className="space-y-2">
          <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black [transform:scaleX(-1)]" />
          <Button type="button" className="w-full h-11" onClick={capture}>
            <Camera className="mr-2 h-4 w-4" /> Capture
          </Button>
        </div>
      )}

      {state === "processing" && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Adding location, time and weather…
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
