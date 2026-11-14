import { createFileRoute } from "@tanstack/react-router";
import { friendlyError } from "@/lib/friendly-error";
import { useMemo, useState, useEffect } from "react";
import {
  RefreshCw, Trash2, Download, FileText, ClipboardList,
  Plus, Pencil, X, CheckCircle2, XCircle, Link2, KeyRound, Search, SlidersHorizontal, Sparkles, MapPin, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  saveRecords, addRecord, syncRecord, watchRecords, loadOlderRecords, loadAllRecordsEver, getRecordsLoadedSince, loadRecords, RECORD_WINDOW_DAYS, deleteRecordById, clearAllRecords,
  loadTestSubmissions, loadSettings, saveTestSubmissions, syncTestSubmission,
  type AttendanceRecord, type AttendanceLink, type Gender,
  type TestSubmission, type TestType, type TestConfig, type TheoryAnswer,
  isTheory, questionMarks, unmarkedTheory,
} from "@/lib/attendance-store";
import { markTheoryAnswer } from "@/lib/ai-server";
import { useStore } from "@/hooks/use-store";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import { AskAiChat, type AiRow } from "@/components/AskAiChat";
import { checkStatus } from "@/components/admin/ui";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/records")({
  head: () => ({ meta: [{ title: "Attendance records — Attendly" }] }),
  component: RecordsPage,
});

const TEST_TYPES: TestType[] = ["C1", "C2", "C3"];
type TestResultsByType = Partial<Record<TestType, TestSubmission>>;

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(
  records: AttendanceRecord[],
  testResultMap: Map<string, TestResultsByType>,
  linkMap: Map<string, string>,
) {
  const headers = [
    "Full Name", "Matric Number", "Department", "Level", "Course Code", "Topic",
    "Gender", "Phone", "Class Code", "Link Used", "Session ID", "Submitted At", "Day",
    "C1 Score", "C1 Total", "C1 Cheated",
    "C2 Score", "C2 Total", "C2 Cheated",
    "C3 Score", "C3 Total", "C3 Cheated",
  ];
  const rows = records.map((r) => {
    const byType = testResultMap.get(r.matricNumber.toLowerCase()) ?? {};
    const typeCols = TEST_TYPES.flatMap((t) => {
      const res = byType[t];
      return [
        res ? String(res.score) : "",
        res ? String(res.total) : "",
        res ? (res.cheated ? "Yes" : "No") : "",
      ];
    });
    return [
      r.fullName, r.matricNumber, r.department, r.level || "",
      r.courseCode, r.topic, r.gender, r.phone,
      r.assignedClassCode || "—",
      r.linkId ? (linkMap.get(r.linkId) ?? r.linkId) : "—",
      r.sessionId || "", new Date(r.submittedAt).toLocaleString(), r.dayKey,
      ...typeCols,
    ];
  });
  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${records.length} record${records.length !== 1 ? "s" : ""} to CSV`);
}

// ── JSON export ───────────────────────────────────────────────────────────────
function exportJSON(
  records: AttendanceRecord[],
  testResultMap: Map<string, TestResultsByType>,
) {
  const enriched = records.map((r) => ({
    ...r,
    testResults: testResultMap.get(r.matricNumber.toLowerCase()) ?? {},
  }));
  const blob = new Blob([JSON.stringify(enriched, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${records.length} record${records.length !== 1 ? "s" : ""} to JSON`);
}

// ── PDF export ────────────────────────────────────────────────────────────────
async function exportPDF(
  records: AttendanceRecord[],
  testResultMap: Map<string, TestResultsByType>,
  linkMap: Map<string, string>,
) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const dateStr = new Date().toLocaleDateString();

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Attendance Records", 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(`Generated: ${dateStr}  ·  ${records.length} record${records.length !== 1 ? "s" : ""}`, 14, 22);
  doc.setTextColor(0);

  const head = [["#", "Name", "Matric", "Dept", "Level", "Course", "Gender", "Phone", "Class Code", "Link Used", "C1", "C2", "C3", "Time"]];

  const body = records.map((r, i) => {
    const byType = testResultMap.get(r.matricNumber.toLowerCase()) ?? {};
    const fmtTest = (t: TestType) => {
      const res = byType[t];
      if (!res) return "—";
      if (res.cheated) return "Cheat";
      return `${res.score}/${res.total}`;
    };
    return [
      String(i + 1), r.fullName, r.matricNumber, r.department,
      r.level ? `${r.level}L` : "—", r.courseCode,
      r.gender.charAt(0).toUpperCase(), r.phone || "—",
      r.assignedClassCode || "—",
      r.linkId ? (linkMap.get(r.linkId) ?? "—") : "—",
      fmtTest("C1"), fmtTest("C2"), fmtTest("C3"),
      new Date(r.submittedAt).toLocaleString(),
    ];
  });

  autoTable(doc, {
    head, body, startY: 27,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 245, 255] },
    columnStyles: {
      0: { cellWidth: 8 },  1: { cellWidth: 32 }, 2: { cellWidth: 26 },
      3: { cellWidth: 26 }, 4: { cellWidth: 12 }, 5: { cellWidth: 18 },
      6: { cellWidth: 12 }, 7: { cellWidth: 22 }, 8: { cellWidth: 18 },
      9: { cellWidth: 24 }, 10: { cellWidth: 12 }, 11: { cellWidth: 12 },
      12: { cellWidth: 12 }, 13: { cellWidth: 34 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && [10, 11, 12].includes(data.column.index) && data.cell.raw === "Cheat") {
        data.cell.styles.textColor = [220, 38, 38];
        data.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: (data) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(`Page ${data.pageNumber} of ${pageCount}`, data.settings.margin.left, doc.internal.pageSize.getHeight() - 5);
    },
  });

  doc.save(`attendance-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success(`Exported ${records.length} record${records.length !== 1 ? "s" : ""} to PDF`);
}

type RecordDraft = {
  fullName: string; matricNumber: string; department: string; phone: string;
  courseCode: string; topic: string; level: string; gender: Gender | "";
};

const emptyDraft: RecordDraft = {
  fullName: "", matricNumber: "", department: "", phone: "",
  courseCode: "", topic: "", level: "", gender: "",
};

function recordToDraft(r: AttendanceRecord): RecordDraft {
  return {
    fullName: r.fullName, matricNumber: r.matricNumber, department: r.department,
    phone: r.phone, courseCode: r.courseCode, topic: r.topic,
    level: r.level || "", gender: r.gender,
  };
}

// ── Add / Edit record modal ───────────────────────────────────────────────────
function RecordModal({ mode, initial, onSave, onClose }: {
  mode: "add" | "edit"; initial: RecordDraft;
  onSave: (d: RecordDraft) => void; onClose: () => void;
}) {
  const [d, setD] = useState<RecordDraft>(initial);
  const u = <K extends keyof RecordDraft>(k: K, v: RecordDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  function save(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!d.fullName.trim())    return toast.error("Full name is required.");
    if (!d.matricNumber.trim()) return toast.error("Matric number is required.");
    if (!d.department.trim())  return toast.error("Department is required.");
    if (!d.courseCode.trim())  return toast.error("Course code is required.");
    if (!d.gender)             return toast.error("Gender is required.");
    onSave(d);
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.93, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 12 }} transition={{ duration: 0.22, ease: "circOut" }}
        className="relative w-full max-w-lg rounded-2xl border bg-card p-6 shadow-soft max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <X className="h-4 w-4" />
        </button>
        <h2 className="mb-5 text-lg font-semibold">{mode === "add" ? "Add attendance record" : "Edit record"}</h2>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-sm">Full name *</Label>
            <Input className="mt-1" value={d.fullName} onChange={(e) => u("fullName", e.target.value)} placeholder="e.g. Amaka Okafor" autoFocus />
          </div>
          <div>
            <Label className="text-sm">Matric number *</Label>
            <Input className="mt-1" value={d.matricNumber} onChange={(e) => u("matricNumber", e.target.value)} placeholder="CSC/2021/001" />
          </div>
          <div>
            <Label className="text-sm">Department *</Label>
            <Input className="mt-1" value={d.department} onChange={(e) => u("department", e.target.value)} placeholder="Computer Science" />
          </div>
          <div>
            <Label className="text-sm">Phone</Label>
            <Input className="mt-1" type="tel" value={d.phone} onChange={(e) => u("phone", e.target.value)} placeholder="080..." />
          </div>
          <div>
            <Label className="text-sm">Level</Label>
            <Select value={d.level} onValueChange={(v) => u("level", v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select level" /></SelectTrigger>
              <SelectContent>
                {["100","200","300","400","500","600"].map((l) => <SelectItem key={l} value={l}>{l} Level</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Course code *</Label>
            <Input className="mt-1" value={d.courseCode} onChange={(e) => u("courseCode", e.target.value.toUpperCase())} placeholder="CSC 401" />
          </div>
          <div>
            <Label className="text-sm">Topic</Label>
            <Input className="mt-1" value={d.topic} onChange={(e) => u("topic", e.target.value)} placeholder="Distributed Systems" />
          </div>
          <div>
            <Label className="text-sm">Gender *</Label>
            <Select value={d.gender} onValueChange={(v) => u("gender", v as Gender)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex gap-2 pt-2">
            <Button type="submit" className="flex-1">
              {mode === "add" ? <><Plus className="mr-2 h-4 w-4" /> Add record</> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Save changes</>}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Test result edit modal ────────────────────────────────────────────────────
function TestResultModal({ submission, test, onSave, onClose }: {
  submission: TestSubmission;
  test?: TestConfig;
  onSave: (updated: TestSubmission) => void;
  onClose: () => void;
}) {
  const [score, setScore] = useState(String(submission.score));
  const [total, setTotal] = useState(String(submission.total));
  const [cheated, setCheated] = useState(submission.cheated);
  const [theory, setTheory] = useState<Record<string, TheoryAnswer>>(submission.theory ?? {});
  const theoryQs = test ? test.questions.map((q, i) => ({ q, i })).filter(({ q }) => isTheory(q)) : [];
  const hasTheory = theoryQs.length > 0;
  // Objective part is recomputed from the answers; theory part is the lecturer's marks
  const objectiveScore = test ? test.questions.reduce((a, q, i) => a + (!isTheory(q) && submission.answers[i] === q.correctIndex ? 1 : 0), 0) : 0;
  const theoryScore = Object.values(theory).reduce((a, t) => a + (t.marks ?? 0), 0);

  function setMark(i: number, patch: Partial<TheoryAnswer>) {
    setTheory((t) => ({ ...t, [i]: { ...(t[i] ?? { text: "", typingMs: 0, keystrokes: 0, bigInserts: 0, pasteAttempts: 0 }), ...patch } }));
  }

  function save(e: { preventDefault(): void }) {
    e.preventDefault();
    if (hasTheory && test) {
      const tot = test.questions.reduce((a, q) => a + questionMarks(q), 0);
      onSave({ ...submission, theory, score: objectiveScore + theoryScore, total: tot, cheated });
      return;
    }
    const s = parseInt(score, 10); const t = parseInt(total, 10);
    if (isNaN(s) || s < 0) return toast.error("Score must be 0 or more.");
    if (isNaN(t) || t < 1) return toast.error("Total must be at least 1.");
    if (s > t) return toast.error("Score cannot exceed total.");
    onSave({ ...submission, score: s, total: t, cheated });
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.93, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 12 }} transition={{ duration: 0.22, ease: "circOut" }}
        className={`relative max-h-[90svh] w-full overflow-y-auto rounded-2xl border bg-card p-6 shadow-soft ${hasTheory ? "max-w-2xl" : "max-w-sm"}`}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <X className="h-4 w-4" />
        </button>
        <h2 className="mb-1 text-lg font-semibold">Edit test result</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          {submission.studentName} · {submission.matricNumber}
          {submission.level && <> · {submission.level} Level</>}
        </p>
        <form onSubmit={save} className="space-y-4">
          {submission.integrity && (submission.integrity.focusLost + submission.integrity.splitScreen + submission.integrity.copyAttempts > 0) && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              During the test: left the page {submission.integrity.focusLost}× · split screen or pop-up {submission.integrity.splitScreen}× · tried to copy {submission.integrity.copyAttempts}×
            </p>
          )}
          {hasTheory ? (
            <>
              <p className="rounded-xl bg-secondary p-3 text-sm">
                Multiple choice: <strong>{objectiveScore}</strong> · Theory: <strong>{theoryScore}</strong> ·
                Total <strong>{objectiveScore + theoryScore}/{test!.questions.reduce((a, q) => a + questionMarks(q), 0)}</strong>
              </p>
              {theoryQs.map(({ q, i }) => (
                <TheoryMarker key={q.id} index={i} question={q.text} guide={q.modelAnswer ?? ""} max={questionMarks(q)}
                  answer={theory[i]} onChange={(patch) => setMark(i, patch)} />
              ))}
            </>
          ) : (
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-sm">Score</Label><Input className="mt-1" type="number" min={0} value={score} onChange={(e) => setScore(e.target.value)} autoFocus /></div>
            <div><Label className="text-sm">Total questions</Label><Input className="mt-1" type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} /></div>
          </div>
          )}
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border bg-secondary p-3">
            <input type="checkbox" checked={cheated} onChange={(e) => setCheated(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
            <div>
              <p className="text-sm font-medium">Flagged for cheating</p>
              <p className="text-xs text-muted-foreground">Check if this student was caught switching tabs</p>
            </div>
          </label>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1"><CheckCircle2 className="mr-2 h-4 w-4" /> Save result</Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── One theory answer: typing record, AI suggestion, lecturer's mark ─────────
function TheoryMarker({ index, question, guide, max, answer, onChange }: {
  index: number; question: string; guide: string; max: number;
  answer?: TheoryAnswer; onChange: (patch: Partial<TheoryAnswer>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const a = answer ?? { text: "", typingMs: 0, keystrokes: 0, bigInserts: 0, pasteAttempts: 0 };
  const secs = Math.round(a.typingMs / 1000);
  const cps = secs > 0 ? a.text.length / secs : a.text.length > 0 ? Infinity : 0;
  // Typed by hand on a phone: ~1–4 characters a second, roughly one key per character
  const suspicious = a.text.length > 0 && (a.bigInserts > 0 || a.pasteAttempts > 0 || cps > 6 || a.keystrokes < a.text.length * 0.5);
  const tone = { low: "bg-[#12b886]/12 text-[#0b7a59] dark:text-[#5fe3b0]", medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" };

  async function askAi() {
    setBusy(true);
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) { toast.error("Sign in again to use AI marking."); return; }
      const r = await markTheoryAnswer({ data: { accessToken: token, question, guide, marks: max, answer: a.text,
        typingSeconds: secs, keystrokes: a.keystrokes, bigInserts: a.bigInserts, pasteAttempts: a.pasteAttempts } });
      if (!r.ok) { toast.error(r.message); return; }
      onChange({ ai: { suggested: r.suggested, aiLikely: r.aiLikely, note: r.note }, ...(a.marks == null ? { marks: r.suggested } : {}) });
    } catch {
      toast.error("AI marking failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <p className="text-sm font-medium"><span className="text-muted-foreground">Q{index + 1}.</span> {question} <span className="text-xs text-muted-foreground">({max} marks)</span></p>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-2.5 text-sm">{a.text || <span className="italic text-muted-foreground">No answer</span>}</p>
      {a.text && (
        <p className={`text-xs ${suspicious ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
          Typed in {secs}s · {a.keystrokes} keys for {a.text.length} characters
          {a.bigInserts > 0 && ` · ${a.bigInserts} big block${a.bigInserts > 1 ? "s" : ""} appeared at once`}
          {a.pasteAttempts > 0 && ` · tried to paste ${a.pasteAttempts}×`}
          {suspicious && " · may not be typed by the student"}
        </p>
      )}
      {a.ai && (
        <div className="space-y-1 rounded-lg border bg-card p-2.5 text-xs">
          <p><span className={`rounded-full px-2 py-0.5 font-semibold ${tone[a.ai.aiLikely]}`}>AI-written: {a.ai.aiLikely}</span> <span className="ml-1 text-muted-foreground">Suggested mark {a.ai.suggested}/{max}</span></p>
          <p className="text-muted-foreground">{a.ai.note}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs">Mark</Label>
        <Input type="number" min={0} max={max} value={a.marks ?? ""} placeholder="—" className="h-9 w-20"
          onChange={(e) => { const v = e.target.value === "" ? null : Math.max(0, Math.min(max, parseInt(e.target.value, 10) || 0)); onChange({ marks: v }); }} />
        <span className="text-xs text-muted-foreground">/ {max}</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={askAi} disabled={busy || !a.text}>
          {busy ? "Checking…" : a.ai ? "Ask AI again" : "Suggest mark + AI check"}
        </Button>
      </div>
    </div>
  );
}

// ── Main records page ─────────────────────────────────────────────────────────
function RecordsPage() {
  const { records, testSubmissions: storeSubmissions, settings, links, tests } = useStore();
  // Also keep a local copy that we refresh directly from Supabase on mount
  const [localSubmissions, setLocalSubmissions] = useState<TestSubmission[]>(() => loadTestSubmissions());
  const [matric, setMatric] = useState("");
  const [dept, setDept] = useState("all");
  const [gender, setGender] = useState("all");
  const [level, setLevel] = useState("all");
  const [course, setCourse] = useState("all");
  const [linkFilter, setLinkFilter] = useState("all");
  const [classCodeFilter, setClassCodeFilter] = useState("all");
  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editingTestResult, setEditingTestResult] = useState<TestSubmission | null>(null);

  // Phones: the assistant and the extra filters fold away until asked for
  const [showAi, setShowAi] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "review" | "other">("all");
  // Only today's check-ins by default; older ones when the lecturer asks to check them
  const [showOlder, setShowOlder] = useState(false);
  const todayLocal = new Date().toDateString();
  const isToday = (r: AttendanceRecord) => new Date(r.submittedAt).toDateString() === todayLocal;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Records load the last 60 days first; older ones on request
  const [loadedSince, setLoadedSince] = useState<string | null>(() => getRecordsLoadedSince() ?? new Date(Date.now() - RECORD_WINDOW_DAYS * 86_400_000).toISOString());
  const [loadingOlder, setLoadingOlder] = useState(false);
  async function loadOlder() {
    setLoadingOlder(true);
    const r = await loadOlderRecords();
    setLoadingOlder(false);
    if (!r) { toast.error("We couldn't reach the server. Check your connection and try again."); return; }
    setLoadedSince(r.since);
    toast.success(r.added ? `Loaded ${r.added} older check-in${r.added > 1 ? "s" : ""}.` : `No check-ins between those dates.`);
  }
  async function exportEverything() {
    const n = await loadAllRecordsEver();
    if (n == null) { toast.error("We couldn't reach the server. Check your connection and try again."); return; }
    setLoadedSince(null);
    exportCSV(loadRecords().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), testResultMap, linkMap);
  }

  // Live: new check-ins appear without refreshing, highlighted for a few seconds
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [lastSync, setLastSync] = useState<Date>(() => new Date());
  useEffect(() => {
    const stop = watchRecords((fresh) => {
      setFreshIds((cur) => new Set([...cur, ...fresh.map((r) => r.id)]));
      const names = fresh.map((r) => r.fullName).filter(Boolean);
      toast.success(names.length === 1 ? `${names[0]} just signed in${fresh[0].courseCode ? ` for ${fresh[0].courseCode}` : ""}.` : `${fresh.length} new check-ins.`);
      setTimeout(() => setFreshIds((cur) => { const n = new Set(cur); fresh.forEach((r) => n.delete(r.id)); return n; }), 8000);
    });
    const t = setInterval(() => setLastSync(new Date()), 10_000);
    return () => { stop(); clearInterval(t); };
  }, []);

  // Pull test submissions directly from Supabase on mount so we always have
  // the latest — even if the student submitted on a different device
  useEffect(() => {
    async function fetchSubmissions() {
      if (!supabase) return;
      try {
        const { data } = await supabase.from("test_submissions").select("*");
        if (data && data.length > 0) {
          const mapped: TestSubmission[] = data.map((row) => ({
            id: row.id,
            testId: row.test_id,
            studentName: row.student_name || "",
            matricNumber: row.matric_number || "",
            level: row.level || "",
            answers: row.answers || [],
            score: row.score || 0,
            total: row.total || 0,
            submittedAt: row.submitted_at,
            cheated: Boolean(row.cheated),
            testType: (row.test_type as TestType) || "C1",
            deviceId: row.device_id || "",
            integrity: row.integrity ?? undefined,
            theory: row.theory ?? undefined,
          }));
          localStorage.setItem("att.test-submissions.v1", JSON.stringify(mapped));
          window.dispatchEvent(new Event("att:test-submissions"));
          setLocalSubmissions(mapped);
        }
      } catch {
        // fall back to local
      }
    }
    fetchSubmissions();
  }, []);

  // Merge store + local. storeSubmissions reflects every local write (including
  // edits made on this page) via the "att:test-submissions" event, so it must
  // win over localSubmissions — a one-time Supabase snapshot taken at mount
  // that goes stale the moment a score is edited. localSubmissions only fills
  // in submissions made on another device that haven't synced locally yet.
  const testSubmissions = useMemo(() => {
    const merged = new Map<string, TestSubmission>();
    [...localSubmissions, ...storeSubmissions].forEach((s) => {
      merged.set(s.id, s);
    });
    return Array.from(merged.values());
  }, [storeSubmissions, localSubmissions]);

  const linkMap = useMemo(() => {
    const m = new Map<string, string>();
    links.forEach((l: AttendanceLink) => m.set(l.id, l.title));
    return m;
  }, [links]);

  const usedLinks = useMemo(() => {
    const ids = new Set(records.map((r) => r.linkId).filter(Boolean) as string[]);
    return links.filter((l: AttendanceLink) => ids.has(l.id));
  }, [records, links]);

  const usedClassCodes = useMemo(() =>
    Array.from(new Set(records.map((r) => r.assignedClassCode).filter(Boolean) as string[])).sort(),
  [records]);

  const testResultMap = useMemo(() => {
    const all = testSubmissions.length > 0 ? testSubmissions : loadTestSubmissions();
    const map = new Map<string, TestResultsByType>();
    all.forEach((s) => {
      const key = s.matricNumber.toLowerCase();
      const type = s.testType || "C1";
      const existing = map.get(key) ?? {};
      const existingForType = existing[type];
      if (!existingForType || s.score > existingForType.score)
        map.set(key, { ...existing, [type]: s });
    });
    return map;
  }, [testSubmissions]);

  const departments = useMemo(() => {
    const fromRecords = records.map((r) => r.department).filter(Boolean);
    const fromSettings = settings.departments || loadSettings().departments || [];
    return Array.from(new Set([...fromSettings, ...fromRecords])).sort();
  }, [records, settings.departments]);

  const courses = useMemo(() => {
    const fromRecords = records.map((r) => r.courseCode).filter(Boolean);
    const fromSettings = settings.courses || loadSettings().courses || [];
    return Array.from(new Set([...fromSettings, ...fromRecords])).sort();
  }, [records, settings.courses]);

  const filtered = useMemo(() => {
    const m = matric.toLowerCase().trim();
    return [...records]
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .filter((r) => {
        if (m && !r.matricNumber.toLowerCase().includes(m) && !r.fullName.toLowerCase().includes(m)) return false;
        // Searching a name or matric looks through older check-ins too
        if (!showOlder && !m && !isToday(r)) return false;
        if (dept !== "all" && r.department !== dept) return false;
        if (gender !== "all" && r.gender !== gender) return false;
        if (level !== "all" && (r.level || "") !== level) return false;
        if (course !== "all" && r.courseCode !== course) return false;
        if (linkFilter !== "all") {
          if (linkFilter === "__none__") { if (r.linkId) return false; }
          else { if (r.linkId !== linkFilter) return false; }
        }
        if (classCodeFilter !== "all") {
          if (classCodeFilter === "__none__") { if (r.assignedClassCode) return false; }
          else { if (r.assignedClassCode !== classCodeFilter) return false; }
        }
        return true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, matric, dept, gender, level, course, linkFilter, classCodeFilter, showOlder]);
  const olderCount = useMemo(() => records.filter((r) => !isToday(r)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records]);

  function resetFilters() {
    setStatusFilter("all");
    setMatric(""); setDept("all"); setGender("all");
    setLevel("all"); setCourse("all"); setLinkFilter("all"); setClassCodeFilter("all");
  }
  function clearAll() {
    if (!confirm("Clear ALL attendance records? This cannot be undone.")) return;
    clearAllRecords(); toast.success("All records cleared.");
  }
  function deleteRecord(id: string) {
    if (!confirm("Delete this record?")) return;
    deleteRecordById(id, records); toast.success("Record deleted.");
  }
  function openAdd() { setModalMode("add"); setEditingRecord(null); }
  function openEdit(r: AttendanceRecord) { setModalMode("edit"); setEditingRecord(r); }
  function closeModal() { setModalMode(null); setEditingRecord(null); }

  function handleSaveTestResult(updated: TestSubmission) {
    const all = loadTestSubmissions();
    saveTestSubmissions(all.map((s) => (s.id === updated.id ? updated : s)));
    syncTestSubmission(updated);
    setEditingTestResult(null);
    toast.success("Test result updated and synced.");
  }

  async function handleSave(draft: RecordDraft) {
    if (modalMode === "add") {
      const newRec: AttendanceRecord = {
        id: `manual-${Date.now()}`,
        fullName: draft.fullName.trim(),
        matricNumber: draft.matricNumber.trim().toUpperCase(),
        department: draft.department.trim(),
        phone: draft.phone.trim(),
        courseCode: draft.courseCode.trim().toUpperCase(),
        topic: draft.topic.trim(),
        level: draft.level,
        gender: draft.gender as Gender,
        submittedAt: new Date().toISOString(),
        dayKey: new Date().toISOString().slice(0, 10),
        deviceId: "manual", distanceMeters: 0, lat: 0, lng: 0,
        sessionId: "", customFields: { addedByLecturer: "1" },
      };
      try {
        await addRecord(newRec);
        toast.success("Record added and synced to database.");
      } catch (err) {
        toast.error(friendlyError(err, "We couldn't save that record. Please try again."));
        return;
      }
    } else if (editingRecord) {
      const updated: AttendanceRecord = {
        ...editingRecord,
        fullName: draft.fullName.trim(),
        matricNumber: draft.matricNumber.trim().toUpperCase(),
        department: draft.department.trim(),
        phone: draft.phone.trim(),
        courseCode: draft.courseCode.trim().toUpperCase(),
        topic: draft.topic.trim(),
        level: draft.level,
        gender: draft.gender as Gender,
      };
      saveRecords(records.map((r) => (r.id === updated.id ? updated : r)));
      syncRecord(updated);
      toast.success("Record updated and synced.");
    }
    closeModal();
  }

  // ── Status for each record (Verified / needs review / other) ──
  const statusOf = (r: AttendanceRecord): "ok" | "review" | "other" => {
    const st = checkStatus(r.customFields);
    return st.tone === "green" ? "ok" : st.tone === "amber" ? "review" : "other";
  };
  const shown = statusFilter === "all" ? filtered : filtered.filter((r) => statusOf(r) === statusFilter);
  const counts = {
    all: filtered.length,
    ok: filtered.filter((r) => statusOf(r) === "ok").length,
    review: filtered.filter((r) => statusOf(r) === "review").length,
    other: filtered.filter((r) => statusOf(r) === "other").length,
  };
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayCount = records.filter((r) => r.submittedAt.slice(0, 10) === todayKey).length;
  const activeFilters: { label: string; clear: () => void }[] = [
    level !== "all" && { label: `${level} Level`, clear: () => setLevel("all") },
    course !== "all" && { label: course, clear: () => setCourse("all") },
    dept !== "all" && { label: dept, clear: () => setDept("all") },
    gender !== "all" && { label: gender[0].toUpperCase() + gender.slice(1), clear: () => setGender("all") },
    linkFilter !== "all" && { label: linkFilter === "__none__" ? "No link" : linkMap.get(linkFilter) ?? "Link", clear: () => setLinkFilter("all") },
    classCodeFilter !== "all" && { label: classCodeFilter === "__none__" ? "No class code" : classCodeFilter, clear: () => setClassCodeFilter("all") },
  ].filter(Boolean) as { label: string; clear: () => void }[];
  const aiRows: AiRow[] = useMemo(() => [...records].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map((r) => {
    const t = testResultMap.get(r.matricNumber.toLowerCase()) ?? {};
    return {
      name: r.fullName, matric: r.matricNumber, dept: r.department, level: r.level, gender: r.gender,
      course: r.courseCode, status: checkStatus(r.customFields).label, distance: r.distanceMeters || undefined,
      at: r.submittedAt, classCode: r.assignedClassCode || undefined,
      tests: TEST_TYPES.map((k) => (t[k] ? `${k} ${t[k]!.cheated ? "cheated" : `${t[k]!.score}/${t[k]!.total}`}` : "")).filter(Boolean).join(", ") || undefined,
    };
  }), [records, testResultMap]);
  const selected = selectedId ? records.find((r) => r.id === selectedId) ?? null : null;
  const initials = (n: string) => n.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const pillClass = (s: "ok" | "review" | "other") =>
    s === "ok" ? "bg-[#12b886]/12 text-[#0b7a59] dark:text-[#5fe3b0]" : s === "review" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" : "bg-secondary text-muted-foreground";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8 lg:pb-16">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#12b886] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#12b886]" /></span>
            Live · checked {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
          <h1 className="mt-1.5 font-display text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">Records</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowAi(true)} className="h-10 rounded-full px-4"><Sparkles className="mr-1.5 h-4 w-4" /> Ask AI</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={shown.length === 0} className="h-10 rounded-full px-4"><Download className="mr-1.5 h-4 w-4" /> Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportCSV(shown, testResultMap, linkMap)}><FileText className="mr-2 h-4 w-4" /> CSV ({shown.length})</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportJSON(shown, testResultMap)}><FileText className="mr-2 h-4 w-4" /> JSON ({shown.length})</DropdownMenuItem>
              <DropdownMenuItem onClick={exportEverything}><FileText className="mr-2 h-4 w-4" /> CSV, all time</DropdownMenuItem>
              <DropdownMenuItem onClick={clearAll} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Clear all records…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={openAdd} className="h-10 rounded-full bg-foreground px-4 text-background hover:bg-foreground/85"><Plus className="mr-1.5 h-4 w-4" /> Add</Button>
        </div>
      </div>

      {/* ── Today only, unless the lecturer wants older records ── */}
      {olderCount > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-secondary/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {showOlder
              ? <>Showing <strong className="text-foreground">all check-ins</strong>, including {olderCount} older one{olderCount === 1 ? "" : "s"}.</>
              : <>Showing <strong className="text-foreground">today's check-ins</strong>. {olderCount} older check-in{olderCount === 1 ? " is" : "s are"} hidden; search a name to find one.</>}
          </span>
          <button type="button" onClick={() => setShowOlder((v) => !v)}
            className="inline-flex h-9 items-center rounded-full bg-card px-4 text-[13px] font-semibold shadow-sm ring-1 ring-border hover:bg-secondary">
            {showOlder ? "Show only today" : "Show older records"}
          </button>
        </div>
      )}

      {/* ── Summary ── */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["all", "All records", records.length, "in this view: " + filtered.length],
          ["ok", "Verified", counts.ok, "location, code and face OK"],
          ["review", "To review", counts.review, "face, phone or location"],
          ["today", "Today", todayCount, new Date().toLocaleDateString([], { weekday: "long" })],
        ] as const).map(([key, label, value, hint]) => {
          const active = key !== "today" && statusFilter === key;
          return (
            <button key={key} type="button" disabled={key === "today"}
              onClick={() => key !== "today" && setStatusFilter(key)}
              className={`rounded-2xl p-4 text-left transition-all ${active ? "bg-foreground text-background" : "bg-card shadow-soft hover:-translate-y-0.5"} disabled:cursor-default disabled:hover:translate-y-0`}>
              <p className={`text-[13px] ${active ? "opacity-75" : "text-muted-foreground"}`}>{label}</p>
              <p className="mt-1 font-display text-[28px] font-bold leading-none tabular-nums">{value}</p>
              <p className={`mt-1.5 truncate text-[12px] ${active ? "opacity-60" : "text-muted-foreground/80"}`}>{hint}</p>
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ── */}
      <div className="mt-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="rec-search" value={matric} onChange={(e) => setMatric(e.target.value)} placeholder="Search name or matric number"
              className="h-11 rounded-full border-0 bg-card pl-10 text-base shadow-soft" />
          </div>
          <div className="flex rounded-full bg-secondary/70 p-1">
            {([["all", "All"], ["ok", "Verified"], ["review", "Review"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setStatusFilter(k)} aria-pressed={statusFilter === k}
                className={`h-9 rounded-full px-3.5 text-sm font-medium transition-colors ${statusFilter === k ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
                {l}{k === "review" && counts.review ? <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{counts.review}</span> : null}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} className="h-11 rounded-full px-4">
            <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Filters{activeFilters.length ? ` · ${activeFilters.length}` : ""}
          </Button>
        </div>

        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-card p-4 shadow-soft sm:grid-cols-3 lg:grid-cols-6">
                <FilterSelect label="Level" value={level} onChange={setLevel} options={[["all", "All levels"], ...["100", "200", "300", "400", "500", "600"].map((l) => [l, `${l} Level`] as [string, string])]} />
                <FilterSelect label="Course" value={course} onChange={setCourse} options={[["all", "All courses"], ...courses.map((c) => [c, c] as [string, string])]} />
                <FilterSelect label="Department" value={dept} onChange={setDept} options={[["all", "All departments"], ...departments.map((d) => [d, d] as [string, string])]} />
                <FilterSelect label="Gender" value={gender} onChange={setGender} options={[["all", "All"], ["male", "Male"], ["female", "Female"], ["other", "Other"]]} />
                <FilterSelect label="Link used" value={linkFilter} onChange={setLinkFilter} options={[["all", "All links"], ["__none__", "No link"], ...usedLinks.map((l) => [l.id, l.title] as [string, string])]} />
                <FilterSelect label="Class code" value={classCodeFilter} onChange={setClassCodeFilter} options={[["all", "All"], ["__none__", "No code yet"], ...usedClassCodes.map((c) => [c, c] as [string, string])]} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map((f) => (
              <button key={f.label} type="button" onClick={f.clear} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground/90 px-3 text-[13px] font-medium text-background hover:bg-foreground">
                {f.label} <X className="h-3.5 w-3.5" />
              </button>
            ))}
            <button type="button" onClick={resetFilters} className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:underline">Clear filters</button>
          </div>
        )}
      </div>

      {/* ── List ── */}
      <div className="mt-4 overflow-hidden rounded-3xl bg-card shadow-soft">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] gap-4 px-5 pb-2 pt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground md:grid">
          <span>Student</span><span>Course</span><span>Status</span><span>Tests</span><span className="w-28 text-right">Time</span>
        </div>
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-medium">{records.length === 0 ? "No check-ins yet" : "Nothing matches"}</p>
            <p className="max-w-xs text-sm text-muted-foreground">{records.length === 0 ? "Start a check-in from Links. Students appear here as they sign in." : "Try a different search, or clear the filters."}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {shown.map((r) => {
              const s = statusOf(r);
              const st = checkStatus(r.customFields);
              const byType = testResultMap.get(r.matricNumber.toLowerCase()) ?? {};
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setSelectedId(r.id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-left transition-colors duration-500 hover:bg-secondary/50 sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] ${freshIds.has(r.id) ? "bg-[#12b886]/12" : ""}`}>
                    <span className="flex min-w-0 items-center gap-3">
                      {r.customFields?.photo
                        ? <img src={r.customFields.photoThumb || r.customFields.photo} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                        : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-xs font-semibold text-muted-foreground">{initials(r.fullName)}</span>}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{r.fullName}</span>
                        <span className="block truncate font-mono text-[12px] text-muted-foreground">{r.matricNumber}{r.assignedClassCode ? ` · ${r.assignedClassCode}` : ""}</span>
                        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold md:hidden ${pillClass(s)}`}>{st.label}</span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 md:block">
                      <span className="block truncate text-sm font-medium">{r.courseCode || "—"}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{r.level ? `${r.level} Level` : ""}{r.department ? ` · ${r.department}` : ""}</span>
                    </span>
                    <span className="hidden md:block">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold ${pillClass(s)}`}>{st.label}</span>
                      {r.distanceMeters ? <span className="ml-2 text-[12px] text-muted-foreground tabular-nums">{r.distanceMeters} m</span> : null}
                    </span>
                    <span className="hidden gap-1 md:flex">
                      {TEST_TYPES.map((t) => {
                        const res = byType[t];
                        return (
                          <span key={t} title={res ? `${t}: ${res.cheated ? "cheated" : `${res.score}/${res.total}`}${unmarkedTheory(res) > 0 ? " (* theory answers to mark)" : ""}` : `${t}: not taken`}
                            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${!res ? "bg-secondary/60 text-muted-foreground/60" : res.cheated ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : res.score / res.total >= 0.5 ? "bg-[#12b886]/12 text-[#0b7a59] dark:text-[#5fe3b0]" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                            {res ? (res.cheated ? "✕" : `${res.score}/${res.total}${unmarkedTheory(res) > 0 ? "*" : ""}`) : t}
                          </span>
                        );
                      })}
                    </span>
                    <span className="w-auto text-right text-[12px] tabular-nums text-muted-foreground md:w-28">
                      {new Date(r.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      <span className="block">{new Date(r.submittedAt).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-5 py-3 text-[12px] text-muted-foreground">
          <span>
            {shown.length > 0 ? `Showing ${shown.length} of ${records.length}. ` : ""}
            {loadedSince ? `Check-ins since ${new Date(loadedSince).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}.` : "All check-ins loaded."}
          </span>
          {loadedSince && (
            <button type="button" disabled={loadingOlder} onClick={loadOlder}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary/70 px-4 text-[13px] font-medium text-foreground hover:bg-secondary disabled:opacity-60">
              {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Load older
            </button>
          )}
        </div>
      </div>

      {/* ── Detail drawer ── */}
      <AnimatePresence>
        {selected && (
          <SideSheet title={selected.fullName} subtitle={selected.matricNumber} onClose={() => setSelectedId(null)}>
            {selected.customFields?.photo && (
              <img src={selected.customFields.photo} alt={`Check-in photo of ${selected.fullName}`} className="w-full rounded-2xl object-cover" />
            )}
            <span className={`inline-flex w-fit rounded-full px-3 py-1 text-[13px] font-semibold ${pillClass(statusOf(selected))}`}>{checkStatus(selected.customFields).label}</span>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-secondary/50 p-4 text-sm">
              {([
                ["Course", selected.courseCode || "—"],
                ["Level", selected.level ? `${selected.level} Level` : "—"],
                ["Department", selected.department || "—"],
                ["Gender", selected.gender ? selected.gender[0].toUpperCase() + selected.gender.slice(1) : "—"],
                ["Phone", selected.phone || "—"],
                ["Distance", selected.distanceMeters ? `${selected.distanceMeters} m from you` : "—"],
                ["Class code", selected.assignedClassCode || "—"],
                ["Link", selected.linkId ? linkMap.get(selected.linkId) ?? "—" : "—"],
                ["Topic", selected.topic || "—"],
                ["Signed", new Date(selected.submittedAt).toLocaleString()],
              ] as const).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 break-words font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {selected.customFields?.photoAddress && (
              <p className="text-[13px] text-muted-foreground"><MapPin className="mr-1 inline h-3.5 w-3.5" />{selected.customFields.photoAddress}</p>
            )}
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Tests</p>
              <div className="grid grid-cols-3 gap-2">
                {TEST_TYPES.map((t) => {
                  const res = (testResultMap.get(selected.matricNumber.toLowerCase()) ?? {})[t];
                  return (
                    <button key={t} type="button" disabled={!res} onClick={() => res && setEditingTestResult(res)}
                      className="rounded-xl bg-secondary/50 p-3 text-left transition-colors enabled:hover:bg-secondary disabled:opacity-60">
                      <span className="block text-[12px] text-muted-foreground">{t}</span>
                      <span className="block font-display text-lg font-bold tabular-nums">{res ? (res.cheated ? "Cheated" : `${res.score}/${res.total}`) : "—"}</span>
                      {res && (unmarkedTheory(res) > 0
                        ? <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{unmarkedTheory(res)} to mark</span>
                        : <span className="text-[11px] text-muted-foreground">Tap to edit</span>)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
              <Button variant="outline" onClick={() => { const r = selected; setSelectedId(null); openEdit(r); }} className="h-11 rounded-full"><Pencil className="mr-1.5 h-4 w-4" /> Edit</Button>
              <Button variant="outline" onClick={() => { const id = selected.id; setSelectedId(null); deleteRecord(id); }} className="h-11 rounded-full text-destructive hover:text-destructive"><Trash2 className="mr-1.5 h-4 w-4" /> Delete</Button>
            </div>
          </SideSheet>
        )}
      </AnimatePresence>

      {/* ── AI assistant drawer ── */}
      <AnimatePresence>
        {showAi && (
          <SideSheet title="Ask AI" subtitle="About your attendance records" onClose={() => setShowAi(false)}>
            <AskAiChat rows={aiRows} onNavigate={() => setShowAi(false)} />
            <details className="rounded-2xl bg-secondary/40 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground">Voice assistant (works offline)</summary>
              <div className="mt-3"><VoiceAssistant records={records} /></div>
            </details>
          </SideSheet>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modalMode && (
          <RecordModal mode={modalMode} initial={editingRecord ? recordToDraft(editingRecord) : emptyDraft}
            onSave={handleSave} onClose={closeModal} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editingTestResult && (
          <TestResultModal submission={editingTestResult} test={tests.find((t) => t.id === editingTestResult.testId)}
            onSave={handleSaveTestResult} onClose={() => setEditingTestResult(null)} />
        )}
      </AnimatePresence>
    </main>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="min-w-0">
      <Label className="text-[12px] font-medium text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1 h-10 rounded-xl border-0 bg-secondary/60 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

/** Panel that slides in from the right (full screen on phones). */
function SideSheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.aside role="dialog" aria-label={title} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.22 }}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-background p-5 pb-8 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-bold">{title}</h2>
            {subtitle && <p className="truncate font-mono text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </motion.aside>
    </motion.div>
  );
}
