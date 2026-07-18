import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, XCircle, Loader2, ArrowLeft, MapPin, ChevronDown, KeyRound, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  addRecord,
  fetchLinkByToken,
  getDeviceId,
  hasMarkedAttendanceForCourseToday,
  hasDeviceMarkedAttendanceToday,
  hasDeviceMarkedAttendanceTodayRemote,
  isLinkValid,
  loadSettings,
  todayKey,
  generateStudentClassCode,
  markClassCodeUsed,
  updateStudentClassCode,
  type AttendanceLink,
  type Gender,
} from "@/lib/attendance-store";
import { distanceMeters, effectiveDistance, formatDistance, getCurrentPosition } from "@/lib/geo";

export const Route = createFileRoute("/attend/$token")({
  head: () => ({
    meta: [
      { title: "Mark attendance — Attendly" },
      { name: "description", content: "Use your lecturer's attendance link to mark yourself present." },
    ],
  }),
  component: AttendTokenPage,
});

// ── Types & empty form ────────────────────────────────────────────────────────
type Form = {
  fullName: string;
  matricNumber: string;
  department: string;
  phone: string;
  level: string;
  gender: Gender | "";
};

const empty: Form = {
  fullName: "", matricNumber: "", department: "", phone: "", level: "", gender: "",
};

// How long the assigned class code stays on screen so the student can copy it
const CODE_VIEW_SECONDS = 600; // 10 minutes

// ── Status banner ─────────────────────────────────────────────────────────────
function Banner({
  tone,
  title,
  children,
}: {
  tone: "ok" | "warn" | "error";
  title: string;
  children: React.ReactNode;
}) {
  const colours = {
    ok:    "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/8 text-[color:var(--color-success)]",
    warn:  "border-amber-400/30 bg-amber-400/8 text-amber-700 dark:text-amber-400",
    error: "border-destructive/30 bg-destructive/8 text-destructive",
  };
  const Icon = tone === "ok" ? CheckCircle2 : XCircle;
  return (
    <div className={`flex gap-3 rounded-xl border p-3 text-sm ${colours[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold leading-none">{title}</p>
        <p className="mt-1 text-xs opacity-80">{children}</p>
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="text-sm">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────
function AttendTokenPage() {
  const { token } = Route.useParams();

  const [link, setLink]             = useState<AttendanceLink | null | "loading">("loading");
  const [form, setForm]             = useState<Form>(empty);
  const [deptManual, setDeptManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]             = useState(false);
  // The class code assigned to this student after successful submission
  const [assignedCode, setAssignedCode] = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);
  // Countdown while the class code is visible; the reveal hides when it hits 0
  const [codeSecondsLeft, setCodeSecondsLeft] = useState(CODE_VIEW_SECONDS);
  const [codeDismissed, setCodeDismissed] = useState(false);
  // Device-level block: set to true if this phone already submitted today
  const [deviceBlocked, setDeviceBlocked] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLink() {
      const l = await fetchLinkByToken(token);
      if (!cancelled) setLink(l);
    }

    loadLink();
    pollRef.current = setInterval(loadLink, 10_000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token]);

  const settings = useMemo(() => loadSettings(), []);
  const deviceId = useMemo(() => getDeviceId(), []);

  // ── Device-level duplicate check (runs once link is known) ─────────────────
  useEffect(() => {
    if (!link || link === "loading") return;
    const today = todayKey();

    // 1. Fast local check
    if (hasDeviceMarkedAttendanceToday(deviceId, link.courseCode, today)) {
      setDeviceBlocked(true);
      return;
    }
    // 2. Authoritative remote check (in case localStorage was cleared)
    hasDeviceMarkedAttendanceTodayRemote(deviceId, link.courseCode, today).then((blocked) => {
      if (blocked) setDeviceBlocked(true);
    });
  }, [link, deviceId]);

  // Matric-level duplicate check (live as user types)
  const alreadyMarked = useMemo(() => {
    if (!link || link === "loading") return false;
    const today = todayKey();
    return hasMarkedAttendanceForCourseToday(form.matricNumber.trim(), link.courseCode, today);
  }, [link, form.matricNumber]);

  const now    = new Date();
  const isValid = link && link !== "loading" && isLinkValid(link, now);

  const update = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!link || link === "loading") return;
    if (!isLinkValid(link, new Date())) return toast.error("This link is no longer valid.");

    if (!form.fullName.trim())     return toast.error("Please enter your full name.");
    if (!form.matricNumber.trim()) return toast.error("Please enter your matric number.");
    if (!form.department.trim())   return toast.error("Please enter your department.");
    if (!form.phone.trim())        return toast.error("Please enter your phone number.");
    if (!form.level)               return toast.error("Please select your level.");
    if (!form.gender)              return toast.error("Please select your gender.");

    const today = todayKey();

    // ── Device block (re-check at submit time) ──────────────────────────────
    if (hasDeviceMarkedAttendanceToday(deviceId, link.courseCode, today)) {
      setDeviceBlocked(true);
      return toast.error("This phone has already marked attendance twice for this course today.");
    }
    // Remote device check
    const blockedRemote = await hasDeviceMarkedAttendanceTodayRemote(deviceId, link.courseCode, today);
    if (blockedRemote) {
      setDeviceBlocked(true);
      return toast.error("This phone has already marked attendance twice for this course today.");
    }

    // ── Matric duplicate check ──────────────────────────────────────────────
    if (hasMarkedAttendanceForCourseToday(form.matricNumber.trim(), link.courseCode, today)) {
      return toast.error(
        `You've already marked attendance for ${link.courseCode} twice today. Only two submissions per course per day are allowed.`
      );
    }

    // ── GPS check ───────────────────────────────────────────────────────────
    const locationSet = settings.classLat != null && settings.classLng != null;
    setSubmitting(true);

    try {
      let lat = 0, lng = 0, dist = 0;

      if (locationSet) {
        let pos;
        try {
          pos = await getCurrentPosition();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not read GPS.";
          toast.error(
            msg.toLowerCase().includes("denied")
              ? "Location permission denied. Allow location access in your browser settings and try again."
              : msg,
          );
          setSubmitting(false);
          return;
        }

        const classPos = { lat: settings.classLat!, lng: settings.classLng! };
        dist = distanceMeters(pos, classPos);
        const eff = effectiveDistance(pos, classPos);

        if (eff > settings.radiusMeters) {
          toast.error(
            `You're ${formatDistance(dist)} away. Must be within ${settings.radiusMeters}m of class.` +
            (pos.source === "ip"
              ? " Your browser denied GPS so IP location is being used. Allow location access and try again."
              : ""),
          );
          setSubmitting(false);
          return;
        }
        lat = pos.lat;
        lng = pos.lng;
      }

      // ── Auto-assign class code if link has it enabled ───────────────────
      let classCode: string | undefined;
      if (link.assignClassCode) {
        const settings2 = loadSettings();
        // Use the global classCode as the base prefix; fall back to courseCode
        const base = settings2.classCode?.trim() || link.courseCode;
        classCode = await generateStudentClassCode(
          form.matricNumber.trim(),
          base,
          settings2.classCodeFormat || "numbers"
        );
        // Mark as used so the home-page "Get code" button knows it's already assigned
        markClassCodeUsed(form.matricNumber.trim());
      }

      await addRecord({
        id: crypto.randomUUID(),
        fullName: form.fullName.trim(),
        matricNumber: form.matricNumber.trim().toUpperCase(),
        department: form.department.trim(),
        phone: form.phone.trim(),
        courseCode: link.courseCode,
        topic: settings.topic || "",
        level: form.level,
        gender: form.gender as Gender,
        submittedAt: new Date().toISOString(),
        dayKey: today,
        deviceId,
        distanceMeters: Math.round(dist),
        lat,
        lng,
        sessionId: settings.activeSessionId || "",
        customFields: {},
        linkId: link.id,
        assignedClassCode: classCode,
      });

      // Persist the code on the attendance record in Supabase too
      if (classCode) {
        updateStudentClassCode(form.matricNumber.trim().toUpperCase(), classCode);
        setAssignedCode(classCode);
      }

      setDone(true);
      toast.success("Attendance marked successfully!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save attendance.";
      toast.error(`Error: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Give students a 10-minute window to copy/write down their class code before
  // the reveal hides itself — long enough to see the code and copy it down.
  useEffect(() => {
    if (!done || !assignedCode || codeDismissed) return;
    setCodeSecondsLeft(CODE_VIEW_SECONDS);
    const tick = setInterval(() => {
      setCodeSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          setCodeDismissed(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, assignedCode]);

  function copyCode() {
    if (!assignedCode) return;
    navigator.clipboard.writeText(assignedCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (link === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-hero">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Device-blocked screen ──────────────────────────────────────────────────
  if (deviceBlocked) {
    return (
      <div className="min-h-screen bg-gradient-hero">
        <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6 sm:py-24">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <XCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="mt-6 text-2xl font-bold sm:text-3xl">Already submitted</h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            This phone has already marked attendance twice for{" "}
            <span className="font-semibold text-foreground">
              {link ? (link as AttendanceLink).courseCode : "this course"}
            </span>{" "}
            today. Only two submissions per device per course per day are allowed.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            If you believe this is a mistake, contact your lecturer.
          </p>
          <Button asChild className="mt-8 w-full sm:w-auto" variant="outline">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ── Success / done screen ──────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-hero">
        <div className="mx-auto max-w-md px-4 py-16 sm:px-6 sm:py-24">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-2xl font-bold sm:text-3xl">You're checked in!</h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Attendance for{" "}
              <span className="font-semibold text-foreground">{(link as AttendanceLink).courseCode}</span>{" "}
              has been recorded via "{(link as AttendanceLink).title}".
            </p>
          </div>

          {/* Class code reveal — only shown if the link had assignClassCode=true */}
          {assignedCode && !codeDismissed && (
            <div className="mt-8 rounded-2xl border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40">
                <KeyRound className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Your personal class code
              </p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Attached to your name — do not share with anyone else
              </p>

              <div className="mt-4 rounded-xl border border-amber-300 bg-white dark:bg-background px-6 py-4 dark:border-amber-700">
                <p className="font-mono text-3xl font-bold tracking-widest text-amber-700 dark:text-amber-300 select-all">
                  {assignedCode}
                </p>
              </div>

              <button
                onClick={copyCode}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white dark:bg-background dark:border-amber-700 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied!" : "Copy code"}
              </button>

              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                You'll need this code to access the test. Screenshot or copy it now.
              </p>

              <Button onClick={() => setCodeDismissed(true)} className="mt-4 w-full">
                Continue
              </Button>
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                This code disappears in{" "}
                <span className="font-semibold tabular-nums">
                  {Math.floor(codeSecondsLeft / 60)}:{String(codeSecondsLeft % 60).padStart(2, "0")}
                </span>{" "}
                — make sure you've copied it before continuing.
              </p>
            </div>
          )}

          <div className="mt-6 text-center">
            <Button asChild variant="outline">
              <Link to="/">Back to home</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Invalid link states ────────────────────────────────────────────────────
  const renderInvalidState = () => {
    if (!link) {
      return (
        <Banner tone="error" title="Link not found">
          This attendance link doesn't exist. Ask your lecturer to share the correct link.
        </Banner>
      );
    }
    if (!link.isActive) {
      return (
        <Banner tone="error" title="Link disabled">
          Your lecturer has disabled this attendance link. Contact them for a new one.
        </Banner>
      );
    }
    if (new Date(link.expiresAt) <= now) {
      return (
        <Banner tone="error" title="Link expired">
          This link expired on {new Date(link.expiresAt).toLocaleString()}. Ask your lecturer to generate a new one.
        </Banner>
      );
    }
    return null;
  };

  const invalidBanner = renderInvalidState();

  const minsLeft = isValid
    ? Math.max(0, Math.ceil((new Date((link as AttendanceLink).expiresAt).getTime() - now.getTime()) / 60_000))
    : 0;

  const departments = settings.departments || [];

  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-6 sm:py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">GPS required</span>
          <span className="sm:hidden">GPS</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-12 sm:px-6 sm:pb-16">
        {/* Title block */}
        {link && (
          <div className="mb-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {link.courseCode}
            </p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{link.title}</h1>
            {link.assignClassCode && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <KeyRound className="h-3 w-3" /> You will receive a class code after submitting
              </p>
            )}
          </div>
        )}
        {!link && (
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Mark attendance</h1>
        )}

        {/* Status banner */}
        <div className="mt-4 rounded-2xl border bg-card p-3 shadow-soft">
          {invalidBanner ?? (
            alreadyMarked && form.matricNumber.trim() ? (
              <Banner tone="warn" title="Daily limit reached">
                You've already marked attendance for {(link as AttendanceLink).courseCode} twice today.
              </Banner>
            ) : (
              <Banner tone="ok" title="Link is active">
                Closes in about {minsLeft} min — submit before it expires.
              </Banner>
            )
          )}
        </div>

        {/* Form */}
        {isValid && (
          <form
            onSubmit={onSubmit}
            className="mt-4 grid gap-3 rounded-2xl border bg-card p-4 shadow-soft sm:mt-6 sm:gap-4 sm:p-6 sm:grid-cols-2"
          >
            <Field label="Full name" className="sm:col-span-2">
              <Input
                value={form.fullName}
                onChange={(e) => update("fullName", e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>

            <Field label="Matric number">
              <Input
                value={form.matricNumber}
                onChange={(e) => update("matricNumber", e.target.value)}
                placeholder="CSC/2021/001"
              />
            </Field>

            <Field label="Department">
              {deptManual ? (
                <div className="flex gap-2">
                  <Input
                    value={form.department}
                    onChange={(e) => update("department", e.target.value)}
                    placeholder="e.g. Computer Science"
                    className="flex-1"
                    autoFocus
                  />
                  {departments.length > 0 && (
                    <Button
                      type="button" size="sm" variant="outline" className="shrink-0 px-2.5"
                      onClick={() => { setDeptManual(false); update("department", ""); }}
                      title="Switch to dropdown"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ) : departments.length > 0 ? (
                <div className="flex gap-2">
                  <Select value={form.department} onValueChange={(v) => update("department", v)}>
                    <SelectTrigger className="flex-1 w-full">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button" size="sm" variant="outline" className="shrink-0 px-2.5"
                    onClick={() => setDeptManual(true)}
                    title="Type manually"
                  >
                    <ChevronDown className="h-4 w-4 rotate-90" />
                  </Button>
                </div>
              ) : (
                <Input
                  value={form.department}
                  onChange={(e) => update("department", e.target.value)}
                  placeholder="e.g. Computer Science"
                />
              )}
            </Field>

            <Field label="Phone number">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="080..."
              />
            </Field>

            <Field label="Level">
              <Select value={form.level} onValueChange={(v) => update("level", v)}>
                <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                <SelectContent>
                  {["100","200","300","400","500","600"].map((l) => (
                    <SelectItem key={l} value={l}>{l} Level</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Gender">
              <Select value={form.gender} onValueChange={(v) => update("gender", v as Gender)}>
                <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <div className="sm:col-span-2 pt-1">
              <Button
                type="submit"
                className="w-full h-11 text-base"
                disabled={submitting || (alreadyMarked && !!form.matricNumber.trim())}
              >
                {submitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
                  : <><CheckCircle2 className="mr-2 h-4 w-4" /> Mark my attendance</>
                }
              </Button>
              {settings.classLat == null && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  No GPS check configured — your location won't be verified for this session.
                </p>
              )}
            </div>
          </form>
        )}

        {!isValid && (
          <div className="mt-6 text-center">
            <Button asChild variant="outline">
              <Link to="/">Go to home</Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
