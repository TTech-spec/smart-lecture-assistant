import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FaceScan, type FaceScanResult } from "@/components/FaceScan";
import { preloadFaceModels } from "@/lib/face";
import { APP_VERSION } from "@/lib/version";
import {
  getDeviceId, getRegisteredMatric, loadSettings, registerStudent, RegisterError, type Gender,
} from "@/lib/attendance-store";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Register — Attendly" },
      { name: "description", content: "Create your student profile once; afterwards check-in takes seconds." },
    ],
  }),
  component: RegisterPage,
});

type Form = { fullName: string; matricNumber: string; department: string; level: string; phone: string; gender: Gender | "" };
const empty: Form = { fullName: "", matricNumber: "", department: "", level: "", phone: "", gender: "" };

function RegisterPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState("");
  const [failure, setFailure] = useState<RegisterError | null>(null);
  const settings = useMemo(() => loadSettings(), []);
  const deviceId = useMemo(() => getDeviceId(), []);
  const already = useMemo(() => getRegisteredMatric(), []);
  const departments = settings.departments || [];

  // Download and warm up the face scanner while the student types their details
  useEffect(() => { preloadFaceModels(); }, []);

  const update = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function next(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return toast.error("Enter your full name.");
    if (!form.matricNumber.trim()) return toast.error("Enter your matric number.");
    if (!form.department.trim()) return toast.error("Enter your department.");
    if (!form.level) return toast.error("Select your level.");
    if (!form.phone.trim()) return toast.error("Enter your phone number.");
    if (!form.gender) return toast.error("Select your gender.");
    setStep(2);
  }

  const onFace = useCallback(async (r: FaceScanResult) => {
    setSaving(true);
    try {
      await registerStudent({
        fullName: form.fullName.trim(),
        matricNumber: form.matricNumber.trim().toUpperCase(),
        department: form.department.trim(),
        level: form.level,
        phone: form.phone.trim(),
        gender: form.gender as Gender,
        deviceId,
        descriptor: r.descriptor,
        photo: r.photo,
      });
      setSavedName(form.fullName.trim().split(" ")[0]);
      setStep(3);
    } catch (err) {
      if (err instanceof RegisterError) setFailure(err);
      else toast.error(err instanceof Error ? err.message : "Could not save your registration.");
      setStep(1);
    } finally {
      setSaving(false);
    }
  }, [form, deviceId]);

  if (failure) {
    const v = describeFailure(failure);
    return (
      <Shell step={1}>
        <h1 className="font-display text-[28px] font-bold leading-8 tracking-tight">{v.title}</h1>
        <p className="mt-3 text-base leading-6 text-muted-foreground">{v.body}</p>
        <div className="flex-grow" />
        <Button className="h-[52px] w-full rounded-full bg-foreground text-base font-semibold text-background hover:bg-foreground/85" onClick={() => setFailure(null)}>{v.action}</Button>
        <Button asChild variant="ghost" className="mt-2 h-12 w-full rounded-full text-base"><Link to="/">Back to home</Link></Button>
      </Shell>
    );
  }

  if (step === 3) {
    return (
      <Shell step={3}>
        <div className="mt-6 flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <h1 className="mt-5 font-display text-[28px] font-bold leading-8 tracking-tight">You're registered{savedName ? `, ${savedName}` : ""}</h1>
          <p className="mt-2 text-base leading-6 text-muted-foreground">
            Your face is linked to <strong className="text-foreground">{form.matricNumber.trim().toUpperCase()}</strong> on this phone.
            From now on, check-in takes about 20 seconds.
          </p>
        </div>
        <div className="mt-6 space-y-3 rounded-2xl bg-accent/60 p-5 text-[15px] leading-6 text-muted-foreground">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground">How check-in works from now</p>
          <p><span className="mr-2 font-bold text-primary">1</span>Open the link your lecturer shares or scan the QR on the projector.</p>
          <p><span className="mr-2 font-bold text-primary">2</span>Type your matric number and the class code on the projector.</p>
          <p><span className="mr-2 font-bold text-primary">3</span>Take a quick selfie — it's matched to today's face scan.</p>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Changed phones? Register again and your lecturer will approve the reset.</p>
        <div className="flex-grow" />
        <Button asChild className="h-[52px] w-full rounded-full bg-foreground text-base font-semibold text-background hover:bg-foreground/85"><Link to="/">Done</Link></Button>
      </Shell>
    );
  }

  if (step === 2) {
    return (
      <Shell step={2} dark>
        <h1 className="font-display text-[28px] font-bold leading-8 tracking-tight text-white">Position your face in the oval</h1>
        <div className="mt-4">
          {saving ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving your profile…
            </div>
          ) : (
            <FaceScan onDone={onFace} />
          )}
        </div>
        <div className="flex-grow" />
        <Button variant="ghost" className="h-12 w-full rounded-full text-base text-gray-300 hover:bg-white/10 hover:text-white" onClick={() => setStep(1)}>Back</Button>
      </Shell>
    );
  }

  return (
    <Shell step={1}>
      <h1 className="font-display text-[28px] font-bold leading-8 tracking-tight">Create your student profile</h1>
      <p className="mt-2 text-base leading-6 text-muted-foreground">
        Do this once. After that, you check in with your matric number and the class code.
      </p>
      {already && (
        <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-[13px] leading-[18px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          This phone is already registered to <strong>{already}</strong>. Each phone can hold one student.
        </p>
      )}
      <form onSubmit={next} className="mt-6 flex flex-col gap-4">
        <Field label="Full name"><Input value={form.fullName} onChange={(e) => update("fullName", e.target.value)} placeholder="Jane Doe" className="h-12 rounded-xl text-base" /></Field>
        <Field label="Matric number"><Input value={form.matricNumber} onChange={(e) => update("matricNumber", e.target.value)} placeholder="CSC/2021/001" className="h-12 rounded-xl text-base" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department">
            {departments.length > 0 ? (
              <Select value={form.department} onValueChange={(v) => update("department", v)}>
                <SelectTrigger className="h-12 rounded-xl text-base"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={form.department} onChange={(e) => update("department", e.target.value)} placeholder="Computer Science" className="h-12 rounded-xl text-base" />
            )}
          </Field>
          <Field label="Level">
            <Select value={form.level} onValueChange={(v) => update("level", v)}>
              <SelectTrigger className="h-12 rounded-xl text-base"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{["100", "200", "300", "400", "500", "600"].map((l) => <SelectItem key={l} value={l}>{l} Level</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Phone number"><Input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="080…" className="h-12 rounded-xl text-base" /></Field>
        <Field label="Gender">
          <div className="grid grid-cols-3 gap-2">
            {(["male", "female", "other"] as Gender[]).map((g) => (
              <button
                key={g} type="button" onClick={() => update("gender", g)}
                className={`h-12 rounded-xl border text-base font-medium capitalize transition-colors ${
                  form.gender === g ? "border-primary bg-primary/10 text-primary border-2" : "border-border bg-card"}`}
              >
                {g}
              </button>
            ))}
          </div>
        </Field>
        <p className="flex gap-2 text-[13px] leading-[18px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Your face data is stored as numbers, not photos, and is used only to confirm it's you at check-in.
        </p>
        <Button type="submit" className="mt-2 h-[52px] w-full rounded-full bg-foreground text-base font-semibold text-background hover:bg-foreground/85">Continue to face scan <ArrowRight className="ml-1 h-4 w-4" /></Button>
        <p className="text-center text-[13px] leading-[18px] text-muted-foreground">
          Already registered? Open the attendance link your lecturer shared to check in.
        </p>
      </form>
    </Shell>
  );
}

function Shell({ step, dark, children }: { step: 1 | 2 | 3; dark?: boolean; children: React.ReactNode }) {
  const labels = ["Your details", "Face scan", "Done"];
  const steps = [
    { t: "Your details", d: "Name, matric number, department and level." },
    { t: "Face scan", d: "A short live scan. We keep numbers, not photos." },
    { t: "Check in anywhere in class", d: "Matric number, class code and a quick selfie." },
  ];
  return (
    <div className={`min-h-[100svh] ${dark ? "bg-[#121a2b] text-white" : "bg-background"}`}>
      <div className="mx-auto grid min-h-[100svh] max-w-6xl lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:p-6">
        <aside className="sticky top-6 hidden h-[calc(100svh-48px)] flex-col justify-between rounded-[32px] bg-primary p-10 text-primary-foreground lg:flex">
          <Link to="/" className="flex items-center gap-2.5 font-display text-xl font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-primary"><MapPin className="h-4 w-4" /></span>
            Attendly
          </Link>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] opacity-80">EKSU · One-time registration</p>
            <h2 className="mt-3 font-display text-5xl font-bold leading-[1.02] tracking-tight">Register once.<br />Sign in every class.</h2>
            <ol className="mt-8 space-y-4">
              {steps.map((s, i) => (
                <li key={s.t} className={`flex gap-4 ${i + 1 > step ? "opacity-60" : ""}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${i + 1 <= step ? "bg-foreground text-background" : "border border-current"}`}>{i + 1}</span>
                  <div><p className="text-base font-semibold">{s.t}</p><p className="text-sm opacity-80">{s.d}</p></div>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs opacity-70">Version {APP_VERSION}</p>
        </aside>
        <div className="mx-auto flex w-full max-w-md flex-col px-6 py-8 lg:py-10">
          <Link to="/" className={`inline-flex items-center gap-2 text-sm ${dark ? "text-gray-400 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}>
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <p className={`mt-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] ${dark ? "text-gray-400" : "text-muted-foreground"}`}>
            <span className="h-2 w-2 rounded-full bg-primary" /> Step {step} of 3 · {labels[step - 1]}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-[5px] rounded-full ${i <= step ? "bg-primary" : dark ? "bg-[#283349]" : "bg-border"}`} />
            ))}
          </div>
          <div className="mt-6 flex flex-grow flex-col">{children}</div>
          <p className={`mt-6 text-center text-[11px] lg:hidden ${dark ? "text-gray-500" : "text-muted-foreground/70"}`}>Version {APP_VERSION}</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function describeFailure(e: RegisterError) {
  switch (e.code) {
    case "matric_taken":
      return {
        title: "This matric number is already registered",
        body: "Someone has already registered a face for this matric number. If that was you on another phone, ask your lecturer to reset it. If it wasn't you, tell your lecturer right away.",
        action: "Go back",
      };
    case "device_taken":
      return {
        title: "This phone is already registered",
        body: "Each phone can hold only one student. If this phone belongs to you and the registration isn't yours, ask your lecturer to reset it.",
        action: "Go back",
      };
    case "face_exists":
      return {
        title: "This face is already registered",
        body: `Your face matches a student who is already registered${e.hint ? ` (${e.hint})` : ""}. One face can be linked to one matric number only.`,
        action: "Go back",
      };
    case "not_configured":
      return { title: "Registration isn't set up yet", body: e.message, action: "Back" };
    default:
      return { title: "Something went wrong", body: e.message || "Please try again.", action: "Try again" };
  }
}
