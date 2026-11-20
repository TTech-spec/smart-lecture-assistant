import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, LocateFixed, MapPin, QrCode, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeafletMap } from "@/components/LeafletMap";
import { reverseGeocode } from "@/lib/photo-stamp";
import { distanceMeters, type Coords } from "@/lib/geo";
import { APP_VERSION } from "@/lib/version";
import { fetchActiveAttendance, type ActiveAttendance } from "@/lib/attendance-store";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Sign attendance — Attendly" },
      { name: "description", content: "Check your live location, then open your class link to sign attendance." },
    ],
  }),
  component: AttendancePage,
});

type LocState =
  | { kind: "waiting" }
  | { kind: "denied" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "live"; pos: Coords; at: number };

function accuracyLabel(acc?: number) {
  if (acc == null) return { text: "Checking signal…", tone: "muted" as const };
  if (acc <= 25) return { text: `Strong signal · ±${Math.round(acc)} m`, tone: "good" as const };
  if (acc <= 60) return { text: `OK signal · ±${Math.round(acc)} m`, tone: "ok" as const };
  return { text: `Weak signal · ±${Math.round(acc)} m. Move near a window or outside the door.`, tone: "bad" as const };
}

function AttendancePage() {
  const [loc, setLoc] = useState<LocState>({ kind: "waiting" });
  const [address, setAddress] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const watchRef = useRef<number | null>(null);
  const lastGeo = useRef<{ pos: Coords; at: number } | null>(null);

  useEffect(() => setMounted(true), []);

  // Open check-ins: re-checked every 20 seconds so the button appears by itself
  const [active, setActive] = useState<ActiveAttendance[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    const load = () => fetchActiveAttendance().then((a) => { if (!cancelled) { setActive(a); setNow(Date.now()); } });
    load();
    const t = setInterval(load, 20_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const open = active.filter((a) => new Date(a.expiresAt).getTime() > now);

  function start() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setLoc({ kind: "unsupported" }); return; }
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    setLoc({ kind: "waiting" });
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos: Coords = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: "gps" };
        setLoc({ kind: "live", pos, at: Date.now() });
        const last = lastGeo.current;
        if (!last || distanceMeters(last.pos, pos) > 20 || Date.now() - last.at > 30_000) {
          lastGeo.current = { pos, at: Date.now() };
          reverseGeocode(pos).then(setAddress).catch(() => {});
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setLoc({ kind: "denied" });
        else setLoc({ kind: "error", message: err.code === err.TIMEOUT ? "Your phone took too long to find you." : "Your phone couldn't get a location." });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }

  useEffect(() => {
    start();
    return () => { if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = loc.kind === "live" ? loc : null;
  const acc = accuracyLabel(live?.pos.accuracy);
  const toneClass = { good: "bg-accent text-primary", ok: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300", bad: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300", muted: "bg-secondary text-muted-foreground" }[acc.tone];

  return (
    <div className="min-h-[100svh] bg-background">
      <div className="mx-auto grid min-h-[100svh] max-w-6xl lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:p-6">
        <aside className="sticky top-6 hidden h-[calc(100svh-48px)] flex-col justify-between rounded-[32px] bg-primary p-10 text-primary-foreground lg:flex">
          <Link to="/" className="flex items-center gap-2.5 font-display text-xl font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-primary"><MapPin className="h-4 w-4" /></span>
            Attendly
          </Link>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] opacity-80">EKSU · Sign attendance</p>
            <h2 className="mt-3 font-display text-5xl font-bold leading-[1.02] tracking-tight">Be in the hall.<br />Your phone proves it.</h2>
            <ol className="mt-8 space-y-4">
              {[
                ["Live location", "Your phone shares where you are right now, not a saved spot."],
                ["Class link or QR", "Open the link your lecturer shared or scan the projector."],
                ["Code and selfie", "Type the class code and take a live selfie with a location stamp."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground font-display text-sm font-bold text-background">{i + 1}</span>
                  <div><p className="text-base font-semibold">{t}</p><p className="text-sm opacity-80">{d}</p></div>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs opacity-70">Version {APP_VERSION}</p>
        </aside>

        <main className="mx-auto flex w-full max-w-md flex-col px-6 py-8 lg:py-10">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <p className="mt-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-primary" : "bg-border"}`} /> {live ? "Live location on" : "Live location"}
          </p>
          <h1 className="mt-3 font-display text-[28px] font-bold leading-8 tracking-tight">Sign attendance</h1>
          <p className="mt-2 text-base leading-6 text-muted-foreground">We check your live location first, so you know you're inside the class radius before you sign.</p>

          {/* Live location card */}
          {open.length > 0 && (
            <section className="mb-6 mt-5 flex flex-col gap-3" aria-label="Open attendance">
              {open.map((a) => {
                const mins = Math.max(1, Math.round((new Date(a.expiresAt).getTime() - now) / 60_000));
                return (
                  <div key={a.token} className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
                    <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Attendance is open
                    </p>
                    <p className="mt-1 text-base font-semibold leading-6">{a.courseCode}{a.title ? ` · ${a.title}` : ""}</p>
                    <p className="text-[13px] text-muted-foreground">Closes in about {mins} min</p>
                    <Button asChild className="mt-3 h-[52px] w-full rounded-full text-base font-semibold">
                      <Link to="/attend/$token" params={{ token: a.token }}>Mark attendance now</Link>
                    </Button>
                  </div>
                );
              })}
            </section>
          )}
          <section className="mt-6 overflow-hidden rounded-3xl border bg-card" aria-live="polite">
            <div className="relative h-52 bg-secondary">
              {live && mounted ? (
                <LeafletMap center={live.pos} radius={live.pos.accuracy} points={[{ id: "me", lat: live.pos.lat, lng: live.pos.lng, color: "#12b886", label: "You are here" }]} className="h-full w-full" zoom={17} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                  {loc.kind === "waiting" && <><Loader2 className="h-5 w-5 animate-spin text-primary" /> Finding your live location…</>}
                  {loc.kind === "denied" && <><ShieldAlert className="h-5 w-5 text-red-600" /> Location is blocked for this site.</>}
                  {loc.kind === "unsupported" && <><ShieldAlert className="h-5 w-5 text-red-600" /> This browser can't share location. Use Chrome or Safari.</>}
                  {loc.kind === "error" && <><ShieldAlert className="h-5 w-5 text-amber-600" /> {loc.message}</>}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 p-5">
              <div className="flex items-start gap-3">
                <LocateFixed className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Where you are now</p>
                  <p className="mt-1 text-base font-medium leading-6">
                    {live ? (address ?? `${live.pos.lat.toFixed(5)}, ${live.pos.lng.toFixed(5)}`) : "Waiting for your phone…"}
                  </p>
                  {live && <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">{live.pos.lat.toFixed(5)}, {live.pos.lng.toFixed(5)} · updated {new Date(live.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>}
                </div>
              </div>
              {live && <span className={`w-fit rounded-full px-3 py-1 text-[13px] font-medium ${toneClass}`}>{acc.text}</span>}
              {loc.kind === "denied" && (
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Turn it on: tap the lock icon next to the web address, set <strong className="text-foreground">Location</strong> to Allow, then tap Try again. On iPhone also check Settings → Privacy → Location Services → Safari.
                </p>
              )}
              {loc.kind !== "live" && loc.kind !== "waiting" && (
                <Button variant="outline" className="h-12 rounded-full text-base" onClick={start}><RefreshCw className="mr-2 h-4 w-4" /> Try again</Button>
              )}
            </div>
          </section>

          <p className="mt-4 flex gap-2 text-[13px] leading-[18px] text-muted-foreground">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            When your lecturer opens attendance, a “Mark attendance now” button appears here. You can also scan the QR code on the projector.
          </p>
          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Not registered yet? <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">Register once</Link>
            <span className="mx-1.5">·</span><Link to="/app" className="font-medium text-primary underline-offset-4 hover:underline">Get the app</Link>
          </p>
          <p className="mt-6 text-center text-[11px] text-muted-foreground/70 lg:hidden">Version {APP_VERSION}</p>
        </main>
      </div>
    </div>
  );
}
