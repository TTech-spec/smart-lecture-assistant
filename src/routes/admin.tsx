import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, MapPin, Lock, Unlock, Sparkles, Users, Trash2, RefreshCw, Loader2, Send, LogOut, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  loadRecords, loadSettings, saveSettings, isWindowOpen, minutesRemaining,
  type AdminSettings, type AttendanceRecord, saveRecords,
} from "@/lib/attendance-store";
import { getCurrentPosition } from "@/lib/geo";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Lecturer dashboard — Attendly" },
      { name: "description", content: "Pin the class location, set the radius and time window, and review attendance." },
    ],
  }),
  component: AdminPage,
});

const AUTH_KEY = "att.admin.auth.v1";
const PASS_KEY = "att.admin.pass.v1";
const DEFAULT_PASS = "lecturer123";

function getStoredPass(): string {
  if (typeof window === "undefined") return DEFAULT_PASS;
  return localStorage.getItem(PASS_KEY) || DEFAULT_PASS;
}

function useStore() {
  const [settings, setSettings] = useState<AdminSettings>(() => loadSettings());
  const [records, setRecords] = useState<AttendanceRecord[]>(() => loadRecords());
  useEffect(() => {
    const syncS = () => setSettings(loadSettings());
    const syncR = () => setRecords(loadRecords());
    window.addEventListener("att:settings", syncS);
    window.addEventListener("att:records", syncR);
    window.addEventListener("storage", () => { syncS(); syncR(); });
    return () => {
      window.removeEventListener("att:settings", syncS);
      window.removeEventListener("att:records", syncR);
    };
  }, []);
  return { settings, setSettings, records, setRecords };
}

function AdminPage() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(sessionStorage.getItem(AUTH_KEY) === "1");
  }, []);

  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;
  return <AdminDashboard onLogout={() => { sessionStorage.removeItem(AUTH_KEY); setAuthed(false); }} />;
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [pass, setPass] = useState("");
  const [showHint, setShowHint] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pass === getStoredPass()) {
      sessionStorage.setItem(AUTH_KEY, "1");
      toast.success("Welcome back, lecturer.");
      onSuccess();
    } else {
      toast.error("Wrong password.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
      </header>
      <main className="mx-auto flex max-w-md flex-col items-center px-6 pt-16">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">Lecturer access only</h1>
        <p className="mt-2 text-center text-muted-foreground">
          Enter the admin password to open the dashboard. Students don't have access to this area.
        </p>
        <form onSubmit={submit} className="mt-8 w-full rounded-2xl border bg-card p-6 shadow-soft">
          <Label htmlFor="pass">Admin password</Label>
          <Input
            id="pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            placeholder="Enter password" className="mt-2" autoFocus
          />
          <Button type="submit" className="mt-4 w-full">Unlock dashboard</Button>
          <button
            type="button"
            onClick={() => setShowHint((s) => !s)}
            className="mt-3 block w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {showHint ? `Default password: ${DEFAULT_PASS}` : "Forgot password?"}
          </button>
        </form>
      </main>
    </div>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const { settings, records } = useStore();
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
    <div className="min-h-screen bg-gradient-hero">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Lecturer dashboard</span>
          <Button size="sm" variant="outline" onClick={onLogout}>
            <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Today's session</h1>
            <p className="mt-1 text-muted-foreground">Pin the class location, set the rules, watch sign-ins come in.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-soft">
            <span className={`h-2 w-2 rounded-full ${open ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-warning)]"}`} />
            {open ? (
              <span>Form open · {minsLeft === Infinity ? "no limit" : `${minsLeft} min left`}</span>
            ) : (
              <span>Form locked</span>
            )}
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <SettingsCard />
          <div className="lg:col-span-2 grid gap-6">
            <StatsRow records={todays} />
            <AIAssistant records={records} />
            <RecordsTable records={records} />
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingsCard() {
  const { settings } = useStore();
  const [draft, setDraft] = useState<AdminSettings>(settings);
  const [pinning, setPinning] = useState(false);

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
      toast.success("Class location pinned.");
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
    const next = { ...draft, windowOpenedAt: new Date().toISOString() };
    setDraft(next);
    saveSettings(next);
    toast.success("Attendance form opened.");
  }

  function closeWindow() {
    const next = { ...draft, windowOpenedAt: null };
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

  const pinned = draft.classLat != null && draft.classLng != null;

  return (
    <aside className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <MapPin className="h-5 w-5 text-[color:var(--color-primary)]" /> Class settings
      </h2>

      <div className="mt-5 space-y-4">
        <div className="rounded-xl border bg-secondary p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Class location</p>
          {pinned ? (
            <p className="mt-1 font-mono text-sm">
              {draft.classLat!.toFixed(5)}, {draft.classLng!.toFixed(5)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Not pinned yet.</p>
          )}
          <Button onClick={pinHere} disabled={pinning} className="mt-3 w-full" variant="outline">
            {pinning ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading GPS…</>) : (<><MapPin className="mr-2 h-4 w-4" /> Pin my current spot</>)}
          </Button>
        </div>

        <div>
          <Label className="text-sm">Allowed radius (meters)</Label>
          <Input
            type="number" min={10} max={5000}
            value={draft.radiusMeters}
            onChange={(e) => update("radiusMeters", Math.max(10, Number(e.target.value) || 0))}
          />
        </div>

        <div>
          <Label className="text-sm">Form open for (minutes, 0 = no limit)</Label>
          <Input
            type="number" min={0} max={720}
            value={draft.windowMinutes}
            onChange={(e) => update("windowMinutes", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Course code</Label>
            <Input value={draft.courseCode} onChange={(e) => update("courseCode", e.target.value)} placeholder="CSC 401" />
          </div>
          <div>
            <Label className="text-sm">Topic</Label>
            <Input value={draft.topic} onChange={(e) => update("topic", e.target.value)} placeholder="Distributed Systems" />
          </div>
        </div>

        <Button onClick={save} className="w-full" variant="secondary">Save settings</Button>

        <div className="flex gap-2">
          <Button onClick={openWindow} className="flex-1"><Unlock className="mr-2 h-4 w-4" /> Open form</Button>
          <Button onClick={closeWindow} variant="outline" className="flex-1"><Lock className="mr-2 h-4 w-4" /> Lock form</Button>
        </div>

        <button
          type="button"
          onClick={changePassword}
          className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Change admin password
        </button>
      </div>
    </aside>
  );
}

function StatsRow({ records }: { records: AttendanceRecord[] }) {
  const departments = new Set(records.map((r) => r.department.toLowerCase())).size;
  const courses = new Set(records.map((r) => r.courseCode.toLowerCase())).size;
  const cards = [
    { label: "Sign-ins today", value: records.length, icon: Users },
    { label: "Departments", value: departments, icon: Users },
    { label: "Courses", value: courses, icon: Users },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
              <c.icon className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-semibold">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function answerLocally(q: string, records: AttendanceRecord[]): string {
  const ql = q.toLowerCase().trim();
  if (!records.length) return "No attendance has been recorded yet.";

  const deptMatch = ql.match(/from ([a-z &/-]+?)(?:\s+(?:signed|department|today|submitted|attended)|\?|$)/);
  if (deptMatch) {
    const dept = deptMatch[1].trim();
    const matches = records.filter((r) => r.department.toLowerCase().includes(dept));
    if (!matches.length) return `No one from ${dept} has signed yet.`;
    const names = matches.map((r) => `• ${r.fullName} (${r.matricNumber}) — ${r.courseCode}`).join("\n");
    return `${matches.length} from ${dept}:\n${names}`;
  }

  if (/how many|count|total/.test(ql)) {
    if (/female/.test(ql)) return `${records.filter((r) => r.gender === "female").length} female sign-ins.`;
    if (/male/.test(ql)) return `${records.filter((r) => r.gender === "male").length} male sign-ins.`;
    return `${records.length} sign-ins recorded in total.`;
  }

  if (/department/.test(ql)) {
    const groups = new Map<string, number>();
    records.forEach((r) => groups.set(r.department, (groups.get(r.department) || 0) + 1));
    return Array.from(groups.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => `• ${d}: ${n}`)
      .join("\n");
  }

  if (/course/.test(ql)) {
    const groups = new Map<string, number>();
    records.forEach((r) => groups.set(r.courseCode, (groups.get(r.courseCode) || 0) + 1));
    return Array.from(groups.entries()).map(([c, n]) => `• ${c}: ${n}`).join("\n");
  }

  return "Try: 'Who from Computer Science signed today?', 'How many female students?', or 'Breakdown by department'.";
}

function AIAssistant({ records }: { records: AttendanceRecord[] }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setAnswer(answerLocally(q, records));
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Sparkles className="h-5 w-5 text-[color:var(--color-primary)]" /> Ask the AI
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Try "Who from Computer Science signed today?" or "How many female students?"
      </p>
      <form onSubmit={ask} className="mt-4 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about today's attendance…" />
        <Button type="submit"><Send className="h-4 w-4" /></Button>
      </form>
      {answer && (
        <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-secondary p-4 font-sans text-sm">{answer}</pre>
      )}
    </div>
  );
}

function RecordsTable({ records }: { records: AttendanceRecord[] }) {
  const [matric, setMatric] = useState("");
  const [dept, setDept] = useState<string>("all");
  const [gender, setGender] = useState<string>("all");

  const departments = useMemo(() => {
    const set = new Set(records.map((r) => r.department).filter(Boolean));
    return Array.from(set).sort();
  }, [records]);

  const filtered = useMemo(() => {
    const m = matric.toLowerCase().trim();
    const sorted = [...records].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return sorted.filter((r) => {
      if (m && !r.matricNumber.toLowerCase().includes(m)) return false;
      if (dept !== "all" && r.department !== dept) return false;
      if (gender !== "all" && r.gender !== gender) return false;
      return true;
    });
  }, [records, matric, dept, gender]);

  function clearAll() {
    if (!confirm("Clear all attendance records?")) return;
    saveRecords([]);
    toast.success("Records cleared.");
  }

  function resetFilters() {
    setMatric(""); setDept("all"); setGender("all");
  }

  return (
    <div className="rounded-2xl border bg-card shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 className="text-lg font-semibold">Attendance records</h2>
          <p className="text-sm text-muted-foreground">{filtered.length} of {records.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={resetFilters} title="Reset filters"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" onClick={clearAll} title="Clear all"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-3 border-b p-5 sm:grid-cols-3">
        <div>
          <Label className="text-xs text-muted-foreground">Matric number</Label>
          <Input
            value={matric} onChange={(e) => setMatric(e.target.value)}
            placeholder="e.g. CSC/19/1234" className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Department</Label>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="All departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Gender</Label>
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="All genders" /></SelectTrigger>
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
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Matric</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Course</th>
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">Gender</th>
              <th className="px-4 py-3">Distance</th>
              <th className="px-4 py-3">Time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No records match these filters.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-3 font-medium">{r.fullName}</td>
                <td className="px-4 py-3">{r.matricNumber}</td>
                <td className="px-4 py-3">{r.department}</td>
                <td className="px-4 py-3">{r.courseCode}</td>
                <td className="px-4 py-3">{r.topic}</td>
                <td className="px-4 py-3 capitalize">{r.gender}</td>
                <td className="px-4 py-3">{r.distanceMeters} m</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(r.submittedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
