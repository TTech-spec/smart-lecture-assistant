import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { useStore } from "@/hooks/use-store";
import { checkStatus } from "@/components/admin/ui";
import { AskAiChat, type AiRow } from "@/components/AskAiChat";

/** Floating "Ask AI" on every admin page: how-to help, fixes, navigation and record questions. */
export function AdminAssistant() {
  const [open, setOpen] = useState(false);
  const { records } = useStore();
  // The phone Live screen is full-screen; the floating button would cover its controls
  const onLive = useRouterState({ select: (st) => st.location.pathname.startsWith("/admin/live") });
  const rows: AiRow[] = useMemo(() => [...records].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map((r) => ({
    name: r.fullName, matric: r.matricNumber, dept: r.department, level: r.level, gender: r.gender,
    course: r.courseCode, status: checkStatus(r.customFields).label, distance: r.distanceMeters || undefined,
    at: r.submittedAt, classCode: r.assignedClassCode || undefined,
  })), [records]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open the AI assistant"
        className={`fixed bottom-[88px] right-4 z-40 h-12 ${onLive ? "hidden lg:flex" : "flex"} w-12 items-center justify-center gap-2 rounded-full bg-[#152033] font-semibold lg:w-auto lg:pl-4 lg:pr-5 text-white shadow-[0_10px_30px_rgba(21,32,51,0.35)] transition-transform hover:scale-[1.03] active:scale-95 lg:bottom-6 lg:right-6`}
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <Sparkles className="h-5 w-5 text-[#3ddc9f]" /> <span className="hidden lg:inline">Ask AI</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
            <motion.aside role="dialog" aria-label="AI assistant" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.22 }}
              className="flex h-full w-full max-w-md flex-col gap-4 bg-background p-5 shadow-2xl sm:p-6" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 font-display text-2xl font-bold"><Sparkles className="h-5 w-5 text-primary" /> Attendly AI</h2>
                  <p className="text-[13px] text-muted-foreground">How-to help, fixes, and answers about your records</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              <AskAiChat rows={rows} onNavigate={() => setOpen(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
