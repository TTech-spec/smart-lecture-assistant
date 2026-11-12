import { createFileRoute } from "@tanstack/react-router";
import { Textarea } from "@/components/ui/textarea";
import { LeafletMap } from "@/components/LeafletMap";
import { friendlyError } from "@/lib/friendly-error";
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
import { changeLecturerPassword } from "@/lib/lecturer-auth";
import { useStore } from "@/hooks/use-store";
import { lecturerPayOutstanding, lecturerPaymentsSummary } from "@/lib/payments-server";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/manage")({
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
  const [tab, setTab] = useState<"settings" | "tests" | "stats" | "history">("settings");
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
    <main className="mx-auto max-w-7xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8 lg:pb-16">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
      >
        <div>
          <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">Tests & settings</h1>
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

      {/* Phones and tablets: one section at a time */}
      <div className="sticky top-0 z-20 -mx-4 mt-6 bg-[#f6f8f8]/95 px-4 py-2 backdrop-blur lg:hidden dark:bg-background/95">
        <div className="flex gap-1.5 overflow-x-auto rounded-full bg-secondary/70 p-1 [scrollbar-width:none]">
          {([["settings", "Class settings"], ["tests", "Tests"], ["stats", "Stats & earnings"], ["history", "History"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setTab(k); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-pressed={tab === k}
              className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors ${tab === k ? "bg-card text-foreground shadow-soft" : "text-muted-foreground"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-3">
        <div className={tab === "settings" ? "" : "hidden lg:block"}>
          <SettingsCard />
        </div>

        <div className="grid min-w-0 gap-6 lg:col-span-2">
          <div className={`grid gap-6 ${tab === "stats" ? "" : "hidden lg:grid"}`}>
            <StatsRow records={todays} allRecords={records} settings={settings} />
            <EarningsDisplay />
          </div>
          <div className={tab === "tests" ? "" : "hidden lg:block"}>
            <TestManager tests={tests} />
          </div>
          <div className={tab === "history" ? "" : "hidden lg:block"}>
            <SessionsPanel sessions={sessions} records={records} settings={settings} />
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Radius hint ────────────────────────────────────────────────────────────────
/** Free OpenStreetMap preview of the class pin (loads only in the browser). */
function ClientMap({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div className="h-56 w-full bg-secondary/50" />;
  return <LeafletMap center={{ lat, lng }} radius={radius} className="h-56 w-full" zoom={17} />;
}

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
      toast.error(friendlyError(e, "Could not read GPS."));
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

  async function changePassword() {
    const current = prompt("Enter current password:");
    if (current == null) return;
    const next = prompt("Enter a new password (min 8 characters):");
    if (next == null) return;
    try {
      await changeLecturerPassword(current, next);
      toast.success("Password updated.");
    } catch (err) {
      toast.error(friendlyError(err, "Could not change password."));
    }
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
          {typeof draft.classLat === "number" && typeof draft.classLng === "number" &&
          Math.abs(draft.classLat) <= 90 && Math.abs(draft.classLng) <= 180 ? (
            <div className="mt-3 overflow-hidden rounded-lg border">
              <ClientMap lat={draft.classLat} lng={draft.classLng} radius={draft.radiusMeters ?? 100} />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${draft.classLat},${draft.classLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-background px-3 py-2 text-xs font-medium text-[color:var(--color-primary)] hover:underline"
              >
                Open in Google Maps ↗
              </a>
            </div>
          ) : (
            <div className="mt-3 flex h-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              Enter coordinates or auto-detect to see the map
            </div>
          )}
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

        <div className="sm:col-span-2">
          <Label className="text-sm">Campus internet addresses (optional)</Label>
          <Input value={draft.campusIpPrefixes ?? ""} onChange={(e) => update("campusIpPrefixes", e.target.value.replace(/[^0-9a-fA-F.:, ]/g, ""))} placeholder="e.g. 102.89., 41.58.10." />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Check-ins from other networks are flagged for review, not blocked. Ask your IT unit for the campus Wi-Fi address range, or copy the start of the "Network" address shown on flagged check-ins in To review. Leave empty to turn this check off.
          </p>
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

              <p className="text-xs text-muted-foreground">
                Students of <strong>any level</strong> get a <strong>unique code</strong> tied to their matric number.
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
  type Summary = Extract<Awaited<ReturnType<typeof lecturerPaymentsSummary>>, { ok: true }>;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  async function token() {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    return data.session?.access_token ?? null;
  }

  async function load() {
    const t = await token();
    if (!t) { setError("Sign in with your lecturer account to see earnings."); return; }
    try {
      const r = await lecturerPaymentsSummary({ data: { accessToken: t } });
      if (r.ok) { setSummary(r); setError(null); }
      else setError(r.message === "not_lecturer" ? "This account isn't on the lecturers list." : r.message);
    } catch (e) {
      const msg = friendlyError(e, "");
      setError(/SUPABASE_SERVICE_ROLE_KEY/.test(msg)
        ? "Payments aren't set up yet: add SUPABASE_SERVICE_ROLE_KEY to your hosting's secrets."
        : "Couldn't load earnings. Check your connection and try again.");
    }
  }
  useEffect(() => { load(); }, []);

  async function payNow() {
    const t = await token();
    if (!t) return;
    setPaying(true);
    try {
      const r = await lecturerPayOutstanding({ data: { accessToken: t } });
      if (!r.ok) toast.error(r.message);
      else if (r.paidCount > 0) toast.success(`Sent ₦${r.paidAmount.toLocaleString()} for ${r.paidCount} sale(s) to the bank account saved on each material.`);
      else if (r.failedCount > 0) toast.error("The transfer didn't go through. Check the bank details on your paid materials and your Squad balance.");
      else toast.info("Nothing is owed right now.");
      await load();
    } catch {
      toast.error("Couldn't send the payout. Try again.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">Earnings from materials</h2>
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>
      {error ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{error}</p>
      ) : !summary ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">Total earned</p><p className="mt-1 text-xl font-semibold">₦{summary.earned.toLocaleString()}</p></div>
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">Sales</p><p className="mt-1 text-xl font-semibold">{summary.salesCount}</p></div>
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">Still owed to you</p><p className="mt-1 text-xl font-semibold">₦{summary.owed.toLocaleString()}</p></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Each sale is paid automatically to the bank account saved on that material. If a transfer fails, it shows here as owed.
          </p>
          {summary.owed > 0 && (
            <Button className="mt-3" onClick={payNow} disabled={paying}>
              {paying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Pay out ₦{summary.owed.toLocaleString()} now
            </Button>
          )}
          {summary.payouts.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-muted-foreground">Recent transfers</p>
              <div className="mt-2 divide-y rounded-xl border">
                {summary.payouts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{new Date(p.created_at as string).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {p.kind === "platform" ? "Platform fee" : "To lecturer"} {p.account_number ?? ""}</span>
                    <span className={p.status === "sent" ? "font-medium" : "font-medium text-red-600"}>₦{Number(p.amount).toLocaleString()} {p.status === "sent" ? "" : "· failed"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

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
  kind?: "objective" | "theory";
  marks?: number;
  modelAnswer?: string;
};

function emptyQuestion(): QuestionDraft {
  return { id: `q-${Date.now()}-${Math.random()}`, text: "", options: ["", "", "", ""], correctIndex: 0 };
}

// AI-detection trap: looks like a normal question but AI tools consistently
// pick option B (confident, sounds authoritative) while the correct answer is C.
// A human reading it carefully picks C easily.
const AI_TRAP_QUESTION: QuestionDraft = {
  id: "ai-trap-1",
  text: "A student submits an assignment and tells the lecturer: 'I wrote every word myself, but I used an AI tool to check my grammar.' Which of the following BEST describes this situation?",
  options: [
    "Academic dishonesty — AI tools must never be used in any part of an assignment",
    "Fully acceptable — using AI for grammar checking is the same as using a spell-checker",
    "It depends on the institution's policy on AI-assisted work",
    "The student should be expelled for using technology",
  ],
  correctIndex: 2,
};

function TestManager({ tests }: { tests: TestConfig[] }) {
  const [creating, setCreating] = useState(false);
  const [inputMode, setInputMode] = useState<"manual" | "pdf">("manual");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [includeAiTrap, setIncludeAiTrap] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [duration, setDuration] = useState(30);
  const [testType, setTestType] = useState<TestType>("C1");
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);

  function resetForm() {
    setTitle(""); setCourseCode(""); setDuration(30); setTestType("C1");
    setQuestions([emptyQuestion()]); setCreating(false); setInputMode("manual");
  }

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
      setInputMode("pdf");
      toast.success(`${result.questions.length} question${result.questions.length !== 1 ? "s" : ""} imported from PDF.`);
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
      if (q.kind !== "theory" && q.options.some((o) => !o.trim())) return toast.error(`Question ${i + 1} has empty options.`);
      if (q.kind === "theory" && !(q.marks && q.marks >= 1)) return toast.error(`Question ${i + 1} needs marks (1 or more).`);
    }
    // Insert AI trap at a random middle position so it doesn't stand out
    let allQuestions = [...questions];
    if (includeAiTrap) {
      const insertAt = Math.max(1, Math.floor(allQuestions.length / 2));
      allQuestions = [...allQuestions.slice(0, insertAt), AI_TRAP_QUESTION, ...allQuestions.slice(insertAt)];
    }
    const config: TestConfig = {
      id: `test-${Date.now()}`,
      title: title.trim(),
      courseCode: courseCode.trim(),
      durationMinutes: duration,
      isActive: false,
      createdAt: new Date().toISOString(),
      questions: allQuestions.map((q) => ({
        id: q.id,
        text: q.text.trim(),
        options: q.options.map((o) => o.trim()) as [string, string, string, string],
        correctIndex: q.correctIndex,
        ...(q.kind === "theory" ? { kind: "theory" as const, marks: q.marks, modelAnswer: q.modelAnswer?.trim() || "" } : {}),
      })),
      testType,
    };
    addTest(config);
    toast.success("Test saved. Toggle it active when ready for students.");
    resetForm();
  }

  function toggleActive(t: TestConfig) {
    setTestActive(t.id, !t.isActive);
    toast.success(t.isActive ? "Test deactivated." : "Test is now live for students.");
  }
  function handleDelete(t: TestConfig) {
    if (!confirm(`Delete "${t.title}"? This cannot be undone.`)) return;
    deleteTest(t.id);
    toast.success("Test deleted.");
  }

  return (
    <div id="tests-quizzes" className="rounded-2xl border bg-card shadow-soft scroll-mt-24">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b p-4 sm:p-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileQuestion className="h-5 w-5 text-[color:var(--color-primary)]" /> Tests &amp; quizzes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Type questions manually or upload a PDF, then activate for students.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="sr-only" onChange={handlePdfUpload} />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={parsing} className="flex-1 sm:flex-none">
            {parsing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
            {parsing ? "Reading…" : "Upload PDF"}
          </Button>
          {!creating && (
            <Button size="sm" onClick={() => { setInputMode("manual"); setCreating(true); }} className="flex-1 sm:flex-none">
              <Plus className="mr-2 h-3.5 w-3.5" /> New test
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
            <div className="border-b p-4 sm:p-5 space-y-4">
              {/* Header + mode tabs */}
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">New test</h3>
                <div className="flex rounded-lg border overflow-hidden text-xs font-medium">
                  <button type="button" onClick={() => setInputMode("manual")}
                    className={`px-3 py-1.5 transition-colors ${inputMode === "manual" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary"}`}>
                    ✏️ Type manually
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className={`px-3 py-1.5 transition-colors border-l ${inputMode === "pdf" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary"}`}>
                    📄 Upload PDF
                  </button>
                </div>
              </div>
              <details className="rounded-xl border bg-secondary/40 p-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">How to write the PDF (objective and theory in one file)</summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-5">{`1. Which layer handles routing?
A) Physical
B) Network
C) Session
D) Transport
Answer: B

2. Explain two differences between TCP and UDP. (5 marks)
Guide: TCP is reliable and connection-oriented; UDP is faster and connectionless.`}</pre>
                <p className="mt-2">A question with A–D options and an Answer line becomes objective. A question without options becomes theory: put the marks in brackets, and a Guide line if you want the AI to mark against it (students never see the guide). Section headings like "SECTION B: THEORY" are fine.</p>
              </details>

              {/* Metadata */}
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

              {/* AI-detection trap toggle */}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 p-4">
                <input type="checkbox" checked={includeAiTrap} onChange={(e) => setIncludeAiTrap(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-primary shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-purple-800 dark:text-purple-300">Include AI-detection trap question (recommended)</p>
                  <p className="mt-0.5 text-xs text-purple-700 dark:text-purple-400">
                    Inserts one hidden trap question mid-test that looks like a normal question. AI tools almost always pick the wrong answer — honest students get it right easily.
                  </p>
                  {includeAiTrap && (
                    <div className="mt-3 rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-purple-900/30 px-3 py-2">
                      <p className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1.5">Preview (students won't know which question is the trap):</p>
                      <p className="text-xs font-semibold">{AI_TRAP_QUESTION.text}</p>
                      <ul className="mt-1.5 space-y-0.5">
                        {AI_TRAP_QUESTION.options.map((opt, oi) => (
                          <li key={oi} className={`text-xs px-1.5 py-0.5 rounded ${oi === AI_TRAP_QUESTION.correctIndex ? "font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20" : "text-muted-foreground"}`}>
                            {String.fromCharCode(65 + oi)}. {opt}{oi === AI_TRAP_QUESTION.correctIndex ? " ✓" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </label>

              {/* Questions list */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{questions.length} Question{questions.length !== 1 ? "s" : ""}</p>
                  {inputMode === "pdf" && <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full">Imported from PDF — edit as needed</span>}
                </div>
                {questions.map((q, qi) => (
                  <div key={q.id} className="rounded-xl border bg-secondary p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <Label className="text-sm font-semibold">Question {qi + 1}</Label>
                      <button type="button" onClick={() => removeQuestion(qi)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="inline-flex rounded-full border bg-card p-0.5 text-xs font-medium">
                      {([["objective", "Multiple choice"], ["theory", "Theory (written)"]] as const).map(([k, label]) => (
                        <button key={k} type="button"
                          onClick={() => updateQuestion(qi, k === "theory" ? { kind: "theory", marks: q.marks ?? 5 } : { kind: "objective" })}
                          className={`rounded-full px-3 py-1 transition-colors ${(q.kind ?? "objective") === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {q.kind === "theory" ? (
                      <Textarea value={q.text} onChange={(e) => updateQuestion(qi, { text: e.target.value })} placeholder="Enter the theory question…" className="text-sm min-h-16" />
                    ) : (
                    <Input value={q.text} onChange={(e) => updateQuestion(qi, { text: e.target.value })} placeholder="Enter question text…" className="text-sm h-9" />
                    )}
                    {q.kind === "theory" ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Marks</Label>
                          <Input type="number" min={1} max={100} value={q.marks ?? 5}
                            onChange={(e) => updateQuestion(qi, { marks: parseInt(e.target.value, 10) || 0 })} className="h-9 w-20 text-sm" />
                        </div>
                        <Textarea value={q.modelAnswer ?? ""} onChange={(e) => updateQuestion(qi, { modelAnswer: e.target.value })}
                          placeholder="Marking guide: the points a good answer should cover (students never see this; the AI uses it to suggest a mark)"
                          className="text-sm min-h-20" />
                        <p className="text-xs text-muted-foreground">Students type their answer. Pasting is blocked and how they typed it is recorded. You mark it on the Records page, with an AI suggestion.</p>
                      </div>
                    ) : (<>
                    <div className="grid gap-2 grid-cols-2">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input type="radio" name={`correct-${q.id}`} checked={q.correctIndex === oi}
                            onChange={() => updateQuestion(qi, { correctIndex: oi as 0 | 1 | 2 | 3 })}
                            className="shrink-0 accent-primary" title="Mark as correct answer" />
                          <Input value={opt} onChange={(e) => updateOption(qi, oi, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + oi)}`} className="text-sm h-9" />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Click the radio button next to the correct answer.</p>
                    </>)}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Add multiple-choice question
                  </Button>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setQuestions((qs) => [...qs, { ...emptyQuestion(), kind: "theory", marks: 5 }])}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Add theory question
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Optional: add a theory question or two if you want to catch students using AI. Their typing is recorded and you can check each answer when marking.</p>
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
                            {q.kind === "theory" ? (
                              <p className="mt-2 text-xs text-muted-foreground">Theory · {q.marks ?? 5} marks{q.modelAnswer ? ` · Guide: ${q.modelAnswer}` : ""}</p>
                            ) : (
                            <ul className="mt-2 space-y-1">
                              {q.options.map((opt, oi) => (
                                <li key={oi} className={`text-xs px-2 py-1 rounded ${oi === q.correctIndex ? "bg-green-100 text-green-700 font-semibold dark:bg-green-900/30 dark:text-green-400" : "text-muted-foreground"}`}>
                                  {String.fromCharCode(65 + oi)}. {opt}{oi === q.correctIndex && " ✓"}
                                </li>
                              ))}
                            </ul>
                            )}
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
