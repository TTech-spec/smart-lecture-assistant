import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, Loader2, ScanLine, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decideHelpRequest, peekHelpRequest, type HelpPreview } from "@/lib/attendance-store";

const REASON: Record<string, string> = {
  weak_gps: "Weak GPS signal",
  out_of_range: "GPS placed them outside the class radius",
  no_gps: "No GPS reading",
};
function reasonText(r: string | null) {
  if (!r) return "GPS problem";
  const [code, n] = r.split(":");
  return `${REASON[code] ?? "GPS problem"}${n ? code === "weak_gps" ? ` (±${n} m)` : ` (${n} m away)` : ""}`;
}

/** Lecturer scans the QR on a student's phone, checks the person, and approves. */
export function HelpScanner({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [found, setFound] = useState<{ id: string; info: HelpPreview } | null>(null);
  const [looking, setLooking] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [done, setDone] = useState(0);

  const stopCamera = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };

  const handleCode = useCallback(async (text: string) => {
    const m = text.match(/^ATTHELP:([a-f0-9]{16,64})$/i);
    if (!m || busyRef.current) return;
    busyRef.current = true;
    setLooking(true);
    const info = await peekHelpRequest(m[1]);
    setLooking(false);
    if ("error" in info && !("matric" in info)) {
      toast.error(info.error === "not_lecturer" ? "Sign in as a lecturer to approve students." : info.error === "not_configured" ? "GPS help isn't switched on yet: run gps-help.sql in Supabase." : info.error === "not_found" ? "That code isn't valid. Ask the student to try again." : "Couldn't check the code. Try again.");
      setTimeout(() => { busyRef.current = false; }, 1500);
      return;
    }
    setFound({ id: m[1], info: info as HelpPreview });
  }, []);

  // Camera + scanning loop
  useEffect(() => {
    let raf = 0; let stopped = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.muted = true; v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); // iPhone Safari needs these to show the camera
        v.srcObject = stream; await v.play();
        const { default: jsQR } = await import("jsqr");
        canvasRef.current = document.createElement("canvas");
        const loop = () => {
          if (stopped) return;
          const c = canvasRef.current!;
          if (v.videoWidth && !busyRef.current) {
            const w = Math.min(640, v.videoWidth); const h = Math.round(v.videoHeight * (w / v.videoWidth));
            c.width = w; c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, w, h);
            const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
            if (code?.data) handleCode(code.data);
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setCamError("Couldn't open the camera. Allow camera access for this site, or use a phone or laptop with a camera.");
      }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stopCamera(); };
  }, [handleCode]);

  async function decide(approve: boolean) {
    if (!found) return;
    setDeciding(true);
    const r = await decideHelpRequest(found.id, approve);
    setDeciding(false);
    if ("error" in r) {
      toast.error(r.error === "expired" ? "That code expired. Ask the student to request help again."
        : r.error.startsWith("already_") ? "This request was already handled."
        : /duplicate/.test(r.error) ? `${found.info.name} is already marked for this class today.`
        : r.error === "not_lecturer" ? "Sign in as a lecturer to approve students." : "Couldn't save. Try again.");
    } else {
      toast.success(approve ? `${found.info.name} is checked in.` : `Declined ${found.info.name}.`);
      if (approve) setDone((n) => n + 1);
    }
    setFound(null);
    setTimeout(() => { busyRef.current = false; }, 800);
  }

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="relative flex max-h-[100svh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-3xl" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold"><ScanLine className="h-5 w-5 text-primary" /> Scan a student</h2>
            <p className="text-[13px] text-muted-foreground">For students in the hall whose GPS isn't working. Point the camera at the code on their phone.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><X className="h-5 w-5" /></button>
        </div>

        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-white/80" />
          {camError && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white"><Camera className="h-6 w-6" />{camError}</div>}
          {looking && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        </div>
        {done > 0 && <p className="text-center text-[13px] text-muted-foreground">{done} student{done > 1 ? "s" : ""} approved. Keep scanning or close.</p>}

        <AnimatePresence>
          {found && (
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
              className="absolute inset-x-0 bottom-0 flex flex-col gap-4 rounded-t-3xl bg-background p-5 shadow-[0_-12px_40px_rgba(0,0,0,0.25)]" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-700 dark:text-amber-400">{reasonText(found.info.reason)}</p>
                <h3 className="mt-1 font-display text-2xl font-bold">{found.info.name}</h3>
                <p className="font-mono text-[13px] text-muted-foreground">{found.info.matric} · {found.info.course}{found.info.registered ? "" : " · not registered"}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[["Registered", found.info.registeredPhoto], ["Selfie now", found.info.photo]].map(([label, src]) => (
                  <div key={label as string}>
                    <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
                    {src ? <img src={src as string} alt={`${label} photo of ${found.info.name}`} className="aspect-square w-full rounded-xl object-cover" />
                      : <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-secondary text-[12px] text-muted-foreground">No photo</div>}
                  </div>
                ))}
              </div>
              <p className="text-[13px] leading-5 text-muted-foreground">
                {found.info.status !== "pending" ? `This request is ${found.info.status}.` : "Look at the student in front of you. Approve only if it's the same person and they're in the hall."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={deciding} onClick={() => decide(false)} className="h-12 rounded-full text-destructive hover:text-destructive"><XCircle className="mr-1.5 h-4 w-4" /> Decline</Button>
                <Button disabled={deciding || found.info.status !== "pending"} onClick={() => decide(true)} className="h-12 rounded-full">
                  {deciding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Approve
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
