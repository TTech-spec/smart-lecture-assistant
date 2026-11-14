import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStore } from "@/hooks/use-store";
import { fetchStudents, fetchReviewQueue, reviewRecord, type AttendanceRecord, type StudentProfile } from "@/lib/attendance-store";
import { needsReview } from "@/components/admin/AdminSidebar";
import { Avatar, PageHeader, Panel, checkStatus } from "@/components/admin/ui";

export const Route = createFileRoute("/admin/review")({
  head: () => ({ meta: [{ title: "To review — Attendly" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ id: typeof s.id === "string" ? s.id : undefined }),
  component: ReviewPage,
});

function ReviewPage() {
  const { records } = useStore();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => { fetchStudents().then(setStudents).catch(() => setStudents([])); }, []);
  // Pull flagged check-ins from the database now and every 15 seconds
  useEffect(() => {
    let alive = true;
    const pull = () => fetchReviewQueue().then((r) => {
      if (!alive) return;
      setLoadError(r.ok ? null : r.message);
      setLoading(false);
    });
    pull();
    const t = setInterval(pull, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const queue = useMemo(
    () => records.filter(needsReview).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [records],
  );
  const current = queue.find((r) => r.id === id) ?? queue[0] ?? null;
  const resets = students.filter((s) => s.status === "reset_requested");

  function decide(r: AttendanceRecord, decision: "approved" | "rejected") {
    if (decision === "rejected" && !confirm(`Reject ${r.fullName}'s check-in? It will be removed and they'll be marked absent.`)) return;
    reviewRecord(r, decision);
    toast.success(decision === "approved" ? "Approved." : "Rejected — check-in removed.");
    const next = queue.find((q) => q.id !== r.id);
    navigate({ to: "/admin/review", search: { id: next?.id } });
  }

  const oldest = queue.length ? queue[queue.length - 1] : null;

  return (
    <main className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-8 lg:py-7">
      <PageHeader
        eyebrow={queue.length ? `${queue.length} waiting${oldest ? ` · oldest ${timeAgo(oldest.submittedAt)}` : ""}` : "All caught up"}
        title="To review"
      />

      {loadError && (
        <Panel className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          Couldn't load check-ins to review from the database. Check your internet, then refresh. ({loadError})
        </Panel>
      )}
      {queue.length === 0 && resets.length === 0 && loading ? (
        <Panel className="py-16 text-center text-sm text-muted-foreground">Loading check-ins to review…</Panel>
      ) : queue.length === 0 && resets.length === 0 ? (
        <Panel className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e7f8f1] text-[#0f8a66]"><ShieldCheck className="h-6 w-6" /></span>
          <p className="font-display text-xl font-semibold">Nothing to review</p>
          <p className="max-w-sm text-sm text-muted-foreground">Check-ins where the face didn't match or a different phone was used will appear here.</p>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2.5">
            {queue.map((r) => {
              const active = current?.id === r.id;
              return (
                <Link
                  key={r.id}
                  to="/admin/review"
                  search={{ id: r.id }}
                  className={`flex items-center gap-3 rounded-2xl border bg-card p-3.5 transition-colors ${active ? "border-[#12b886] ring-[3px] ring-[#12b886]/10" : "border-[rgba(27,36,57,0.08)] hover:border-[rgba(27,36,57,0.2)]"}`}
                >
                  <Avatar src={r.customFields?.photoThumb || r.customFields?.photo} name={r.fullName} size={40} />
                  <div className="min-w-0 flex-grow">
                    <p className="truncate text-sm font-semibold">{r.fullName}</p>
                    <p className="truncate text-xs text-amber-700 dark:text-amber-400">{checkStatus(r.customFields).label} · {r.courseCode}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(r.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </Link>
              );
            })}
            {resets.length > 0 && (
              <Link to="/admin/students" className="mt-2 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-3.5 text-sm dark:bg-amber-900/10">
                <strong>{resets.length} reset request{resets.length > 1 ? "s" : ""}</strong>
                <span className="block text-xs text-muted-foreground">Students who changed phones — handle them on the Students page.</span>
              </Link>
            )}
          </div>

          {current ? (
            <ReviewDetail
              r={current}
              registered={students.find((s) => s.matricNumber.toUpperCase() === current.matricNumber.toUpperCase()) ?? null}
              onDecide={(d) => decide(current, d)}
            />
          ) : (
            <Panel className="py-16 text-center text-sm text-muted-foreground">No check-ins waiting.</Panel>
          )}
        </div>
      )}
    </main>
  );
}

function ReviewDetail({ r, registered, onDecide }: { r: AttendanceRecord; registered: StudentProfile | null; onDecide: (d: "approved" | "rejected") => void }) {
  const cf = r.customFields ?? {};
  const flags = String(cf.flags ?? "");
  const faceDist = cf.faceDistance != null && cf.faceDistance !== "" ? Number(cf.faceDistance) : null;
  const matchPct = faceDist != null ? Math.max(0, Math.round((1 - faceDist / 1.2) * 100)) : null;
  const LOC_REASONS: Record<string, string> = {
    gps_too_still: "GPS never moved while the camera was open (common with fake-GPS apps)",
    gps_round: "Coordinates look typed in (too few decimals)",
    same_spot: "Exactly the same coordinates as another student",
    on_pin: "Exactly on your pin (real phones land a few metres away)",
    off_campus_net: `Not on a campus internet address${cf.ip ? ` (network ${cf.ip})` : ""}`,
    gps_help: "You scanned this student in the hall because their GPS failed",
  };
  const locReasons = Object.keys(LOC_REASONS).filter((k) => flags.includes(k)).map((k) => LOC_REASONS[k]);
  const checks = [
    { label: "Class code", ok: Boolean(cf.roomCodeOk), value: cf.roomCodeOk ? "Correct" : "Not checked" },
    { label: "Location", ok: Boolean(cf.serverChecked) && locReasons.length === 0, value: locReasons.length ? `Suspicious · ${r.distanceMeters ?? 0} m away` : r.distanceMeters ? `${r.distanceMeters} m away` : "No location" },
    { label: "Phone", ok: !flags.includes("different_phone"), value: flags.includes("different_phone") ? "Different phone" : "Registered phone" },
    { label: "Face", ok: !flags.includes("face_mismatch") && !flags.includes("no_face_check"), value: flags.includes("no_face_check") ? "Not checked" : matchPct != null ? `${matchPct}% match` : "—" },
  ];
  const edits = (Array.isArray(cf.edits) ? cf.edits : []) as { at: string; from: Record<string, string>; to: Record<string, string> }[];
  const hint = locReasons.length
    ? `The location may be faked: ${locReasons.join("; ")}. Look at the selfie background: is it your lecture hall? If yes, approve; if it's a room or outdoors elsewhere, reject.`
    : flags.includes("matric_changed")
    ? "The student changed the matric number on this check-in after submitting. Make sure the person in the selfie is the student with the new matric number — a swap to an absent friend's number would show here."
    : flags.includes("face_mismatch") && !flags.includes("different_phone")
    ? "The class code, location and phone all check out. A low face match is usually bad lighting — if the two photos are clearly the same person, approve it."
    : flags.includes("different_phone")
      ? "This student used a phone other than the one they registered. Check the selfie, then approve if it's them."
      : "Compare the two photos and approve if it's the same person.";

  return (
    <Panel className="flex flex-col gap-5 p-6">
      <div>
        <p className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-400">{checkStatus(cf).label}</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">{r.fullName} · <span className="font-mono text-lg">{r.matricNumber}</span></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{r.courseCode} · {new Date(r.submittedAt).toLocaleString()} · {r.level ? `${r.level} Level · ` : ""}{r.department}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Photo src={registered?.photo} caption={registered?.createdAt ? `Registered · ${new Date(registered.createdAt).toLocaleDateString()}` : "Registered photo"} empty="No registered photo" />
        <Photo src={cf.photo} caption={`Check-in selfie${matchPct != null ? ` · ${matchPct}% match` : ""}`} empty="No selfie" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {checks.map((c) => (
          <div key={c.label} className={`rounded-xl px-3.5 py-3 ${c.ok ? "bg-[#f2f6f5] dark:bg-white/5" : "bg-[#fdf3e2] dark:bg-amber-900/20"}`}>
            <p className={`text-xs ${c.ok ? "text-muted-foreground" : "text-[#92400e] dark:text-amber-300"}`}>{c.label}</p>
            <p className={`mt-0.5 text-sm font-semibold ${c.ok ? "text-[#0f8a66]" : "text-[#92400e] dark:text-amber-300"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {edits.length > 0 && (
        <div className="rounded-xl border border-[rgba(27,36,57,0.08)] p-4">
          <p className="text-xs font-semibold text-muted-foreground">Changed by the student</p>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {edits.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{new Date(e.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                {(["fullName", "matricNumber", "department"] as const).filter((k) => e.from?.[k] !== e.to?.[k]).map((k) => (
                  <span key={k}><span className="line-through opacity-60">{e.from?.[k] || "—"}</span> → <strong>{e.to?.[k]}</strong></span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[13px] leading-relaxed text-muted-foreground">{hint}</p>

      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="outline" className="h-11 rounded-xl border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700" onClick={() => onDecide("rejected")}>
          <X className="mr-1.5 h-4 w-4" /> Reject · mark absent
        </Button>
        <Button className="h-11 rounded-xl px-6" onClick={() => onDecide("approved")}>
          <Check className="mr-1.5 h-4 w-4" /> Approve
        </Button>
      </div>
    </Panel>
  );
}

function Photo({ src, caption, empty }: { src?: string | null; caption: string; empty: string }) {
  return (
    <figure>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-[#283349]">
        {src ? <img src={src} alt={caption} className="h-full w-full object-cover" /> : <span className="text-sm text-[#9aa6b8]">{empty}</span>}
      </div>
      <figcaption className="mt-2 text-[13px] text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
