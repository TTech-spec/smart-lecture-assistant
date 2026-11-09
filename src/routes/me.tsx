import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, Clock, Loader2, Lock, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EditError, fetchMyAttendance, getRegisteredMatric, loadSettings, updateMyDetails,
  type MyAttendance, type MyCheckIn,
} from "@/lib/attendance-store";

export const Route = createFileRoute("/me")({
  head: () => ({
    meta: [
      { title: "My attendance — Attendly" },
      { name: "description", content: "See the check-ins you submitted from this phone and correct your name, matric number or department." },
    ],
  }),
  component: MyAttendancePage,
});

function MyAttendancePage() {
  const [matric, setMatric] = useState(() => (typeof window !== "undefined" ? getRegisteredMatric() ?? "" : ""));
  const [lookedUp, setLookedUp] = useState("");
  const [data, setData] = useState<MyAttendance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load(m: string) {
    if (!m.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMyAttendance(m));
      setLookedUp(m.trim().toUpperCase());
    } catch (e) {
      setError(e instanceof Error && e.message === "not_configured"
        ? "This page isn't set up yet. Ask your lecturer to run student-edits.sql."
        : "Couldn't load your check-ins. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (matric) load(matric); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const current = data?.records.find((r) => r.matricNumber.toUpperCase() === lookedUp) ?? data?.records[0];
  const name = data?.profile?.fullName ?? current?.fullName ?? "";
  const dept = data?.profile?.department ?? current?.department ?? "";
  const hasAnything = Boolean(data && (data.profile || data.records.length));

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <h1 className="mt-5 font-display text-2xl font-semibold">My attendance</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Check-ins submitted from this phone. You can correct your name, matric number and department.</p>

        <form
          onSubmit={(e) => { e.preventDefault(); load(matric); }}
          className="mt-5 flex gap-2"
        >
          <Input
            value={matric}
            onChange={(e) => setMatric(e.target.value)}
            placeholder="Your matric number"
            autoCapitalize="characters"
            className="h-11"
            aria-label="Matric number"
          />
          <Button type="submit" className="h-11 px-5" disabled={loading || !matric.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Show"}
          </Button>
        </form>

        {error && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{error}</p>}

        {data && !hasAnything && !loading && (
          <div className="mt-6 rounded-2xl bg-secondary/60 p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No check-ins found on this phone</p>
            <p className="mt-1">Only check-ins submitted from this phone show here. If you used another phone, open this page on that phone.</p>
          </div>
        )}

        {hasAnything && (
          <>
            <section className="mt-6 rounded-2xl border border-[rgba(27,36,57,0.08)] bg-card p-5">
              <div className="flex items-start gap-3">
                {data?.profile?.photo
                  ? <img src={data.profile.photo} alt="" className="h-14 w-14 rounded-full object-cover" />
                  : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-muted-foreground">{name.slice(0, 2).toUpperCase()}</span>}
                <div className="min-w-0 flex-grow">
                  <p className="truncate text-lg font-semibold">{name}</p>
                  <p className="font-mono text-sm text-muted-foreground">{lookedUp}</p>
                  <p className="text-sm text-muted-foreground">{dept}{data?.profile?.level ? ` · ${data.profile.level} Level` : ""}</p>
                </div>
                {!editing && (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                )}
              </div>

              {editing && (
                <EditForm
                  matric={lookedUp}
                  name={name}
                  department={dept}
                  onCancel={() => setEditing(false)}
                  onSaved={(newMatric) => { setEditing(false); setMatric(newMatric); load(newMatric); }}
                />
              )}

              <div className="mt-4 flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Your live photo, location, check-in time and face scan can't be changed.</span>
              </div>
            </section>

            <h2 className="mt-7 text-sm font-semibold text-muted-foreground">Your check-ins</h2>
            <div className="mt-2 flex flex-col gap-2.5">
              {data!.records.map((r) => <CheckInRow key={r.id} r={r} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CheckInRow({ r }: { r: MyCheckIn }) {
  const flagged = /face_mismatch|no_face_check|different_phone|matric_changed/.test(r.flags) && r.reviewed !== "approved";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[rgba(27,36,57,0.08)] bg-card p-3.5">
      {r.photo
        ? <img src={r.photo} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
        : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Camera className="h-5 w-5" /></span>}
      <div className="min-w-0 flex-grow">
        <p className="font-medium">{r.courseCode}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(r.submittedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          {r.distanceMeters != null && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{r.distanceMeters} m</span>}
          {r.edited && <span>· edited</span>}
        </p>
      </div>
      {flagged
        ? <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Under review</span>
        : <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e7f8f1] px-2 py-0.5 text-xs font-semibold text-[#0b6b4f] dark:bg-emerald-900/30 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" />Present</span>}
    </div>
  );
}

function EditForm({ matric, name, department, onCancel, onSaved }: {
  matric: string; name: string; department: string; onCancel: () => void; onSaved: (newMatric: string) => void;
}) {
  const [form, setForm] = useState({ fullName: name, matric, department });
  const [saving, setSaving] = useState(false);
  const departments = loadSettings().departments || [];
  const matricChanged = form.matric.trim().toUpperCase() !== matric;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim() || !form.matric.trim() || !form.department.trim()) return toast.error("Fill in all three fields.");
    setSaving(true);
    try {
      const r = await updateMyDetails({
        matricNumber: matric,
        newMatricNumber: form.matric.trim().toUpperCase(),
        fullName: form.fullName.trim(),
        department: form.department.trim(),
      });
      toast.success(matricChanged ? "Saved. Your lecturer will see the matric change." : "Your details were updated.");
      onSaved(r.matricNumber);
    } catch (err) {
      const code = err instanceof EditError ? err.code : "unknown";
      toast.error({
        not_owner: "Only the phone you checked in with can edit these details.",
        matric_taken: "That matric number is already registered to another student.",
        matric_conflict: "That matric number is already marked present for the same class. Ask your lecturer if this is a mistake.",
        too_many_edits: "You've made several changes today. Try again tomorrow or ask your lecturer.",
        invalid: "Check that all three fields are filled in.",
        not_configured: err instanceof Error ? err.message : "Editing isn't set up yet.",
        unknown: "Couldn't save. Check your connection and try again.",
      }[code], { duration: 7000 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-5 flex flex-col gap-3 border-t border-[rgba(27,36,57,0.06)] pt-5">
      <div>
        <Label htmlFor="ed-name" className="text-sm">Full name</Label>
        <Input id="ed-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="mt-1 h-11" />
      </div>
      <div>
        <Label htmlFor="ed-matric" className="text-sm">Matric number</Label>
        <Input id="ed-matric" value={form.matric} onChange={(e) => setForm({ ...form, matric: e.target.value })} autoCapitalize="characters" className="mt-1 h-11" />
        {matricChanged && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Changing your matric number is shown to your lecturer for review.</p>}
      </div>
      <div>
        <Label htmlFor="ed-dept" className="text-sm">Department</Label>
        <Input id="ed-dept" list="ed-depts" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="mt-1 h-11" />
        <datalist id="ed-depts">{departments.map((d) => <option key={d} value={d} />)}</datalist>
      </div>
      <div className="mt-1 flex gap-2">
        <Button type="button" variant="ghost" className="h-11 flex-1" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" className="h-11 flex-[2]" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save changes
        </Button>
      </div>
    </form>
  );
}
