import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, MousePointer2, Pause, Play, X } from "lucide-react";
import { tourById, type Tour } from "@/lib/tours";

const STEP_MS = 5000;

/** Visible element whose text matches the step target */
function findTarget(text?: string): HTMLElement | null {
  if (!text) return null;
  const want = text.toLowerCase();
  const els = [...document.querySelectorAll<HTMLElement>("main button, main a, main [role=tab], main h1, main h2, main h3, main label, main summary, aside a, main span")];
  const visible = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const norm = (el: HTMLElement) => el.innerText.trim().replace(/\s+/g, " ").toLowerCase();
  return els.find((el) => visible(el) && norm(el) === want)
    ?? els.find((el) => visible(el) && norm(el).startsWith(want) && norm(el).length < want.length + 30)
    ?? els.find((el) => visible(el) && el.tagName === "BUTTON" && norm(el).includes(want) && norm(el).length < want.length + 6)
    ?? null;
}

/**
 * Plays a walkthrough like a short video over the real app: opens each page,
 * moves a pointer to the button, highlights it and shows a caption. Starts
 * when anything dispatches the "att:tour" event (see playTour).
 */
export function TourPlayer() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [tour, setTour] = useState<Tour | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onTour = (e: Event) => {
      const t = tourById(String((e as CustomEvent).detail));
      if (!t) return;
      setTour(t); setStep(0); setPlaying(true); setElapsed(0);
    };
    window.addEventListener("att:tour", onTour);
    return () => window.removeEventListener("att:tour", onTour);
  }, []);

  const close = useCallback(() => { setTour(null); setRect(null); }, []);
  const go = useCallback((n: number) => {
    if (!tour) return;
    // Moving forward from a "press" step: tap the button so its form opens
    const cur = tour.steps[step];
    if (n > step && cur?.press) findTarget(cur.target)?.click();
    if (n >= tour.steps.length) { close(); return; }
    setStep(Math.max(0, n)); setElapsed(0);
  }, [tour, step, close]);

  // Open the step's page, then find and highlight its target
  useEffect(() => {
    if (!tour) return;
    const s = tour.steps[step];
    if (pathname !== s.path) { navigate({ to: s.path }); return; }
    setRect(null);
    let tries = 0;
    const look = setInterval(() => {
      const el = findTarget(s.target);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => setRect(el.getBoundingClientRect()), 350);
        clearInterval(look);
      } else if (++tries > 12) clearInterval(look);
    }, 150);
    return () => clearInterval(look);
  }, [tour, step, pathname, navigate]);

  // Keep the highlight on the element when the page scrolls or resizes
  useEffect(() => {
    if (!tour) return;
    const update = () => { const el = findTarget(tour.steps[step].target); if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [tour, step]);

  // Advance by itself like a video
  useEffect(() => {
    if (!tour || !playing) return;
    tick.current = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [tour, playing, step]);
  useEffect(() => { if (tour && elapsed >= STEP_MS) go(step + 1); }, [elapsed, tour, step, go]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") go(step + 1);
      if (e.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, step, go, close]);

  if (!tour) return null;
  const s = tour.steps[step];
  const pad = 8;
  const box = rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;

  return (
    <div className="fixed inset-0 z-[90]" aria-live="polite">
      {/* Dim everything except the highlighted element */}
      <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        style={box ? undefined : { background: "rgba(10,18,30,0.55)" }} onClick={() => setPlaying((p) => !p)} />
      {box && (
        <motion.div className="pointer-events-none absolute rounded-xl ring-4 ring-[#12b886]"
          initial={false} animate={box} transition={{ type: "spring", stiffness: 180, damping: 24 }}
          style={{ boxShadow: "0 0 0 9999px rgba(10,18,30,0.55)" }}>
          <span className="absolute inset-0 animate-ping rounded-xl ring-2 ring-[#12b886]/60" />
        </motion.div>
      )}
      {/* Pointer */}
      <motion.div className="pointer-events-none absolute text-white drop-shadow-lg"
        initial={{ left: "50%", top: "60%", opacity: 0 }}
        animate={box ? { left: box.left + box.width * 0.6, top: box.top + box.height * 0.65, opacity: 1 } : { left: "50%", top: "45%", opacity: 0 }}
        transition={{ type: "spring", stiffness: 90, damping: 16 }}>
        <MousePointer2 className="h-8 w-8 fill-[#12b886]" />
        {box && <motion.span key={step} className="absolute left-0 top-0 h-8 w-8 rounded-full bg-[#12b886]/50"
          initial={{ scale: 0, opacity: 1 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ delay: 0.9, duration: 0.7 }} />}
      </motion.div>

      {/* Caption, like video subtitles with controls */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-2xl">
            <div className="h-1 bg-secondary"><div className="h-full bg-[#12b886] transition-[width] duration-100" style={{ width: `${Math.min(100, (elapsed / STEP_MS) * 100)}%` }} /></div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">Show me how · {tour.title}</p>
                <span className="text-xs tabular-nums text-muted-foreground">{step + 1}/{tour.steps.length}</span>
              </div>
              <p className="mt-1.5 text-[15px] font-medium leading-6">{s.caption}</p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous step"
                  className="flex h-9 w-9 items-center justify-center rounded-full border disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#12b886] text-white">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
                <button type="button" onClick={() => go(step + 1)} aria-label="Next step"
                  className="flex h-9 w-9 items-center justify-center rounded-full border"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" onClick={close} className="ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm">
                  <X className="h-3.5 w-3.5" /> {step === tour.steps.length - 1 ? "Done" : "Close"}
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
