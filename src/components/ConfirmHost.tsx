import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Ask = { message: string; okText: string; danger: boolean; resolve: (ok: boolean) => void };

let show: ((a: Ask) => void) | null = null;

/**
 * In-app "Are you sure?" box. Used instead of the browser's own confirm(),
 * which phones often block silently (installed app, in-app browsers), so
 * Delete / Disable buttons looked like they did nothing.
 */
export function askConfirm(message: string, opts: { okText?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const ask: Ask = { message, okText: opts.okText ?? "Yes, continue", danger: opts.danger ?? true, resolve };
    if (show) show(ask);
    else resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  });
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    show = (a) => setAsk((prev) => { prev?.resolve(false); return a; });
    return () => { show = null; };
  }, []);
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") answer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function answer(ok: boolean) { ask?.resolve(ok); setAsk(null); }
  if (!ask || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 p-4 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg"
      onClick={(e) => { if (e.target === e.currentTarget) answer(false); }}>
      <div className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-2xl">
        <p id="confirm-msg" className="text-[15px] font-medium leading-6 text-foreground">{ask.message}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" autoFocus onClick={() => answer(true)}
            className={`h-12 flex-1 rounded-full text-[15px] font-semibold text-white ${ask.danger ? "bg-red-600 active:bg-red-700" : "bg-primary active:opacity-90"}`}>
            {ask.okText}
          </button>
          <button type="button" onClick={() => answer(false)} className="h-12 flex-1 rounded-full border text-[15px] font-medium">Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
