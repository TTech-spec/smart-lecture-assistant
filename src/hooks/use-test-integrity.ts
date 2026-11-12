import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { TestIntegrity } from "@/lib/attendance-store";

/**
 * Watches a test while it's being taken:
 * - focus lost while the page is still on screen (another app in split screen,
 *   a floating ChatGPT/assistant bubble, a pop-up window),
 * - the page shrinking a lot (Android split screen / pop-up view),
 * - copy, cut, long-press menus and text selection (blocked).
 * Nothing is blocked except copying; everything is counted for the lecturer.
 */
export function useTestIntegrity() {
  const [counts, setCounts] = useState<TestIntegrity>({ focusLost: 0, splitScreen: 0, copyAttempts: 0 });
  const ref = useRef(counts);
  ref.current = counts;

  useEffect(() => {
    const bump = (k: keyof TestIntegrity, msg?: string) => {
      setCounts((c) => ({ ...c, [k]: c[k] + 1 }));
      if (msg) toast.warning(msg, { id: `integrity-${k}` });
    };
    const area = () => window.innerWidth * window.innerHeight;
    let fullArea = area();
    let shrunk = false;
    let lastOrientation = screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? "landscape" : "portrait");

    const onBlur = () => {
      // Hidden pages are already handled by the "left the app" rule; this catches the page staying visible
      if (!document.hidden) bump("focusLost", "Stay on the test. Using another app beside it is recorded.");
    };
    const onResize = () => {
      const orientation = screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? "landscape" : "portrait");
      if (orientation !== lastOrientation) { lastOrientation = orientation; fullArea = Math.max(fullArea, area()); shrunk = false; return; }
      const a = area();
      if (a > fullArea) fullArea = a;
      if (!shrunk && a < fullArea * 0.7) { shrunk = true; bump("splitScreen", "Split screen or a pop-up window was detected. This is recorded."); }
      else if (shrunk && a > fullArea * 0.9) shrunk = false;
    };
    // Students may still select and edit their own typed answers
    const inAnswerBox = (e: Event) => (e.target as HTMLElement | null)?.closest?.("textarea") != null;
    const block = (e: Event) => { if (!inAnswerBox(e)) e.preventDefault(); };
    const onCopy = (e: Event) => { e.preventDefault(); bump("copyAttempts", "Copying questions isn't allowed during the test."); };

    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("contextmenu", block);
    document.addEventListener("selectstart", block);
    document.addEventListener("dragstart", block);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("selectstart", block);
      document.removeEventListener("dragstart", block);
    };
  }, []);

  return { counts, ref };
}

/** Classes for the test area: no text selection, no long-press copy menu on iPhone. */
export const NO_COPY_CLASS = "select-none [-webkit-touch-callout:none] [-webkit-user-select:none]";

