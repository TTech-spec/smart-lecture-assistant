import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, LayoutGroup, animate, motion, useMotionValue, useTransform } from "framer-motion";
import gsap from "gsap";
import { Ban, Bell, ChevronRight, Clock, Gauge, Map as MapIcon, MonitorPlay, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { disableLink, setLinkExpiry, type AttendanceLink, type AttendanceRecord, type CheckInAttempt } from "@/lib/attendance-store";
import { needsReview } from "@/components/admin/AdminSidebar";
import { ATTEMPT_LABEL, Avatar } from "@/components/admin/ui";
import { LeafletMap, type MapPoint } from "@/components/LeafletMap";

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that counts to its new value (GSAP) with a small pop */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(value);
  useLayoutEffect(() => {
    const o = { v: last.current };
    const still = reduceMotion();
    const tw = gsap.to(o, { v: value, duration: still ? 0 : 0.9, ease: "power3.out", onUpdate: () => { if (ref.current) ref.current.textContent = String(Math.round(o.v)); } });
    if (ref.current && !still && value !== last.current) gsap.fromTo(ref.current, { scale: 1.07 }, { scale: 1, duration: 0.5, ease: "back.out(3)" });
    last.current = value;
    return () => { tw.kill(); };
  }, [value]);
  return <span ref={ref} className={`inline-block ${className ?? ""}`}>{value}</span>;
}

type Props = {
  live: AttendanceLink;
  records: AttendanceRecord[];
  attempts: CheckInAttempt[];
  expected: number | null;
  code: string | null;
  now: number;
  onScan: () => void;
  onNotify: () => void;
  onBlock: () => void;
};

/**
 * Phone layout for a running check-in: a dark command centre with two views,
 * Ring (how many are in) and Map (where they are, with a pull-up list).
 */
export function MobileLive({ live, records, attempts, expected, code, now, onScan, onNotify, onBlock }: Props) {
  const [view, setView] = useState<"ring" | "map">(() => {
    try { return sessionStorage.getItem("att.live.view") === "map" ? "map" : "ring"; } catch { return "ring"; }
  });
  useEffect(() => { try { sessionStorage.setItem("att.live.view", view); } catch { /* private mode */ } }, [view]);
  const flagged = records.filter(needsReview).length;
  const msLeft = Math.max(0, new Date(live.expiresAt).getTime() - now);
  const left = `${Math.floor(msLeft / 60000)}:${String(Math.floor((msLeft % 60000) / 1000)).padStart(2, "0")}`;
  const recent = records.filter((r) => now - new Date(r.submittedAt).getTime() < 60_000).length;

  function extend() {
    setLinkExpiry(live.id, new Date(Math.max(new Date(live.expiresAt).getTime(), Date.now()) + 5 * 60_000).toISOString());
    toast.success("Check-in extended by 5 minutes.");
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[57px] z-[30] flex flex-col overflow-hidden bg-[#0c1322] text-[#eef2f7] lg:hidden">
      <div className="relative z-[5] flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-[#16233a] px-2.5 py-1.5 text-xs font-semibold text-[#4fd8a8]">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#4fd8a8]" />
          <span className="truncate">LIVE · {live.courseCode}</span>
        </span>
        <div className="flex shrink-0 rounded-xl bg-[#16233a] p-[3px]" role="tablist" aria-label="Live view">
          {([["ring", "Ring", Gauge], ["map", "Map", MapIcon]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`relative flex items-center gap-1.5 rounded-[9px] px-3 py-[7px] text-[12.5px] font-semibold ${view === k ? "text-[#0c1322]" : "text-[#9fb0c4]"}`}>
              {view === k && <motion.span layoutId="live-seg" className="absolute inset-0 rounded-[9px] bg-[#4fd8a8]" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <Icon className="relative h-[15px] w-[15px]" /><span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {view === "ring" ? (
            <motion.div key="ring" className="absolute inset-0 overflow-y-auto" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.03 }} transition={{ duration: 0.26 }}>
              <RingView live={live} count={records.length} expected={expected} recent={recent} left={left} flagged={flagged} code={code} onExtend={extend} onScan={onScan} onNotify={onNotify} onBlock={onBlock} />
            </motion.div>
          ) : (
            <motion.div key="map" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <MapView live={live} records={records} attempts={attempts} expected={expected} flagged={flagged} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RingView({ live, count, expected, recent, left, flagged, code, onExtend, onScan, onNotify, onBlock }: {
  live: AttendanceLink; count: number; expected: number | null; recent: number; left: string; flagged: number; code: string | null;
  onExtend: () => void; onScan: () => void; onNotify: () => void; onBlock: () => void;
}) {
  const R = 102, C = 2 * Math.PI * R;
  const arc = useRef<SVGCircleElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  // With a known class size the ring is a share of the class; otherwise it fills over the first 50 arrivals
  const share = expected && expected > 0 ? Math.min(1, count / expected) : Math.min(1, count / 50);
  useLayoutEffect(() => {
    gsap.to(arc.current, { strokeDashoffset: C * (1 - share), duration: reduceMotion() ? 0 : 1.1, ease: "power3.out" });
  }, [share, C]);
  useEffect(() => {
    if (reduceMotion()) return;
    const tl = gsap.timeline({ repeat: -1, yoyo: true }).to(glow.current, { opacity: 0.55, scale: 1.04, duration: 1.6, ease: "sine.inOut" });
    return () => { tl.kill(); };
  }, []);

  return (
    <div className="flex min-h-full flex-col items-center pb-[110px]">
      <div className="relative mt-3 h-[240px] w-[240px] shrink-0">
        <div ref={glow} className="absolute inset-[18px] rounded-full opacity-25" style={{ background: "radial-gradient(circle, rgba(79,216,168,.35), transparent 65%)" }} />
        <svg viewBox="0 0 240 240" width="240" height="240" className="relative" aria-hidden="true">
          <circle cx="120" cy="120" r={R} fill="none" stroke="#1b2840" strokeWidth="16" />
          <circle ref={arc} cx="120" cy="120" r={R} fill="none" stroke="url(#live-ring)" strokeWidth="16" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C} transform="rotate(-90 120 120)" />
          <defs><linearGradient id="live-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4fd8a8" /><stop offset="1" stopColor="#0ea371" /></linearGradient></defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <CountUp value={count} className="text-[58px] font-extrabold leading-none tracking-tight" />
          <span className="mt-1 text-[13px] text-[#9fb0c4]">{expected ? `of ${expected} checked in` : "checked in"}</span>
          <AnimatePresence mode="popLayout">
            <motion.span key={recent} className="mt-2 text-[12.5px] font-semibold text-[#4fd8a8]" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}>
              {recent > 0 ? `+${recent} in the last minute` : "Waiting for the next student"}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 px-4 text-[13px] text-[#9fb0c4]">
        <span><b className="tabular-nums text-white">{left}</b> left</span>
        <Link to="/admin/review" className="hover:underline"><b className={flagged ? "text-amber-300" : "text-white"}>{flagged}</b> to review</Link>
        {live.requireRoomCode && <span><b className="font-mono tracking-wider text-white">{code ?? "····"}</b> code</span>}
      </div>

      <div className="mt-5 w-full overflow-hidden pl-4">
        <motion.div className="flex w-max gap-3 pr-4" drag="x" dragConstraints={{ left: -500, right: 0 }} dragElastic={0.12} style={{ touchAction: "pan-y" }}>
          <ActionCard i={0} icon={<MonitorPlay className="h-5 w-5 text-[#4fd8a8]" />} title="Projector" sub="Show QR + code" to={{ to: "/admin/projector", search: { link: live.id } }} />
          <ActionCard i={1} icon={<Clock className="h-5 w-5 text-[#4fd8a8]" />} title="+5 minutes" sub="Extend the window" onClick={onExtend} />
          <ActionCard i={2} icon={<ScanLine className="h-5 w-5 text-[#4fd8a8]" />} title="Scan student" sub="Help with GPS" onClick={onScan} />
          <ActionCard i={3} icon={<Bell className="h-5 w-5 text-[#4fd8a8]" />} title="Notify" sub="Ping the class" onClick={onNotify} />
          <ActionCard i={4} icon={<Ban className="h-5 w-5 text-[#ff9a9a]" />} title="Block student" sub="Sent someone out?" onClick={onBlock} />
        </motion.div>
      </div>

      <div className="mt-auto w-full px-4 pt-6"><HoldToEnd onEnd={() => { disableLink(live.id); toast.success("Check-in ended."); }} /></div>
    </div>
  );
}

function ActionCard({ i, icon, title, sub, onClick, to }: {
  i: number; icon: React.ReactNode; title: string; sub: string; onClick?: () => void; to?: { to: string; search: Record<string, string> };
}) {
  const cls = "flex min-h-[104px] w-[150px] flex-col gap-0.5 rounded-[20px] bg-[#16233a] p-3.5 text-left";
  const body = <>{icon}<span className="mt-2 font-bold">{title}</span><span className="text-xs text-[#9fb0c4]">{sub}</span></>;
  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 + i * 0.07 }} whileTap={{ scale: 0.95 }}>
      {to ? <Link to={to.to} search={to.search as never} className={cls} draggable={false}>{body}</Link>
          : <button type="button" onClick={onClick} className={cls}>{body}</button>}
    </motion.div>
  );
}

/** Press and hold for about a second to end the check-in, so a stray tap can't end it */
function HoldToEnd({ onEnd }: { onEnd: () => void }) {
  const fill = useRef<HTMLSpanElement>(null);
  const tw = useRef<gsap.core.Tween | null>(null);
  const [done, setDone] = useState(false);
  const finish = () => { setDone(true); onEnd(); };
  const start = () => { if (!done) tw.current = gsap.to(fill.current, { scaleX: 1, duration: 1.2, ease: "none", onComplete: finish }); };
  const stop = () => { if (done) return; tw.current?.kill(); gsap.to(fill.current, { scaleX: 0, duration: 0.3 }); };
  return (
    <button type="button" data-tour="end-checkin" onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !done) finish(); }}
      className="relative grid h-[52px] w-full select-none place-items-center overflow-hidden rounded-2xl border border-[#4a2330] bg-[#2a1720]" style={{ touchAction: "none" }}>
      <span ref={fill} className="absolute inset-0 origin-left scale-x-0 bg-[#7f1d2d]" />
      <span className="relative font-bold text-[#ff9a9a]">{done ? "Check-in ended" : "Hold to end check-in"}</span>
    </button>
  );
}

function MapView({ live, records, attempts, expected, flagged }: {
  live: AttendanceLink; records: AttendanceRecord[]; attempts: CheckInAttempt[]; expected: number | null; flagged: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(600);
  useLayoutEffect(() => {
    const measure = () => { if (wrap.current) setH(wrap.current.clientHeight); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  // Three resting places for the sheet: peeking, half, and nearly full
  const snaps = useMemo(() => [Math.max(120, h - 150), Math.round(h * 0.58), 64], [h]);
  const y = useMotionValue(snaps[1]);
  useEffect(() => { y.set(snaps[1]); }, [snaps, y]);
  const dim = useTransform(y, [snaps[2], snaps[0]], [0.4, 0]);
  const settle = (_: unknown, info: { velocity: { y: number } }) => {
    const target = y.get() + info.velocity.y * 0.18;
    const snap = snaps.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    animate(y, snap, { type: "spring", stiffness: 380, damping: 36 });
  };

  const points: MapPoint[] = useMemo(() => [
    ...records.filter((r) => r.lat && r.lng).map((r) => ({ id: `r${r.id}`, lat: r.lat, lng: r.lng, color: needsReview(r) ? "#f59e0b" : "#12b886", label: `${r.fullName}${r.distanceMeters ? ` · ${r.distanceMeters} m` : ""}` })),
    ...attempts.filter((a) => a.lat != null && a.lng != null).map((a) => ({ id: `a${a.id}`, lat: a.lat!, lng: a.lng!, color: a.reason === "need_room_code" ? "#f59e0b" : "#ef4444", label: `${a.matric ?? "Unknown"} · ${ATTEMPT_LABEL[a.reason] ?? a.reason}` })),
  ], [records, attempts]);

  const [filter, setFilter] = useState<"all" | "review" | "blocked">("all");
  const sorted = useMemo(() => [...records].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [records]);
  const blocked = attempts.filter((a) => a.reason !== "need_room_code");
  const rows = filter === "review" ? sorted.filter(needsReview) : sorted;

  return (
    <div ref={wrap} className="absolute inset-0">
      {live.anchorLat != null && live.anchorLng != null ? (
        <LeafletMap center={{ lat: live.anchorLat, lng: live.anchorLng }} radius={live.anchorRadius ?? 100} points={points} centerOffsetY={Math.round(h * 0.2)} className="absolute inset-0 h-full w-full" />
      ) : (
        <p className="absolute inset-x-6 top-16 text-center text-sm text-[#9fb0c4]">This check-in has no verified location, so there is no map. The list below still updates.</p>
      )}
      <motion.div className="pointer-events-none absolute inset-0 z-[400] bg-[#0c1322]" style={{ opacity: dim }} />

      <motion.section aria-label="Checked-in students" className="absolute inset-x-0 top-0 z-[500] flex flex-col rounded-t-[28px] bg-white text-[#13202f] shadow-[0_-12px_30px_rgba(10,20,35,0.22)] dark:bg-[#151e2c] dark:text-white"
        style={{ y, height: h, touchAction: "none" }} drag="y" dragConstraints={{ top: snaps[2], bottom: snaps[0] }} dragElastic={0.08} onDragEnd={settle}>
        <div className="mx-auto mb-1.5 mt-2.5 h-[5px] w-11 shrink-0 rounded-full bg-[#d3dbe3]" aria-hidden="true" />
        <div className="flex shrink-0 items-baseline justify-between px-4">
          <h2 className="text-[21px] font-extrabold"><CountUp value={records.length} /> checked in</h2>
          {expected ? <span className="text-[12.5px] font-bold text-[#0b8f69]">of {expected}</span> : null}
        </div>
        <LayoutGroup>
          <div className="flex shrink-0 gap-2 px-4 pb-2 pt-3">
            {([["all", "All"], ["review", `To review ${flagged}`], ["blocked", `Blocked ${blocked.length}`]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={`relative rounded-full px-3 py-[7px] text-[12.5px] font-semibold ${filter === k ? "text-white" : "bg-[#eef2f5] text-[#13202f] dark:bg-white/10 dark:text-white"}`}>
                {filter === k && <motion.span layoutId="live-filter" className="absolute inset-0 rounded-full bg-[#121a2b]" transition={{ type: "spring", stiffness: 500, damping: 34 }} />}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[150px]" style={{ touchAction: "pan-y" }} onPointerDownCapture={(e) => e.stopPropagation()}>
          {filter === "blocked" ? (
            blocked.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No blocked attempts.</p> : blocked.slice(0, 40).map((a) => (
              <div key={a.id} className="flex h-[58px] items-center gap-3 border-t border-[#eef2f5] px-4 dark:border-white/10">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-red-50 text-xs font-bold text-red-700 dark:bg-red-900/30">✕</span>
                <div className="min-w-0 flex-1"><p className="truncate text-[14.5px] font-semibold">{a.matric || "Unknown student"}</p><p className="truncate text-[12.5px] text-red-700 dark:text-red-400">{ATTEMPT_LABEL[a.reason] ?? a.reason}</p></div>
              </div>
            ))
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">{filter === "review" ? "Nothing to review." : "Waiting for the first check-in…"}</p>
          ) : (
            <AnimatePresence initial={false}>
              {rows.slice(0, 60).map((r) => {
                const flag = needsReview(r);
                return (
                  <motion.div key={r.id} layout initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <Link to={flag ? "/admin/review" : "/admin/records"} search={(flag ? { id: r.id } : {}) as never} className="flex h-[58px] items-center gap-3 border-t border-[#eef2f5] px-4 dark:border-white/10">
                      <Avatar src={r.customFields?.photoThumb || r.customFields?.photo} name={r.fullName} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-semibold">{r.fullName}</p>
                        <p className={`truncate text-[12.5px] ${flag ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                          {new Date(r.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {flag ? "Needs review" : r.distanceMeters ? `${r.distanceMeters} m` : "Checked in"}
                        </p>
                      </div>
                      <ChevronRight className="h-[18px] w-[18px] text-muted-foreground" />
                    </Link>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </motion.section>
    </div>
  );
}
