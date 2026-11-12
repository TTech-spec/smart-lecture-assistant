/** Browser side of phone notifications (see push-server.ts and public/push-sw.js). */
import { supabase } from "@/lib/supabase";
import { getPushPublicKey } from "@/lib/push-server";
import { getDeviceId, getRegisteredMatric } from "@/lib/attendance-store";

export type PushState = "unsupported" | "needs-install" | "blocked" | "off" | "on";

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
export function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // iPhone only allows notifications for apps added to the home screen
  if (!supported) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch { return "off"; }
}

/** The service worker reads the database address from here to fetch the notice text. */
async function saveConfigForWorker() {
  const url = (import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string | undefined;
  if (!url || !key) return;
  const cache = await caches.open("attendly-config");
  await cache.put("/__attendly_config", new Response(JSON.stringify({ url, key }), { headers: { "Content-Type": "application/json" } }));
}

const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export async function turnOnNotifications(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const state = await pushState();
  if (state === "needs-install") return { ok: false, reason: "Add Attendly to your home screen first, then open it from there and turn on notifications." };
  if (state === "unsupported") return { ok: false, reason: "This browser can't show notifications. Use Chrome on Android, or Safari on iPhone after adding to home screen." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "Notifications are blocked. Allow them for this site in your phone's settings, then try again." };
  const keyRes = await getPushPublicKey();
  if (!keyRes.ok) return { ok: false, reason: "Notifications aren't set up yet. Please let your lecturer know." };
  try {
    await saveConfigForWorker();
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(keyRes.key) });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!supabase || !json.endpoint) return { ok: false, reason: "We couldn't reach the server. Check your connection and try again." };
    const { error } = await supabase.rpc("save_push_subscription", {
      p: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, matric: getRegisteredMatric() ?? "", deviceId: getDeviceId() },
    });
    if (error) return { ok: false, reason: /does not exist|schema cache|Could not find/i.test(error.message) ? "Notifications aren't set up yet. Please let your lecturer know." : "We couldn't reach the server. Check your connection and try again." };
    return { ok: true };
  } catch {
    return { ok: false, reason: "We couldn't turn on notifications on this phone. Try again." };
  }
}

export async function turnOffNotifications(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase?.rpc("remove_push_subscription", { p_endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
}
