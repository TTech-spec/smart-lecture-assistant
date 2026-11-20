import { createFileRoute, Link } from "@tanstack/react-router";
import { friendlyError } from "@/lib/friendly-error";
import { useMemo, useState } from "react";
import {
  Link2, Plus, X, Copy, Ban, ChevronDown, ChevronUp,
  Clock, CheckCircle2, XCircle, Users, RefreshCw, QrCode, Trash2, KeyRound, FileQuestion,
  MapPin, Loader2, MonitorPlay,
} from "lucide-react";
import { surveyAnchor, distanceMeters, type Coords, type SurveyProgress } from "@/lib/geo";
import { QrCode as QrImage } from "@/components/QrCode";
import { LeafletMap } from "@/components/LeafletMap";
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
  type AttendanceLink, type TestConfig, type TestLink, loadSettings, saveSettings, type Venue
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
          <QrImage value={url} size={200} alt={`QR code for ${title}`} className="rounded" />
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

// A measured location is only used when it is at least this exact
const ANCHOR_MAX_ACCURACY_M = 60;
// A measured or hand-placed location must be this fresh when the link is made
const ANCHOR_MAX_AGE_MS = 10 * 60_000;

function tooRoughMessage(acc: number): string {
  return `Too rough to use (±${acc} m). Drag the pin onto your hall, or move to a door or window and try again. On a laptop? Verify from your phone.`;
}

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
  const [requireRoomCode, setRequireRoomCode] = useState(false); // projector code: off unless the lecturer wants it
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null); // for test links
  // Lecturer-verified location (attendance links)
  const [anchor, setAnchor] = useState<Coords | null>(null);
  const [anchorRadius, setAnchorRadius] = useState(150);
  // When the anchor was measured or placed (ms). Not used for saved venues.
  const [anchorTakenAt, setAnchorTakenAt] = useState<number | null>(null);
  // A reading too rough to use: only centres the map so the pin can be placed by hand
  const [roughFix, setRoughFix] = useState<Coords | null>(null);
  // Saved lecture halls; picking one replaces indoor GPS
  const [venues, setVenues] = useState<Venue[]>(() => loadSettings().venues ?? []);
  const [venueId, setVenueId] = useState<string>("");
  const [venueName, setVenueName] = useState("");
  const [pinMoved, setPinMoved] = useState(false);

  function pickVenue(id: string) {
    setVenueId(id);
    const v = venues.find((x) => x.id === id);
    if (v) {
      setAnchor({ lat: v.lat, lng: v.lng, accuracy: Math.max(40, v.accuracy ?? 40), source: "gps" });
      setAnchorTakenAt(null);
      setRoughFix(null);
      setPinMoved(false);
    }
  }

  function saveVenue() {
    if (!anchor || !venueName.trim()) return toast.error("Give the venue a name first.");
    const v: Venue = { id: `ven-${Date.now()}`, name: venueName.trim(), lat: anchor.lat, lng: anchor.lng, accuracy: Math.max(40, Math.round(anchor.accuracy ?? 40)) };
    const next = [...venues.filter((x) => x.name.toLowerCase() !== v.name.toLowerCase()), v];
    saveSettings({ ...loadSettings(), venues: next });
    setVenues(next);
    setVenueId(v.id);
    setVenueName("");
    toast.success(`Saved "${v.name}". Pick it next time instead of using GPS.`);
  }

  function deleteVenue(id: string) {
    const next = venues.filter((x) => x.id !== id);
    saveSettings({ ...loadSettings(), venues: next });
    setVenues(next);
    if (venueId === id) setVenueId("");
  }
  const [locating, setLocating] = useState(false);
  const [locProgress, setLocProgress] = useState<SurveyProgress | null>(null);

  async function verifyLocation() {
    setLocating(true);
    setLocProgress(null);
    try {
      const pos = await surveyAnchor({ minMs: 12_000, maxMs: 25_000 }, setLocProgress);
      const acc = Math.round(pos.accuracy ?? 0);
      if (pos.accuracy != null && pos.accuracy <= ANCHOR_MAX_ACCURACY_M) {
        setAnchor({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, source: "gps" });
        setAnchorTakenAt(pos.takenAt);
        setRoughFix(null);
        setVenueId("");
        setPinMoved(false);
        toast.success(`Location found (±${acc} m).`);
      } else {
        // Too rough to measure students from: show it on the map only
        if (!anchor) setRoughFix({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, source: "gps" });
        toast.warning(tooRoughMessage(acc), { duration: 10000 });
      }
    } catch (err) {
      toast.error(friendlyError(err, "Could not read your location."));
    } finally {
      setLocating(false);
    }
  }

  function movePin(p: { lat: number; lng: number }) {
    const from = anchor ?? roughFix;
    // A tiny nudge is not a new position
    if (from && distanceMeters(from, p) < 10) return;
    setAnchor({ ...p, accuracy: 40, source: "gps" });
    setAnchorTakenAt(Date.now());
    setRoughFix(null);
    setVenueId("");
    setPinMoved(true);
  }
  const mapCentre = anchor ?? roughFix;
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
    if (linkType === "attendance" && !anchor)
      return toast.error("Verify your location first — stand in the lecture hall and tap “Verify my location”.");
    if (linkType === "attendance" && !venueId && anchorTakenAt != null && Date.now() - anchorTakenAt > ANCHOR_MAX_AGE_MS)
      return toast.error("Check your location again; it was taken a while ago");
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
          requireRoomCode: linkType === "attendance" ? requireRoomCode : false,
          linkType: linkType,
          ...(anchor
            ? {
                anchorLat: anchor.lat,
                anchorLng: anchor.lng,
                anchorAccuracy: anchor.accuracy,
                anchorRadius,
                anchorAt: new Date(!venueId && anchorTakenAt != null ? anchorTakenAt : Date.now()).toISOString(),
              }
            : {}),
        };
        await addLink(link);
        toast.success(`Link "${link.title}" created and saved to database.`);
        onCreated(link);
      }
      
      setTitle("");
      setCourseCode("");
      setLinkType(null);
      setAssignClassCode(null);
      setRequireRoomCode(false);
      setSelectedTestId(null);
      setAnchor(null);
      setAnchorTakenAt(null);
      setRoughFix(null);
      setVenueId("");
      setPinMoved(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message.toLowerCase() : "";
      const msg = friendlyError(err, "We couldn't create the check-in link. Please try again.");
      if (/gen_random_bytes|hmac|pgcrypto/.test(raw)) {
        toast.error("The link couldn't get its class-code secret. Run fix-link-creation.sql in the Supabase SQL Editor once, then try again.", { duration: 10000 });
      } else if (/relation "?attendance_links"? does not exist/.test(raw)) {
        toast.error(
          "Database table missing. Run attendance-links-migration.sql in your Supabase SQL Editor first, then try again.",
          { duration: 8000 }
        );
      } else {
        toast.error(msg);
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
          <button data-tour="link-type-attendance"
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
            <button data-tour="class-code-yes"
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

      {/* ── Projector code (optional) ── */}
      {linkType === "attendance" && (
        <label data-tour="projector-code" className="flex cursor-pointer items-start gap-3 rounded-xl border bg-secondary/40 p-4">
          <input id="require-room-code" type="checkbox" checked={requireRoomCode} onChange={(e) => setRequireRoomCode(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary" />
          <span className="text-sm">
            <span className="block font-semibold">Ask for the projector code</span>
            <span className="block text-xs text-muted-foreground">Off: students just enter their matric number, take a selfie and submit. Live GPS and the face match prove they're in class. On: they must also type the code shown on your projector.</span>
            <span className="mt-1 block text-xs text-muted-foreground">Either way, keep the Projector screen open. Students whose GPS is off indoors are asked for the code on it.</span>
          </span>
        </label>
      )}

      {/* ── Lecturer location (attendance links) ── */}
      {linkType === "attendance" && (
        <div className="rounded-xl border bg-secondary/40 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Verify your location</p>
              <p className="text-xs text-muted-foreground">
                Stand inside the lecture hall. Students must be near this spot to check in.
              </p>
            </div>
          </div>
          {venues.length > 0 && (
            <div>
              <Label className="text-sm">Use a saved venue</Label>
              <div className="mt-1 flex gap-2">
                <Select value={venueId} onValueChange={pickVenue}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Choose a lecture hall" /></SelectTrigger>
                  <SelectContent>
                    {venues.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {venueId && (
                  <Button type="button" variant="outline" size="icon" aria-label="Delete this venue" onClick={() => deleteVenue(venueId)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">— or —</p>
            </div>
          )}
          <Button data-tour="verify-location" type="button" variant={anchor ? "outline" : "default"} className="w-full" onClick={verifyLocation} disabled={locating}>
            {locating ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {locProgress ? `Checking your location… ${locProgress.n} reading${locProgress.n === 1 ? "" : "s"}, ±${Math.round(locProgress.accuracy)} m` : "Checking your location…"}</>
            ) : anchor ? (
              <><CheckCircle2 className="mr-2 h-4 w-4 text-primary" /> {venueId ? "Using saved venue · use my GPS instead" : pinMoved ? "Pin placed by hand · Check again" : `Location found (±${Math.round(anchor.accuracy ?? 0)} m) · Check again`}</>
            ) : (
              <><MapPin className="mr-2 h-4 w-4" /> Verify my location</>
            )}
          </Button>
          {mapCentre && (
            <div className="space-y-2">
              <LeafletMap
                center={{ lat: mapCentre.lat, lng: mapCentre.lng }}
                radius={anchorRadius}
                draggable
                onMove={movePin}
                className="h-56 w-full overflow-hidden rounded-lg border"
              />
              {anchor ? (
                <p className="text-xs text-muted-foreground">
                  {pinMoved
                    ? "Pin placed by hand — students are measured from here."
                    : "Is the pin on your lecture hall? If not, drag it onto the exact building."}
                </p>
              ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
                  {tooRoughMessage(Math.round(mapCentre.accuracy ?? 0))}
                </p>
              )}
              {anchor && !venueId && (
                <div className="flex gap-2">
                  <Input
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    placeholder="Save as e.g. EKSU Faculty of Science LT1"
                    className="h-9 flex-1 text-sm"
                    aria-label="Venue name"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={saveVenue}>Save venue</Button>
                </div>
              )}
            </div>
          )}
          <div>
            <Label className="text-sm">Students must be within</Label>
            <Select value={String(anchorRadius)} onValueChange={(v) => setAnchorRadius(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[100, 150, 200, 300].map((m) => (
                  <SelectItem key={m} value={String(m)}>{m} m of me{m === 150 ? " (recommended)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                No tests available yet. Upload your test questions in the dashboard first.
              </p>
              <Button asChild size="sm" type="button" className="w-full">
                <Link to="/admin/manage" hash="tests-quizzes">Click here to upload questions</Link>
              </Button>
            </div>
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
        <div data-tour="expires-in">
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

      <Button data-tour="generate-link" type="submit" className="w-full" disabled={creating || linkType === null || (linkType === "attendance" && (assignClassCode === null || !anchor)) || (linkType === "test" && !selectedTestId)}>
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
            <Button asChild size="sm" className="gap-1.5 text-xs">
              <Link to="/admin/projector" search={{ link: link.id }}>
                <MonitorPlay className="h-3.5 w-3.5" /> Projector
              </Link>
            </Button>
          )}
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
          <Button data-tour="new-link" size="sm" onClick={() => setShowForm((s) => !s)}>
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
            url={qrLink.url}
            title={qrLink.title}
            onClose={() => setQrLink(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
