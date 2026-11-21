import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FaceScan, type FaceScanResult } from "@/components/FaceScan";
import { addMyFace, fetchStudentProfile, getDeviceId, type StudentProfile } from "@/lib/attendance-store";
import { preloadFaceModels } from "@/lib/face";

export const Route = createFileRoute("/face")({
  validateSearch: (s: Record<string, unknown>) => ({ id: typeof s.id === "string" ? s.id : "" }),
  head: () => ({ meta: [{ title: "Add your face — Attendly" }] }),
  component: AddFacePage,
});

/**
 * For students the lecturer already uploaded: no registration form, just
 * their number and a face scan, saved onto their existing record.
 */
function AddFacePage() {
  const { id: initial } = Route.useSearch();
  const deviceId = useMemo(() => getDeviceId(), []);
  const [id, setId] = useState(initial);
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [step, setStep] = useState<"number" | "scan" | "saving" | "done">("number");
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (id.trim().length < 5) return setError("Enter your matric number or UTME reg number.");
    setFinding(true);
    const p = await fetchStudentProfile(id).catch(() => null);
    setFinding(false);
    if (!p) return setError("We can't find that number on your lecturer's list. Check it, or register instead.");
    if (p.hasFace) return setError("Your face is already on file, so you're all set. Just check in.");
    preloadFaceModels();
    setStudent(p);
  }

  const onFace = useCallback(async (r: FaceScanResult) => {
    if (!student) return;
    setStep("saving");
    try {
      await addMyFace(student.matricNumber, deviceId, r.descriptor, r.photo);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save your face. Try again.");
      setStep("number");
    }
  }, [student, deviceId]);

  return (
    <div className="min-h-[100svh] bg-background">
      <main className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col px-5 pb-8 pt-5">
        <Link to="/" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Home</Link>

        {step === "done" ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground"><CheckCircle2 className="h-10 w-10" /></span>
            <h1 className="mt-5 text-[28px] font-bold leading-8">Face added{student ? `, ${student.fullName.split(" ")[0]}` : ""}</h1>
            <p className="mt-2 text-base text-muted-foreground">Your check-ins will now be matched to your face. Nothing else to do.</p>
            <Button asChild className="mt-8 h-[52px] w-full rounded-full text-base"><Link to="/">Done</Link></Button>
          </div>
        ) : student && step !== "number" ? (
          <div className="mt-6">
            <h1 className="text-[26px] font-bold leading-8">Scan your face</h1>
            <p className="mt-1 text-sm text-muted-foreground">Hold still, then turn your head a little.</p>
            <div className="mt-4">
              {step === "saving" ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</div> : <FaceScan onDone={onFace} />}
            </div>
          </div>
        ) : student ? (
          <div className="mt-8">
            <h1 className="text-[26px] font-bold leading-8">Is this you?</h1>
            <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-lg font-semibold">{student.fullName}</p>
              <p className="text-sm text-muted-foreground">{student.department || "—"}{student.level ? ` · ${student.level} Level` : ""}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{student.matricNumber}</p>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Your details are already on your lecturer's list. You only need to add your face, on the phone you'll check in with.</p>
            {error && <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-400">{error}</p>}
            <Button className="mt-6 h-[52px] w-full rounded-full text-base" onClick={() => { setError(null); setStep("scan"); }}>Yes, scan my face</Button>
            <Button variant="ghost" className="mt-2 h-12 w-full rounded-full" onClick={() => { setStudent(null); setError(null); }}>That's not me</Button>
          </div>
        ) : (
          <form onSubmit={find} className="mt-8">
            <h1 className="text-[26px] font-bold leading-8">Add your face</h1>
            <p className="mt-1 text-sm text-muted-foreground">Already on your lecturer's list? No need to register. Just add your face.</p>
            <label htmlFor="face-id" className="mt-6 block text-sm font-medium">Matric number or UTME reg number</label>
            <Input id="face-id" value={id} onChange={(e) => { setId(e.target.value); setError(null); }} autoCapitalize="characters" className="mt-1 h-12 text-base" />
            {error && <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-400">{error}</p>}
            <Button type="submit" className="mt-6 h-[52px] w-full rounded-full text-base" disabled={finding}>{finding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}</Button>
            <p className="mt-6 text-center text-sm text-muted-foreground">Not on the list? <Link to="/register" className="font-medium text-primary">Register instead</Link></p>
          </form>
        )}
      </main>
    </div>
  );
}
