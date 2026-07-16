import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Link2, Plus, X, Copy, Ban, ChevronDown, ChevronUp,
  Clock, CheckCircle2, XCircle, Users, RefreshCw, QrCode, Trash2, KeyRound, FileQuestion,
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
  addLink, disableLink, deleteLink, generateToken, isLinkValid,
  fetchLinksFromSupabase, saveLinks, loadTests, addTestLink, loadTestLinks, deleteTestLink,
  type AttendanceLink, type TestConfig, type TestLink,
} from "@/lib/attendance-store";
import { useStore } from "@/hooks/use-store";

export const Route = createFileRoute("/admin/links")({
  head: () => ({ meta: [{ title: "Attendance links — Attendly" }] }),
  component: LinksPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAttendUrl(token: string): string {
  return `${window.location.origin}/attend/${token}`;
}

function buildTestUrl(token: string): string {
  return `${window.location.origin}/test/${token}`;
}

function linkStatus(link: AttendanceLink): "active" | "disabled" | "expired" {
  if (!link.isActive) return "disabled";
  if (new Date(link.expiresAt) <= new Date()) return "expired";
  return "active";
}

function testLinkStatus(link: TestLink): "active" | "disabled" | "expired" {
  if (!link.isActive) return "disabled";
  if (new Date(link.expiresAt) <= new Date()) return "expired";
  return "active";
}

function isTestLinkValid(link: TestLink, now = new Date()): boolean {
  return link.isActive && new Date(link.expiresAt) > now;
}

function StatusBadge({ link }: { link: AttendanceLink }) {
  const status = linkStatus(link);
  const map = {
    active:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    disabled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    expired:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };
  const Icon = status === "active" ? CheckCircle2 : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      <Icon className="h-3 w-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── QR Code modal ─────────────────────────────────────────────────────────────
function QrModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.93, y: 12 }} transition={{ duration: 0.22, ease: "circOut" }}
        className="relative w-full max-w-sm rounded-2xl border bg-card p-6 shadow-soft text-center"
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <X className="h-4 w-4" />
        </button>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow mx-auto">
          <QrCode className="h-6 w-6" />
        </div>
        <h2 className="mt-3 text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground break-all">{url}</p>
        <div className="mt-4 flex justify-center rounded-xl border bg-white p-3">
          <img src={qrSrc} alt="QR code" width={200} height={200} className="rounded" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Students can scan this QR code to open the link directly.
        </p>
        <Button variant="outline" size="sm" className="mt-4 w-full" onClick={onClose}>Close</Button>
      </motion.div>
    </motion.div>
  );
}

// ── Generate link form ────────────────────────────────────────────────────────
const EXPIRY_OPTIONS = [
  { label: "10 minutes", minutes: 10 },
  { label: "15 minutes", minutes: 15 },
  { label: "20 minutes", minutes: 20 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour",     minutes: 60 },
  { label: "2 hours",    minutes: 120 },
  { label: "24 hours",   minutes: 1440 },
];

function GenerateLinkForm({
  courses,
  onCreated,
}: {
  courses: string[];
  onCreated: (link: AttendanceLink) => void;
}) {
  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [expiryMinutes, setExpiryMinutes] = useState(15);
  const [creating, setCreating] = useState(false);
  const [linkType, setLinkType] = useState<"attendance" | "test" | null>(null); // null = not answered yet
  const [assignClassCode, setAssignClassCode] = useState<boolean | null>(null); // null = not answered yet
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null); // for test links
  const tests = loadTests();

  // Suggestions: courses that match what's been typed
  const suggestions = courses.filter(
    (c) => c.toLowerCase().includes(courseCode.toLowerCase()) && c !== courseCode.toUpperCase()
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error("Enter a title for this link.");
    if (!courseCode.trim()) return toast.error("Enter a course code.");
    if (linkType === null) return toast.error("Please select whether this link is for attendance or test.");
    if (linkType === "attendance" && assignClassCode === null) return toast.error("Please answer the class code question above.");
    if (linkType === "test" && !selectedTestId) return toast.error("Please select a test for this link.");
    setCreating(true);
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiryMinutes * 60_000).toISOString();

      if (linkType === "test") {
        // Create a test link
        const testLink: TestLink = {
          id: `tlnk-${Date.now()}`,
          testId: selectedTestId!,
          courseCode: courseCode.trim().toUpperCase(),
          title: title.trim(),
          token: generateToken(),
          isActive: true,
          createdAt: now.toISOString(),
          expiresAt,
        };
        await addTestLink(testLink);
        toast.success(`Test link "${testLink.title}" created and saved to database.`);
        // Copy the test link URL
        const url = buildTestUrl(testLink.token);
        navigator.clipboard.writeText(url).then(
          () => toast.success("Test link created and copied to clipboard."),
          () => toast.success("Test link created. Copy it from the list below."),
        );
      } else {
        // Create an attendance link
        const link: AttendanceLink = {
          id: `lnk-${Date.now()}`,
          courseCode: courseCode.trim().toUpperCase(),
          title: title.trim(),
          token: generateToken(),
          isActive: true,
          createdBy: "admin",
          createdAt: now.toISOString(),
          expiresAt,
          assignClassCode: linkType === "attendance" ? (assignClassCode ?? false) : false,
          linkType: linkType,
        };
        await addLink(link);
        toast.success(`Link "${link.title}" created and saved to database.`);
        onCreated(link);
      }
      
      setTitle("");
      setCourseCode("");
      setLinkType(null);
      setAssignClassCode(null);
      setSelectedTestId(null);
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation")) {
        toast.error(
          "Database table missing. Run attendance-links-migration.sql in your Supabase SQL Editor first, then try again.",
          { duration: 8000 }
        );
      } else {
        toast.error(`Could not save link: ${msg}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="space-y-4">
      {/* ── Link type prompt ── */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
            What type of link is this?
          </p>
        </div>
        <p className="text-xs text-blue-700 dark:text-blue-400">
          Select whether this link is for attendance or for a test.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setLinkType("attendance"); setAssignClassCode(null); setSelectedTestId(null); }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
              linkType === "attendance"
                ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                : "border-blue-300 bg-white text-blue-700 hover:bg-blue-100 dark:bg-background dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-900/30"
            }`}
          >
            📋 Attendance
          </button>
          <button
            type="button"
            onClick={() => { setLinkType("test"); setAssignClassCode(false); setSelectedTestId(null); }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
              linkType === "test"
                ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                : "border-blue-300 bg-white text-blue-700 hover:bg-blue-100 dark:bg-background dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-900/30"
            }`}
          >
          📝 Test
          </button>
        </div>
      </div>

      {/* ── Class code prompt (only for attendance links) ── */}
      {linkType === "attendance" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Do you want students to receive a unique class code when they submit attendance?
            </p>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            If yes, each student will see their personal class code immediately after marking attendance. The code is tied to their name and matric number.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAssignClassCode(true)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                assignClassCode === true
                  ? "border-amber-500 bg-amber-500 text-white shadow-sm"
                  : "border-amber-300 bg-white text-amber-700 hover:bg-amber-100 dark:bg-background dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-900/30"
              }`}
            >
              ✓ Yes, assign class codes
            </button>
            <button
              type="button"
              onClick={() => setAssignClassCode(false)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                assignClassCode === false
                  ? "border-muted-foreground bg-muted text-foreground shadow-sm"
                  : "border-border bg-white text-muted-foreground hover:bg-secondary dark:bg-background dark:border-border"
              }`}
            >
              ✗ No, skip class codes
            </button>
          </div>
          {assignClassCode === true && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              ✓ Students will see their unique class code on the success screen after submitting.
            </p>
          )}
          {assignClassCode === false && (
            <p className="text-xs text-muted-foreground">
              Students will see a standard success screen with no class code.
            </p>
          )}
        </div>
      )}

      {/* ── Test selection (only for test links) ── */}
      {linkType === "test" && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 dark:border-purple-800/40 dark:bg-purple-900/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileQuestion className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
            <p className="text-sm font-semibold text-purple-800 dark:text-purple-300">
              Select a test for this link
            </p>
          </div>
          <p className="text-xs text-purple-700 dark:text-purple-400">
            Choose which test students will take when they use this link.
          </p>
          {tests.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tests available. Create a test in the dashboard first.
            </p>
          ) : (
            <div className="space-y-2">
              {tests.map((test) => (
                <button
                  key={test.id}
                  type="button"
                  onClick={() => setSelectedTestId(test.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-left transition-all ${
                    selectedTestId === test.id
                      ? "border-purple-500 bg-purple-500 text-white shadow-sm"
                      : "border-purple-300 bg-white text-purple-700 hover:bg-purple-100 dark:bg-background dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-900/30"
                  }`}
                >
                  <div className="font-medium">{test.title}</div>
                  <div className="text-xs opacity-80">
                    {test.courseCode} • {test.durationMinutes} min • {test.testType}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Link title ── */}
      <div>
        <Label className="text-sm">Link title</Label>
        <Input
          className="mt-1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Morning Link, Late Entry, Group B"
          autoFocus
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Helps you identify which link each student used.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Course code</Label>
          {/* Free-type combobox — works for any number of courses */}
          <div className="relative mt-1">
            <Input
              value={courseCode}
              onChange={(e) => {
                setCourseCode(e.target.value.toUpperCase());
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="e.g. PSY101, CSC401…"
              autoComplete="off"
            />
            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border bg-card shadow-soft overflow-hidden">
                {suggestions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setCourseCode(c); setShowSuggestions(false); }}
                    className="flex w-full items-center px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Type any course — saved courses appear as suggestions.
          </p>
        </div>
        <div>
          <Label className="text-sm">Expires in</Label>
          <Select value={String(expiryMinutes)} onValueChange={(v) => setExpiryMinutes(Number(v))}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((o) => (
                <SelectItem key={o.minutes} value={String(o.minutes)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={creating || linkType === null || (linkType === "attendance" && assignClassCode === null) || (linkType === "test" && !selectedTestId)}>
        <Plus className="mr-2 h-4 w-4" /> Generate link
      </Button>
    </form>
  );
}

// ── Per-link student detail ───────────────────────────────────────────────────
function LinkStudentList({
  link,
  records,
}: {
  link: AttendanceLink;
  records: Array<{ fullName: string; matricNumber: string; department: string; level: string; submittedAt: string; linkId?: string }>;
}) {
  const linkRecords = useMemo(
    () => records.filter((r) => r.linkId === link.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [records, link.id]
  );

  if (linkRecords.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No students have marked attendance through this link yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[400px]">
        <thead className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Matric</th>
            <th className="px-4 py-2">Dept</th>
            <th className="px-4 py-2">Level</th>
            <th className="px-4 py-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {linkRecords.map((r) => (
            <tr key={r.matricNumber} className="border-t hover:bg-secondary/40 transition-colors">
              <td className="px-4 py-2 font-medium whitespace-nowrap">{r.fullName}</td>
              <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{r.matricNumber}</td>
              <td className="px-4 py-2 whitespace-nowrap">{r.department}</td>
              <td className="px-4 py-2 whitespace-nowrap">{r.level ? `${r.level} Lvl` : "—"}</td>
              <td className="px-4 py-2 text-muted-foreground whitespace-nowrap text-xs">
                {new Date(r.submittedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Link row ──────────────────────────────────────────────────────────────────
function LinkRow({
  link,
  records,
  onDisable,
  onDelete,
  onShowQr,
}: {
  link: AttendanceLink;
  records: Array<{ fullName: string; matricNumber: string; department: string; level: string; submittedAt: string; linkId?: string }>;
  onDisable: (id: string) => void;
  onDelete: (id: string) => void;
  onShowQr: (link: AttendanceLink) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = linkStatus(link);
  const isActive = status === "active";
  const url = buildAttendUrl(link.token);
  const count = records.filter((r) => r.linkId === link.id).length;

  function copyUrl() {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied to clipboard."),
      () => toast.error("Could not copy — please copy manually."),
    );
  }

  return (
    <div className="border-t first:border-t-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-sm">{link.title}</p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {link.courseCode}
            </span>
            <StatusBadge link={link} />
            {link.assignClassCode && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                <KeyRound className="h-2.5 w-2.5" /> Class code
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {new Date(link.createdAt).toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Expires {new Date(link.expiresAt).toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {count} student{count !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="font-mono text-xs text-muted-foreground truncate max-w-xs sm:max-w-md" title={url}>
            {url}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <Button size="sm" variant="outline" onClick={copyUrl} className="gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
          <Button size="sm" variant="outline" onClick={() => onShowQr(link)} className="gap-1.5 text-xs">
            <QrCode className="h-3.5 w-3.5" /> QR
          </Button>
          {isActive && (
            <Button
              size="sm" variant="outline"
              onClick={() => onDisable(link.id)}
              className="gap-1.5 text-xs text-amber-600 hover:text-amber-700 border-amber-200 hover:border-amber-300"
            >
              <Ban className="h-3.5 w-3.5" /> Disable
            </Button>
          )}
          <Button
            size="sm" variant="outline"
            onClick={() => onDelete(link.id)}
            className="gap-1.5 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary transition-colors"
            title={expanded ? "Collapse" : "Show students"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t bg-secondary/30"
          >
            <div className="px-2 py-1">
              <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Students who used "{link.title}"
              </p>
              <LinkStudentList link={link} records={records} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Test Link row ──────────────────────────────────────────────────────────────
function TestLinkRow({
  link,
  onDisable,
  onDelete,
  onShowQr,
}: {
  link: TestLink;
  onDisable: (id: string) => void;
  onDelete: (id: string) => void;
  onShowQr: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = testLinkStatus(link);
  const isActive = status === "active";
  const url = buildTestUrl(link.token);

  function copyUrl() {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Test link copied to clipboard."),
      () => toast.error("Could not copy — please copy manually."),
    );
  }

  return (
    <div className="border-t first:border-t-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-sm">{link.title}</p>
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              {link.courseCode}
            </span>
            <StatusBadge link={link as any} />
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              <FileQuestion className="h-2.5 w-2.5" /> Test
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {new Date(link.createdAt).toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Expires {new Date(link.expiresAt).toLocaleString()}
            </span>
          </div>
          <p className="font-mono text-xs text-muted-foreground truncate max-w-xs sm:max-w-md" title={url}>
            {url}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <Button size="sm" variant="outline" onClick={copyUrl} className="gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
          <Button size="sm" variant="outline" onClick={onShowQr} className="gap-1.5 text-xs">
            <QrCode className="h-3.5 w-3.5" /> QR
          </Button>
          {isActive && (
            <Button
              size="sm" variant="outline"
              onClick={() => onDisable(link.id)}
              className="gap-1.5 text-xs text-amber-600 hover:text-amber-700 border-amber-200 hover:border-amber-300"
            >
              <Ban className="h-3.5 w-3.5" /> Disable
            </Button>
          )}
          <Button
            size="sm" variant="outline"
            onClick={() => onDelete(link.id)}
            className="gap-1.5 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function LinksPage() {
  const { links, records, settings, testLinks } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [qrLink, setQrLink] = useState<{ url: string; title: string; isTest: boolean } | null>(null);

  function handleShowQr(link: AttendanceLink) {
    const isTest = link.linkType === "test";
    const url = isTest ? buildTestUrl(link.token) : buildAttendUrl(link.token);
    setQrLink({ url, title: link.title, isTest });
  }
  const [filterCourse, setFilterCourse] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const sorted = useMemo(() => {
    const filtered = filterCourse === "all"
      ? links
      : links.filter((l) => l.courseCode === filterCourse);
    return [...filtered].sort((a, b) => {
      const aActive = linkStatus(a) === "active" ? 0 : 1;
      const bActive = linkStatus(b) === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [links, filterCourse]);

  const sortedTestLinks = useMemo(() => {
    const filtered = filterCourse === "all"
      ? testLinks
      : testLinks.filter((l) => l.courseCode === filterCourse);
    return [...filtered].sort((a, b) => {
      const aActive = testLinkStatus(a) === "active" ? 0 : 1;
      const bActive = testLinkStatus(b) === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [testLinks, filterCourse]);

  const courses = useMemo(
    () => Array.from(new Set([...(settings.courses || []), ...links.map((l) => l.courseCode), ...testLinks.map((l) => l.courseCode)])).sort(),
    [settings.courses, links, testLinks],
  );

  const activeCount = links.filter((l) => isLinkValid(l)).length + testLinks.filter((l) => isTestLinkValid(l)).length;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const fresh = await fetchLinksFromSupabase();
      saveLinks(fresh);
      toast.success("Links refreshed from database.");
    } catch {
      toast.error("Could not refresh links.");
    } finally {
      setRefreshing(false);
    }
  }

  function handleDisable(id: string) {
    if (!confirm("Disable this link? Students with the URL will no longer be able to use it. Attendance records are preserved.")) return;
    disableLink(id);
    toast.success("Link disabled.");
  }

  function handleDisableTestLink(id: string) {
    if (!confirm("Disable this test link? Students with the URL will no longer be able to use it. Test records are preserved.")) return;
    deleteTestLink(id);
    toast.success("Test link disabled.");
  }

  function handleDelete(id: string) {
    const link = links.find((l) => l.id === id);
    const usedCount = records.filter((r) => r.linkId === id).length;
    const warn = usedCount > 0
      ? `This link has ${usedCount} student record${usedCount !== 1 ? "s" : ""} attached. The attendance records will remain, but they will no longer reference this link title. `
      : "";
    if (!confirm(`${warn}Delete this link permanently? This cannot be undone.`)) return;
    deleteLink(id);
    toast.success(`Link "${link?.title ?? ""}" deleted.`);
  }

  function handleCreated(link: AttendanceLink) {
    setShowForm(false);
    const url = link.linkType === "test" ? buildTestUrl(link.token) : buildAttendUrl(link.token);
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link created and copied to clipboard."),
      () => toast.success("Link created. Copy it from the list below."),
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
      >
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Link2 className="h-6 w-6 text-[color:var(--color-primary)] sm:h-7 sm:w-7" />
            Attendance links
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Generate shareable links students use to mark attendance. Each link has a title, expiry, and usage log.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            {showForm
              ? <><X className="mr-1.5 h-3.5 w-3.5" /> Cancel</>
              : <><Plus className="mr-1.5 h-3.5 w-3.5" /> New link</>}
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.35 }}
        className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {[
          { label: "Attendance links",  value: links.length },
          { label: "Test links",        value: testLinks.length },
          { label: "Active now",        value: activeCount },
          { label: "Courses",           value: courses.length },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-card p-4 shadow-soft">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </motion.div>

      {/* Generate form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="mt-5 rounded-2xl border bg-card p-5 shadow-soft">
              <h2 className="mb-4 text-base font-semibold flex items-center gap-2">
                <Plus className="h-4 w-4 text-[color:var(--color-primary)]" /> Generate new attendance link
              </h2>
              <GenerateLinkForm courses={courses} onCreated={handleCreated} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter */}
      {(links.length > 0 || testLinks.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.35 }}
          className="mt-5 flex items-center gap-3"
        >
          <Label className="text-sm shrink-0">Filter by course</Label>
          <Select value={filterCourse} onValueChange={setFilterCourse}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All courses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {filterCourse !== "all" && (
            <button onClick={() => setFilterCourse("all")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Clear
            </button>
          )}
        </motion.div>
      )}

      {/* Links list */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }}
        className="mt-4 rounded-2xl border bg-card shadow-soft overflow-hidden"
      >
        {sorted.length === 0 && sortedTestLinks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Link2 className="h-7 w-7 text-muted-foreground/50" />
            </div>
            <p className="text-base font-medium">No links yet</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Click "New link" to generate a shareable URL. Students open it to mark attendance or take tests.
            </p>
            <Button size="sm" className="mt-1" onClick={() => setShowForm(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Generate first link
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {/* Attendance Links Section */}
            {sorted.length > 0 && (
              <div className="bg-secondary/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Attendance Links
              </div>
            )}
            {sorted.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                records={records}
                onDisable={handleDisable}
                onDelete={handleDelete}
                onShowQr={handleShowQr}
              />
            ))}
            
            {/* Test Links Section */}
            {sortedTestLinks.length > 0 && (
              <div className="bg-secondary/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Test Links
              </div>
            )}
            {sortedTestLinks.map((link) => (
              <TestLinkRow
                key={link.id}
                link={link}
                onDisable={handleDisableTestLink}
                onDelete={handleDisableTestLink}
                onShowQr={() => setQrLink({ url: buildTestUrl(link.token), title: link.title, isTest: true })}
              />
            ))}
          </div>
        )}
      </motion.div>

      {/* QR modal */}
      <AnimatePresence>
        {qrLink && (
          <QrModal
            url={qrLink.linkType === "test" ? buildTestUrl(qrLink.token) : buildAttendUrl(qrLink.token)}
            title={qrLink.title}
            onClose={() => setQrLink(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
