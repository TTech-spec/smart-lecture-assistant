import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteStudent, fetchStudents, type StudentProfile } from "@/lib/attendance-store";

export const Route = createFileRoute("/admin/students")({
  head: () => ({ meta: [{ title: "Registered students — Attendly" }] }),
  component: StudentsPage,
});

function StudentsPage() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setStudents(await fetchStudents());
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load students.";
      setError(/does not exist|schema cache/i.test(msg) ? "Run students-migration.sql in Supabase to enable registration." : msg);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return students.filter((st) => !s || st.fullName.toLowerCase().includes(s) || st.matricNumber.toLowerCase().includes(s));
  }, [students, q]);
  const resets = students.filter((s) => s.status === "reset_requested");

  async function reset(st: StudentProfile) {
    if (!confirm(`Remove ${st.fullName}'s registration (${st.matricNumber})? They will register again with a new face scan.`)) return;
    try {
      await deleteStudent(st.matricNumber);
      setStudents((all) => all.filter((x) => x.matricNumber !== st.matricNumber));
      toast.success("Registration removed. The student can register again.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove.");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Registered students</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {students.length} registered · students register once at <code className="rounded bg-secondary px-1">/register</code>
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or matric" className="h-10 w-56 pl-9" />
          </div>
          <Button variant="outline" size="sm" className="h-10" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {resets.length > 0 && (
        <section className="mt-6">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Reset requested ({resets.length})</p>
          <div className="mt-2 divide-y rounded-xl border bg-card">
            {resets.map((st) => <Row key={st.matricNumber} st={st} onReset={reset} label="Approve reset" />)}
          </div>
        </section>
      )}

      <section className="mt-6">
        {error ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{error}</p>
        ) : loading && students.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Users className="h-10 w-10 opacity-20" />
            <p className="font-medium">{students.length === 0 ? "No students registered yet" : "No matches"}</p>
            {students.length === 0 && <p className="text-sm">Share <code className="rounded bg-secondary px-1">{typeof window !== "undefined" ? `${window.location.origin}/register` : "/register"}</code> with your class.</p>}
          </div>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {filtered.filter((s) => s.status !== "reset_requested").map((st) => <Row key={st.matricNumber} st={st} onReset={reset} label="Reset" />)}
          </div>
        )}
      </section>
    </main>
  );
}

function Row({ st, onReset, label }: { st: StudentProfile; onReset: (s: StudentProfile) => void; label: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      {st.photo ? (
        <img src={st.photo} alt="" className="h-11 w-11 rounded-full object-cover" />
      ) : (
        <div className="h-11 w-11 rounded-full bg-secondary" />
      )}
      <div className="min-w-0 flex-grow">
        <p className="truncate font-medium">{st.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{st.matricNumber}</span> · {st.department}{st.level ? ` · ${st.level} L` : ""} · {st.phone}
        </p>
      </div>
      <span className="hidden text-xs text-muted-foreground sm:block">
        {st.createdAt ? new Date(st.createdAt).toLocaleDateString() : ""}
      </span>
      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onReset(st)}>
        <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {label}
      </Button>
    </div>
  );
}
