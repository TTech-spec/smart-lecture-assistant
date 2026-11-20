import { askConfirm } from "@/components/ConfirmHost";
import { createFileRoute } from "@tanstack/react-router";
import { friendlyError } from "@/lib/friendly-error";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileUp, Loader2, Pencil, RefreshCw, Search, Trash2, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteStudent, fetchStudents, importStudents, matricErrorText, setMatricNumbers,
  type ImportStudent, type MatricProblem, type StudentProfile,
} from "@/lib/attendance-store";
import {
  FIELDS, PHOTO_PROBLEM, cleanId, driveFileId, guessColumns, parseCsv, photoToFace, type FieldKey,
} from "@/lib/student-import";
import { fetchDrivePhoto } from "@/lib/drive-server";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/students")({
  head: () => ({ meta: [{ title: "Students — Attendly" }] }),
  component: StudentsPage,
});

type Filter = "all" | "no_matric" | "by_student";

function StudentsPage() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"import" | "matric" | null>(null);

  async function load() {
    setLoading(true);
    try {
      setStudents(await fetchStudents());
      setError(null);
    } catch (e) {
      const msg = friendlyError(e, "Could not load students.");
      setError(/does not exist|schema cache/i.test(msg) ? "Run students-migration.sql in Supabase to enable registration." : msg);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const noMatric = students.filter((s) => s.needsMatric);
  const byStudent = students.filter((s) => s.matricSource === "student");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = filter === "no_matric" ? noMatric : filter === "by_student" ? byStudent : students;
    return base.filter((st) => !s || st.fullName.toLowerCase().includes(s) || st.matricNumber.toLowerCase().includes(s)
      || (st.utmeRegNo ?? "").toLowerCase().includes(s) || st.department.toLowerCase().includes(s));
  }, [students, q, filter, noMatric, byStudent]);
  const resets = students.filter((s) => s.status === "reset_requested");

  async function reset(st: StudentProfile) {
    const imported = st.source === "imported";
    const ok = await askConfirm(imported
      ? `Remove ${st.fullName} from your list? Their attendance records are kept.`
      : `Remove ${st.fullName}'s registration (${st.matricNumber})? They will register again with a new face scan.`, { okText: "Remove" });
    if (!ok) return;
    try {
      await deleteStudent(st.matricNumber);
      setStudents((all) => all.filter((x) => x.matricNumber !== st.matricNumber));
      toast.success(imported ? "Student removed." : "Registration removed. The student can register again.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not remove."));
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Students</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {students.length} on your list
            {students.some((s) => s.utmeRegNo) && <> · {students.length - noMatric.length} have a matric number · {noMatric.length} still on UTME only</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-10" onClick={() => setPanel("import")}><Upload className="mr-2 h-4 w-4" /> Upload student list</Button>
          <Button className="h-10" onClick={() => setPanel("matric")}><FileUp className="mr-2 h-4 w-4" /> Upload matric numbers</Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {([["all", `All (${students.length})`], ["no_matric", `No matric yet (${noMatric.length})`], ["by_student", `Added by student (${byStudent.length})`]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={`h-9 rounded-full px-3.5 text-sm ${filter === k ? "bg-foreground font-semibold text-background" : "border bg-card"}`}>{label}</button>
        ))}
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, UTME or matric" className="h-10 w-full pl-9 sm:w-64" />
          </div>
          <Button variant="outline" size="sm" className="h-10 shrink-0" onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {resets.length > 0 && (
        <section className="mt-6">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Reset requested ({resets.length})</p>
          <div className="mt-2 divide-y rounded-xl border bg-card">
            {resets.map((st) => <Row key={st.matricNumber} st={st} onReset={reset} onChanged={load} label="Approve reset" />)}
          </div>
        </section>
      )}

      <section className="mt-4">
        {error ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{error}</p>
        ) : loading && students.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Users className="h-10 w-10 opacity-20" />
            <p className="font-medium">{students.length === 0 ? "No students yet" : "No matches"}</p>
            {students.length === 0 && <p className="max-w-md text-sm">Upload the list you collected (Google Form → Sheet → Download as CSV), or share <code className="rounded bg-secondary px-1">/register</code> with your class.</p>}
          </div>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {filtered.filter((s) => s.status !== "reset_requested").map((st) => <Row key={st.matricNumber} st={st} onReset={reset} onChanged={load} label="Remove" />)}
          </div>
        )}
      </section>

      {panel === "import" && <ImportPanel onClose={() => setPanel(null)} onDone={load} />}
      {panel === "matric" && <MatricPanel onClose={() => setPanel(null)} onDone={load} />}
    </main>
  );
}

function Tag({ st }: { st: StudentProfile }) {
  const [text, cls] = st.needsMatric
    ? ["UTME only", "bg-secondary text-muted-foreground"]
    : st.matricSource === "student" ? ["Matric added by student", "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"]
    : st.matricSource === "csv" ? ["Matric from department list", "bg-accent text-primary"]
    : st.matricSource === "lecturer" ? ["Matric added by you", "bg-accent text-primary"]
    : st.source === "imported" ? ["Imported", "bg-secondary text-muted-foreground"]
    : ["Registered in app", "bg-accent text-primary"];
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{text}</span>;
}

function Row({ st, onReset, onChanged, label }: { st: StudentProfile; onReset: (s: StudentProfile) => void; onChanged: () => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [matric, setMatric] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveMatric() {
    if (!st.utmeRegNo) return;
    setSaving(true);
    try {
      const r = await setMatricNumbers([{ utme: st.utmeRegNo, matric }], "lecturer");
      if (r.problems.length) toast.error(matricErrorText(r.problems[0].error));
      else { toast.success("Matric number saved. Both numbers now work at check-in."); setEditing(false); onChanged(); }
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't save it."));
    } finally { setSaving(false); }
  }

  const matricShown = st.needsMatric ? "—" : st.matricNumber;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        {st.photo ? <img src={st.photo} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <div className="h-11 w-11 shrink-0 rounded-full bg-secondary" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{st.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{st.department}{st.level ? ` · ${st.level} L` : ""}</p>
        </div>
        <div className="hidden min-w-[150px] text-xs md:block">
          {st.utmeRegNo && <p className="font-mono text-muted-foreground">UTME {st.utmeRegNo}</p>}
          <p className={`font-mono ${st.needsMatric ? "text-muted-foreground" : ""}`}>Matric {matricShown}</p>
        </div>
        <div className="hidden lg:block"><Tag st={st} /></div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Details">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onReset(st)}>
            <Trash2 className="h-3.5 w-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">{label}</span>
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 rounded-lg bg-secondary/50 p-3 text-sm sm:grid-cols-2">
          <Detail k="UTME reg number" v={st.utmeRegNo || "—"} mono />
          <Detail k="Matric number" v={matricShown} mono />
          <Detail k="WhatsApp" v={st.whatsapp || st.phone || "—"} />
          <Detail k="Hostel address" v={st.hostel || "—"} />
          <Detail k="Next of kin" v={st.nextOfKin || "—"} />
          <Detail k="Next of kin's number" v={st.nextOfKinPhone || "—"} />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2"><Tag st={st} />
            {!st.photo && <span className="text-xs text-amber-700 dark:text-amber-300">No face photo on file: check-ins can't be face-matched.</span>}
          </div>
          {st.utmeRegNo && st.needsMatric && (
            <div className="sm:col-span-2">
              {editing ? (
                <div className="flex flex-wrap gap-2">
                  <Input value={matric} onChange={(e) => setMatric(e.target.value)} placeholder="Matric number, e.g. CSC/2024/031" className="h-10 min-w-0 flex-1" aria-label="Matric number" />
                  <Button className="h-10" onClick={saveMatric} disabled={saving || matric.trim().length < 5}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
                  <Button variant="ghost" className="h-10" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Add matric number</Button>
              )}
            </div>
          )}
          <p className="sm:col-span-2 text-xs text-muted-foreground">Only lecturers can see these details.</p>
        </div>
      )}
    </div>
  );
}

function Detail({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{k}</p><p className={`break-words ${mono ? "font-mono" : ""}`}>{v}</p></div>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92svh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border bg-card p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

async function readCsvFile(f: File): Promise<string[][]> {
  if (!/\.csv$/i.test(f.name) && !/csv|text/i.test(f.type)) throw new Error("Choose a .csv file. In Google Sheets: File → Download → Comma-separated values (.csv).");
  const rows = parseCsv(await f.text());
  if (rows.length < 2) throw new Error("That file has no rows under the headings.");
  return rows;
}

type RowResult = { name: string; utme: string; problem: string | null };

function ImportPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [cols, setCols] = useState<Record<FieldKey, number> | null>(null);
  const [phase, setPhase] = useState<"pick" | "map" | "running" | "done">("pick");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<RowResult[]>([]);
  const [summary, setSummary] = useState<{ added: number; updated: number } | null>(null);
  const cancelled = useRef(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      const r = await readCsvFile(f);
      setRows(r); setCols(guessColumns(r[0])); setPhase("map");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't read that file."); }
  }

  const headers = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];
  const get = (r: string[], k: FieldKey) => (cols && cols[k] >= 0 ? (r[cols[k]] ?? "").trim() : "");
  const missing = cols ? FIELDS.filter((f) => f.required && cols[f.key] < 0).map((f) => f.label) : [];
  const usable = body.filter((r) => get(r, "fullName") && get(r, "utme"));

  async function run() {
    if (!cols) return;
    cancelled.current = false;
    setPhase("running");
    const { data: sess } = await supabase!.auth.getSession();
    const token = sess.session?.access_token ?? "";
    const out: ImportStudent[] = [];
    const res: RowResult[] = [];
    const seen = new Set<string>();
    setProgress({ done: 0, total: usable.length });
    let i = 0;
    const worker = async () => {
      while (i < usable.length && !cancelled.current) {
        const r = usable[i++];
        const utme = cleanId(get(r, "utme"));
        const name = get(r, "fullName");
        if (seen.has(utme)) { res.push({ name, utme, problem: "Same UTME number twice in the file (kept the first)" }); setProgress((p) => ({ ...p, done: p.done + 1 })); continue; }
        seen.add(utme);
        let descriptor: number[] = [], photo: string | null = null, problem: string | null = null;
        const link = get(r, "photo");
        const id = link ? driveFileId(link.split(/[,\s]+/)[0]) : null;
        if (!id) problem = PHOTO_PROBLEM.no_link;
        else {
          try {
            const d = await fetchDrivePhoto({ data: { accessToken: token, fileId: id } });
            if (!d.ok) problem = PHOTO_PROBLEM[d.reason];
            else {
              const bytes = Uint8Array.from(atob(d.base64), (c) => c.charCodeAt(0));
              const face = await photoToFace(bytes, d.contentType, d.name);
              descriptor = face.descriptor; photo = face.photo;
            }
          } catch (e) {
            problem = PHOTO_PROBLEM[e instanceof Error ? e.message : ""] ?? PHOTO_PROBLEM.error;
          }
        }
        out.push({
          fullName: name, utme, department: get(r, "department"), level: get(r, "level").replace(/\D/g, "").slice(0, 3),
          gender: /^f/i.test(get(r, "gender")) ? "female" : /^m/i.test(get(r, "gender")) ? "male" : "other",
          whatsapp: get(r, "whatsapp"), hostel: get(r, "hostel"), nextOfKin: get(r, "nextOfKin"), nextOfKinPhone: get(r, "nextOfKinPhone"),
          descriptor, photo,
        });
        res.push({ name, utme, problem });
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (cancelled.current) { setPhase("map"); return; }
    try {
      const s = await importStudents(out);
      // Matric numbers already in the file (optional column)
      const withMatric = usable.map((r) => ({ utme: cleanId(get(r, "utme")), matric: get(r, "matric") })).filter((x) => x.matric);
      if (withMatric.length) await setMatricNumbers(withMatric, "csv").catch(() => null);
      setSummary(s); setResults(res); setPhase("done"); onDone();
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't save the students."));
      setPhase("map");
    }
  }

  const problems = results.filter((r) => r.problem);
  return (
    <Sheet title="Upload student list" onClose={() => { cancelled.current = true; onClose(); }}>
      {phase === "pick" && (
        <div className="space-y-4 text-sm">
          <ol className="space-y-2.5">
            <li className="flex gap-3"><Num n={1} /> <span>Open the Google Sheet with the form answers, then <strong>File → Download → Comma-separated values (.csv)</strong>.</span></li>
            <li className="flex gap-3"><Num n={2} /> <span>In Google Drive, open the folder the form made for the photos (it ends in <em>“(File responses)”</em>). Share it as <strong>Anyone with the link · Viewer</strong>.</span></li>
            <li className="flex gap-3"><Num n={3} /> <span>Choose the CSV below. When the import is done, set the folder back to <strong>Restricted</strong>.</span></li>
          </ol>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Button className="h-12 w-full" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Choose CSV file</Button>
          <p className="text-xs text-muted-foreground">Photos can be JPG, PNG or PDF. Students already on your list are updated, not added twice (matched by UTME number).</p>
        </div>
      )}

      {phase === "map" && cols && (
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">{body.length} rows found. Check each field points at the right column.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs font-medium">{f.label}{f.required && " *"}</span>
                <select value={cols[f.key]} onChange={(e) => setCols({ ...cols, [f.key]: Number(e.target.value) })}
                  className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm">
                  <option value={-1}>— Not in the file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {usable[0] && (
            <div className="rounded-lg bg-secondary/60 p-3 text-xs">
              <p className="font-semibold">First student</p>
              <p className="mt-1">{get(usable[0], "fullName")} · {cleanId(get(usable[0], "utme"))} · {get(usable[0], "department") || "no department"}</p>
            </div>
          )}
          {missing.length > 0 && <p className="text-amber-700 dark:text-amber-300">Choose a column for: {missing.join(", ")}.</p>}
          <div className="flex gap-2">
            <Button variant="ghost" className="h-11" onClick={() => setPhase("pick")}>Back</Button>
            <Button className="h-11 flex-1" disabled={missing.length > 0 || usable.length === 0} onClick={run}>Import {usable.length} students</Button>
          </div>
        </div>
      )}

      {phase === "running" && (
        <div className="space-y-3 py-4 text-center text-sm">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="font-medium">Reading passport photos… {progress.done} of {progress.total}</p>
          <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          <p className="text-xs text-muted-foreground">Keep this page open. About 1–2 seconds per student.</p>
        </div>
      )}

      {phase === "done" && summary && (
        <div className="space-y-4 text-sm">
          <p className="rounded-lg bg-accent p-3 font-medium text-primary">
            {summary.added} added · {summary.updated} updated · {results.length - problems.length} photos OK
          </p>
          {problems.length > 0 && (
            <div>
              <p className="font-semibold">{problems.length} need attention</p>
              <p className="text-xs text-muted-foreground">They're on your list and can check in; their check-ins just can't be face-matched until this is fixed. Fix the photo and upload the list again, or ask them to register in the app.</p>
              <ul className="mt-2 max-h-64 divide-y overflow-y-auto rounded-lg border">
                {problems.map((p) => <li key={p.utme} className="px-3 py-2"><span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-muted-foreground">{p.utme}</span><br /><span className="text-xs text-amber-700 dark:text-amber-300">{p.problem}</span></li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Remember to set the Drive photo folder back to <strong>Restricted</strong>.</p>
          <Button className="h-11 w-full" onClick={onClose}>Done</Button>
        </div>
      )}
    </Sheet>
  );
}

function MatricPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pairs, setPairs] = useState<{ utme: string; matric: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ updated: number; problems: MatricProblem[] } | null>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      const rows = await readCsvFile(f);
      const g = guessColumns(rows[0]);
      if (g.utme < 0 || g.matric < 0) throw new Error("The file needs a UTME reg number column and a matric number column.");
      setPairs(rows.slice(1).map((r) => ({ utme: cleanId(r[g.utme] ?? ""), matric: (r[g.matric] ?? "").trim() })).filter((p) => p.utme && p.matric));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't read that file."); }
  }
  async function save() {
    if (!pairs) return;
    setBusy(true);
    try {
      let updated = 0; const problems: MatricProblem[] = [];
      for (let i = 0; i < pairs.length; i += 200) {
        const r = await setMatricNumbers(pairs.slice(i, i + 200), "csv");
        updated += r.updated; problems.push(...r.problems);
      }
      setResult({ updated, problems }); onDone();
    } catch (e) { toast.error(friendlyError(e, "Couldn't save the matric numbers.")); }
    finally { setBusy(false); }
  }

  return (
    <Sheet title="Upload matric numbers" onClose={onClose}>
      {!pairs && (
        <div className="space-y-4 text-sm">
          <p>Got the matric list from the department? Upload a CSV with a <strong>UTME reg number</strong> column and a <strong>Matric number</strong> column. Each student gets their matric number at once; their past attendance moves with them.</p>
          <pre className="rounded-lg bg-secondary p-3 text-xs">UTME reg number,Matric number{"\n"}202412345678AB,CSC/2024/031</pre>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Button className="h-12 w-full" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Choose CSV file</Button>
        </div>
      )}
      {pairs && !result && (
        <div className="space-y-4 text-sm">
          <p>{pairs.length} matric numbers found. First: <span className="font-mono">{pairs[0]?.utme} → {pairs[0]?.matric}</span></p>
          <div className="flex gap-2">
            <Button variant="ghost" className="h-11" onClick={() => setPairs(null)}>Back</Button>
            <Button className="h-11 flex-1" onClick={save} disabled={busy || pairs.length === 0}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Save ${pairs.length} matric numbers`}</Button>
          </div>
        </div>
      )}
      {result && (
        <div className="space-y-4 text-sm">
          <p className="rounded-lg bg-accent p-3 font-medium text-primary">{result.updated} students now have a matric number.</p>
          {result.problems.length > 0 && (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
              {result.problems.map((p, i) => <li key={i} className="px-3 py-2"><span className="font-mono text-xs">{p.utme} → {p.matric}</span><br /><span className="text-xs text-amber-700 dark:text-amber-300">{matricErrorText(p.error)}</span></li>)}
            </ul>
          )}
          <Button className="h-11 w-full" onClick={onClose}>Done</Button>
        </div>
      )}
    </Sheet>
  );
}

function Num({ n }: { n: number }) {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>;
}
