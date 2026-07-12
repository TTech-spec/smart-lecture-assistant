import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin, Lock, Unlock, Users, Loader2,
  Plus, X, GraduationCap, ClipboardList, Activity,
  FileQuestion, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp,
  Upload, Hash, KeyRound, RefreshCw, Banknote, ArrowDownToLine, CheckCircle2, AlertCircle,
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
  loadSettings, saveSettings, isWindowOpen, minutesRemaining, addSession, closeSession, clearSessions,
  addTest, deleteTest, setTestActive,
  type AdminSettings, type AttendanceRecord, type AttendanceSession,
  type CustomField, type TestConfig, type TestType,
} from "@/lib/attendance-store";
import { parsePdfQuestions } from "@/lib/pdf-parser";
import { getCurrentPosition } from "@/lib/geo";
import { getStoredPass, PASS_KEY } from "@/routes/admin";
import { useStore } from "@/hooks/use-store";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import { calculateTotalEarnings } from "@/lib/materials-store";
import { payoutToLecturer } from "@/lib/squad-server";
import { NG_BANKS, generateTransactionRef, loadSquadPayments } from "@/lib/squad";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" as const },
  }),
};

function AdminDashboard() {
  const { settings, records, sessions, tests } = useStore();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const todays = useMemo(() => {
    const k = new Date().toISOString().slice(0, 10);
    return records.filter((r) => r.dayKey === k);
  }, [records]);

  const open = isWindowOpen(settings, now);
  const minsLeft = minutesRemaining(settings, now);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Today's session</h1>
          <p className="mt-1 text-sm sm:text-base text-muted-foreground">
            Pin the class location, set the rules, watch sign-ins come in.
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          className="flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-xs sm:text-sm shadow-soft self-start sm:self-auto"
        >
          <span className={`h-2 w-2 rounded-full ${open ? "bg-[color:var(--color-success)] animate-pulse" : "bg-[color:var(--color-warning)]"}`} />
          {open ? (
            <span>Form open · {minsLeft === Infinity ? "no limit" : `${minsLeft} min left`}</span>
          ) : (
            <span>Form locked</span>
          )}
        </motion.div>
      </motion.div>

      <div className="mt-8 grid gap-6 grid-cols-1 md:grid-cols-3">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
          <SettingsCard />
        </motion.div>

        <div className="md:col-span-2 grid gap-6">
          <StatsRow records={todays} allRecords={records} settings={settings} />

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
            <EarningsDisplay />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
            <VoiceAssistant records={records} />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.4 }}>
            <TestManager tests={tests} />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.4 }}>
            <SessionsPanel sessions={sessions} records={records} settings={settings} />
          </motion.div>
        </div>
      </div>
    </main>
  );
}

// ── Radius hint ────────────────────────────────────────────────────────────────
function RadiusHint({ meters }: { meters: number }) {
  let description: string;
  let color: string;

  if (meters <= 30) {
    description = `Only students physically inside the same room (≤${meters}m) can sign attendance. Very strict — best for small classrooms.`;
    color = "text-blue-600 dark:text-blue-400";
  } else if (meters <= 75) {
    description = `Students within ${meters}m — roughly the same floor or corridor — can use the form. Good for small lecture rooms.`;
    color = "text-green-600 dark:text-green-400";
  } else if (meters <= 150) {
    description = `Students within ${meters}m of your pinned spot can sign attendance. This covers a standard lecture hall or classroom block.`;
    color = "text-green-600 dark:text-green-400";
  } else if (meters <= 300) {
    description = `${meters}m covers roughly 2–3 building lengths. Students in nearby classrooms or outside the building could still qualify.`;
    color = "text-amber-600 dark:text-amber-400";
  } else if (meters <= 600) {
    description = `${meters}m is a wide zone — about half a typical campus block. Students in other departments may be able to sign in.`;
    color = "text-amber-600 dark:text-amber-400";
  } else {
    description = `${meters}m is a very large area. Students far from your class may be able to sign attendance. Consider reducing the radius.`;
    color = "text-red-600 dark:text-red-400";
  }

  return (
    <p className={`mt-1.5 text-xs leading-snug ${color}`}>
      {description}
    </p>
  );
}

// ── Settings card ───────────────────────────────────────────────────────────────
function SettingsCard() {
  const { settings } = useStore();
  const [draft, setDraft] = useState<AdminSettings>(settings);
  const [pinning, setPinning] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldPlaceholder, setNewFieldPlaceholder] = useState("");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newCourse, setNewCourse] = useState("");
  const [newDepartment, setNewDepartment] = useState("");

  useEffect(() => setDraft(settings), [settings]);

  function update<K extends keyof AdminSettings>(k: K, v: AdminSettings[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function pinHere() {
    setPinning(true);
    try {
      const pos = await getCurrentPosition();
      const next = { ...draft, classLat: pos.lat, classLng: pos.lng };
      setDraft(next);
      saveSettings(next);
      const acc = pos.accuracy ? Math.round(pos.accuracy) : null;
      // If accuracy is extremely high (>10km), it's likely using IP geolocation instead of GPS
      if (acc && acc > 10000) {
        toast.error(`Location accuracy is very poor (±${(acc / 1000).toFixed(0)} km). This device may be using IP-based location instead of GPS. Please use a mobile device or enter coordinates manually.`);
      } else if (acc && acc > 100) {
        toast.warning(`Location pinned but GPS accuracy is poor (±${acc} m). Students nearby may be wrongly rejected. Pin from a mobile phone or enter coordinates manually for better results.`);
      } else {
        toast.success(acc ? `Class location pinned (±${acc} m accuracy).` : "Class location pinned.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read GPS.");
    } finally {
      setPinning(false);
    }
  }

  function save() {
    saveSettings(draft);
    toast.success("Settings saved.");
  }

  function openWindow() {
    const sessionId = `ses-${Date.now()}`;
    if (draft.activeSessionId) {
      closeSession(draft.activeSessionId, new Date().toISOString());
    }
    const session: AttendanceSession = {
      id: sessionId,
      courseCode: draft.courseCode,
      level: draft.level,
      topic: draft.topic,
      openedAt: new Date().toISOString(),
    };
    addSession(session);
    const next: AdminSettings = {
      ...draft,
      windowOpenedAt: new Date().toISOString(),
      sessionOpenCount: (draft.sessionOpenCount || 0) + 1,
      activeSessionId: sessionId,
    };
    setDraft(next);
    saveSettings(next);
    toast.success("Attendance form opened.");
  }

  function closeWindow() {
    if (draft.activeSessionId) {
      closeSession(draft.activeSessionId, new Date().toISOString());
    }
    const next: AdminSettings = { ...draft, windowOpenedAt: null, activeSessionId: null };
    setDraft(next);
    saveSettings(next);
    toast.success("Attendance form locked.");
  }

  function changePassword() {
    const current = prompt("Enter current admin password:");
    if (current == null) return;
    if (current !== getStoredPass()) { toast.error("Wrong current password."); return; }
    const next = prompt("Enter a new admin password (min 4 chars):");
    if (!next || next.length < 4) { toast.error("Password too short."); return; }
    localStorage.setItem(PASS_KEY, next);
    toast.success("Admin password updated.");
  }

  function addCourse() {
    const val = newCourse.trim().toUpperCase();
    if (!val) return toast.error("Enter a course code.");
    if ((draft.courses || []).includes(val)) return toast.error("Course already exists.");
    const next = { ...draft, courses: [...(draft.courses || []), val] };
    setDraft(next); saveSettings(next);
    setNewCourse("");
  }

  function removeCourse(code: string) {
    const next = { ...draft, courses: (draft.courses || []).filter((c) => c !== code) };
    setDraft(next); saveSettings(next);
  }

  function addDepartment() {
    const val = newDepartment.trim();
    if (!val) return toast.error("Enter a department name.");
    if ((draft.departments || []).map((d) => d.toLowerCase()).includes(val.toLowerCase())) return toast.error("Department already exists.");
    const next = { ...draft, departments: [...(draft.departments || []), val] };
    setDraft(next); saveSettings(next);
    setNewDepartment("");
  }

  function removeDepartment(dept: string) {
    const next = { ...draft, departments: (draft.departments || []).filter((d) => d !== dept) };
    setDraft(next); saveSettings(next);
  }

  function addCustomField() {
    if (!newFieldLabel.trim()) return toast.error("Field label is required.");
    const field: CustomField = {
      id: `field-${Date.now()}`,
      label: newFieldLabel.trim(),
      placeholder: newFieldPlaceholder.trim(),
      required: newFieldRequired,
    };
    setDraft((d) => ({ ...d, customFields: [...(d.customFields || []), field] }));
    setNewFieldLabel(""); setNewFieldPlaceholder(""); setNewFieldRequired(false); setAddingField(false);
  }

  function removeCustomField(id: string) {
    setDraft((d) => ({ ...d, customFields: (d.customFields || []).filter((f) => f.id !== id) }));
  }

  const pinned = draft.classLat != null && draft.classLng != null;

  return (
    <aside className="rounded-2xl border bg-card p-4 sm:p-6 shadow-soft">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <MapPin className="h-5 w-5 text-[color:var(--color-primary)]" /> Class settings
      </h2>

      <div className="mt-5 space-y-4">
        <div className="rounded-xl border bg-secondary p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Class location</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Latitude</Label>
              <Input
                type="number"
                step="any"
                placeholder="e.g. 6.5244"
                value={draft.classLat ?? ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  update("classLat", isNaN(v) ? null : v);
                }}
                className="h-8 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Longitude</Label>
              <Input
                type="number"
                step="any"
                placeholder="e.g. 3.3792"
                value={draft.classLng ?? ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  update("classLng", isNaN(v) ? null : v);
                }}
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Paste coordinates from Google Maps, then click <strong>Save settings</strong>.
          </p>
          <Button onClick={pinHere} disabled={pinning} className="mt-3 w-full" variant="outline">
            {pinning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading GPS…</> : <><MapPin className="mr-2 h-4 w-4" /> Auto-detect my location</>}
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            For best accuracy, auto-detect from a <strong>mobile phone</strong>. Laptops/desktops use IP geolocation which can be 100+ km off.
          </p>
        </div>

        <div>
          <Label className="text-sm">Allowed radius (meters)</Label>
          <Input type="number" min={10} max={5000} value={draft.radiusMeters ?? 100} onChange={(e) => update("radiusMeters", Math.max(10, Number(e.target.value) || 0))} />
          <RadiusHint meters={draft.radiusMeters} />
        </div>

        <div>
          <Label className="text-sm">Form open for (minutes, 0 = no limit)</Label>
          <Input type="number" min={0} max={720} value={draft.windowMinutes ?? 15} onChange={(e) => update("windowMinutes", Math.max(0, Number(e.target.value) || 0))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Course code</Label>
            <Input value={draft.courseCode ?? ""} onChange={(e) => update("courseCode", e.target.value)} placeholder="CSC 401" className="h-9" />
          </div>
          <div>
            <Label className="text-sm">Level</Label>
            <div className="flex items-center gap-2">
              <Input
                value={draft.level ?? ""}
                onChange={(e) => update("level", e.target.value)}
                placeholder="400"
                list="level-options"
                className="flex-1 h-9"
              />
              <datalist id="level-options">
                {["100","200","300","400","500","600"].map((l) => <option key={l} value={l} />)}
              </datalist>
            </div>
          </div>
        </div>

        {/* Level restriction toggle */}
        <button
          type="button"
          onClick={() => update("levelRestricted", !draft.levelRestricted)}
          className={`w-full rounded-xl border p-3 text-left transition-colors ${draft.levelRestricted ? "border-primary/40 bg-primary/5" : "border-dashed bg-secondary/50"}`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${draft.levelRestricted ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <div className={`mx-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${draft.levelRestricted ? "translate-x-4" : "translate-x-0"}`} />
            </div>
            <div>
              <p className="text-sm font-medium leading-none">
                Restrict to {draft.level ? `${draft.level} Level` : "selected level"} only
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {draft.levelRestricted
                  ? `Only ${draft.level || "the configured"} Level students can submit. Other levels will be blocked.`
                  : "All levels can submit attendance. Toggle on to lock it to one level."}
              </p>
            </div>
          </div>
        </button>

        <div>
          <Label className="text-sm">Topic</Label>
          <Input value={draft.topic ?? ""} onChange={(e) => update("topic", e.target.value)} placeholder="Distributed Systems" className="h-9" />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Custom form fields</Label>
            {!addingField && (
              <button type="button" onClick={() => setAddingField(true)} className="flex items-center gap-1 text-xs text-[color:var(--color-primary)] hover:underline">
                <Plus className="h-3 w-3" /> Add field
              </button>
            )}
          </div>

          {(draft.customFields || []).length === 0 && !addingField && (
            <p className="mt-1 text-xs text-muted-foreground">Add extra fields students must fill — e.g. Faculty, State of Origin.</p>
          )}

          <div className="mt-2 space-y-1.5">
            {(draft.customFields || []).map((field) => (
              <div key={field.id} className="flex items-center gap-2 rounded-lg border bg-secondary px-3 py-2">
                <span className="flex-1 text-sm">{field.label}</span>
                {field.required && <span className="text-xs text-muted-foreground">required</span>}
                <button type="button" onClick={() => removeCustomField(field.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {addingField && (
            <div className="mt-2 space-y-2 rounded-lg border bg-secondary p-3">
              <Input value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} placeholder="Field label (e.g. Faculty)" className="text-sm" autoFocus />
              <Input value={newFieldPlaceholder} onChange={(e) => setNewFieldPlaceholder(e.target.value)} placeholder="Placeholder hint (e.g. Science)" className="text-sm" />
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={newFieldRequired} onChange={(e) => setNewFieldRequired(e.target.checked)} className="rounded" />
                Required field
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={addCustomField} className="flex-1">Add</Button>
                <Button size="sm" variant="outline" onClick={() => { setAddingField(false); setNewFieldLabel(""); setNewFieldPlaceholder(""); setNewFieldRequired(false); }} className="flex-1">Cancel</Button>
              </div>
            </div>
          )}
        </div>

        {/* My Courses */}
        <div className="rounded-xl border bg-secondary p-4 space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <GraduationCap className="h-4 w-4 text-[color:var(--color-primary)]" /> My Courses
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(draft.courses || []).map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium">
                {c}
                <button type="button" onClick={() => removeCourse(c)} className="text-muted-foreground hover:text-destructive transition-colors ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {(draft.courses || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No courses added yet.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={newCourse}
              onChange={(e) => setNewCourse(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCourse(); } }}
              placeholder="e.g. PSY104"
              className="text-sm h-8"
            />
            <Button type="button" size="sm" onClick={addCourse} className="shrink-0">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* My Departments */}
        <div className="rounded-xl border bg-secondary p-4 space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-[color:var(--color-primary)]" /> My Departments
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(draft.departments || []).map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium">
                {d}
                <button type="button" onClick={() => removeDepartment(d)} className="text-muted-foreground hover:text-destructive transition-colors ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {(draft.departments || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No departments added yet.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={newDepartment}
              onChange={(e) => setNewDepartment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDepartment(); } }}
              placeholder="e.g. Economics"
              className="text-sm h-8"
            />
            <Button type="button" size="sm" onClick={addDepartment} className="shrink-0">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Class Code */}
        <div className="rounded-xl border bg-secondary p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <KeyRound className="h-4 w-4 text-[color:var(--color-primary)]" /> Class code
            </p>
            <button type="button" onClick={() => {
              const next = { ...draft, classCodeEnabled: !draft.classCodeEnabled };
              if (!draft.classCode) {
                next.classCode = draft.classCodeFormat === "numbers"
                  ? String(Math.floor(100000 + Math.random() * 900000))
                  : `${(draft.courseCode || "CLS").replace(/\s/g, "").toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
              }
              setDraft(next); saveSettings(next);
            }} className="flex items-center gap-1.5 text-xs text-[color:var(--color-primary)] hover:underline">
              {draft.classCodeEnabled ? <><ToggleRight className="h-4 w-4" /> Active</> : <><ToggleLeft className="h-4 w-4" /> Inactive</>}
            </button>
          </div>

          {draft.classCodeEnabled && (
            <>
              <div className="flex gap-2">
                <button type="button" onClick={() => { const n = { ...draft, classCodeFormat: "numbers" as const }; setDraft(n); saveSettings(n); }}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${draft.classCodeFormat === "numbers" ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-primary-foreground" : "bg-card text-muted-foreground hover:border-[color:var(--color-primary)]"}`}>
                  <Hash className="mr-1 inline h-3 w-3" /> Numbers
                </button>
                <button type="button" onClick={() => { const n = { ...draft, classCodeFormat: "id" as const }; setDraft(n); saveSettings(n); }}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${draft.classCodeFormat === "id" ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-primary-foreground" : "bg-card text-muted-foreground hover:border-[color:var(--color-primary)]"}`}>
                  <KeyRound className="mr-1 inline h-3 w-3" /> ID format
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg border bg-card px-3 py-2 font-mono text-lg font-bold tracking-widest text-center text-[color:var(--color-primary)]">
                  {draft.classCode || "—"}
                </div>
                <button type="button" title="Generate new code" onClick={() => {
                  const code = draft.classCodeFormat === "numbers"
                    ? String(Math.floor(100000 + Math.random() * 900000))
                    : `${(draft.courseCode || "CLS").replace(/\s/g, "").toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
                  const n = { ...draft, classCode: code }; setDraft(n); saveSettings(n);
                }} className="rounded-lg border bg-card p-2 hover:bg-secondary transition-colors">
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Target level</p>
                <select value={draft.classCodeLevel || ""} onChange={(e) => { const n = { ...draft, classCodeLevel: e.target.value }; setDraft(n); saveSettings(n); }}
                  className="w-full rounded-lg border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]">
                  <option value="">All levels</option>
                  {["100","200","300","400","500","600"].map((l) => <option key={l} value={l}>{l} Level</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                Students get a <strong>unique code</strong> tied to their matric number.
                {draft.classCodeLevel && ` Only ${draft.classCodeLevel} Level students can receive it.`}
              </p>
            </>
          )}
        </div>

        <Button onClick={save} className="w-full" variant="secondary">Save settings</Button>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={openWindow} className="w-full text-xs sm:text-sm px-2 sm:px-4">
            <Unlock className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="truncate">Open form</span>
          </Button>
          <Button onClick={closeWindow} variant="outline" className="w-full text-xs sm:text-sm px-2 sm:px-4">
            <Lock className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="truncate">Lock form</span>
          </Button>
        </div>

        {(draft.sessionOpenCount || 0) > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            Form opened {draft.sessionOpenCount} time{draft.sessionOpenCount !== 1 ? "s" : ""} in total
          </p>
        )}

        <button type="button" onClick={changePassword} className="block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors">
          Change admin password
        </button>
      </div>
    </aside>
  );
}

// ── Stats row ──────────────────────────────────────────────────────────────────
function StatsRow({ records, allRecords, settings }: { records: AttendanceRecord[]; allRecords: AttendanceRecord[]; settings: AdminSettings }) {
  const uniqueStudentsToday = new Set(records.map((r) => r.matricNumber)).size;
  const cards = [
    { label: "Sign-ins today", value: records.length, icon: Users },
    { label: "Sessions opened", value: settings.sessionOpenCount || 0, icon: ClipboardList },
    { label: "Unique students today", value: uniqueStudentsToday, icon: GraduationCap },
    { label: "Total fills (all time)", value: allRecords.length, icon: Activity },
  ];

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
      {cards.map((c, i) => (
        <motion.div key={c.label} custom={i} variants={cardVariants} initial="hidden" animate="visible"
          className="rounded-2xl border bg-card p-3 sm:p-5 shadow-soft hover:shadow-md transition-shadow duration-200">
          <div className="flex items-start justify-between gap-1">
            <p className="text-[11px] sm:text-xs leading-tight text-muted-foreground">{c.label}</p>
            <div className="flex h-7 w-7 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
              <c.icon className="h-3 w-3 sm:h-4 sm:w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-semibold leading-none">{c.value}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ── Earnings Display ──────────────────────────────────────────────────────────
function EarningsDisplay() {
  const [earnings, setEarnings]         = useState(() => calculateTotalEarnings());
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState<"form" | "processing" | "success" | "failed">("form");
  const [acctNumber, setAcctNumber]     = useState("");
  const [bankCode, setBankCode]         = useState("");
  const [acctName, setAcctName]         = useState("");
  const [amountInput, setAmountInput]   = useState("");
  const [withdrawError, setWithdrawError] = useState("");

  useEffect(() => {
    const sync = () => setEarnings(calculateTotalEarnings());
    window.addEventListener("att:purchases", sync);
    return () => window.removeEventListener("att:purchases", sync);
  }, []);

  const { amount, currency, salesCount } = earnings;

  // Total already withdrawn — sum of successful payout refs in squad payment records
  const alreadyWithdrawn = useMemo(() => {
    return loadSquadPayments()
      .filter((p) => p.payoutStatus === "successful")
      .reduce((sum, p) => sum + (p.lecturerAmount || 0), 0);
  }, [earnings]);

  const available = Math.max(0, amount - alreadyWithdrawn);

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawError("");

    const withdrawAmt = Number(amountInput);
    if (!acctNumber.trim() || acctNumber.trim().length < 10) {
      return setWithdrawError("Enter a valid 10-digit account number.");
    }
    if (!bankCode) return setWithdrawError("Select your bank.");
    if (!acctName.trim()) return setWithdrawError("Enter the account name.");
    if (!withdrawAmt || withdrawAmt <= 0) return setWithdrawError("Enter a valid amount.");
    if (withdrawAmt > available) {
      return setWithdrawError(`Amount exceeds available balance of ₦${available.toLocaleString()}.`);
    }
    if (withdrawAmt < 100) return setWithdrawError("Minimum withdrawal is ₦100.");

    setWithdrawStep("processing");

    try {
      const ref = `WD-${generateTransactionRef()}`;
      const res = await payoutToLecturer({
        data: {
          transferRef: ref,
          amountNGN: withdrawAmt,
          lecturerAccountNumber: acctNumber.trim(),
          lecturerBankCode: bankCode,
          lecturerAccountName: acctName.trim(),
          narration: "Attendly earnings withdrawal",
        },
      });

      if (res.success) {
        setWithdrawStep("success");
        toast.success(`₦${withdrawAmt.toLocaleString()} withdrawal initiated successfully.`);
      } else {
        throw new Error((res.message as string) || "Transfer failed.");
      }
    } catch (err) {
      setWithdrawStep("failed");
      setWithdrawError(err instanceof Error ? err.message : "Transfer failed. Try again.");
    }
  }

  function resetWithdraw() {
    setWithdrawStep("form");
    setAcctNumber("");
    setBankCode("");
    setAcctName("");
    setAmountInput("");
    setWithdrawError("");
  }

  return (
    <>
      <div className="rounded-2xl border bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 p-6 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg">
              <Banknote className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-green-900 dark:text-green-100">Total Earnings</h2>
              <p className="text-sm text-green-700 dark:text-green-300">From material sales</p>
            </div>
          </div>
          {salesCount > 0 && (
            <Button
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => { resetWithdraw(); setShowWithdraw(true); }}
            >
              <ArrowDownToLine className="h-3.5 w-3.5" /> Withdraw
            </Button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-green-200 dark:border-green-800 bg-white/50 dark:bg-black/20 p-4">
            <p className="text-xs text-green-600 dark:text-green-400 uppercase tracking-wider font-medium">Total Revenue</p>
            <p className="mt-2 text-2xl font-bold text-green-900 dark:text-green-100">
              ₦{amount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-green-200 dark:border-green-800 bg-white/50 dark:bg-black/20 p-4">
            <p className="text-xs text-green-600 dark:text-green-400 uppercase tracking-wider font-medium">Available</p>
            <p className="mt-2 text-2xl font-bold text-green-900 dark:text-green-100">
              ₦{available.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-green-200 dark:border-green-800 bg-white/50 dark:bg-black/20 p-4">
            <p className="text-xs text-green-600 dark:text-green-400 uppercase tracking-wider font-medium">Total Sales</p>
            <p className="mt-2 text-2xl font-bold text-green-900 dark:text-green-100">
              {salesCount}
            </p>
          </div>
        </div>

        {salesCount === 0 && (
          <p className="mt-4 text-sm text-green-700 dark:text-green-300 text-center">
            No material sales yet. Upload paid materials to start earning.
          </p>
        )}
      </div>

      {/* ── Withdrawal modal ── */}
      <AnimatePresence>
        {showWithdraw && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget && withdrawStep !== "processing") { setShowWithdraw(false); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 16 }} transition={{ duration: 0.22, ease: "circOut" }}
              className="relative w-full max-w-md rounded-2xl border bg-card p-6 shadow-soft"
            >
              {withdrawStep !== "processing" && (
                <button
                  onClick={() => setShowWithdraw(false)}
                  className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              {/* ── Form ── */}
              {withdrawStep === "form" && (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/30">
                      <ArrowDownToLine className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold">Withdraw Earnings</h2>
                      <p className="text-xs text-muted-foreground">Available: <span className="font-semibold text-green-600 dark:text-green-400">₦{available.toLocaleString()}</span></p>
                    </div>
                  </div>

                  <form onSubmit={handleWithdraw} className="space-y-3">
                    {/* Amount */}
                    <div>
                      <Label htmlFor="wd-amount">Amount (₦)</Label>
                      <Input
                        id="wd-amount"
                        type="number"
                        min={100}
                        max={available}
                        step={1}
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        placeholder={`Max ₦${available.toLocaleString()}`}
                        className="mt-1"
                        required
                      />
                    </div>

                    {/* Bank */}
                    <div>
                      <Label htmlFor="wd-bank">Bank</Label>
                      <Select value={bankCode} onValueChange={setBankCode}>
                        <SelectTrigger id="wd-bank" className="mt-1">
                          <SelectValue placeholder="Select your bank" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {NG_BANKS.map((b) => (
                            <SelectItem key={b.code} value={b.code}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Account number */}
                    <div>
                      <Label htmlFor="wd-acct">Account Number</Label>
                      <Input
                        id="wd-acct"
                        value={acctNumber}
                        onChange={(e) => setAcctNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        placeholder="0123456789"
                        maxLength={10}
                        className="mt-1 font-mono tracking-wider"
                        required
                      />
                    </div>

                    {/* Account name */}
                    <div>
                      <Label htmlFor="wd-name">Account Name</Label>
                      <Input
                        id="wd-name"
                        value={acctName}
                        onChange={(e) => setAcctName(e.target.value)}
                        placeholder="As shown on your bank account"
                        className="mt-1"
                        required
                      />
                    </div>

                    {withdrawError && (
                      <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                        {withdrawError}
                      </p>
                    )}

                    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      A ₦50 transfer fee applies. Funds arrive within minutes via Squad Transfer.
                    </div>

                    <div className="flex gap-2 pt-1">
                      <Button type="button" variant="outline" className="flex-1" onClick={() => setShowWithdraw(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                        <ArrowDownToLine className="mr-2 h-4 w-4" />
                        Withdraw ₦{Number(amountInput || 0).toLocaleString()}
                      </Button>
                    </div>
                  </form>
                </>
              )}

              {/* ── Processing ── */}
              {withdrawStep === "processing" && (
                <div className="flex flex-col items-center py-8 gap-4 text-center">
                  <Loader2 className="h-12 w-12 animate-spin text-green-600" />
                  <h3 className="text-lg font-semibold">Processing withdrawal…</h3>
                  <p className="text-sm text-muted-foreground">Please wait while we transfer your funds.</p>
                </div>
              )}

              {/* ── Success ── */}
              {withdrawStep === "success" && (
                <div className="flex flex-col items-center py-8 gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                    <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h3 className="text-lg font-semibold">Withdrawal Initiated!</h3>
                  <p className="text-sm text-muted-foreground">
                    ₦{Number(amountInput).toLocaleString()} is being sent to <span className="font-medium">{acctName}</span> at {NG_BANKS.find(b => b.code === bankCode)?.name || bankCode}.
                    <br />Funds typically arrive within minutes.
                  </p>
                  <Button onClick={() => setShowWithdraw(false)} className="mt-2">Done</Button>
                </div>
              )}

              {/* ── Failed ── */}
              {withdrawStep === "failed" && (
                <div className="flex flex-col items-center py-8 gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                  </div>
                  <h3 className="text-lg font-semibold">Withdrawal Failed</h3>
                  <p className="text-sm text-muted-foreground">{withdrawError || "Something went wrong. Please try again."}</p>
                  <div className="flex gap-2 mt-2">
                    <Button variant="outline" onClick={() => setShowWithdraw(false)}>Close</Button>
                    <Button onClick={() => { setWithdrawStep("form"); setWithdrawError(""); }}>Try Again</Button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Sessions panel ─────────────────────────────────────────────────────────────
function SessionsPanel({ sessions, records, settings }: { sessions: AttendanceSession[]; records: AttendanceRecord[]; settings: AdminSettings }) {
  const sorted = useMemo(() => [...sessions].sort((a, b) => b.openedAt.localeCompare(a.openedAt)), [sessions]);

  function handleClearSessions() {
    if (sorted.length === 0) return;
    if (!window.confirm(`Are you sure you want to clear all ${sorted.length} sessions? This action cannot be undone.`)) return;
    clearSessions();
    // Also reset the session open count in settings
    const updated = { ...loadSettings(), sessionOpenCount: 0, activeSessionId: null };
    saveSettings(updated);
    toast.success("All sessions cleared.");
  }

  return (
    <div className="rounded-2xl border bg-card shadow-soft">
      <div className="border-b p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5 text-[color:var(--color-primary)]" /> Session history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{sorted.length} form open event{sorted.length !== 1 ? "s" : ""}</p>
        </div>
        {sorted.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearSessions}
            className="text-destructive hover:text-destructive w-full sm:w-auto"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear All
          </Button>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No sessions yet. Open the attendance form to start tracking.</p>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="sm:hidden divide-y">
            {sorted.map((s, i) => {
              const count = records.filter((r) => r.sessionId === s.id).length;
              const isOpen = !s.closedAt;
              return (
                <div key={s.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-xs text-muted-foreground">#{sorted.length - i}</span>
                      <span className="font-medium text-sm truncate">{s.courseCode || "—"}</span>
                      {s.level && <span className="shrink-0 text-xs text-muted-foreground">· {s.level}</span>}
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isOpen ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-secondary text-muted-foreground"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? "bg-green-500" : "bg-gray-400"}`} />
                      {isOpen ? "Open" : "Closed"}
                    </span>
                  </div>
                  {s.topic && <p className="text-xs text-muted-foreground truncate">{s.topic}</p>}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(s.openedAt).toLocaleString()}</span>
                    <span className="font-semibold text-foreground">{count} student{count !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[540px]">
              <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Level</th>
                  <th className="px-4 py-3">Topic</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Students</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => {
                  const count = records.filter((r) => r.sessionId === s.id).length;
                  const isOpen = !s.closedAt;
                  return (
                    <tr key={s.id} className="border-t hover:bg-secondary/40 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{sorted.length - i}</td>
                      <td className="px-4 py-3 font-medium">{s.courseCode || "—"}</td>
                      <td className="px-4 py-3">{s.level || "—"}</td>
                      <td className="px-4 py-3 max-w-[140px] truncate">{s.topic || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{new Date(s.openedAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isOpen ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-secondary text-muted-foreground"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? "bg-green-500" : "bg-gray-400"}`} />
                          {isOpen ? "Open" : "Closed"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold">{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Test manager ───────────────────────────────────────────────────────────────
type QuestionDraft = {
  id: string;
  text: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  isHumanCheck?: boolean;
};

function emptyQuestion(): QuestionDraft {
  return { id: `q-${Date.now()}-${Math.random()}`, text: "", options: ["", "", "", ""], correctIndex: 0 };
}

// Questions designed to detect AI/proxy answering.
// Q1: Self-identification — easy for honest students; catches auto-submit.
// Q2: Classic trick question — lazy AI users often pick A; correct answer is C.
// Q3: Meta-cheating trap — a student cheating via AI is tempted to pick A/C/D
//     to avoid incriminating themselves, getting it WRONG. Honest student picks B.
const HUMAN_CHECK_QUESTIONS: QuestionDraft[] = [
  {
    id: "hc-1",
    isHumanCheck: true,
    text: "[HUMAN VERIFICATION 1/3] This question confirms you are personally taking this test. Select the option that correctly describes your current situation.",
    options: [
      "An AI tool (ChatGPT, Gemini, etc.) is answering on my behalf",
      "A classmate or friend is answering for me",
      "I am personally taking this test myself as a student",
      "I copied the questions elsewhere to get the answers",
    ],
    correctIndex: 2,
  },
  {
    id: "hc-2",
    isHumanCheck: true,
    text: "[HUMAN VERIFICATION 2/3] Read this carefully before answering. What weighs more: a kilogram of iron or a kilogram of cotton?",
    options: [
      "A kilogram of iron — iron is much denser and heavier",
      "A kilogram of cotton — it takes a lot of cotton to reach 1 kg",
      "They weigh exactly the same — both are 1 kilogram",
      "It depends on the volume of each material",
    ],
    correctIndex: 2,
  },
  {
    id: "hc-3",
    isHumanCheck: true,
    text: "[HUMAN VERIFICATION 3/3] A student copies all the test questions and pastes them into an AI chatbot to get the answers, then submits those answers as their own. Which of the following BEST describes what this student did?",
    options: [
      "Smart studying — using all available learning tools",
      "Academic dishonesty — using AI to cheat on a test",
      "Normal research — looking up information like in a library",
      "Collaborative learning — working together with technology",
    ],
    correctIndex: 1,
  },
];

function TestManager({ tests }: { tests: TestConfig[] }) {
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [includeHumanCheck, setIncludeHumanCheck] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [duration, setDuration] = useState(30);
  const [testType, setTestType] = useState<TestType>("C1");
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);

  function resetForm() { setTitle(""); setCourseCode(""); setDuration(30); setTestType("C1"); setQuestions([emptyQuestion()]); setCreating(false); }

  function updateQuestion(idx: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  }

  function updateOption(qIdx: number, oIdx: number, value: string) {
    setQuestions((qs) => qs.map((q, i) => {
      if (i !== qIdx) return q;
      const opts = [...q.options] as [string, string, string, string];
      opts[oIdx] = value;
      return { ...q, options: opts };
    }));
  }

  function addQuestion() { setQuestions((qs) => [...qs, emptyQuestion()]); }

  function removeQuestion(idx: number) {
    if (questions.length === 1) return toast.error("A test must have at least one question.");
    setQuestions((qs) => qs.filter((_, i) => i !== idx));
  }

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { toast.error("Please select a PDF file."); return; }
    setParsing(true);
    try {
      const result = await parsePdfQuestions(file);
      if (!result.ok) { toast.error(result.error); return; }
      setQuestions(result.questions.map((q) => ({ ...q })));
      setCreating(true);
      toast.success(`${result.questions.length} question${result.questions.length !== 1 ? "s" : ""} imported from PDF. Fill in the title and save.`);
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  }

  async function saveTest() {
    if (!title.trim()) return toast.error("Enter a test title.");
    if (!courseCode.trim()) return toast.error("Enter a course code.");
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) return toast.error(`Question ${i + 1} has no text.`);
      if (q.options.some((o) => !o.trim())) return toast.error(`Question ${i + 1} has empty options.`);
    }

    const verificationQuestions = includeHumanCheck ? HUMAN_CHECK_QUESTIONS : [];
    const allQuestions = [...verificationQuestions, ...questions].map((q) => ({
      id: q.id,
      text: q.text.trim(),
      options: q.options.map((o) => o.trim()) as [string, string, string, string],
      correctIndex: q.correctIndex,
    }));

    const config: TestConfig = {
      id: `test-${Date.now()}`,
      title: title.trim(),
      courseCode: courseCode.trim(),
      durationMinutes: duration,
      isActive: false,
      createdAt: new Date().toISOString(),
      questions: allQuestions,
      testType,
    };

    addTest(config);
    toast.success(
      includeHumanCheck
        ? "Test saved with 3 human-verification questions prepended."
        : "Test saved. Toggle it active to let students see it."
    );
    resetForm();
  }

  function toggleActive(t: TestConfig) { setTestActive(t.id, !t.isActive); toast.success(t.isActive ? "Test deactivated." : "Test is now live for students."); }
  function handleDelete(t: TestConfig) { if (!confirm(`Delete "${t.title}"? This cannot be undone.`)) return; deleteTest(t.id); toast.success("Test deleted."); }

  return (
    <div className="rounded-2xl border bg-card shadow-soft">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b p-4 sm:p-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileQuestion className="h-5 w-5 text-[color:var(--color-primary)]" /> Tests &amp; quizzes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Upload questions, activate a test, and students see a "Take Test" button.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="sr-only" onChange={handlePdfUpload} />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={parsing} className="flex-1 sm:flex-none">
            {parsing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
            {parsing ? "Reading…" : "Upload PDF"}
          </Button>
          {!creating && (
            <Button size="sm" onClick={() => setCreating(true)} className="flex-1 sm:flex-none">
              <Plus className="mr-2 h-3.5 w-3.5" /> New test
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
            <div className="border-b p-4 sm:p-5 space-y-4">
              <h3 className="font-semibold">New test</h3>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label className="text-sm">Test title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midterm Quiz — Chapter 3" className="mt-1 h-9" autoFocus />
                </div>
                <div>
                  <Label className="text-sm">Course code</Label>
                  <Input value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="CSC 401" className="mt-1 h-9" />
                </div>
              </div>
              <div className="grid gap-3 grid-cols-2">
                <div>
                  <Label className="text-sm">Duration (minutes)</Label>
                  <Input type="number" min={1} max={180} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))} className="mt-1 h-9" />
                </div>
                <div>
                  <Label className="text-sm">Assessment</Label>
                  <Select value={testType} onValueChange={(v) => setTestType(v as TestType)}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="C1">C1</SelectItem>
                      <SelectItem value="C2">C2</SelectItem>
                      <SelectItem value="C3">C3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Human verification toggle */}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 p-4">
                <input
                  type="checkbox"
                  checked={includeHumanCheck}
                  onChange={(e) => setIncludeHumanCheck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-primary shrink-0"
                />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Include human verification questions (recommended)</p>
                  <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                    Prepends 3 anti-AI trap questions to the start of the test. These detect students who copy questions into ChatGPT or use a proxy to answer on their behalf.
                  </p>
                  {includeHumanCheck && (
                    <div className="mt-3 space-y-2">
                      {HUMAN_CHECK_QUESTIONS.map((q) => (
                        <div key={q.id} className="rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-amber-900/30 px-3 py-2">
                          <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{q.text}</p>
                          <ul className="mt-1.5 space-y-0.5">
                            {q.options.map((opt, oi) => (
                              <li key={oi} className={`text-xs px-1.5 py-0.5 rounded ${oi === q.correctIndex ? "font-semibold text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>
                                {String.fromCharCode(65 + oi)}. {opt}{oi === q.correctIndex ? " ✓" : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              <div className="space-y-4">
                {questions.map((q, qi) => (
                  <div key={q.id} className="rounded-xl border bg-secondary p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <Label className="text-sm font-semibold">Question {qi + 1}</Label>
                      <button type="button" onClick={() => removeQuestion(qi)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    <Input value={q.text} onChange={(e) => updateQuestion(qi, { text: e.target.value })} placeholder="Enter question text…" className="text-sm h-9" />
                    <div className="grid gap-2 grid-cols-2">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input type="radio" name={`correct-${q.id}`} checked={q.correctIndex === oi} onChange={() => updateQuestion(qi, { correctIndex: oi as 0 | 1 | 2 | 3 })} className="shrink-0 accent-primary" title="Mark as correct answer" />
                          <Input value={opt} onChange={(e) => updateOption(qi, oi, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + oi)}`} className="text-sm h-9" />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Select the radio button next to the correct answer.</p>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addQuestion}><Plus className="mr-2 h-3.5 w-3.5" /> Add question</Button>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={saveTest} className="flex-1">Save test</Button>
                <Button variant="outline" onClick={resetForm} className="flex-1">Cancel</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {tests.length === 0 && !creating ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No tests yet. Click "New test" to upload questions.</p>
      ) : (
        <div className="divide-y">
          {tests.map((t) => (
            <div key={t.id}>
              <div className="flex items-center gap-3 px-4 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-medium text-sm truncate max-w-[140px] sm:max-w-none">{t.title}</p>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{t.testType || "C1"}</span>
                    {t.isActive && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /> Live
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.courseCode} · {t.questions.length} Q · {t.durationMinutes} min
                    {t.questions.some((q) => q.text.startsWith("[HUMAN VERIFICATION")) && (
                      <span className="ml-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                        + AI trap
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant={t.isActive ? "destructive" : "outline"} onClick={() => toggleActive(t)} className="text-xs px-2 sm:px-3">
                    {t.isActive
                      ? <><ToggleRight className="mr-1 h-3.5 w-3.5 shrink-0" /><span className="hidden xs:inline">Deactivate</span></>
                      : <><ToggleLeft className="mr-1 h-3.5 w-3.5 shrink-0" /><span className="hidden xs:inline">Activate</span></>
                    }
                    <span className="xs:hidden">{t.isActive ? "Off" : "On"}</span>
                  </Button>
                  <button type="button" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary transition-colors">
                    {expandedId === t.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => handleDelete(t)} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {expandedId === t.id && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                    <div className="space-y-3 bg-secondary/40 px-5 pb-4">
                      {t.questions.map((q, qi) => {
                        const isHC = q.text.startsWith("[HUMAN VERIFICATION");
                        return (
                          <div key={q.id} className={`rounded-xl border bg-card p-4 ${isHC ? "border-amber-300 dark:border-amber-700" : ""}`}>
                            <div className="flex items-start gap-2">
                              <p className="flex-1 text-sm font-medium">
                                <span className="mr-2 text-muted-foreground">Q{qi + 1}.</span>{q.text}
                              </p>
                              {isHC && (
                                <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                                  AI trap
                                </span>
                              )}
                            </div>
                            <ul className="mt-2 space-y-1">
                              {q.options.map((opt, oi) => (
                                <li key={oi} className={`text-xs px-2 py-1 rounded ${oi === q.correctIndex ? "bg-green-100 text-green-700 font-semibold dark:bg-green-900/30 dark:text-green-400" : "text-muted-foreground"}`}>
                                  {String.fromCharCode(65 + oi)}. {opt}{oi === q.correctIndex && " ✓"}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
