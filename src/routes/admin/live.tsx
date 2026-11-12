import { createFileRoute, Link } from "@tanstack/react-router";
import { friendlyError } from "@/lib/friendly-error";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ban, Loader2, Undo2 } from "lucide-react";
import { useStore } from "@/hooks/use-store";
import {
  blockStudent, deleteRecordById, disableLink, fetchAttempts, fetchSessionBlocks, setLinkExpiry, unblockStudent,
  type AttendanceLink, type SessionBlock, type AttendanceRecord, type CheckInAttempt,
} from "@/lib/attendance-store";
import { needsReview } from "@/components/admin/AdminSidebar";
import { ATTEMPT_LABEL, Avatar, PageHeader, Panel, PanelTitle, Stat } from "@/components/admin/ui";
import { useClassCode, useLiveLink } from "@/routes/admin/index";
import { LeafletMap, type MapPoint } from "@/components/LeafletMap";

export const Route = createFileRoute("/admin/live")({
  head: () => ({ meta: [{ title: "Live session — Attendly" }] }),
  component: LivePage,
});

function LivePage() {
  const { links, records } = useStore();
  const { live, now } = useLiveLink(links);
  const { code, secondsLeft } = useClassCode(live?.id ?? null);
  const [attempts, setAttempts] = useState<CheckInAttempt[]>([]);
  const blockRef = useRef<((matric: string) => void) | null>(null);

  // Refresh blocked attempts every 10 s while live
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const load = () => fetchAttempts({ linkId: live.id }).then((a) => { if (!cancelled) setAttempts(a); });
    load();
    const t = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [live]);

  if (!live) {
    return (
      <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 lg:py-7">
        <PageHeader eyebrow="Live session" title="No check-in is running" />
        <Panel className="mt-6 flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">Start a check-in from the lecture hall to see students arrive here in real time.</p>
          <Button asChild className="rounded-xl"><Link to="/admin/links">Start check-in</Link></Button>
        </Panel>
      </main>
    );
  }

  const mine = records.filter((r) => r.linkId === live.id);
  const flagged = mine.filter(needsReview).length;
  const start = new Date(live.createdAt);
  const end = new Date(live.expiresAt);
  const blockedByReason = attempts.reduce<Record<string, number>>((acc, a) => { acc[a.reason] = (acc[a.reason] ?? 0) + 1; return acc; }, {});

  function extend(minutes: number) {
    setLinkExpiry(live!.id, new Date(Math.max(end.getTime(), Date.now()) + minutes * 60_000).toISOString());
    toast.success(`Check-in extended by ${minutes} minutes.`);
  }

  return (
    <main className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-8 lg:py-7">
      <PageHeader
        eyebrow={<span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#12b886]" />Live · started {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · closes {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        title={`${live.courseCode} · ${live.title}`}
        actions={<>
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => extend(5)}>+5 minutes</Button>
          <Button variant="outline" className="h-10 rounded-xl text-red-700 hover:text-red-700" onClick={() => { if (confirm("End check-in now?")) { disableLink(live.id); toast.success("Check-in ended."); } }}>End check-in</Button>
          <Button asChild className="h-10 rounded-xl"><Link to="/admin/projector" search={{ link: live.id }}>Open projector</Link></Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl bg-[#121a2b] px-5 py-4 text-white">
          <p className="text-[13px] text-[#9aa6b8]">Class code</p>
          <p className="mt-1.5 font-display text-[34px] font-semibold leading-none tracking-[0.08em]">{code ?? "····"}</p>
          <div className="mt-3 h-[3px] rounded bg-[#283349]"><div className="h-full rounded bg-[#4fd8a8] transition-[width] duration-1000 ease-linear" style={{ width: `${(secondsLeft / 30) * 100}%` }} /></div>
        </div>
        <Stat label="Checked in" value={mine.length} hint={`Closes in ${Math.max(0, Math.ceil((end.getTime() - now) / 60000))} min`} />
        <Stat label="Flagged" value={flagged} tone={flagged ? "amber" : undefined} hint={flagged ? <Link to="/admin/review" className="text-[#0f8a66] hover:underline">Review now</Link> : "All clear"} />
        <Stat label="Blocked attempts" value={attempts.length} hint={Object.entries(blockedByReason).map(([k, v]) => `${v} ${(ATTEMPT_LABEL[k] ?? k).toLowerCase()}`).join(" · ") || "None"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="flex min-h-[420px] flex-col lg:col-span-3">
          <PanelTitle action={live.anchorRadius ? <span className="text-xs text-muted-foreground">Allowed: within {live.anchorRadius} m of you</span> : null}>
            Where students checked in from
          </PanelTitle>
          <CheckInMap link={live} records={mine} attempts={attempts} />
        </Panel>
        <Panel className="flex flex-col lg:col-span-2">
          <PanelTitle action={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#12b886]" />Updating</span>}>
            Live feed
          </PanelTitle>
          <Feed records={mine} attempts={attempts} onBlock={(m) => blockRef.current?.(m)} />
        </Panel>
      </div>

      <BlockPanel link={live} records={mine} allRecords={records} registerBlock={(fn) => { blockRef.current = fn; }} />
    </main>
  );
}

type FeedItem =
  | { kind: "ok"; at: string; r: AttendanceRecord }
  | { kind: "blocked"; at: string; a: CheckInAttempt };

function Feed({ records, attempts, onBlock }: { records: AttendanceRecord[]; attempts: CheckInAttempt[]; onBlock: (matric: string) => void }) {
  const items: FeedItem[] = useMemo(() => [
    ...records.map((r) => ({ kind: "ok" as const, at: r.submittedAt, r })),
    ...attempts.map((a) => ({ kind: "blocked" as const, at: a.at, a })),
  ].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 12), [records, attempts]);

  if (items.length === 0) return <p className="m-auto py-10 text-sm text-muted-foreground">Waiting for the first check-in…</p>;
  return (
    <div className="mt-2 divide-y divide-[rgba(27,36,57,0.06)] overflow-y-auto">
      {items.map((it) => {
        const time = new Date(it.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        if (it.kind === "ok") {
          const flagged = needsReview(it.r);
          return (
            <div key={`r${it.r.id}`} className="flex items-center gap-3 py-2.5">
              <Avatar src={it.r.customFields?.photo} name={it.r.fullName} size={32} />
              <div className="min-w-0 flex-grow">
                <p className="truncate text-sm font-medium">{it.r.fullName}</p>
                <p className={`text-xs ${flagged ? "text-amber-700 dark:text-amber-400" : "text-[#0f8a66]"}`}>
                  {flagged ? "Flagged for review" : "Checked in"}{it.r.distanceMeters ? ` · ${it.r.distanceMeters} m` : ""}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{time}</span>
              <button type="button" onClick={() => onBlock(it.r.matricNumber)} title={`Block ${it.r.fullName}`} aria-label={`Block ${it.r.fullName}`}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/30"><Ban className="h-4 w-4" /></button>
            </div>
          );
        }
        return (
          <div key={`a${it.a.id}`} className="flex items-center gap-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs font-bold text-red-700 dark:bg-red-900/30">✕</span>
            <div className="min-w-0 flex-grow">
              <p className="truncate text-sm font-medium">{it.a.matric || "Unknown student"}</p>
              <p className="text-xs text-red-700 dark:text-red-400">
                Blocked · {ATTEMPT_LABEL[it.a.reason] ?? it.a.reason}
                {it.a.reason === "out_of_range" && it.a.detail ? ` · ${it.a.detail} m away` : ""}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{time}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Real street map (OpenStreetMap): your spot, the allowed circle, and every check-in / blocked attempt. */
function CheckInMap({ link, records, attempts }: { link: AttendanceLink; records: AttendanceRecord[]; attempts: CheckInAttempt[] }) {
  if (link.anchorLat == null || link.anchorLng == null) {
    return <p className="m-auto max-w-sm py-10 text-center text-sm text-muted-foreground">This check-in has no verified lecturer location, so there's nothing to map. New check-ins ask you to verify your location first.</p>;
  }
  const points: MapPoint[] = [
    ...records.filter((r) => r.lat && r.lng).map((r) => ({
      id: `r${r.id}`, lat: r.lat, lng: r.lng,
      color: needsReview(r) ? "#f59e0b" : "#12b886",
      label: `${r.fullName}${r.distanceMeters ? ` · ${r.distanceMeters} m` : ""}`,
    })),
    ...attempts.filter((a) => a.lat != null && a.lng != null).map((a) => ({
      id: `a${a.id}`, lat: a.lat!, lng: a.lng!, color: "#ef4444",
      label: `${a.matric ?? "Unknown"} · ${ATTEMPT_LABEL[a.reason] ?? a.reason}${a.reason === "out_of_range" && a.detail ? ` · ${a.detail} m` : ""}`,
    })),
  ];
  return (
    <div className="relative mt-3 flex-grow overflow-hidden rounded-2xl border border-[rgba(27,36,57,0.06)]">
      <LeafletMap
        center={{ lat: link.anchorLat, lng: link.anchorLng }}
        radius={link.anchorRadius ?? 100}
        points={points}
        className="h-full min-h-[340px] w-full"
      />
      <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap gap-3 rounded-lg border border-[rgba(27,36,57,0.08)] bg-white/90 px-3 py-1.5 text-xs dark:bg-black/60">
        <Legend color="#121a2b" label="You" />
        <Legend color="#12b886" label="Accepted" />
        <Legend color="#f59e0b" label="Flagged" />
        <Legend color="#ef4444" label="Blocked" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</span>;
}


/** Block a matric number from this session (and remove them if they already signed); unblock later. */
function BlockPanel({ link, records, allRecords, registerBlock }: {
  link: AttendanceLink; records: AttendanceRecord[]; allRecords: AttendanceRecord[];
  registerBlock: (fn: (matric: string) => void) => void;
}) {
  const [blocks, setBlocks] = useState<SessionBlock[]>([]);
  const [matric, setMatric] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => fetchSessionBlocks(link.id).then((b) => { setBlocks(b); setLoadError(null); }).catch((e: Error) => setLoadError(e.message)), [link.id]);
  useEffect(() => { load(); }, [load]);

  const nameFor = (m: string) => records.find((r) => r.matricNumber.toUpperCase() === m.toUpperCase())?.fullName;

  const block = useCallback(async (raw: string, why = "") => {
    const m = raw.trim().toUpperCase();
    if (m.length < 3) { toast.error("Type the student's matric number."); return; }
    setBusy(m);
    try {
      await blockStudent(link.id, m, why);
      // A student sent out of class shouldn't keep a check-in for this session
      const signed = allRecords.find((r) => r.linkId === link.id && r.matricNumber.toUpperCase() === m);
      if (signed) deleteRecordById(signed.id, allRecords);
      toast.success(signed ? `${signed.fullName} blocked and removed from this session.` : `${m} blocked for this session.`);
      setMatric(""); setReason("");
      await load();
    } catch (e) {
      toast.error(friendlyError(e, "Could not block the student."));
    } finally { setBusy(null); }
  }, [link.id, allRecords, load]);

  useEffect(() => { registerBlock((m) => { if (window.confirm(`Block ${m} from this session? Their check-in will be removed.`)) block(m); }); }, [registerBlock, block]);

  async function unblock(m: string) {
    setBusy(m);
    try {
      await unblockStudent(link.id, m);
      toast.success(`${m} unblocked. They can sign this session again.`);
      await load();
    } catch (e) {
      toast.error(friendlyError(e, "Could not unblock the student."));
    } finally { setBusy(null); }
  }

  return (
    <Panel className="flex flex-col gap-4">
      <PanelTitle action={<span className="text-xs text-muted-foreground">{blocks.length} blocked</span>}>Blocked students</PanelTitle>
      <p className="-mt-2 text-sm text-muted-foreground">Sent someone out? Block their matric number and they can't sign this session from anywhere, even outside the door. Unblock any time.</p>
      <form onSubmit={(e) => { e.preventDefault(); block(matric, reason); }} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input id="block-matric" list="block-matric-list" value={matric} onChange={(e) => setMatric(e.target.value)} placeholder="Matric number, e.g. CSC/2021/001" className="h-11 rounded-xl text-base" autoComplete="off" />
        <datalist id="block-matric-list">{records.map((r) => <option key={r.id} value={r.matricNumber}>{r.fullName}</option>)}</datalist>
        <Input id="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="h-11 rounded-xl text-base" />
        <Button type="submit" disabled={!!busy} className="h-11 rounded-xl bg-red-600 text-white hover:bg-red-700">
          {busy && busy === matric.trim().toUpperCase() ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />} Block
        </Button>
      </form>
      {loadError && <p className="text-sm text-amber-700 dark:text-amber-400">{loadError}</p>}
      {blocks.length > 0 && (
        <ul className="divide-y divide-[rgba(27,36,57,0.06)]">
          {blocks.map((b) => (
            <li key={b.matric} className="flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700 dark:bg-red-900/30"><Ban className="h-4 w-4" /></span>
              <div className="min-w-0 flex-grow">
                <p className="truncate text-sm font-medium tabular-nums">{b.matric}{nameFor(b.matric) ? ` · ${nameFor(b.matric)}` : ""}</p>
                <p className="truncate text-xs text-muted-foreground">Blocked {new Date(b.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{b.reason ? ` · ${b.reason}` : ""}</p>
              </div>
              <Button variant="outline" size="sm" disabled={busy === b.matric} onClick={() => unblock(b.matric)} className="rounded-lg">
                {busy === b.matric ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />} Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
