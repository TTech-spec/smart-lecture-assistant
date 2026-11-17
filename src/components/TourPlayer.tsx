import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Hand, Info, MousePointer2, X } from "lucide-react";
import { tourById, type Tour, type TourStep } from "@/lib/tours";

const LOOK_MS = 6000;

const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

/** The step's element: its data-tour marker first (exact), then its visible text */
function findTarget(step: TourStep): HTMLElement | null {
  if (step.tour) {
    const byMark = [...document.querySelectorAll<HTMLElement>(`[data-tour="${step.tour}"]`)].find(visible);
    if (byMark) return byMark;
  }
  if (!step.text) return null;
  const want = step.text.toLowerCase();
  const els = [...document.querySelectorAll<HTMLElement>("main button, main a, main [role=tab], main h1, main h2, main h3, main label, aside button, aside a")];
  const norm = (el: HTMLElement) => el.innerText.trim().replace(/\s+/g, " ").toLowerCase();
  return els.find((el) => visible(el) && norm(el) === want)
    ?? els.find((el) => visible(el) && norm(el).startsWith(want) && norm(el).length < want.length + 30)
    ?? null;
}

/**
 * Walks the lecturer through a task on the real screens: opens the page,
 * points at the exact control and explains it. "Tap" steps wait for the
 * lecturer to tap the highlighted control (or "Do it for me"); "look" steps
 * move on by themselves. A step never moves on while its control is missing;
 * it says why instead.
 */
export function TourPlayer() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [tour, setTour] = useState<Tour | null>(null);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onTour = (e: Event) => {
      const t = tourById(String((e as CustomEvent).detail));
      if (!t) return;
      setTour(t); setStep(0); setElapsed(0);
    };
    window.addEventListener("att:tour", onTour);
    return () => window.removeEventListener("att:tour", onTour);
  }, []);

  const close = useCallback(() => { setTour(null); setRect(null); targetRef.current = null; }, []);
  const go = useCallback((n: number) => {
    if (!tour) return;
    if (n >= tour.steps.length) { close(); return; }
    setStep(Math.max(0, n)); setElapsed(0);
  }, [tour, close]);

  const s = tour?.steps[step];

  // Open the step's page, then find and highlight its control (waits up to ~5 s)
  useEffect(() => {
    if (!tour || !s) return;
    if (pathname !== s.path) { navigate({ to: s.path }); return; }
    setRect(null); setMissing(false); targetRef.current = null;
    if (!s.tour && !s.text) return;
    let tries = 0;
    const look = setInterval(() => {
      const el = findTarget(s);
      if (el) {
        clearInterval(look);
        targetRef.current = el;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => setRect(el.getBoundingClientRect()), 350);
      } else if (++tries > 33) {
        clearInterval(look);
        setMissing(true);
      }
    }, 150);
    return () => clearInterval(look);
  }, [tour, s, pathname, navigate]);

  // Keep the highlight on the control as the page scrolls or resizes
  useEffect(() => {
    if (!tour) return;
    const update = () => { const el = targetRef.current; if (el && el.isConnected) setRect(el.getBoundingClientRect()); };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const t = setInterval(update, 500);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); clearInterval(t); };
  }, [tour, step]);

  // "Tap" steps: go on when the lecturer taps the highlighted control
  useEffect(() => {
    if (!tour || !s || s.action !== "tap" || !rect) return;
    const el = targetRef.current;
    if (!el) return;
    const onTap = () => setTimeout(() => go(step + 1), 400);
    el.addEventListener("click", onTap, { once: true });
    return () => el.removeEventListener("click", onTap);
  }, [tour, s, rect, step, go]);

  // "Look" steps move on by themselves, but only once their control is showing
  const autoAdvance = Boolean(tour && s && s.action !== "tap" && !missing && (rect || (!s.tour && !s.text)));
  useEffect(() => {
    if (!autoAdvance) return;
    const t = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(t);
  }, [autoAdvance, step]);
  useEffect(() => { if (autoAdvance && elapsed >= LOOK_MS) go(step + 1); }, [elapsed, autoAdvance, step, go]);

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

  if (!tour || !s) return null;
  const pad = 8;
  const box = rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  const waitingTap = s.action === "tap" && !!box;
  // Keep the caption away from the highlighted control
  const captionTop = box && typeof window !== "undefined" && box.top + box.height > window.innerHeight * 0.55;

  return (
    <div className="pointer-events-none fixed inset-0 z-[90]" aria-live="polite">
      {/* Dim everything except the control (the control itself stays tappable) */}
      {box ? (
        <motion.div className="absolute rounded-xl ring-4 ring-[#12b886]" initial={false} animate={box}
          transition={{ type: "spring", stiffness: 180, damping: 24 }} style={{ boxShadow: "0 0 0 9999px rgba(10,18,30,0.55)" }}>
          <span className="absolute inset-0 animate-ping rounded-xl ring-2 ring-[#12b886]/60" />
        </motion.div>
      ) : (
        <div className="absolute inset-0 bg-[rgba(10,18,30,0.45)]" />
      )}

      {box && (
        <motion.div className="absolute text-white drop-shadow-lg" initial={{ opacity: 0 }}
          animate={{ left: box.left + box.width * 0.6, top: box.top + box.height * 0.65, opacity: 1 }}
          transition={{ type: "spring", stiffness: 90, damping: 16 }}>
          {waitingTap ? <Hand className="h-8 w-8 fill-[#12b886]" /> : <MousePointer2 className="h-8 w-8 fill-[#12b886]" />}
        </motion.div>
      )}

      <div className={`absolute inset-x-0 flex justify-center px-4 ${captionTop ? "top-0 pt-[max(16px,env(safe-area-inset-top))]" : "bottom-0 pb-[max(16px,env(safe-area-inset-bottom))]"}`}>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: captionTop ? -16 : 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-2xl">
            <div className="h-1 bg-secondary">
              <div className="h-full bg-[#12b886] transition-[width] duration-100"
                style={{ width: `${s.action === "tap" ? ((step + (waitingTap ? 0.5 : 0)) / tour.steps.length) * 100 : Math.min(100, (elapsed / LOOK_MS) * 100)}%` }} />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">Show me how · {tour.title}</p>
                <span className="text-xs tabular-nums text-muted-foreground">Step {step + 1} of {tour.steps.length}</span>
              </div>
              <p className="mt-1.5 text-[15px] font-medium leading-6">{s.caption}</p>
              {waitingTap && <p className="mt-1 text-sm font-semibold text-primary">👆 Tap the highlighted button to continue.</p>}
              {missing && (
                <p className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  {s.missing ?? "This isn't on your screen right now. Follow the step above, then tap Next."}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous step"
                  className="flex h-9 w-9 items-center justify-center rounded-full border disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                {waitingTap ? (
                  <button type="button" onClick={() => { targetRef.current?.click(); }}
                    className="rounded-full bg-[#12b886] px-4 py-2 text-sm font-semibold text-white">Do it for me</button>
                ) : (
                  <button type="button" onClick={() => go(step + 1)}
                    className="flex items-center gap-1 rounded-full bg-[#12b886] px-4 py-2 text-sm font-semibold text-white">
                    {step === tour.steps.length - 1 ? "Done" : "Next"} <ChevronRight className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={close} className="ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm">
                  <X className="h-3.5 w-3.5" /> Close
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
