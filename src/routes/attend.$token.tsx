import { createFileRoute, Link } from "@tanstack/react-router";
import { friendlyError } from "@/lib/friendly-error";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, XCircle, Loader2, ArrowLeft, ArrowRight, MapPin, ChevronDown, KeyRound, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchLinkByToken,
  fetchStudentProfile,
  createHelpRequest,
  getHelpRequest,
  type SubmitAttendanceInput,
  type SubmitAttendanceResult,
  fetchMyClassCode,
  getStudentCode,
  lookupStudentRemote,
  getRegisteredMatric,
  submitAttendance,
  CheckInError,
  type StudentProfile,
  getDeviceId,
  hasMarkedAttendanceForCourseToday,
  hasDeviceMarkedAttendanceToday,
  hasDeviceMarkedAttendanceTodayRemote,
  isLinkValid,
  loadSettings,
  todayKey,
  markClassCodeUsed,
  type AttendanceLink,
  type Gender,
} from "@/lib/attendance-store";
import { getCurrentPosition, warmUpGps, type Coords } from "@/lib/geo";
import { CheckInErrorScreen } from "@/components/CheckInErrorScreen";
import { QrCode } from "@/components/QrCode";
import { uploadCheckinPhoto, withTimeout } from "@/lib/checkin-photos";
import { analyseFace, faceDistance, FACE_MATCH_THRESHOLD, preloadFaceModels } from "@/lib/face";
import { StampedSelfie, type GpsStats } from "@/components/StampedSelfie";
import type { StampInfo } from "@/lib/photo-stamp";

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
  // Device-level block: set to true if this phone already submitted today
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  // Live stamped selfie (required before submit)
  const [photo, setPhoto] = useState<{ dataUrl: string; info: StampInfo; pos: Coords; frame: HTMLCanvasElement; gps: GpsStats } | null>(null);
  // Registered profile for the typed matric (details come from it, not the form)
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  // Not registered, but signed a class before: details found from that record
  const [pastMatch, setPastMatch] = useState<{ fullName: string; level: string } | null>(null);
  // The student's personal class code (only returned on their own phone)
  const [myCode, setMyCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  // The form is three short screens: you → live selfie → class code
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  // GPS help: the lecturer scans a code on this phone
  const lastInputRef = useRef<SubmitAttendanceInput | null>(null);
  // Upload the selfie as soon as it's taken, so submitting stays instant
  const uploadRef = useRef<{ dataUrl: string; job: Promise<{ photo: string; photoThumb: string } | null> } | null>(null);
  const [helpId, setHelpId] = useState<string | null>(null);
  const [helpState, setHelpState] = useState<"waiting" | "declined" | "expired" | "failed">("waiting");
  const [helpBusy, setHelpBusy] = useState(false);
  // Face comparison of the selfie against the registered face
  const [face, setFace] = useState<{ state: "checking" | "match" | "mismatch" | "noface"; distance?: number } | null>(null);
  const [roomCode, setRoomCode] = useState("");
  // Set when the server refuses the check-in; shows a full-screen explanation
  const [failure, setFailure] = useState<CheckInError | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => warmUpGps(), []); // GPS gets a strong fix while the student fills in their details
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

  // Prefill the matric registered on this phone
  useEffect(() => {
    const m = getRegisteredMatric();
    if (m) setForm((f) => (f.matricNumber ? f : { ...f, matricNumber: m }));
  }, []);

  // Look up the registered profile as the matric is typed (debounced)
  useEffect(() => {
    const m = form.matricNumber.trim();
    if (m.length < 5) { setProfile(null); setPastMatch(null); setMyCode(null); setProfileLoading(false); return; }
    let cancelled = false;
    setProfileLoading(true);
    const t = setTimeout(async () => {
      fetchMyClassCode(m).catch(() => null).then((c) => { if (!cancelled) setMyCode(c ?? getStudentCode(m)); });
      const p = await fetchStudentProfile(m).catch(() => null);
      if (cancelled) return;
      setProfile(p);
      if (p) {
        setPastMatch(null);
        setProfileLoading(false);
        preloadFaceModels(); // ready by the time the selfie is taken
        setForm((f) => ({ ...f, fullName: p.fullName, department: p.department, phone: p.phone, level: p.level, gender: p.gender }));
        return;
      }
      // Not registered: fill in what we know from a class they signed before
      const past = await lookupStudentRemote(m).catch(() => null);
      if (cancelled) return;
      setProfileLoading(false);
      setPastMatch(past ? { fullName: past.fullName, level: past.level } : null);
      if (past) setForm((f) => ({ ...f, fullName: f.fullName || past.fullName, level: f.level || past.level }));
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.matricNumber]);

  useEffect(() => {
    if (photo && uploadRef.current?.dataUrl !== photo.dataUrl) {
      uploadRef.current = { dataUrl: photo.dataUrl, job: uploadCheckinPhoto(photo.dataUrl, token) };
    }
  }, [photo]);

  function goNext(e: React.FormEvent) {
    e.preventDefault();
    if (stage === 1) {
      if (form.matricNumber.trim().length < 5) return toast.error("Enter your matric number.");
      if (profileLoading) return toast.error("One moment, we're still finding your details.");
      if (!profile) {
        if (!form.fullName.trim()) return toast.error("Enter your full name.");
        if (!form.department.trim()) return toast.error("Enter your department.");
        if (!form.level) return toast.error("Choose your level.");
        if (!form.gender) return toast.error("Choose your gender.");
      }
      setStage(2);
    } else if (stage === 2) {
      if (!photo) return toast.error("Take your live photo first.");
      setStage(3);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function copyMyCode(code: string) {
    navigator.clipboard?.writeText(code).then(() => { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); }).catch(() => {});
  }

  // Compare the selfie with the registered face as soon as both exist
  useEffect(() => {
    if (!photo || !profile || profile.descriptor.length !== 128) { setFace(null); return; }
    let cancelled = false;
    setFace({ state: "checking" });
    analyseFace(photo.frame, { withDescriptor: true })
      .then((f) => {
        if (cancelled) return;
        if (!f || f.descriptor.length !== 128) { setFace({ state: "noface" }); return; }
        const d = faceDistance(f.descriptor, profile.descriptor);
        setFace({ state: d <= FACE_MATCH_THRESHOLD ? "match" : "mismatch", distance: d });
      })
      .catch(() => { if (!cancelled) setFace({ state: "noface" }); });
    return () => { cancelled = true; };
  }, [photo, profile]);

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

    if (!form.matricNumber.trim()) return toast.error("Please enter your matric number.");
    if (!profile) {
      if (!form.fullName.trim())     return toast.error("Please enter your full name.");
      if (!form.department.trim())   return toast.error("Please enter your department.");
      if (!form.phone.trim())        return toast.error("Please enter your phone number.");
      if (!form.level)               return toast.error("Please select your level.");
      if (!form.gender)              return toast.error("Please select your gender.");
    }
    if (profile && face?.state === "checking") return toast.error("Still checking your face — one moment.");
    if (profile && face?.state === "noface")   return toast.error("No face found in your photo. Retake it facing the light.");
    if (!photo)                    return toast.error("Please take your live photo first.");
    if (Date.now() - photo.info.takenAt.getTime() > 5 * 60_000)
      return toast.error("Your photo is older than 5 minutes. Please retake it.");
    if (roomCode.trim().length !== 4) return toast.error("Enter the 4-character room code from the projector.");

    const today = todayKey();

    // Fast local checks (the server repeats them authoritatively)
    if (hasDeviceMarkedAttendanceToday(deviceId, link.courseCode, today)) {
      setDeviceBlocked(true);
      return toast.error("This phone has already been used to mark attendance for this course today.");
    }
    if (hasMarkedAttendanceForCourseToday(form.matricNumber.trim(), link.courseCode, today)) {
      return toast.error(`You've already marked attendance for ${link.courseCode} today.`);
    }

    setSubmitting(true);
    try {
      const pos = photo.pos;
      const stored = uploadRef.current?.dataUrl === photo.dataUrl ? await withTimeout(uploadRef.current.job, 8000) : null;
      const input: SubmitAttendanceInput = {
        id: crypto.randomUUID(),
        token,
        deviceId,
        fullName: form.fullName.trim(),
        matricNumber: form.matricNumber.trim().toUpperCase(),
        department: form.department.trim(),
        phone: form.phone.trim(),
        level: form.level,
        gender: form.gender as Gender,
        topic: settings.topic || "",
        sessionId: settings.activeSessionId || "",
        roomCode: roomCode.trim().toUpperCase(),
        lat: pos.source === "gps" ? pos.lat : null,
        lng: pos.source === "gps" ? pos.lng : null,
        accuracy: pos.source === "gps" ? (pos.accuracy ?? null) : null,
        faceDistance: face?.distance ?? null,
        gps: photo.gps,
        customFields: {
          photo: stored?.photo ?? photo.dataUrl,
          ...(stored ? { photoThumb: stored.photoThumb } : {}),
          photoAddress: photo.info.address,
          photoTemperatureC: photo.info.temperatureC != null ? String(photo.info.temperatureC) : "",
          photoWeather: photo.info.weather,
          photoTakenAt: photo.info.takenAt.toISOString(),
        },
      };
      lastInputRef.current = input;
      const result = await submitAttendance(input);

      if (result.classCode) {
        markClassCodeUsed(form.matricNumber.trim());
        setAssignedCode(result.classCode);
      }
      setDone(true);
      toast.success("Attendance marked successfully!");
    } catch (err) {
      if (err instanceof CheckInError) {
        if (err.code === "duplicate_device") setDeviceBlocked(true);
        else setFailure(err);
      } else {
        toast.error(friendlyError(err, "We couldn't save your attendance. Please try again."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function retryAfterFailure() {
    const code = failure?.code;
    setFailure(null);
    // Location problems need a fresh photo; a wrong code only needs a new code
    if (code !== "wrong_code") { setPhoto(null); setFace(null); setStage(2); } else { setStage(3); }
    setRoomCode("");
  }

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
            This phone has already been used to mark attendance for{" "}
            <span className="font-semibold text-foreground">
              {link ? (link as AttendanceLink).courseCode : "this course"}
            </span>{" "}
            today. Only one submission per device per course per day is allowed.
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

  // ── Server refused the check-in ────────────────────────────────────────────
  async function askHelp() {
    const input = lastInputRef.current;
    if (!input || !failure) return;
    setHelpBusy(true);
    const reason = failure.code + (failure.meters != null ? `:${failure.meters}` : "");
    const r = await createHelpRequest(input, reason);
    setHelpBusy(false);
    if ("error" in r) {
      toast.error(r.error === "not_configured" ? "GPS help isn't switched on yet. Please tell your lecturer." : r.error === "closed" ? "This check-in has closed." : "We couldn't reach the server. Check your connection and try again.");
      return;
    }
    setHelpState("waiting");
    setHelpId(r.id);
  }

  if (helpId) {
    return (
      <HelpQrScreen id={helpId} state={helpState} courseCode={link ? (link as AttendanceLink).courseCode : ""}
        onState={setHelpState}
        onApproved={(res) => {
          if (res?.classCode) { markClassCodeUsed(form.matricNumber.trim()); setAssignedCode(res.classCode); }
          setHelpId(null); setFailure(null); setDone(true);
          toast.success("Your lecturer confirmed you. Attendance marked!");
        }}
        onCancel={() => setHelpId(null)} />
    );
  }

  if (failure) {
    return <CheckInErrorScreen error={failure} courseCode={link ? (link as AttendanceLink).courseCode : "this course"} onRetry={retryAfterFailure}
      onAskHelp={lastInputRef.current && !helpBusy ? askHelp : undefined} />;
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
          {assignedCode && (
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
            </div>
          )}

          <div className="mt-6 flex flex-col items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/me">Review or correct my details</Link>
            </Button>
            <Button asChild variant="ghost">
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
              <Banner tone="warn" title="Already submitted">
                You've already marked attendance for {(link as AttendanceLink).courseCode} today.
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
            onSubmit={stage < 3 ? goNext : onSubmit}
            className="mt-4 grid gap-3 rounded-2xl border bg-card p-4 shadow-soft sm:mt-6 sm:gap-4 sm:p-6 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" /> Step {stage} of 3 · {["Your details", "Live selfie", "Class code"][stage - 1]}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {[1, 2, 3].map((i) => <div key={i} className={`h-[5px] rounded-full transition-colors duration-300 ${i <= stage ? "bg-primary" : "bg-border"}`} />)}
              </div>
            </div>

            <div className={stage === 1 ? "contents" : "hidden"}>
            <Field label="Matric number" className="sm:col-span-2">
              <Input
                value={form.matricNumber}
                onChange={(e) => update("matricNumber", e.target.value)}
                placeholder="CSC/2021/001"
                autoCapitalize="characters"
              />
              {profileLoading && (
                <p className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Finding your details…
                </p>
              )}
              {profile && !profileLoading && (
                <div className="mt-3 overflow-hidden rounded-2xl border border-primary/30 bg-primary/5">
                  <div className="flex items-center gap-2 border-b border-primary/20 px-4 py-2.5 text-sm font-semibold text-primary">
                    <CheckCircle2 className="h-4 w-4" /> Welcome back, {profile.fullName.split(" ")[0]}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3 text-sm">
                    {[
                      ["Full name", profile.fullName],
                      ["Matric number", profile.matricNumber],
                      ["Department", profile.department || "—"],
                      ["Level", profile.level ? `${profile.level} Level` : "—"],
                      ["Gender", profile.gender ? profile.gender[0].toUpperCase() + profile.gender.slice(1) : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className={k === "Full name" ? "col-span-2" : ""}>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{k}</dt>
                        <dd className="mt-0.5 font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {myCode && <MyCodeRow code={myCode} copied={codeCopied} onCopy={() => copyMyCode(myCode)} />}
                  <p className="border-t border-primary/20 px-4 py-2 text-[12px] text-muted-foreground">
                    Not you? <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => update("matricNumber", "")}>Use a different matric number</button>
                  </p>
                </div>
              )}
              {!profile && !profileLoading && pastMatch && (
                <div className="mt-2 overflow-hidden rounded-xl bg-accent/60">
                  <p className="px-3 py-2 text-[13px] leading-5">
                    We found <strong>{pastMatch.fullName}</strong> from a class you signed before and filled it in below. Check it, then add anything missing.
                  </p>
                  {myCode && <MyCodeRow code={myCode} copied={codeCopied} onCopy={() => copyMyCode(myCode)} />}
                </div>
              )}
              {!profile && !profileLoading && !pastMatch && form.matricNumber.trim().length >= 5 && (
                <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-400">
                  We don't have this matric number yet. Fill in your details below, and <Link to="/register" className="font-medium underline">register once</Link> so they fill in by themselves next time.
                </p>
              )}
            </Field>

            {!profile && (<>
            <Field label="Full name" className="sm:col-span-2">
              <Input
                value={form.fullName}
                onChange={(e) => update("fullName", e.target.value)}
                placeholder="Jane Doe"
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

            </>)}

            <div className="sm:col-span-2 pt-1">
              <Button type="submit" className="h-12 w-full rounded-full text-base">Continue <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
            </div>

            <div className={stage === 3 ? "contents" : "hidden"}>
            {profile || form.fullName ? (
              <div className="sm:col-span-2 flex items-center gap-3 rounded-2xl bg-secondary/60 p-3">
                {photo && <img src={photo.dataUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />}
                <div className="min-w-0 text-sm">
                  <p className="truncate font-semibold">{profile?.fullName ?? form.fullName}</p>
                  <p className="truncate text-muted-foreground">{form.matricNumber.trim().toUpperCase()}{myCode ? ` · ${myCode}` : ""}</p>
                </div>
              </div>
            ) : null}
            <Field label="Class code — look at the projector" className="sm:col-span-2">
              <Input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4))}
                placeholder="e.g. K7P2"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                className="h-14 text-center font-mono text-2xl font-bold tracking-[0.4em]"
              />
              <p className="mt-1 text-xs text-muted-foreground">The code changes every 30 seconds. Letters are never O or I.</p>
            </Field>
            </div>

            <div className={stage === 2 ? "contents" : "hidden"}>
            <Field label="Live photo (with location stamp)" className="sm:col-span-2">
              <StampedSelfie onChange={setPhoto} getPosition={() => getCurrentPosition()} />
              {profile && photo && face && (
                <p className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  face.state === "match" ? "bg-primary/10 text-primary"
                  : face.state === "checking" ? "bg-secondary text-muted-foreground"
                  : "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"}`}>
                  {face.state === "checking" && <><Loader2 className="h-4 w-4 animate-spin" /> Comparing with your registered face…</>}
                  {face.state === "match" && <><CheckCircle2 className="h-4 w-4" /> Face matches your registration</>}
                  {face.state === "mismatch" && <>Face doesn't clearly match your registration. You can still submit — your lecturer will review it. Better light usually fixes this; try Retake.</>}
                  {face.state === "noface" && <>No face found in the photo. Retake it facing the light.</>}
                </p>
              )}
            </Field>
            <div className="sm:col-span-2 flex flex-col gap-2 pt-1">
              <Button type="submit" disabled={!photo} className="h-12 w-full rounded-full text-base">Continue <ArrowRight className="ml-1 h-4 w-4" /></Button>
              <Button type="button" variant="ghost" className="h-11 w-full rounded-full" onClick={() => setStage(1)}>Back</Button>
            </div>
            </div>

            <div className={stage === 3 ? "sm:col-span-2 pt-1" : "hidden"}>
              <Button
                type="submit"
                className="h-12 w-full rounded-full text-base"
                disabled={submitting || !photo || roomCode.length !== 4 || (alreadyMarked && !!form.matricNumber.trim())}
              >
                {submitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
                  : <><CheckCircle2 className="mr-2 h-4 w-4" /> Mark my attendance</>
                }
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Your class code, location and photo are checked on the server before attendance is saved.
              </p>
              <Button type="button" variant="ghost" className="mt-1 h-11 w-full rounded-full" onClick={() => setStage(2)}>Back</Button>
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

/** "Your class code" strip shown with the student's details. */
function MyCodeRow({ code, copied, onCopy }: { code: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-primary/20 bg-background/60 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Your class code</p>
        <p className="mt-0.5 font-display text-xl font-bold tracking-[0.08em] tabular-nums">{code}</p>
      </div>
      <button type="button" onClick={onCopy} className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium hover:bg-secondary">
        <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** The student's phone shows this QR for the lecturer to scan, and waits for approval. */
function HelpQrScreen({ id, state, courseCode, onState, onApproved, onCancel }: {
  id: string; state: "waiting" | "declined" | "expired" | "failed"; courseCode: string;
  onState: (s: "waiting" | "declined" | "expired" | "failed") => void;
  onApproved: (r: SubmitAttendanceResult | null) => void; onCancel: () => void;
}) {
  useEffect(() => {
    if (state !== "waiting") return;
    let stop = false;
    const tick = async () => {
      const r = await getHelpRequest(id);
      if (stop || !r) return;
      if (r.status === "approved") onApproved(r.result);
      else if (r.status === "declined" || r.status === "expired" || r.status === "failed") onState(r.status);
    };
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [id, state, onApproved, onState]);

  return (
    <div className="min-h-[100svh] bg-background">
      <div className="mx-auto flex min-h-[100svh] max-w-md flex-col items-center px-6 py-10 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{courseCode} · GPS help</p>
        {state === "waiting" ? (<>
          <h1 className="mt-2 font-display text-[28px] font-bold leading-8 tracking-tight">Show this to your lecturer</h1>
          <p className="mt-2 text-base leading-6 text-muted-foreground">They'll scan it from their laptop or phone to confirm you're in the hall. Keep this screen open.</p>
          <div className="mt-6 rounded-3xl bg-white p-4 shadow-soft">
            <QrCode value={`ATTHELP:${id}`} size={240} alt="Your check-in code for the lecturer to scan" />
          </div>
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Waiting for your lecturer…</p>
          <p className="mt-1 text-[12px] text-muted-foreground">This code works once and expires in 10 minutes.</p>
        </>) : (<>
          <h1 className="mt-2 font-display text-[28px] font-bold leading-8 tracking-tight">
            {state === "declined" ? "Your lecturer didn't approve this" : state === "expired" ? "This code expired" : "That didn't go through"}
          </h1>
          <p className="mt-2 text-base leading-6 text-muted-foreground">
            {state === "declined" ? "Speak to your lecturer if you think this is a mistake." : state === "expired" ? "Ask for help again to get a new code." : "You may already be marked for this class today, or the check-in has closed. Speak to your lecturer."}
          </p>
        </>)}
        <div className="flex-grow" />
        <Button variant="ghost" className="mt-8 h-11 w-full rounded-full" onClick={onCancel}>Back</Button>
      </div>
    </div>
  );
}
