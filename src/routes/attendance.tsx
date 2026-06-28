import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MapPin, Loader2, CheckCircle2, ShieldAlert, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  addRecord, getDeviceId, isWindowOpen, loadRecords, loadSettings,
  minutesRemaining, todayKey, type AdminSettings, type Gender,
} from "@/lib/attendance-store";
import { distanceMeters, formatDistance, getCurrentPosition } from "@/lib/geo";

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
  fullName: string; matricNumber: string; department: string;
  phone: string; courseCode: string; topic: string; gender: Gender | "";
};

const empty: Form = {
  fullName: "", matricNumber: "", department: "", phone: "",
  courseCode: "", topic: "", gender: "",
};

function useSettings() {
  const [s, setS] = useState<AdminSettings>(() => loadSettings());
  useEffect(() => {
    const sync = () => setS(loadSettings());
    window.addEventListener("att:settings", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("att:settings", sync);
      window.removeEventListener("storage", sync);
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
  }));
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      courseCode: f.courseCode || settings.courseCode,
      topic: f.topic || settings.topic,
    }));
  }, [settings.courseCode, settings.topic]);

  const deviceId = useMemo(() => getDeviceId(), []);
  const alreadySubmitted = useMemo(() => {
    if (typeof window === "undefined") return false;
    const today = todayKey();
    return loadRecords().some(
      (r) => r.deviceId === deviceId && r.dayKey === today &&
        (!settings.courseCode || r.courseCode.toLowerCase() === settings.courseCode.toLowerCase()),
    );
  }, [deviceId, settings.courseCode, done]);

  const locationSet = settings.classLat != null && settings.classLng != null;
  const windowOpen = isWindowOpen(settings, now);
  const minsLeft = minutesRemaining(settings, now);

  const update = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!locationSet) return toast.error("Lecturer hasn't set the class location yet.");
    if (!windowOpen) return toast.error("Attendance form is locked. Ask the lecturer to reopen.");
    if (alreadySubmitted) return toast.error("This device has already submitted today.");

    for (const [k, v] of Object.entries(form)) {
      if (!v) return toast.error(`Please fill ${k.replace(/([A-Z])/g, " $1").toLowerCase()}.`);
    }

    setSubmitting(true);
    try {
      const pos = await getCurrentPosition();
      const dist = distanceMeters(pos, { lat: settings.classLat!, lng: settings.classLng! });
      if (dist > settings.radiusMeters) {
        toast.error(`You're ${formatDistance(dist)} away. You must be within ${settings.radiusMeters}m of class.`);
        setSubmitting(false);
        return;
      }
      addRecord({
        id: crypto.randomUUID(),
        fullName: form.fullName.trim(),
        matricNumber: form.matricNumber.trim().toUpperCase(),
        department: form.department.trim(),
        phone: form.phone.trim(),
        courseCode: form.courseCode.trim().toUpperCase(),
        topic: form.topic.trim(),
        gender: form.gender as Gender,
        submittedAt: new Date().toISOString(),
        dayKey: todayKey(),
        deviceId,
        distanceMeters: Math.round(dist),
        lat: pos.lat,
        lng: pos.lng,
      });
      setDone(true);
      toast.success("Attendance recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read GPS.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-hero">
        <div className="mx-auto max-w-md px-6 py-20 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-3xl font-bold">You're checked in</h1>
          <p className="mt-2 text-muted-foreground">Your attendance was verified by GPS and logged for today.</p>
          <Button asChild className="mt-8" variant="outline"><Link to="/">Back to home</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-6 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> GPS required
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-16">
        <h1 className="text-3xl font-bold tracking-tight">Sign today's attendance</h1>
        <p className="mt-2 text-muted-foreground">
          We'll check your location against the lecturer's classroom pin.
        </p>

        {/* Status banner */}
        <div className="mt-6 rounded-2xl border bg-card p-4 shadow-soft">
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
              This device has already submitted attendance today.
            </Banner>
          ) : (
            <Banner tone="ok" title="Form open">
              {minsLeft === Infinity ? "No time limit set." : `Closes in about ${minsLeft} min · within ${settings.radiusMeters}m of class.`}
            </Banner>
          )}
        </div>

        <form onSubmit={onSubmit} className="mt-6 grid gap-4 rounded-2xl border bg-card p-6 shadow-soft sm:grid-cols-2">
          <Field label="Full name" className="sm:col-span-2">
            <Input value={form.fullName} onChange={(e) => update("fullName", e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Matric number">
            <Input value={form.matricNumber} onChange={(e) => update("matricNumber", e.target.value)} placeholder="CSC/2021/001" />
          </Field>
          <Field label="Department">
            <Input value={form.department} onChange={(e) => update("department", e.target.value)} placeholder="Computer Science" />
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

          <div className="sm:col-span-2">
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={submitting || !locationSet || !windowOpen || alreadySubmitted}
            >
              {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking location…</>) : (<><MapPin className="mr-2 h-4 w-4" /> Verify & submit</>)}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              By submitting, you allow Attendly to read your GPS once to confirm you're in class.
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
  const okStyle = { backgroundColor: "color-mix(in oklab, var(--color-primary) 12%, transparent)", color: "var(--color-foreground)" };
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
