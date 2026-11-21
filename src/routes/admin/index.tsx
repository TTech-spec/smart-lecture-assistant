import { askConfirm } from "@/components/ConfirmHost";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CountUp } from "@/components/admin/MobileLive";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStore } from "@/hooks/use-store";
import {
  disableLink, fetchAttempts, fetchRoomCode, fetchStudents, isLinkValid, todayKey,
  type AttendanceLink, type AttendanceRecord, type CheckInAttempt,
} from "@/lib/attendance-store";
import { needsReview } from "@/components/admin/AdminSidebar";
import { Avatar, Panel, PanelTitle, PinBanners, Stat, StatusPill, checkStatus } from "@/components/admin/ui";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Overview — Attendly" }] }),
  component: OverviewPage,
});

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The attendance link that is open right now, if any (newest first). */
export function useLiveLink(links: AttendanceLink[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const live = useMemo(
    () => links
      .filter((l) => (l.linkType ?? "attendance") === "attendance" && isLinkValid(l, new Date(now)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    [links, now],
  );
  return { live, now };
}

/** Polls the server for the class code of a link (lecturer only). */
export function useClassCode(linkId: string | null) {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(30);
  useEffect(() => {
    if (!linkId) { setCode(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      try {
        const r = await fetchRoomCode(linkId!);
        if (cancelled || !r) return;
        setCode(r.code);
        setSecondsLeft(r.secondsLeft);
        timer = setTimeout(load, Math.max(1, r.secondsLeft) * 1000 + 300);
      } catch {
        if (!cancelled) timer = setTimeout(load, 5000);
      }
    }
    load();
    const tick = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); clearInterval(tick); };
  }, [linkId]);
  return { code, secondsLeft };
}

function OverviewPage() {
  const { links, records } = useStore();
  const { live, now } = useLiveLink(links);
  const { code, secondsLeft } = useClassCode(live?.id ?? null);
  const [registered, setRegistered] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<CheckInAttempt[]>([]);

  useEffect(() => {
    fetchStudents().then((s) => setRegistered(s.length)).catch(() => setRegistered(null));
    fetchAttempts({ sinceDays: 7 }).then(setAttempts);
  }, []);

  // Attempts on the live link only (for the pin warnings), refreshed every 30 s
  const [liveAttempts, setLiveAttempts] = useState<CheckInAttempt[]>([]);
  const liveId = live?.id ?? null;
  useEffect(() => {
    if (!liveId) { setLiveAttempts([]); return; }
    let cancelled = false;
    const load = () => fetchAttempts({ linkId: liveId }).then((a) => { if (!cancelled) setLiveAttempts(a); });
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [liveId]);

  const today = todayKey();
  const liveCount = live ? records.filter((r) => r.linkId === live.id).length : 0;
  const liveFlagged = live ? records.filter((r) => r.linkId === live.id && needsReview(r)).length : 0;
  const review = records.filter(needsReview).slice(0, 3);
  const todayCount = records.filter((r) => r.dayKey === today).length;
  const latest = [...records].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 6);

  // Last 8 attendance links (oldest → newest) with their check-in counts
  const history = useMemo(() => {
    const att = links.filter((l) => (l.linkType ?? "attendance") === "attendance")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-8);
    return att.map((l) => ({ l, n: records.filter((r) => r.linkId === l.id).length }));
  }, [links, records]);
  const maxN = Math.max(1, ...history.map((h) => h.n));

  const msLeft = live ? new Date(live.expiresAt).getTime() - now : 0;
  const closesIn = `${Math.floor(msLeft / 60000)}:${String(Math.floor((msLeft % 60000) / 1000)).padStart(2, "0")}`;
  const outOfRange = attempts.filter((a) => a.reason === "out_of_range").length;

  const reviewTotal = records.filter(needsReview).length;
  return (
    <>
    <MobileHome live={live} liveCount={liveCount} registered={registered} closesIn={closesIn} reviewTotal={reviewTotal}
      todayCount={todayCount} latest={latest}
      banners={live ? <PinBanners records={records.filter((r) => r.linkId === live.id)} attempts={liveAttempts} /> : null} />
    <main className="mx-auto hidden max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-8 lg:flex lg:py-7">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-grow">
          <p className="text-[13px] text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-0.5 font-display text-2xl font-semibold sm:text-[28px]">{greeting()}</h1>
        </div>
        <Button asChild className="hidden h-11 rounded-xl px-5 lg:inline-flex">
          <Link to="/admin/links"><Plus className="mr-2 h-4 w-4" /> Start check-in</Link>
        </Button>
      </div>

      {live && <PinBanners records={records.filter((r) => r.linkId === live.id)} attempts={liveAttempts} />}

      <div className="grid gap-4 lg:grid-cols-3">
        {live ? (
          <>
          {/* Phones: one big tappable card that opens the live screen */}
          <motion.div className="lg:hidden" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} whileTap={{ scale: 0.98 }}>
            <Link to="/admin/live" className="block rounded-[24px] p-[18px] text-white shadow-[0_12px_30px_rgba(18,184,134,0.35)]"
              style={{ background: "radial-gradient(120% 120% at 100% 0%, #22d3a0 0%, transparent 55%), linear-gradient(140deg, #12b886, #08855f)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold"><span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" /><span className="truncate">Live · {live.courseCode}</span></span>
                <span className="shrink-0 text-[13px] tabular-nums opacity-90">closes in {closesIn}</span>
              </div>
              <p className="mt-3.5 text-[46px] font-extrabold leading-none tracking-tight"><CountUp value={liveCount} />{registered ? <span className="text-[19px] font-semibold opacity-85"> / {registered}</span> : null}</p>
              <p className="mt-1 text-[13px] opacity-90">students checked in · tap to open</p>
              <div className="mt-3 h-[7px] overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${registered ? Math.min(100, (liveCount / registered) * 100) : 0}%` }} /></div>
            </Link>
          </motion.div>
          <section className="hidden flex-col gap-6 rounded-[18px] bg-[#121a2b] p-6 text-[#f1f5f4] sm:flex-row sm:items-center lg:col-span-2 lg:flex">
            <div className="flex min-w-0 flex-grow flex-col gap-3">
              <p className="flex items-center gap-2 text-[13px] text-[#9aa6b8]">
                <span className="h-2 w-2 rounded-full bg-[#4fd8a8]" /> Live now · {live.courseCode} · {live.title}
              </p>
              <p className="text-sm text-[#9aa6b8]">Checked in</p>
              <p className="-mt-1.5 font-display text-5xl font-semibold leading-none text-white">
                {liveCount}{registered ? <span className="text-[22px] text-[#9aa6b8]"> / {registered}</span> : null}
              </p>
              <div className="h-1.5 rounded bg-[#283349]">
                <div className="h-full rounded bg-[#4fd8a8] transition-all" style={{ width: `${registered ? Math.min(100, (liveCount / registered) * 100) : 0}%` }} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#9aa6b8]">
                <span>Closes in <strong className="text-white">{closesIn}</strong></span>
                {live.anchorRadius && <span>Within <strong className="text-white">{live.anchorRadius} m</strong> of you</span>}
                <span><strong className="text-amber-300">{liveFlagged}</strong> flagged</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:w-[210px]">
              <p className="text-xs text-[#9aa6b8]">Class code</p>
              <p className="font-display text-[46px] font-semibold leading-none tracking-[0.08em] text-white">{code ?? "····"}</p>
              <p className="text-xs text-[#9aa6b8]">New code in {secondsLeft}s</p>
              <div className="flex w-full gap-2">
                <Button asChild size="sm" className="h-9 flex-1 rounded-lg">
                  <Link to="/admin/projector" search={{ link: live.id }}>Projector</Link>
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="h-9 flex-1 rounded-lg border-red-300/40 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200"
                  onClick={() => { askConfirm("End check-in now?", { okText: "End check-in" }).then((ok) => { if (ok) { disableLink(live.id); toast.success("Check-in ended."); } }); }}
                >
                  End
                </Button>
              </div>
            </div>
          </section>
          </>
        ) : (
          <section className="flex flex-col items-start justify-center gap-3 rounded-[18px] border border-dashed border-[rgba(27,36,57,0.18)] bg-[#f6f9f8] p-6 lg:col-span-2">
            <p className="font-display text-xl font-semibold">No check-in running</p>
            <p className="text-sm text-muted-foreground">Start one from the lecture hall: verify your location, then put the class code on the projector.</p>
            <Button asChild className="mt-1 rounded-xl"><Link to="/admin/links">Start check-in</Link></Button>
          </section>
        )}

        <Panel className="flex flex-col">
          <PanelTitle action={<Link to="/admin/review" className="text-[13px] font-medium text-[#0f8a66] hover:underline">View all</Link>}>
            Needs your review
          </PanelTitle>
          {review.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">Nothing to review.</p>
          ) : (
            <div className="mt-2 divide-y divide-[rgba(27,36,57,0.06)]">
              {review.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-2.5">
                  <Avatar src={r.customFields?.photoThumb || r.customFields?.photo} name={r.fullName} size={36} />
                  <div className="min-w-0 flex-grow">
                    <p className="truncate text-sm font-medium">{r.fullName}</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">{checkStatus(r.customFields).label}</p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-8 rounded-lg text-xs">
                    <Link to="/admin/review" search={{ id: r.id }}>Review</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Checked in today" value={todayCount} />
        <Stat label="Registered students" value={registered ?? "—"} hint={registered == null ? "Run students-migration.sql" : undefined} />
        <Stat label="Blocked attempts" value={attempts.length} hint={`Last 7 days${outOfRange ? ` · ${outOfRange} out of range` : ""}`} />
        <Stat label="All check-ins" value={records.length} hint="This semester" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="flex min-h-[300px] flex-col lg:col-span-2">
          <PanelTitle>Check-ins, last {history.length || 8} sessions</PanelTitle>
          {history.length === 0 ? (
            <p className="m-auto text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <div className="flex flex-grow items-end gap-2.5 pt-5" role="img" aria-label="Bar chart of check-ins per session">
              {history.map(({ l, n }, i) => {
                const last = i === history.length - 1;
                return (
                  <div key={l.id} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${l.title}: ${n}`}>
                    {last && <span className="text-[11px] font-semibold text-[#0f8a66]">{n}</span>}
                    <div className={`w-full rounded-t-md rounded-b-sm ${last ? "bg-[#12b886]" : "bg-[#cdeee1] dark:bg-emerald-900/40"}`} style={{ height: `${Math.max(4, (n / maxN) * 85)}%` }} />
                    <span className={`max-w-full truncate text-[11px] ${last ? "font-semibold" : "text-muted-foreground"}`}>
                      {new Date(l.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel className="overflow-hidden lg:col-span-3">
          <PanelTitle action={<Link to="/admin/records" className="text-[13px] font-medium text-[#0f8a66] hover:underline">All records</Link>}>
            Latest check-ins
          </PanelTitle>
          {latest.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No check-ins yet.</p>
          ) : (
            <div className="-mx-1 mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-1 py-2 font-medium">Student</th>
                    <th className="py-2 font-medium">Matric</th>
                    <th className="py-2 font-medium">Check</th>
                    <th className="py-2 font-medium">Distance</th>
                    <th className="px-1 py-2 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map((r) => {
                    const st = checkStatus(r.customFields);
                    return (
                      <tr key={r.id} className="border-t border-[rgba(27,36,57,0.06)]">
                        <td className="px-1 py-2.5"><span className="flex items-center gap-2.5"><Avatar src={r.customFields?.photoThumb || r.customFields?.photo} name={r.fullName} size={28} /><span className="font-medium">{r.fullName}</span></span></td>
                        <td className="font-mono text-xs text-muted-foreground">{r.matricNumber}</td>
                        <td><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                        <td className="text-muted-foreground">{r.distanceMeters ? `${r.distanceMeters} m` : "—"}</td>
                        <td className="px-1 text-right text-muted-foreground">{new Date(r.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </main>
    </>
  );
}

const rise = { h: { opacity: 0, y: 16 }, s: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 26 } } };

/** Phone home, kept minimal: the running class (or one Start button), three numbers, the latest names */
function MobileHome({ live, liveCount, registered, closesIn, reviewTotal, todayCount, latest, banners }: {
  live: AttendanceLink | null; liveCount: number; registered: number | null; closesIn: string; reviewTotal: number;
  todayCount: number; latest: AttendanceRecord[]; banners: React.ReactNode;
}) {
  const dot = (tone: string) => tone === "green" ? "bg-[#12b886]" : tone === "amber" ? "bg-amber-500" : "bg-[#c3ccd6]";
  return (
    <motion.main className="flex flex-col px-5 pb-8 pt-6 lg:hidden" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.08 } } }}>
      <motion.p variants={rise} className="text-[13px] text-muted-foreground">
        {greeting()} · {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      </motion.p>

      {banners && <div className="mt-4">{banners}</div>}

      {/* One thing on the screen: the class that is running, or the button to start one */}
      {live ? (
        <motion.div variants={rise} className="mt-7">
          <Link to="/admin/live" className="block">
            <p className="flex items-center gap-2 text-[13px] font-medium text-[#0f8a66]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#12b886]" /> {live.courseCode} · live · closes in <span className="tabular-nums">{closesIn}</span>
            </p>
            <p className="mt-2 font-display text-[72px] font-bold leading-none tracking-tight">
              <CountUp value={liveCount} />{registered ? <span className="text-[24px] font-medium text-muted-foreground"> / {registered}</span> : null}
            </p>
            <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-[rgba(27,36,57,0.08)]">
              <div className="h-full rounded-full bg-[#12b886] transition-all duration-700" style={{ width: `${registered ? Math.min(100, (liveCount / registered) * 100) : 0}%` }} />
            </div>
            <p className="mt-3 text-sm font-medium">Open live <span aria-hidden>→</span></p>
          </Link>
        </motion.div>
      ) : (
        <motion.div variants={rise} className="mt-7">
          <h1 className="font-display text-[30px] font-bold leading-9 tracking-tight">No check-in running</h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">Start one when you're in the hall.</p>
          <motion.div whileTap={{ scale: 0.98 }} className="mt-5">
            <Link to="/admin/links" search={{ new: "attendance" }} className="flex h-[52px] items-center justify-center rounded-full bg-foreground text-[15px] font-semibold text-background">
              Start check-in
            </Link>
          </motion.div>
        </motion.div>
      )}

      {/* Three numbers, no boxes */}
      <motion.div variants={rise} className="mt-9 grid grid-cols-3 border-y border-[rgba(27,36,57,0.08)] py-4">
        {([["/admin/review", reviewTotal, "to review", reviewTotal > 0], ["/admin/records", todayCount, "today", false], ["/admin/students", registered ?? 0, "students", false]] as const).map(([to, n, label, warn], i) => (
          <Link key={label} to={to} className={`flex flex-col ${i ? "border-l border-[rgba(27,36,57,0.08)] pl-4" : ""}`}>
            <span className={`text-[24px] font-semibold leading-7 tabular-nums ${warn ? "text-amber-600" : ""}`}><CountUp value={n} /></span>
            <span className="text-[12.5px] text-muted-foreground">{label}</span>
          </Link>
        ))}
      </motion.div>

      <motion.section variants={rise} className="mt-7">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-medium">Latest</p>
          <Link to="/admin/records" className="text-[13px] text-muted-foreground">All records</Link>
        </div>
        {latest.length === 0 ? <p className="py-8 text-sm text-muted-foreground">No check-ins yet.</p> : (
          <div className="mt-1">
            <AnimatePresence initial={false}>
              {latest.slice(0, 6).map((r) => {
                const st = checkStatus(r.customFields);
                const flagged = needsReview(r);
                return (
                  <motion.div key={r.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 52 }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-b border-[rgba(27,36,57,0.06)]">
                    <Link to={flagged ? "/admin/review" : "/admin/records"} search={(flagged ? { id: r.id } : {}) as never} className="flex h-[52px] items-center gap-3">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dot(flagged ? "amber" : st.tone)}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[15px]">{r.fullName}</span>
                      <span className={`shrink-0 text-[12.5px] ${flagged ? "text-amber-600" : "text-muted-foreground"}`}>
                        {flagged ? st.label : new Date(r.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </Link>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.section>
    </motion.main>
  );
}
