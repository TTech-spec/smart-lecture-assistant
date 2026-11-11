import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { analyseFace, cropFacePhoto, loadFaceApi, switchToCpuBackend } from "@/lib/face";
import { startLiveness, updateLiveness, type LivenessFrame, type LivenessState } from "@/lib/liveness";

export type FaceScanResult = { descriptor: number[]; photo: string };

type Step = "hold" | "blink" | "turn" | "done";

/**
 * Live face enrolment with simple liveness: hold still → blink → turn head.
 * Saves automatically once all three pass; a printed photo or a video on
 * another screen can't blink and turn on request.
 */
export function FaceScan({ onDone }: { onDone: (r: FaceScanResult) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [step, setStep] = useState<Step>("hold");
  const [faceSeen, setFaceSeen] = useState(false);
  const [hint, setHint] = useState("Loading face scanner (first time only)…");
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    // Liveness state
    let stillFrames = 0;
    // Eye/head readings while holding still → this student's own baseline
    const steadyReadings: LivenessFrame[] = [];
    let live: LivenessState | null = null;
    let baselineDescriptor: Float32Array | null = null;
    let baselineSource: HTMLCanvasElement | null = null;
    let lastBox: { x: number; y: number } | null = null;
    let current: Step = "hold";
    // Once the face has been steady, we're "capturing": every frame asks for
    // the fingerprint and the first good one is used — movement during the
    // (slower) fingerprint frame no longer restarts the count.
    let capturing = false;
    let missedFrames = 0;      // consecutive frames with no face
    let descriptorErrors = 0;  // fingerprint failures (some phones' GPUs)
    let holdStartedAt = Date.now();

    async function start() {
      try {
        await loadFaceApi();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setStatus("live");
        setHint("Hold still, face inside the oval");
        loop();
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error && /denied|permission/i.test(e.message)
          ? "Camera permission is needed. Allow it in your browser settings and try again."
          : "Could not start the face scanner. Check your connection and try again.");
      }
    }

    async function loop() {
      if (cancelled || doneRef.current) return;
      const v = videoRef.current;
      if (v && v.videoWidth) {
        try {
          let f: Awaited<ReturnType<typeof analyseFace>> = null;
          try {
            f = await analyseFace(v, { withDescriptor: current === "hold" && capturing });
          } catch (err) {
            // A fingerprint failure on this phone's GPU: fall back to the slower CPU path
            if (current === "hold" && capturing && ++descriptorErrors === 3) await switchToCpuBackend();
            console.warn("Face scan frame failed:", err);
          }
          setFaceSeen(Boolean(f));
          if (!f) {
            // One missed frame is normal; only react after several in a row
            missedFrames++;
            if (missedFrames >= 4) {
              stillFrames = 0;
              capturing = false;
              setHint("No face found — move closer, into the light");
            }
          } else if (f.box.w < 0.15) {
            missedFrames = 0;
            stillFrames = Math.max(0, stillFrames - 1);
            setHint("Move closer to the camera");
          } else {
            missedFrames = 0;
            const moved = lastBox ? Math.hypot(f.box.x - lastBox.x, f.box.y - lastBox.y) : 0;
            lastBox = { x: f.box.x, y: f.box.y };

            if (current === "hold") {
              steadyReadings.push({ eyeOpenness: f.eyeOpenness, yaw: f.yaw });
              if (steadyReadings.length > 8) steadyReadings.shift();
              if (!capturing) {
                // Forgiving: small wobbles only slow the count, they don't restart it
                stillFrames = moved < 0.06 ? stillFrames + 1 : Math.max(0, stillFrames - 1);
                if (stillFrames >= 3) capturing = true;
                const slow = Date.now() - holdStartedAt > 12_000;
                setHint(capturing ? "Capturing…" : slow ? "Hold the phone steady, at eye level" : "Hold still…");
              }
              if (capturing && f.descriptor.length === 128) {
                baselineDescriptor = f.descriptor;
                const c = document.createElement("canvas");
                c.width = v.videoWidth; c.height = v.videoHeight;
                c.getContext("2d")!.drawImage(v, 0, 0);
                baselineSource = c;
                live = startLiveness(steadyReadings);
                current = "blink"; setStep("blink");
                setHint("Close your eyes for a second");
              }
            } else if (live) {
              // Close eyes, then turn head — measured against this student's own baseline
              const r = updateLiveness(live, { eyeOpenness: f.eyeOpenness, yaw: f.yaw });
              live = r.state;
              setHint(r.hint);
              if (live.step === "turn" && current !== "turn") { current = "turn"; setStep("turn"); }
              if (live.step === "done") {
                current = "done"; setStep("done");
                finish();
                return;
              }
            }
          }
        } catch {
          /* skip frame */
        }
      }
      raf = window.setTimeout(loop, 40) as unknown as number;
    }

    function finish() {
      if (doneRef.current || !baselineDescriptor || !baselineSource) return;
      doneRef.current = true;
      // Re-detect on the saved frame to crop the photo around the face
      const save = (box?: { x: number; y: number; w: number; h: number }) => {
        const photo = cropFacePhoto(baselineSource!, box ?? { x: 0.25, y: 0.15, w: 0.5, h: 0.6 });
        stop();
        onDone({ descriptor: Array.from(baselineDescriptor!), photo });
      };
      // If re-detecting fails, still save with a centred crop — never hang here
      analyseFace(baselineSource).then((f) => save(f?.box), () => save());
    }

    function stop() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    start();
    return () => { cancelled = true; clearTimeout(raf); stop(); };
  }, [onDone]);

  const checks: { key: Step; label: string }[] = [
    { key: "hold", label: "Hold still" },
    { key: "blink", label: "Close eyes" },
    { key: "turn", label: "Turn head" },
  ];
  const order: Step[] = ["hold", "blink", "turn", "done"];
  const idx = order.indexOf(step);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl bg-[#283349]" style={{ aspectRatio: "3 / 4" }}>
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]" />
        {/* Oval mask */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[72%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px]"
          style={{ borderColor: faceSeen ? "#4fd8a8" : "#9aa6b8", boxShadow: "0 0 0 999px rgba(18,26,43,0.55)" }}
        />
        <div className="absolute left-3 right-3 top-3 flex justify-between text-[11px] font-semibold text-white">
          <span className="rounded-full bg-black/50 px-2 py-1">{faceSeen ? "Face detected" : "Looking for face…"}</span>
          <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1">
            <span className={`h-2 w-2 rounded-full ${status === "live" ? "bg-green-500" : "bg-gray-400"}`} /> LIVE
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-center text-white">
          {status === "loading" ? (
            <p className="flex items-center justify-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> {hint}</p>
          ) : (
            <>
              <p className="text-lg font-semibold">{hint}</p>
              <p className="mt-1 text-xs text-gray-300">
                {step === "done" ? "Saving…" : `${Math.min(idx + 1, 3)} of 3 checks`}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-center gap-6 text-xs text-muted-foreground">
        {checks.map((c, i) => {
          const passed = i < idx;
          const active = i === idx;
          return (
            <span key={c.key} className={`flex items-center gap-1.5 ${active ? "text-foreground" : ""}`}>
              <span
                className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-bold ${
                  passed ? "bg-primary text-primary-foreground" : active ? "border-2 border-primary" : "border-2 border-border"}`}
              >
                {passed ? "✓" : ""}
              </span>
              {c.label}
            </span>
          );
        })}
      </div>
      <p className="text-center text-xs text-muted-foreground">Good light on your face · no cap, mask or dark glasses</p>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
