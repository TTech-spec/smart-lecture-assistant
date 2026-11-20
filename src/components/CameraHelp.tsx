import { createPortal } from "react-dom";
import { Camera, RefreshCw, Settings } from "lucide-react";

type Device = "iphone" | "android" | "inapp" | "other";

function detect(): Device {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // Links opened inside WhatsApp, Facebook, Instagram, etc. often can't use the camera at all
  if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|; wv\)/i.test(ua)) return "inapp";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

const STEPS: Record<Device, { title: string; steps: string[] }> = {
  iphone: {
    title: "Turn on the camera (iPhone)",
    steps: [
      "Tap the “aA” or the puzzle icon in the address bar, then Website Settings.",
      "Set Camera to Allow.",
      "If you don't see that: open the Settings app → Safari → Camera → Allow.",
      "Come back here and tap Try again.",
    ],
  },
  android: {
    title: "Turn on the camera (Android)",
    steps: [
      "Tap the lock icon next to the web address at the top.",
      "Tap Permissions, then turn Camera on.",
      "If you don't see that: open Settings → Apps → Chrome → Permissions → Camera → Allow.",
      "Come back here and tap Try again.",
    ],
  },
  inapp: {
    title: "Open this page in your browser",
    steps: [
      "This page was opened inside another app (like WhatsApp), which blocks the camera.",
      "Tap the three dots ⋮ or the share icon at the top.",
      "Choose “Open in Chrome” or “Open in Safari”.",
      "Allow the camera when the browser asks.",
    ],
  },
  other: {
    title: "Turn on the camera",
    steps: [
      "Click the lock icon next to the web address.",
      "Set Camera to Allow.",
      "Reload the page, or tap Try again.",
    ],
  },
};

/**
 * Shown when the camera is blocked. A web page isn't allowed to open the
 * phone's settings itself, so this walks the student there step by step.
 */
export function CameraHelp({ onRetry, onUsePhoneCamera, onClose }: {
  onRetry: () => void; onUsePhoneCamera?: () => void; onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  const d = STEPS[detect()];
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/55 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="cam-help-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[90svh] w-full max-w-sm overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <Settings className="h-5 w-5" />
        </span>
        <h2 id="cam-help-title" className="mt-3 text-lg font-semibold">{d.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your camera is switched off for this page. We need it for your attendance photo.</p>
        <ol className="mt-4 space-y-2.5">
          {d.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm leading-5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={onRetry} className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-primary-foreground">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
          {onUsePhoneCamera && (
            <button type="button" onClick={onUsePhoneCamera} className="flex h-12 items-center justify-center gap-2 rounded-full border text-[15px] font-medium">
              <Camera className="h-4 w-4" /> Use phone camera instead
            </button>
          )}
          <button type="button" onClick={onClose} className="h-10 text-sm text-muted-foreground">Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
