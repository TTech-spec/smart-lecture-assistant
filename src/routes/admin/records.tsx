import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  RefreshCw, Trash2, Download, FileText, ClipboardList,
  Plus, Pencil, X, CheckCircle2, XCircle,
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
  saveRecords, addRecord, syncRecord, deleteRecordById, clearAllRecords,
  loadTestSubmissions, loadSettings, saveTestSubmissions, syncTestSubmission,
  type AttendanceRecord, type Gender, type TestSubmission, type TestType,
} from "@/lib/attendance-store";

const TEST_TYPES: TestType[] = ["C1", "C2", "C3"];
import { useStore } from "@/hooks/use-store";
import { VoiceAssistant } from "@/components/VoiceAssistant";

export const Route = createFileRoute("/admin/records")({
  head: () => ({ meta: [{ title: "Attendance records — Attendly" }] }),
  component: RecordsPage,
});

// ── CSV / JSON export ─────────────────────────────────────────────────────────
type TestResultsByType = Partial<Record<TestType, TestSubmission>>;

function exportCSV(records: AttendanceRecord[], testResultMap: Map<string, TestResultsByType>) {
  const headers = [
    "Full Name", "Matric Number", "Department", "Level", "Course Code", "Topic", "Gender", "Phone", "Session ID", "Submitted At", "Day",
    "C1 Score", "C1 Total", "C1 Cheated", "C2 Score", "C2 Total", "C2 Cheated", "C3 Score", "C3 Total", "C3 Cheated",
  ];
  const rows = records.map((r) => {
    const byType = testResultMap.get(r.matricNumber.toLowerCase()) ?? {};
    const typeCols = TEST_TYPES.flatMap((t) => {
      const res = byType[t];
      return [res ? String(res.score) : "", res ? String(res.total) : "", res ? (res.cheated ? "Yes" : "No") : ""];
    });
    return [
      r.fullName, r.matricNumber, r.department, r.level || "", r.courseCode, r.topic, r.gender, r.phone,
      r.sessionId || "", new Date(r.submittedAt).toLocaleString(), r.dayKey,
      ...typeCols,
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast.success(`Exported ${records.length} record${records.length !== 1 ? "s" : ""} to CSV`);
}

function exportJSON(records: AttendanceRecord[], testResultMap: Map<string, TestResultsByType>) {
  const enriched = records.map((r) => ({
    ...r,
    testResults: testResultMap.get(r.matricNumber.toLowerCase()) ?? {},
  }));
  const blob = new Blob([JSON.stringify(enriched, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `attendance-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast.success(`Exported ${records.length} record${records.length !== 1 ? "s" : ""} to JSON`);
}

// ── Record form ───────────────────────────────────────────────────────────────
type RecordDraft = {
  fullName: string; matricNumber: string; department: string; phone: string;
  courseCode: string; topic: string; level: string; gender: Gender | "";
};

const emptyDraft: RecordDraft = { fullName: "", matricNumber: "", department: "", phone: "", courseCode: "", topic: "", level: "", gender: "" };

function recordToDraft(r: AttendanceRecord): RecordDraft {
  return { fullName: r.fullName, matricNumber: r.matricNumber, department: r.department, phone: r.phone, courseCode: r.courseCode, topic: r.topic, level: r.level || "", gender: r.gender };
}

function RecordModal({ mode, initial, onSave, onClose }: { mode: "add" | "edit"; initial: RecordDraft; onSave: (d: RecordDraft) => void; onClose: () => void }) {
  const [d, setD] = useState<RecordDraft>(initial);
  const u = <K extends keyof RecordDraft>(k: K, v: RecordDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  function save(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!d.fullName.trim()) return toast.error("Full name is required.");
    if (!d.matricNumber.trim()) return toast.error("Matric number is required.");
    if (!d.department.trim()) return toast.error("Department is required.");
    if (!d.courseCode.trim()) return toast.error("Course code is required.");
    if (!d.gender) return toast.error("Gender is required.");
    onSave(d);
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.93, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.93, y: 12 }} transition={{ duration: 0.22, ease: "circOut" }}
        className="relative w-full max-w-lg rounded-2xl border bg-card p-6 shadow-soft max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"><X className="h-4 w-4" /></button>
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
function TestResultModal({ submission, onSave, onClose }: { submission: TestSubmission; onSave: (updated: TestSubmission) => void; onClose: () => void }) {
  const [score, setScore] = useState(String(submission.score));
  const [total, setTotal] = useState(String(submission.total));
  const [cheated, setCheated] = useState(submission.cheated);

  function save(e: { preventDefault(): void }) {
    e.preventDefault();
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
      <motion.div initial={{ opacity: 0, scale: 0.93, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.93, y: 12 }} transition={{ duration: 0.22, ease: "circOut" }}
        className="relative w-full max-w-sm rounded-2xl border bg-card p-6 shadow-soft">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"><X className="h-4 w-4" /></button>
        <h2 className="mb-1 text-lg font-semibold">Edit test result</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          {submission.studentName} · {submission.matricNumber}
          {submission.level && <> · {submission.level} Level</>}
        </p>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-sm">Score</Label><Input className="mt-1" type="number" min={0} value={score} onChange={(e) => setScore(e.target.value)} autoFocus /></div>
            <div><Label className="text-sm">Total questions</Label><Input className="mt-1" type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} /></div>
          </div>
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

// ── Main page ─────────────────────────────────────────────────────────────────
function RecordsPage() {
  const { records, testSubmissions, settings } = useStore();
  const [matric, setMatric] = useState("");
  const [dept, setDept] = useState("all");
  const [gender, setGender] = useState("all");
  const [level, setLevel] = useState("all");
  const [course, setCourse] = useState("all");
  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editingTestResult, setEditingTestResult] = useState<TestSubmission | null>(null);

  const testResultMap = useMemo(() => {
    const all = testSubmissions.length > 0 ? testSubmissions : loadTestSubmissions();
    const map = new Map<string, TestResultsByType>();
    all.forEach((s) => {
      const key = s.matricNumber.toLowerCase();
      const type = s.testType || "C1";
      const existing = map.get(key) ?? {};
      const existingForType = existing[type];
      if (!existingForType || s.score > existingForType.score) {
        map.set(key, { ...existing, [type]: s });
      }
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
    return [...records].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).filter((r) => {
      if (m && !r.matricNumber.toLowerCase().includes(m) && !r.fullName.toLowerCase().includes(m)) return false;
      if (dept !== "all" && r.department !== dept) return false;
      if (gender !== "all" && r.gender !== gender) return false;
      if (level !== "all" && (r.level || "") !== level) return false;
      if (course !== "all" && r.courseCode !== course) return false;
      return true;
    });
  }, [records, matric, dept, gender, level, course]);

  function clearAll() { if (!confirm("Clear ALL attendance records? This cannot be undone.")) return; clearAllRecords(); toast.success("All records cleared."); }
  function deleteRecord(id: string) { if (!confirm("Delete this record?")) return; deleteRecordById(id, records); toast.success("Record deleted."); }
  function openAdd() { setModalMode("add"); setEditingRecord(null); }
  function openEdit(r: AttendanceRecord) { setModalMode("edit"); setEditingRecord(r); }
  function closeModal() { setModalMode(null); setEditingRecord(null); }

  function handleSaveTestResult(updated: TestSubmission) {
    const all = loadTestSubmissions();
    const next = all.map((s) => (s.id === updated.id ? updated : s));
    saveTestSubmissions(next);
    syncTestSubmission(updated);
    setEditingTestResult(null);
    toast.success("Test result updated and synced.");
  }

  async function handleSave(draft: RecordDraft) {
    if (modalMode === "add") {
      const newRecord: AttendanceRecord = {
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
        deviceId: "manual",
        distanceMeters: 0,
        lat: 0, lng: 0,
        sessionId: "",
        customFields: {},
      };
      try {
        await addRecord(newRecord);
        toast.success("Record added and synced to database.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Database error";
        toast.error(`Could not save to database: ${msg}`);
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
      toast.success("Record updated and synced to database.");
    }
    closeModal();
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 sm:text-3xl">
            <ClipboardList className="h-6 w-6 text-[color:var(--color-primary)] sm:h-7 sm:w-7" /> Attendance records
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{filtered.length} of {records.length} entries</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={openAdd}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add record</Button>
          <Button variant="outline" size="sm" onClick={() => { setMatric(""); setDept("all"); setGender("all"); setLevel("all"); setCourse("all"); }}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reset</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={filtered.length === 0} className="gap-1.5"><Download className="h-3.5 w-3.5" /> Export ({filtered.length})</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportCSV(filtered, testResultMap)}><FileText className="mr-2 h-4 w-4" /> Download CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportJSON(filtered, testResultMap)}><FileText className="mr-2 h-4 w-4" /> Download JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={clearAll} className="text-destructive hover:text-destructive"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear all</Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }} className="mt-5">
        <VoiceAssistant records={records} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }} className="mt-5 rounded-2xl border bg-card shadow-soft">
        <div className="grid gap-3 border-b p-4 sm:p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div>
            <Label className="text-xs font-medium text-muted-foreground sm:text-sm">Search name / matric</Label>
            <Input value={matric} onChange={(e) => setMatric(e.target.value)} placeholder="Jane or CSC/19/…" className="mt-1 text-sm sm:text-base" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground sm:text-sm">Level</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="mt-1 text-sm sm:text-base"><SelectValue placeholder="All levels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                {["100","200","300","400","500","600"].map((l) => <SelectItem key={l} value={l}>{l} Level</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground sm:text-sm">Course</Label>
            <Select value={course} onValueChange={setCourse}>
              <SelectTrigger className="mt-1 text-sm sm:text-base"><SelectValue placeholder="All courses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All courses</SelectItem>
                {courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground sm:text-sm">Department</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="mt-1 text-sm sm:text-base"><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground sm:text-sm">Gender</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="mt-1 text-sm sm:text-base"><SelectValue placeholder="All genders" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:text-base">
            <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Name</th>
                <th className="px-4 py-3 whitespace-nowrap">Matric</th>
                <th className="px-4 py-3 whitespace-nowrap">Dept</th>
                <th className="px-4 py-3 whitespace-nowrap">Level</th>
                <th className="px-4 py-3 whitespace-nowrap">Course</th>
                <th className="px-4 py-3 whitespace-nowrap">Topic</th>
                <th className="px-4 py-3 whitespace-nowrap">Gender</th>
                <th className="px-4 py-3 whitespace-nowrap">Phone</th>
                <th className="px-4 py-3 whitespace-nowrap">C1</th>
                <th className="px-4 py-3 whitespace-nowrap">C2</th>
                <th className="px-4 py-3 whitespace-nowrap">C3</th>
                <th className="px-4 py-3 whitespace-nowrap">Time</th>
                <th className="px-4 py-3 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-14 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="h-10 w-10 opacity-20" />
                      <p className="text-base font-medium">No records match these filters</p>
                      <p className="text-sm">Try adjusting your filters or open the attendance form</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const byType = testResultMap.get(r.matricNumber.toLowerCase()) ?? {};
                  return (
                    <tr key={r.id} className="border-t hover:bg-secondary/40 transition-colors">
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{r.fullName}</td>
                      <td className="px-4 py-3 font-mono text-xs sm:text-sm whitespace-nowrap">{r.matricNumber}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.department}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.level ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{r.level} Lvl</span> : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.courseCode}</td>
                      <td className="px-4 py-3 whitespace-nowrap max-w-[140px] truncate" title={r.topic}>{r.topic || "—"}</td>
                      <td className="px-4 py-3 capitalize whitespace-nowrap">{r.gender}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.phone || "—"}</td>
                      {TEST_TYPES.map((t) => {
                        const testResult = byType[t];
                        return (
                          <td key={t} className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {testResult ? (
                                testResult.cheated ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    <XCircle className="h-3 w-3" /> Cheated
                                  </span>
                                ) : (
                                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${testResult.score / testResult.total >= 0.5 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                                    <CheckCircle2 className="h-3 w-3" />{testResult.score}/{testResult.total}
                                  </span>
                                )
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                              {testResult && (
                                <button onClick={() => setEditingTestResult(testResult)} className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title={`Edit ${t} result`}>
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs sm:text-sm">{new Date(r.submittedAt).toLocaleString()}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(r)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="Edit record"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => deleteRecord(r.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive transition-colors" title="Delete record"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="border-t px-4 py-3 flex items-center justify-between sm:px-5">
            <span className="text-xs text-muted-foreground sm:text-sm">Showing {filtered.length} of {records.length} records</span>
            <Button size="sm" variant="ghost" onClick={() => exportCSV(filtered, testResultMap)} className="gap-1.5 text-xs sm:text-sm"><Download className="h-3.5 w-3.5" /> Download CSV</Button>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {modalMode && <RecordModal mode={modalMode} initial={editingRecord ? recordToDraft(editingRecord) : emptyDraft} onSave={handleSave} onClose={closeModal} />}
      </AnimatePresence>

      <AnimatePresence>
        {editingTestResult && <TestResultModal submission={editingTestResult} onSave={handleSaveTestResult} onClose={() => setEditingTestResult(null)} />}
      </AnimatePresence>
    </main>
  );
}
