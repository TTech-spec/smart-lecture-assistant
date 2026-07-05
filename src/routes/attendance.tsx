import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MapPin, Loader2, CheckCircle2, ShieldAlert, ArrowLeft, Navigation, PenLine, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  addRecord, fetchSettingsFromSupabase, getDeviceId, isWindowOpen,
  loadRecords, loadSettings, minutesRemaining, todayKey,
  type AdminSettings, type Gender,
} from "@/lib/attendance-store";
import { distanceMeters, effectiveDistance, formatDistance, getCurrentPosition } from "@/lib/geo";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Sign attendance — Attendly" },
      { name: "description", content: "Mark today's class attendance. GPS-verified, one submission per device." },
    ],
  }),
  component: AttendancePage,
});

type Form = {
  fullName: string;
  matricNumber: string;
  department: string;
  phone: string;
  courseCode: string;
  topic: string;
  level: string;
  gender: Gender | "";
};

const empty: Form = {
  fullName: "", matricNumber: "", department: "", phone: "",
  courseCode: "", topic: "", level: "", gender: "",
};

function useSettings() {
  const [s, setS] = useState<AdminSettings>(() => loadSettings());

  useEffect(() => {
    // Keep in sync within the same browser (same-device changes)
    const sync = () => setS(loadSettings());
    window.addEventListener("att:settings", sync);
    window.addEventListener("storage", sync);

    // Poll Supabase every 15 s so students see the form open/close
    // on the lecturer's device without needing a page refresh.
    const poll = async () => {
      const remote = await fetchSettingsFromSupabase();
      if (remote) {
        setS((current) => {
          // Only update (and re-render) when something actually changed
          const remoteStr = JSON.stringify(remote);
          return JSON.stringify(current) === remoteStr ? current : remote;
        });
      }
    };

    // Fire once immediately so a freshly-loaded page doesn't have to wait 15 s
    poll();
    const timer = setInterval(poll, 15_000);

    return () => {
      window.removeEventListener("att:settings", sync);
      window.removeEventListener("storage", sync);
      clearInterval(timer);
    };
  }, []);

  return s;
}

function AttendancePage() {
  const settings = useSettings();
  const [form, setForm] = useState<Form>(() => ({
    ...empty,
    courseCode: settings.courseCode,
    topic: settings.topic,
    level: settings.level,
  }));
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [gpsStatus, setGpsStatus] = useState<"idle" | "checking" | "ok" | "far" | "error">("idle");
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);
  const [levelManual, setLevelManual] = useState(false);
  const [deptManual, setDeptManual] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      courseCode: f.courseCode || settings.courseCode,
      topic: f.topic || settings.topic,
      // If level is restricted, always force the form to the locked level
      level: settings.levelRestricted && settings.level ? settings.level : (f.level || settings.level),
    }));
  }, [settings.courseCode, settings.topic, settings.level, settings.levelRestricted]);

  const deviceId = useMemo(() => getDeviceId(), []);
  const alreadySubmitted = useMemo(() => {
    if (typeof window === "undefined") return false;
    const today = todayKey();
    // If there's an active session, check against that specific session so
    // students can attend multiple classes (different sessions) in one day.
    // Fall back to date + course code check when no session is active.
    const activeSession = settings.activeSessionId;
    return loadRecords().some((r) => {
      if (r.deviceId !== deviceId) return false;
      if (activeSession) {
        // Block only if already signed into THIS session on THIS device
        return r.sessionId === activeSession;
      }
      // Legacy / no-session fallback: same device, same day, same course
      return r.dayKey === today &&
        (!settings.courseCode || r.courseCode.toLowerCase() === settings.courseCode.toLowerCase());
    });
  }, [deviceId, settings.courseCode, settings.activeSessionId, done]);

  const locationSet = settings.classLat != null && settings.classLng != null;
  const windowOpen = isWindowOpen(settings, now);
  const minsLeft = minutesRemaining(settings, now);

  const update = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function checkGps() {
    if (!locationSet) return toast.error("Lecturer hasn't pinned the class location yet.");
    setGpsStatus("checking");
    try {
      const pos = await getCurrentPosition();
      const classPos = { lat: settings.classLat!, lng: settings.classLng! };
      const raw  = distanceMeters(pos, classPos);
      const eff  = effectiveDistance(pos, classPos);
      setGpsDistance(Math.round(raw));
      const sourceLabel = pos.source === "ip" ? " (IP-based location — less precise)" : "";
      if (eff <= settings.radiusMeters) {
        setGpsStatus("ok");
        toast.success(`You're ${formatDistance(raw)} away — within range.${sourceLabel}`);
      } else {
        setGpsStatus("far");
        toast.error(
          `You're ${formatDistance(raw)} away — must be within ${settings.radiusMeters}m of class.` +
          (pos.source === "ip"
            ? " Your browser denied GPS so IP location is being used, which may be inaccurate. Please allow location access and try again."
            : sourceLabel)
        );
      }
    } catch (err) {
      setGpsStatus("error");
      const msg = err instanceof Error ? err.message : "Could not read GPS.";
      toast.error(
        msg.toLowerCase().includes("denied")
          ? "Location permission denied. Please allow location access in your browser settings and try again."
          : msg,
      );
    }
  }

  async function onSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!locationSet) return toast.error("Lecturer hasn't set the class location yet.");
    if (!windowOpen) return toast.error("Attendance form is locked. Ask the lecturer to reopen.");
    if (alreadySubmitted) return toast.error("You've already signed attendance for this session.");

    if (!form.fullName.trim())      return toast.error("Please fill full name.");
    if (!form.matricNumber.trim())  return toast.error("Please fill matric number.");
    if (!form.department.trim())    return toast.error("Please fill department.");
    if (!form.phone.trim())         return toast.error("Please fill phone number.");
    if (!form.courseCode.trim())    return toast.error("Please fill course code.");
    if (!form.topic.trim())         return toast.error("Please fill topic.");
    if (!form.gender)               return toast.error("Please select gender.");
    if (!form.level)                return toast.error("Please select your level.");

    if (settings.levelRestricted && settings.level) {
      if (form.level !== settings.level) {
        return toast.error(`This attendance is restricted to ${settings.level} Level students only.`);
      }
    }

    for (const field of (settings.customFields || [])) {
      if (field.required && !customFieldValues[field.id]?.trim()) {
        return toast.error(`Please fill ${field.label}.`);
      }
    }

    setSubmitting(true);
    try {
      const pos = await getCurrentPosition();
      const classPos = { lat: settings.classLat!, lng: settings.classLng! };
      const dist = distanceMeters(pos, classPos);
      const eff  = effectiveDistance(pos, classPos);
      if (eff > settings.radiusMeters) {
        setGpsStatus("far");
        setGpsDistance(Math.round(dist));
        toast.error(
          `You're ${formatDistance(dist)} away. Must be within ${settings.radiusMeters}m of class.` +
          (pos.source === "ip"
            ? " Your browser denied GPS so IP location is being used, which may be inaccurate. Please allow location access and try again."
            : "")
        );
        setSubmitting(false);
        return;
      }

      try {
        await addRecord({
          id: crypto.randomUUID(),
          fullName: form.fullName.trim(),
          matricNumber: form.matricNumber.trim().toUpperCase(),
          department: form.department.trim(),
          phone: form.phone.trim(),
          courseCode: form.courseCode.trim().toUpperCase(),
          topic: form.topic.trim(),
          level: form.level.trim(),
          gender: form.gender as Gender,
          submittedAt: new Date().toISOString(),
          dayKey: todayKey(),
          deviceId,
          distanceMeters: Math.round(dist),
          lat: pos.lat,
          lng: pos.lng,
          sessionId: settings.activeSessionId || "",
          customFields: customFieldValues,
        });
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : "Database error";
        toast.error(`Could not save to database: ${msg}`);
        setSubmitting(false);
        return;
      }

      setGpsStatus("ok");
      setGpsDistance(Math.round(dist));
      setDone(true);
      toast.success("Attendance recorded and saved.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read GPS.";
      setGpsStatus("error");
      toast.error(
        msg.toLowerCase().includes("denied")
          ? "Location permission denied. Allow location in browser settings."
          : msg,
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-hero">
        <div className="mx-auto max-w-md px-4 py-12 text-center sm:px-6 sm:py-20">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-2xl font-bold sm:text-3xl">You're checked in</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Your attendance was verified by GPS and logged for today.
          </p>
          <Button asChild className="mt-8 w-full sm:w-auto" variant="outline">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </div>
    );
  }

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
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sign today's attendance</h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:mt-2 sm:text-base">
          We'll check your location against the lecturer's classroom pin.
        </p>

        <div className="mt-4 rounded-2xl border bg-card p-3 shadow-soft sm:mt-6 sm:p-4">
          {!locationSet ? (
            <Banner tone="warn" title="Waiting for lecturer">
              The lecturer hasn't pinned the class location yet. Try again shortly.
            </Banner>
          ) : !windowOpen ? (
            <Banner tone="warn" title="Form locked">
              The attendance window is closed. Wait for the lecturer to reopen it.
            </Banner>
          ) : alreadySubmitted ? (
            <Banner tone="warn" title="Already submitted">
              You've already signed attendance for this session on this device.
            </Banner>
          ) : (
            <Banner tone="ok" title="Form open">
              {minsLeft === Infinity
                ? "No time limit set."
                : `Closes in about ${minsLeft} min · within ${settings.radiusMeters}m of class.`}
            </Banner>
          )}
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-2xl border bg-card p-4 shadow-soft sm:mt-6 sm:gap-4 sm:p-6 sm:grid-cols-2">
          <Field label="Full name" className="sm:col-span-2">
            <Input value={form.fullName} onChange={(e) => update("fullName", e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Matric number">
            <Input value={form.matricNumber} onChange={(e) => update("matricNumber", e.target.value)} placeholder="CSC/2021/001" />
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
                {(settings.departments || []).length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 px-2.5"
                    onClick={() => { setDeptManual(false); update("department", ""); }}
                    title="Switch to dropdown"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : (settings.departments || []).length > 0 ? (
              <div className="flex gap-2">
                <Select value={form.department} onValueChange={(v) => update("department", v)}>
                  <SelectTrigger className="flex-1 w-full"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {(settings.departments || []).map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 px-2.5"
                  onClick={() => { setDeptManual(true); update("department", ""); }}
                  title="Type department manually"
                >
                  <PenLine className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Input value={form.department} onChange={(e) => update("department", e.target.value)} placeholder="Computer Science" />
            )}
            {(settings.departments || []).length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {deptManual ? "Type your department, then tap the arrow to switch back to dropdown." : "Not in the list? Tap the pen icon to type manually."}
              </p>
            )}
          </Field>
          <Field label="Phone number">
            <Input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="080..." />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onValueChange={(v) => update("gender", v as Gender)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Course code">
            <Input value={form.courseCode} onChange={(e) => update("courseCode", e.target.value)} placeholder="CSC 401" />
          </Field>
          <Field label="Topic">
            <Input value={form.topic} onChange={(e) => update("topic", e.target.value)} placeholder="Distributed Systems" />
          </Field>
          <Field label={settings.levelRestricted && settings.level ? `Level (restricted to ${settings.level})` : "Level"}>
            {settings.levelRestricted && settings.level ? (
              <div className="flex h-10 items-center rounded-md border bg-secondary px-3 text-sm font-medium text-foreground">
                {settings.level} Level
              </div>
            ) : (
              <Select value={form.level} onValueChange={(v) => update("level", v)}>
                <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                <SelectContent>
                  {["100","200","300","400","500","600"].map((l) => <SelectItem key={l} value={l}>{l} Level</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>

          {(settings.customFields || []).map((field) => (
            <Field key={field.id} label={field.required ? field.label : `${field.label} (optional)`}>
              <Input
                value={customFieldValues[field.id] || ""}
                onChange={(e) => setCustomFieldValues((v) => ({ ...v, [field.id]: e.target.value }))}
                placeholder={field.placeholder || ""}
              />
            </Field>
          ))}

          {locationSet && !alreadySubmitted && (
            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-secondary/50 px-3 py-3 sm:flex-nowrap sm:gap-3 sm:px-4">
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  gpsStatus === "ok"    ? "bg-green-500" :
                  gpsStatus === "far" || gpsStatus === "error" ? "bg-red-500 animate-pulse" :
                  gpsStatus === "checking" ? "bg-amber-500 animate-pulse" :
                  "bg-muted-foreground/40"
                }`} />
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {gpsStatus === "idle"     && "Test your location before submitting."}
                  {gpsStatus === "checking" && "Reading your GPS…"}
                  {gpsStatus === "ok"  && gpsDistance !== null && `✓ ${formatDistance(gpsDistance)} away — within range.`}
                  {gpsStatus === "far" && gpsDistance !== null && `✗ ${formatDistance(gpsDistance)} away — too far from class.`}
                  {gpsStatus === "error"    && "GPS error — check location permissions."}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={checkGps}
                  disabled={gpsStatus === "checking" || submitting} className="ml-auto shrink-0">
                  {gpsStatus === "checking"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Navigation className="h-3.5 w-3.5" />}
                  <span className="ml-1.5">Check GPS</span>
                </Button>
              </div>
            </div>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" className="w-full" size="lg"
              disabled={submitting || !locationSet || !windowOpen || alreadySubmitted}>
              {submitting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying location…</>
                : <><MapPin className="mr-2 h-4 w-4" /> Verify &amp; submit</>}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Your GPS is read once at submission to confirm you're physically in class.
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-sm">{label}</Label>
      {children}
    </div>
  );
}

function Banner({ tone, title, children }: { tone: "ok" | "warn"; title: string; children: React.ReactNode }) {
  const okStyle   = { backgroundColor: "color-mix(in oklab, var(--color-primary) 12%, transparent)", color: "var(--color-foreground)" };
  const warnStyle = { backgroundColor: "color-mix(in oklab, var(--color-warning) 18%, transparent)", color: "var(--color-foreground)" };
  const Icon = tone === "ok" ? CheckCircle2 : ShieldAlert;
  return (
    <div className="flex items-start gap-3 rounded-xl p-3" style={tone === "ok" ? okStyle : warnStyle}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
