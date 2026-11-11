import { supabase } from "./supabase";

// Fire-and-forget wrapper — keeps the UI fast, never throws
function sync(p: PromiseLike<{ error: unknown }> | undefined): void {
  if (!p) return;
  Promise.resolve(p).catch(() => {});
}

export type Gender = "male" | "female" | "other";

export type CustomField = {
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
};

export type AttendanceRecord = {
  id: string;
  fullName: string;
  matricNumber: string;
  department: string;
  phone: string;
  courseCode: string;
  topic: string;
  level: string;
  gender: Gender;
  submittedAt: string;
  dayKey: string;
  deviceId: string;
  distanceMeters: number;
  lat: number;
  lng: number;
  sessionId: string;
  customFields: Record<string, string>;
  assignedClassCode?: string;
  linkId?: string; // References attendance_links.id — which shareable link was used
};

export type AdminSettings = {
  classLat: number | null;
  classLng: number | null;
  radiusMeters: number;
  windowMinutes: number;
  windowOpenedAt: string | null;
  courseCode: string;
  topic: string;
  level: string;
  levelRestricted: boolean;
  customFields: CustomField[];
  classCode: string;
  classCodeEnabled: boolean;
  classCodeFormat: "numbers" | "id";
  classCodeLevel: string;
  sessionOpenCount: number;
  activeSessionId: string | null;
  courses: string[];
  departments: string[];
  /** Lecture halls saved by the lecturer (exact spot, set once) */
  venues?: Venue[];
};

export type Venue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Metres; small when the pin was placed by hand on the map */
  accuracy: number;
};

export type AttendanceSession = {
  id: string;
  courseCode: string;
  level: string;
  topic: string;
  openedAt: string;
  closedAt?: string;
};

export type AttendanceLink = {
  id: string;
  courseCode: string;
  title: string;
  token: string;       // unique random string used in /attend/{token}
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  /** When true, a unique class code is auto-generated and shown to the student on submission */
  assignClassCode: boolean;
  /** Type of link: 'attendance' or 'test' */
  linkType?: "attendance" | "test";
  /** For test links, the ID of the test to associate with */
  testId?: string;
  /** Lecturer-verified location: students must be within anchorRadius metres of it */
  anchorLat?: number;
  anchorLng?: number;
  anchorAccuracy?: number;
  anchorRadius?: number;
  anchorAt?: string;
};

/**
 * A shareable link that opens /test/{token} and lets the student take a
 * specific test directly — without needing the test to be globally activated.
 */
export type TestLink = {
  id: string;
  testId: string;       // References test_configs.id
  courseCode: string;
  title: string;        // Human label, e.g. "PSY202 C1 — Group A"
  token: string;        // URL-safe random token used in /test/{token}
  isActive: boolean;
  createdAt: string;
  expiresAt: string;
};

export type TestQuestion = {
  id: string;
  text: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
};

export type TestType = "C1" | "C2" | "C3";

/** Fisher–Yates shuffle of [0..n). Each student gets their own question order
 *  (generated client-side, once per attempt) so question numbers don't match
 *  between students — copying "the answer to Q4" or a screenshot of one
 *  student's screen won't line up with anyone else's paper. Answers are still
 *  stored against the original question index, so scoring is unaffected.
 */
export function shuffledIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export type TestConfig = {
  id: string;
  title: string;
  courseCode: string;
  durationMinutes: number;
  isActive: boolean;
  createdAt: string;
  questions: TestQuestion[];
  testType: TestType;
};

export type TestSubmission = {
  id: string;
  testId: string;
  studentName: string;
  matricNumber: string;
  level: string;
  answers: (number | null)[];
  score: number;
  total: number;
  submittedAt: string;
  cheated: boolean;
  testType: TestType;
  deviceId: string;
};

// ── Storage keys ──────────────────────────────────────────────────────────────
const REC_KEY      = "att.records.v1";
const SET_KEY      = "att.settings.v1";
const DEV_KEY      = "att.deviceId.v1";
const SES_KEY      = "att.sessions.v1";
const TST_KEY      = "att.tests.v1";
const TSUB_KEY     = "att.test-submissions.v1";
const CODE_USED_KEY = "att.code.used.v1";
const LINKS_KEY    = "att.links.v1";
const TEST_LINKS_KEY = "att.test-links.v1";

// ── DB row mappers ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function recordToDb(r: AttendanceRecord): Row {
  return {
    id: r.id,
    full_name: r.fullName,
    matric_number: r.matricNumber,
    department: r.department,
    phone: r.phone,
    course_code: r.courseCode,
    topic: r.topic,
    level: r.level,
    gender: r.gender,
    submitted_at: r.submittedAt,
    day_key: r.dayKey,
    device_id: r.deviceId,
    distance_meters: r.distanceMeters,
    lat: r.lat,
    lng: r.lng,
    session_id: r.sessionId,
    custom_fields: r.customFields,
    assigned_class_code: r.assignedClassCode || null,
    link_id: r.linkId || null,
  };
}

function recordFromDb(row: Row): AttendanceRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    matricNumber: row.matric_number,
    department: row.department,
    phone: row.phone || "",
    courseCode: row.course_code,
    topic: row.topic || "",
    level: row.level || "",
    gender: row.gender as Gender,
    submittedAt: row.submitted_at,
    dayKey: row.day_key,
    deviceId: row.device_id,
    distanceMeters: row.distance_meters || 0,
    lat: row.lat || 0,
    lng: row.lng || 0,
    sessionId: row.session_id || "",
    customFields: row.custom_fields || {},
    assignedClassCode: row.assigned_class_code || undefined,
    linkId: row.link_id || undefined,
  };
}

function sessionToDb(s: AttendanceSession): Row {
  return {
    id: s.id,
    course_code: s.courseCode,
    level: s.level,
    topic: s.topic,
    opened_at: s.openedAt,
    closed_at: s.closedAt ?? null,
  };
}

function sessionFromDb(row: Row): AttendanceSession {
  return {
    id: row.id,
    courseCode: row.course_code || "",
    level: row.level || "",
    topic: row.topic || "",
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
  };
}

function testToDb(t: TestConfig): Row {
  return {
    id: t.id,
    title: t.title,
    course_code: t.courseCode,
    duration_minutes: t.durationMinutes,
    is_active: t.isActive,
    created_at: t.createdAt,
    questions: t.questions,
    test_type: t.testType,
  };
}

function testFromDb(row: Row): TestConfig {
  return {
    id: row.id,
    title: row.title,
    courseCode: row.course_code,
    durationMinutes: row.duration_minutes || 30,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    questions: (row.questions as TestQuestion[]) || [],
    testType: (row.test_type as TestType) || "C1",
  };
}

function testLinkToDb(t: TestLink): Row {
  return {
    id: t.id,
    test_id: t.testId,
    course_code: t.courseCode,
    title: t.title,
    token: t.token,
    is_active: t.isActive,
    created_at: t.createdAt,
    expires_at: t.expiresAt,
  };
}

function testLinkFromDb(row: Row): TestLink {
  return {
    id: row.id,
    testId: row.test_id,
    courseCode: row.course_code || "",
    title: row.title || "",
    token: row.token,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function submissionToDb(s: TestSubmission): Row {
  return {
    id: s.id,
    test_id: s.testId,
    student_name: s.studentName,
    matric_number: s.matricNumber,
    level: s.level,
    answers: s.answers,
    score: s.score,
    total: s.total,
    submitted_at: s.submittedAt,
    cheated: s.cheated,
    test_type: s.testType,
    device_id: s.deviceId,
  };
}

function submissionFromDb(row: Row): TestSubmission {
  return {
    id: row.id,
    testId: row.test_id,
    studentName: row.student_name,
    matricNumber: row.matric_number,
    level: row.level || "",
    answers: (row.answers as (number | null)[]) || [],
    score: row.score || 0,
    total: row.total || 0,
    submittedAt: row.submitted_at,
    cheated: Boolean(row.cheated),
    testType: (row.test_type as TestType) || "C1",
    deviceId: row.device_id || "",
  };
}

// ── Device ID ─────────────────────────────────────────────────────────────────
export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEV_KEY);
  if (!id) {
    id = (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ||
      `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    localStorage.setItem(DEV_KEY, id);
  }
  return id;
}

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ── Default settings ──────────────────────────────────────────────────────────
export const defaultSettings: AdminSettings = {
  classLat: null,
  classLng: null,
  radiusMeters: 100,
  windowMinutes: 15,
  windowOpenedAt: null,
  courseCode: "",
  topic: "",
  level: "",
  levelRestricted: false,
  customFields: [],
  classCode: "",
  classCodeEnabled: false,
  classCodeFormat: "numbers",
  classCodeLevel: "",
  sessionOpenCount: 0,
  activeSessionId: null,
  courses: ["PSY101", "PSY103", "PSY102"],
  departments: ["Law", "Sociology", "Psychology", "Social", "Management Science"],
};

// ── Settings ──────────────────────────────────────────────────────────────────
export function loadSettings(): AdminSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(SET_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: AdminSettings) {
  localStorage.setItem(SET_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("att:settings"));
  sync(supabase?.from("admin_settings").upsert({ id: "default", data: s }));
}

// ── Records ───────────────────────────────────────────────────────────────────
export function loadRecords(): AttendanceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(REC_KEY) || "[]") as AttendanceRecord[];
  } catch {
    return [];
  }
}

export function findStudentByMatric(matricNumber: string): AttendanceRecord | null {
  const records = loadRecords();
  return records.find(r => r.matricNumber === matricNumber) || null;
}

export function updateStudentClassCode(matricNumber: string, classCode: string): void {
  const records = loadRecords();
  const updated = records.map(r => {
    if (r.matricNumber === matricNumber) {
      return { ...r, assignedClassCode: classCode };
    }
    return r;
  });
  localStorage.setItem(REC_KEY, JSON.stringify(updated));
  window.dispatchEvent(new Event("att:records"));
  
  // Sync to Supabase
  if (supabase) {
    const student = updated.find(r => r.matricNumber === matricNumber);
    if (student) {
      sync(supabase.from("attendance_records").update({ assigned_class_code: classCode }).eq("matric_number", matricNumber));
    }
  }
}

export function saveRecords(records: AttendanceRecord[]) {
  localStorage.setItem(REC_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event("att:records"));
}

export async function addRecord(r: AttendanceRecord): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("attendance_records").upsert(recordToDb(r));
    if (error) throw new Error(error.message);
  }
  const all = loadRecords();
  all.push(r);
  saveRecords(all);
}

export function syncRecord(r: AttendanceRecord) {
  sync(supabase?.from("attendance_records").upsert(recordToDb(r)));
}

export function deleteRecordById(id: string, current: AttendanceRecord[]) {
  saveRecords(current.filter((r) => r.id !== id));
  sync(supabase?.from("attendance_records").delete().eq("id", id));
}

export function clearAllRecords() {
  saveRecords([]);
  sync(supabase?.from("attendance_records").delete().gte("created_at", "1970-01-01T00:00:00Z"));
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export function loadSessions(): AttendanceSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SES_KEY) || "[]") as AttendanceSession[];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: AttendanceSession[]) {
  localStorage.setItem(SES_KEY, JSON.stringify(sessions));
  window.dispatchEvent(new Event("att:sessions"));
}

export function addSession(s: AttendanceSession) {
  const all = loadSessions();
  all.push(s);
  saveSessions(all);
  sync(supabase?.from("attendance_sessions").upsert(sessionToDb(s)));
}

export function closeSession(id: string, closedAt: string) {
  saveSessions(loadSessions().map((s) => (s.id === id ? { ...s, closedAt } : s)));
  sync(supabase?.from("attendance_sessions").update({ closed_at: closedAt }).eq("id", id));
}

export function clearSessions() {
  saveSessions([]);
  // Mark that sessions were intentionally cleared so syncFromSupabase won't re-populate them
  localStorage.setItem("att.sessions.cleared.v1", "true");
  sync(supabase?.from("attendance_sessions").delete().gte("opened_at", "1970-01-01T00:00:00Z"));
}

// ── Attendance links ──────────────────────────────────────────────────────────

function linkToDb(l: AttendanceLink): Row {
  return {
    id: l.id,
    course_code: l.courseCode,
    title: l.title,
    token: l.token,
    is_active: l.isActive,
    created_by: l.createdBy,
    created_at: l.createdAt,
    expires_at: l.expiresAt,
    assign_class_code: l.assignClassCode ?? false,
    link_type: l.linkType ?? "attendance",
    test_id: l.testId ?? null,
    // Only sent when the lecturer verified a location, so databases that
    // haven't run lecturer-location-migration.sql keep working.
    ...(l.anchorLat != null && l.anchorLng != null
      ? {
          anchor_lat: l.anchorLat,
          anchor_lng: l.anchorLng,
          anchor_accuracy: l.anchorAccuracy ?? null,
          anchor_radius: l.anchorRadius ?? null,
          anchor_at: l.anchorAt ?? null,
        }
      : {}),
  };
}

function linkFromDb(row: Row): AttendanceLink {
  return {
    id: row.id,
    courseCode: row.course_code || "",
    title: row.title || "",
    token: row.token,
    isActive: Boolean(row.is_active),
    createdBy: row.created_by || "admin",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    assignClassCode: Boolean(row.assign_class_code),
    linkType: (row.link_type as "attendance" | "test" | undefined) || undefined,
    testId: row.test_id || undefined,
    anchorLat: row.anchor_lat ?? undefined,
    anchorLng: row.anchor_lng ?? undefined,
    anchorAccuracy: row.anchor_accuracy ?? undefined,
    anchorRadius: row.anchor_radius ?? undefined,
    anchorAt: row.anchor_at ?? undefined,
  };
}

// Ensure backward compatibility for links created before linkType was added
function ensureLinkType(link: AttendanceLink): AttendanceLink {
  if (!link.linkType) {
    return { ...link, linkType: "attendance" as const };
  }
  return link;
}

// Ensure backward compatibility for test links
function ensureTestLinkType(link: TestLink): TestLink {
  // Test links don't have linkType field since they're inherently test links
  return link;
}

export function loadLinks(): AttendanceLink[] {
  if (typeof window === "undefined") return [];
  try {
    const links = JSON.parse(localStorage.getItem(LINKS_KEY) || "[]") as AttendanceLink[];
    return links.map(ensureLinkType);
  } catch {
    return [];
  }
}

export function saveLinks(links: AttendanceLink[]) {
  localStorage.setItem(LINKS_KEY, JSON.stringify(links));
  window.dispatchEvent(new Event("att:links"));
}

export async function addLink(l: AttendanceLink): Promise<void> {
  // Save locally first so the lecturer sees it immediately
  const all = loadLinks();
  all.push(l);
  saveLinks(all);

  if (supabase) {
    const row = linkToDb(l);
    let { error } = await supabase.from("attendance_links").upsert(row);

    if (error && /anchor_/.test(error.message)) {
      throw new Error(
        "Lecturer location columns are missing. Run lecturer-location-migration.sql in the Supabase SQL Editor, then try again.",
      );
    }
    if (error) {
      // If the error is because assign_class_code or link_type column doesn't exist yet
      // (migration not run), retry without those columns so the link still saves.
      if (
        error.message.includes("assign_class_code") ||
        error.message.includes("link_type") ||
        error.message.includes("schema cache")
      ) {
        const { assign_class_code: _dropped, link_type: _dropped2, ...rowWithout } = row as Record<string, unknown>;
        const retry = await supabase.from("attendance_links").upsert(rowWithout);
        if (retry.error) {
          throw new Error(retry.error.message);
        }
        // Warn the lecturer without blocking them
        console.warn(
          "attendance_links.assign_class_code or link_type column not found. " +
          "Run attendance-links-migration.sql in Supabase to enable the class-code and link-type features on links."
        );
        return;
      }
      // Any other error — surface it
      throw new Error(error.message);
    }
  }
}

export function disableLink(id: string) {
  saveLinks(loadLinks().map((l) => (l.id === id ? { ...l, isActive: false } : l)));
  sync(supabase?.from("attendance_links").update({ is_active: false }).eq("id", id));
}

export function deleteLink(id: string) {
  saveLinks(loadLinks().filter((l) => l.id !== id));
  sync(supabase?.from("attendance_links").delete().eq("id", id));
}

export function getLinkByToken(token: string): AttendanceLink | null {
  return loadLinks().find((l) => l.token === token) || null;
}

export function isLinkValid(l: AttendanceLink, now = new Date()): boolean {
  return l.isActive && new Date(l.expiresAt) > now;
}

/** Generate a cryptographically-random URL-safe token */
export function generateToken(): string {
  const arr = new Uint8Array(18);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fetch a single link by token.
 * Returns the link, null if not found, or throws with message "db_error" if
 * Supabase is reachable but the query failed (e.g. migration not yet run).
 */
export async function fetchLinkByToken(token: string): Promise<AttendanceLink | null> {
  // Always try localStorage first (covers the lecturer's own device without a round-trip)
  const local = getLinkByToken(token);

  if (!supabase) return local;

  try {
    // Students: server function that returns only this link, without the lecturer's GPS
    const rpc = await supabase.rpc("get_attendance_link", { p_token: token });
    if (!rpc.error) {
      const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      return row ? linkFromDb(row) : null;
    }

    // Older databases without security-fixes.sql: read the table directly
    const { data, error } = await supabase
      .from("attendance_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      // If the table doesn't exist yet (migration not run), fall back to local
      // so the lecturer's own device still works. For students on other devices,
      // local will be null and they'll see the "not found" state.
      console.warn("fetchLinkByToken Supabase error:", error.message);
      return local;
    }

    if (!data) return null; // Link genuinely not found in DB
    return linkFromDb(data);
  } catch {
    return local;
  }
}

/**
 * Fetch a test link by token (for test-specific links).
 * Returns the test link, null if not found, or throws with message "db_error" if
 * Supabase is reachable but the query failed.
 */
export async function fetchTestLinkByToken(token: string): Promise<TestLink | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("test_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      console.warn("fetchTestLinkByToken Supabase error:", error.message);
      return null;
    }

    if (!data) return null; // Link genuinely not found in DB
    return testLinkFromDb(data);
  } catch {
    return null;
  }
}

/** Fetch all links for a course directly from Supabase */
export async function fetchLinksFromSupabase(): Promise<AttendanceLink[]> {
  if (!supabase) return loadLinks();
  const { data, error } = await supabase
    .from("attendance_links")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return loadLinks();
  return data.map(linkFromDb).map(ensureLinkType);
}

/**
 * Check if a student has already marked attendance for a given course today
 * across ALL links (Option B — once per course per day).
 */
export function hasMarkedAttendanceForCourseToday(
  matricNumber: string,
  courseCode: string,
  dayKey: string
): boolean {
  return loadRecords().some(
    (r) =>
      r.matricNumber.toLowerCase() === matricNumber.toLowerCase() &&
      r.courseCode.toUpperCase() === courseCode.toUpperCase() &&
      r.dayKey === dayKey
  );
}

/**
 * Check if a device has already submitted attendance for a given course today.
 * This is the phone-level lock — even if someone clears cookies, the Supabase
 * check (below) is the authoritative source; this is the fast local check.
 */
export function hasDeviceMarkedAttendanceToday(
  deviceId: string,
  courseCode: string,
  dayKey: string
): boolean {
  return loadRecords().some(
    (r) =>
      r.deviceId === deviceId &&
      r.courseCode.toUpperCase() === courseCode.toUpperCase() &&
      r.dayKey === dayKey
  );
}

/**
 * Server-side (Supabase) check: has this device already submitted for this
 * course today? Returns false if Supabase is unavailable (fails open so
 * students aren't blocked offline).
 */
export async function hasDeviceMarkedAttendanceTodayRemote(
  deviceId: string,
  courseCode: string,
  dayKey: string
): Promise<boolean> {
  if (!supabase) return false;
  try {
    void dayKey; // the server works out today's date itself
    const { data } = await supabase.rpc("device_checked_in_today", { p_device: deviceId, p_course: courseCode });
    return data === true;
  } catch {
    return false; // fail open — don't block students if DB is unreachable
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
export function loadTests(): TestConfig[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(TST_KEY) || "[]") as TestConfig[];
  } catch {
    return [];
  }
}

export function saveTests(tests: TestConfig[]) {
  localStorage.setItem(TST_KEY, JSON.stringify(tests));
  window.dispatchEvent(new Event("att:tests"));
}

/**
 * Fetch the currently active test directly from Supabase.
 * This is what students call on page load so they always see the live state
 * regardless of what's in their localStorage.
 */
export async function fetchActiveTestFromSupabase(): Promise<TestConfig | null> {
  if (!supabase) return getActiveTest();
  try {
    const { data, error } = await supabase
      .from("test_configs")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const test = testFromDb(data);
    // Sync into localStorage so getActiveTest() stays consistent
    const all = loadTests();
    const idx = all.findIndex((t) => t.id === test.id);
    if (idx >= 0) all[idx] = test; else all.push(test);
    // Deactivate any other tests locally
    const synced = all.map((t) => ({ ...t, isActive: t.id === test.id }));
    localStorage.setItem(TST_KEY, JSON.stringify(synced));
    window.dispatchEvent(new Event("att:tests"));
    return test;
  } catch {
    return getActiveTest(); // fall back to local
  }
}

/**
 * Poll Supabase for the active test state (called by the landing page on a timer).
 * Also handles the case where the lecturer deactivates a test — clears it locally.
 */
export async function pollActiveTest(): Promise<TestConfig | null> {
  if (!supabase) return getActiveTest();
  try {
    const { data } = await supabase
      .from("test_configs")
      .select("id, is_active, title, course_code, duration_minutes, created_at, questions, test_type")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!data) {
      // No active test in DB — make sure local state reflects that
      const local = loadTests();
      if (local.some((t) => t.isActive)) {
        const cleared = local.map((t) => ({ ...t, isActive: false }));
        localStorage.setItem(TST_KEY, JSON.stringify(cleared));
        window.dispatchEvent(new Event("att:tests"));
      }
      return null;
    }

    const test = testFromDb(data);
    const local = loadTests();
    const needsUpdate = !local.some((t) => t.id === test.id && t.isActive);
    if (needsUpdate) {
      const merged = local.filter((t) => t.id !== test.id);
      merged.push(test);
      const synced = merged.map((t) => ({ ...t, isActive: t.id === test.id }));
      localStorage.setItem(TST_KEY, JSON.stringify(synced));
      window.dispatchEvent(new Event("att:tests"));
    }
    return test;
  } catch {
    return getActiveTest();
  }
}

export function addTest(t: TestConfig) {
  const all = loadTests();
  all.push(t);
  saveTests(all);
  sync(supabase?.from("test_configs").upsert(testToDb(t)));
}

export function updateTest(t: TestConfig) {
  saveTests(loadTests().map((x) => (x.id === t.id ? t : x)));
  sync(supabase?.from("test_configs").upsert(testToDb(t)));
}

export function deleteTest(id: string) {
  saveTests(loadTests().filter((t) => t.id !== id));
  sync(supabase?.from("test_configs").delete().eq("id", id));
}

export function setTestActive(id: string, isActive: boolean) {
  const updated = loadTests().map((t) => ({ ...t, isActive: t.id === id ? isActive : false }));
  saveTests(updated);
  updated.forEach((t) => sync(supabase?.from("test_configs").upsert(testToDb(t))));
}

export function getActiveTest(): TestConfig | null {
  return loadTests().find((t) => t.isActive) ?? null;
}

// ── Test submissions ───────────────────────────────────────────────────────────
export function loadTestSubmissions(): TestSubmission[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(TSUB_KEY) || "[]") as TestSubmission[];
  } catch {
    return [];
  }
}

export function saveTestSubmissions(subs: TestSubmission[]) {
  localStorage.setItem(TSUB_KEY, JSON.stringify(subs));
  window.dispatchEvent(new Event("att:test-submissions"));
}

export function addTestSubmission(s: TestSubmission) {
  const all = loadTestSubmissions();
  all.push(s);
  saveTestSubmissions(all);
  sync(supabase?.from("test_submissions").upsert(submissionToDb(s)));
}

export function syncTestSubmission(s: TestSubmission) {
  sync(supabase?.from("test_submissions").upsert(submissionToDb(s)));
}

/**
 * Fast local check: has this device already submitted this test?
 * Same device-level lock used for attendance — checked independently of
 * matric number so re-entering a different matric on the same phone doesn't
 * unlock a second attempt.
 */
export function hasDeviceTakenTest(deviceId: string, testId: string): TestSubmission | null {
  return loadTestSubmissions().find((s) => s.deviceId === deviceId && s.testId === testId) ?? null;
}

/**
 * Server-side (Supabase) check: has this device already submitted this test?
 * Returns null if Supabase is unavailable (fails open so students aren't
 * blocked offline) or if the app was never synced from Supabase locally.
 */
export async function hasDeviceTakenTestRemote(
  deviceId: string,
  testId: string
): Promise<TestSubmission | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("test_submissions")
      .select("*")
      .eq("device_id", deviceId)
      .eq("test_id", testId)
      .limit(1)
      .maybeSingle();
    return data ? submissionFromDb(data) : null;
  } catch {
    return null; // fail open — don't block students if DB is unreachable
  }
}

// ── Class code tracking ───────────────────────────────────────────────────────

/** Key: matric (lower) → unique code assigned to that student */
const STUDENT_CODES_KEY = "att.student.codes.v1";

/** Key: matric (lower) → flagged for sharing someone else's code */
const CODE_FRAUD_KEY = "att.code.fraud.v1";

export function getUsedClassCodes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CODE_USED_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function hasUsedClassCode(matricNumber: string): boolean {
  return getUsedClassCodes().includes(matricNumber.trim().toLowerCase());
}

export function markClassCodeUsed(matricNumber: string) {
  const used = getUsedClassCodes();
  const key = matricNumber.trim().toLowerCase();
  if (!used.includes(key)) {
    used.push(key);
    localStorage.setItem(CODE_USED_KEY, JSON.stringify(used));
  }
}

/** Returns the matric→code map */
function getStudentCodeMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STUDENT_CODES_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function randomCodeSuffix(format: "numbers" | "id"): string {
  return format === "numbers"
    ? String(Math.floor(1000 + Math.random() * 9000))
    : Math.random().toString(36).slice(2, 6).toUpperCase();
}

/** Checks whether a candidate class code is already assigned to anyone — locally
 *  (this device) or in Supabase (any other student's device). Students each
 *  generate their code on their own phone, so the local-only map alone can't
 *  catch collisions between two different students; this closes that gap.
 */
async function isClassCodeTaken(code: string): Promise<boolean> {
  if (Object.values(getStudentCodeMap()).includes(code)) return true;
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from("attendance_records")
      .select("id")
      .eq("assigned_class_code", code)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false; // fail open — don't block a student if the DB is unreachable
  }
}

/** Generate (or retrieve) a unique class code for a specific student.
 *  The code is derived from the global classCode prefix + a short unique suffix,
 *  so the lecturer's format preference is preserved. Retries against Supabase
 *  until the suffix doesn't collide with any other student's code, since each
 *  student generates theirs independently on their own device.
 */
export async function generateStudentClassCode(
  matricNumber: string,
  globalCode: string,
  format: "numbers" | "id" = "numbers"
): Promise<string> {
  const map = getStudentCodeMap();
  const key = matricNumber.trim().toLowerCase();

  // Already assigned — return the same code every time
  if (map[key]) return map[key];

  let code: string | null = null;
  for (let attempt = 0; attempt < 15 && !code; attempt++) {
    const candidate = `${globalCode}-${randomCodeSuffix(format)}`;
    if (!(await isClassCodeTaken(candidate))) code = candidate;
  }
  // Astronomically unlikely fallback: a timestamp-derived suffix is unique by construction
  if (!code) code = `${globalCode}-${Date.now().toString(36).toUpperCase().slice(-5)}`;

  map[key] = code;
  localStorage.setItem(STUDENT_CODES_KEY, JSON.stringify(map));
  return code;
}

/** Return the unique code stored for a matric, or null if none assigned yet */
export function getStudentCode(matricNumber: string): string | null {
  const map = getStudentCodeMap();
  return map[matricNumber.trim().toLowerCase()] ?? null;
}

/** Validate that the code a student typed matches their own assigned code.
 *  Returns true = valid, false = wrong code (possibly someone else's).
 */
export function validateStudentCode(matricNumber: string, enteredCode: string): boolean {
  const assigned = getStudentCode(matricNumber);
  if (!assigned) return false;
  return assigned.trim().toLowerCase() === enteredCode.trim().toLowerCase();
}

/** Mark a student as having attempted to use a code that wasn't theirs */
export function flagCodeFraud(matricNumber: string, enteredCode: string) {
  if (typeof window === "undefined") return;
  try {
    const fraudMap: Record<string, { enteredCode: string; at: string }[]> =
      JSON.parse(localStorage.getItem(CODE_FRAUD_KEY) || "{}");
    const key = matricNumber.trim().toLowerCase();
    if (!fraudMap[key]) fraudMap[key] = [];
    fraudMap[key].push({ enteredCode, at: new Date().toISOString() });
    localStorage.setItem(CODE_FRAUD_KEY, JSON.stringify(fraudMap));
    // Sync fraud flag to Supabase so the lecturer can see it
    sync(supabase?.rpc("flag_code_fraud", { p_matric: matricNumber.trim(), p_entered: enteredCode }));
  } catch {
    // non-fatal
  }
}

/** Get all flagged fraud attempts (for admin display) */
export function getCodeFraudMap(): Record<string, { enteredCode: string; at: string }[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CODE_FRAUD_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Clear all stored student codes and fraud flags (call when lecturer resets class code) */
export function clearStudentCodes() {
  localStorage.removeItem(STUDENT_CODES_KEY);
  localStorage.removeItem(CODE_FRAUD_KEY);
}

// ── Test links ───────────────────────────────────────────────────────────────────
export function loadTestLinks(): TestLink[] {
  if (typeof window === "undefined") return [];
  try {
    const links = JSON.parse(localStorage.getItem(TEST_LINKS_KEY) || "[]") as TestLink[];
    return links.map(ensureTestLinkType);
  } catch {
    return [];
  }
}

export function saveTestLinks(links: TestLink[]) {
  localStorage.setItem(TEST_LINKS_KEY, JSON.stringify(links));
  window.dispatchEvent(new Event("att:test-links"));
}

export async function addTestLink(t: TestLink): Promise<void> {
  // Save locally first so the lecturer sees it immediately
  const all = loadTestLinks();
  all.push(t);
  saveTestLinks(all);

  if (supabase) {
    const row = testLinkToDb(t);
    let { error } = await supabase.from("test_links").upsert(row);

    if (error) {
      // If the table doesn't exist yet (migration not run), still save locally
      console.warn("test_links table may not exist. Run migration to enable cloud sync.");
      return;
    }
  }
}

export function deleteTestLink(id: string) {
  saveTestLinks(loadTestLinks().filter((t) => t.id !== id));
  sync(supabase?.from("test_links").delete().eq("id", id));
}

export function getTestLinkByToken(token: string): TestLink | null {
  return loadTestLinks().find((l) => l.token === token) || null;
}

// ── Window helpers ────────────────────────────────────────────────────────────
export function isWindowOpen(s: AdminSettings, now = new Date()): boolean {
  if (!s.windowOpenedAt) return false;
  if (s.windowMinutes <= 0) return true;
  const opened = new Date(s.windowOpenedAt).getTime();
  return now.getTime() - opened <= s.windowMinutes * 60_000;
}

export function minutesRemaining(s: AdminSettings, now = new Date()): number {
  if (!s.windowOpenedAt) return 0;
  if (s.windowMinutes <= 0) return Infinity;
  const opened = new Date(s.windowOpenedAt).getTime();
  const remainingMs = s.windowMinutes * 60_000 - (now.getTime() - opened);
  return Math.max(0, Math.ceil(remainingMs / 60_000));
}

// ── Supabase fetch — populates localStorage from remote ───────────────────────
type AllData = {
  settings: AdminSettings | null;
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  tests: TestConfig[];
  testSubmissions: TestSubmission[];
  links: AttendanceLink[];
};

export async function fetchAllFromSupabaseOnce(): Promise<AllData | null> {
  if (!supabase) return null;
  try {
    const [settingsRes, recordsRes, sessionsRes, testsRes, subsRes, linksRes] = await Promise.all([
      supabase.from("admin_settings").select("data").eq("id", "default").maybeSingle(),
      supabase.from("attendance_records").select("*"),
      supabase.from("attendance_sessions").select("*"),
      supabase.from("test_configs").select("*"),
      supabase.from("test_submissions").select("*"),
      supabase.from("attendance_links").select("*").order("created_at", { ascending: false }),
    ]);

    return {
      settings: settingsRes.data ? (settingsRes.data.data as AdminSettings) : null,
      records: (recordsRes.data || []).map(recordFromDb),
      sessions: (sessionsRes.data || []).map(sessionFromDb),
      tests: (testsRes.data || []).map(testFromDb),
      testSubmissions: (subsRes.data || []).map(submissionFromDb),
      links: (linksRes.data || []).map(linkFromDb),
    };
  } catch {
    return null;
  }
}

export async function syncFromSupabase(): Promise<void> {
  const data = await fetchAllFromSupabaseOnce();
  if (!data || typeof window === "undefined") return;

  if (data.settings) {
    localStorage.setItem(SET_KEY, JSON.stringify(data.settings));
    window.dispatchEvent(new Event("att:settings"));
  }
  if (data.records.length > 0) {
    localStorage.setItem(REC_KEY, JSON.stringify(data.records));
    window.dispatchEvent(new Event("att:records"));
  }
  const sessionsClearedFlag = localStorage.getItem("att.sessions.cleared.v1");
  if (data.sessions.length > 0 && !sessionsClearedFlag) {
    localStorage.setItem(SES_KEY, JSON.stringify(data.sessions));
    window.dispatchEvent(new Event("att:sessions"));
  }
  if (data.tests.length > 0) {
    localStorage.setItem(TST_KEY, JSON.stringify(data.tests));
    window.dispatchEvent(new Event("att:tests"));
  }
  if (data.testSubmissions.length > 0) {
    localStorage.setItem(TSUB_KEY, JSON.stringify(data.testSubmissions));
    window.dispatchEvent(new Event("att:test-submissions"));
  }
  if (data.links.length > 0) {
    localStorage.setItem(LINKS_KEY, JSON.stringify(data.links));
    window.dispatchEvent(new Event("att:links"));
  }
}

export { fetchAllFromSupabaseOnce as fetchAllFromSupabase };

// ── Lightweight settings-only fetch (used for student-side polling) ───────────
export async function fetchSettingsFromSupabase(): Promise<AdminSettings | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("admin_settings")
      .select("data")
      .eq("id", "default")
      .maybeSingle();
    return data ? (data.data as AdminSettings) : null;
  } catch {
    return null;
  }
}


// ── Server-side check-in (security-hardening.sql) ────────────────────────────

export type SubmitAttendanceInput = {
  id: string;
  token: string;
  deviceId: string;
  fullName: string;
  matricNumber: string;
  department: string;
  phone: string;
  level: string;
  gender: Gender;
  topic: string;
  sessionId: string;
  roomCode: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  /** Distance between the selfie and the registered face (lower = closer); null if not registered */
  faceDistance: number | null;
  customFields: Record<string, string>;
};

export type SubmitAttendanceResult = {
  id: string;
  distance: number;
  classCode: string | null;
  dayKey: string;
  submittedAt: string;
};

/** Structured reason the server refused a check-in. */
export type CheckInErrorCode =
  | "not_found" | "closed" | "locked" | "wrong_code" | "weak_gps" | "no_gps"
  | "out_of_range" | "duplicate_device" | "duplicate_matric" | "invalid"
  | "no_location" | "not_configured" | "unknown";

export class CheckInError extends Error {
  code: CheckInErrorCode;
  /** out_of_range → metres away; weak_gps → reported accuracy in metres */
  meters?: number;
  /** out_of_range → the allowed radius */
  radius?: number;
  constructor(code: CheckInErrorCode, message: string, meters?: number, radius?: number) {
    super(message);
    this.code = code;
    this.meters = meters;
    this.radius = radius;
  }
}

function parseCheckInError(raw: string): CheckInError {
  const m = raw.match(/(not_found|closed|locked|wrong_code|weak_gps|no_gps|out_of_range|duplicate_device|duplicate_matric|no_location|invalid)(?::(\d+))?(?::(\d+))?/);
  if (!m) {
    if (/function .*submit_attendance.* does not exist|schema cache/i.test(raw)) {
      return new CheckInError("not_configured", "Check-in is not set up yet. Ask your lecturer to run security-hardening.sql.");
    }
    return new CheckInError("unknown", raw);
  }
  const code = m[1] as CheckInErrorCode;
  return new CheckInError(code, raw, m[2] ? Number(m[2]) : undefined, m[3] ? Number(m[3]) : undefined);
}

/**
 * Sends a check-in to the server, which re-does every check (link open,
 * room code, distance from the lecturer, GPS accuracy, duplicates).
 * Throws CheckInError with a structured code on refusal.
 */
export async function submitAttendance(input: SubmitAttendanceInput): Promise<SubmitAttendanceResult> {
  if (!supabase) throw new CheckInError("not_configured", "Database not configured.");
  const { data, error } = await supabase.rpc("submit_attendance", { p: input });
  if (error) throw parseCheckInError(error.message);
  // Refusals the server logs (wrong code, out of range…) come back as {"error": "..."}
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw parseCheckInError(String((data as { error: string }).error));
  }
  const r = data as SubmitAttendanceResult;
  // Mirror locally so the device/matric checks work offline too
  const all = loadRecords();
  all.push({
    id: r.id,
    fullName: input.fullName,
    matricNumber: input.matricNumber.toUpperCase(),
    department: input.department,
    phone: input.phone,
    courseCode: "",
    topic: input.topic,
    level: input.level,
    gender: input.gender,
    submittedAt: r.submittedAt,
    dayKey: r.dayKey,
    deviceId: input.deviceId,
    distanceMeters: r.distance,
    lat: input.lat ?? 0,
    lng: input.lng ?? 0,
    sessionId: input.sessionId,
    customFields: input.customFields,
    assignedClassCode: r.classCode ?? undefined,
  });
  saveRecords(all);
  return r;
}

/** Lecturer only: the room code currently showing for a link. */
export async function fetchRoomCode(linkId: string): Promise<{ code: string; secondsLeft: number } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_room_code", { p_link_id: linkId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { code: row.code as string, secondsLeft: Number(row.seconds_left) };
}

/** Student: look up own attendance record by matric (name, level, class code). */
export async function lookupStudentRemote(matric: string): Promise<{ fullName: string; level: string; matricNumber: string; classCode: string | null } | null> {
  if (!supabase) return null;
  const { data } = await supabase.rpc("lookup_student", { p_matric: matric.trim() });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { fullName: row.full_name, level: row.level || "", matricNumber: row.matric_number, classCode: row.assigned_class_code ?? null };
}

// ── Student registration (students-migration.sql) ────────────────────────────

export type StudentProfile = {
  matricNumber: string;
  fullName: string;
  department: string;
  level: string;
  phone: string;
  gender: Gender;
  descriptor: number[];
  status: "active" | "reset_requested";
  photo?: string | null;
  deviceId?: string;
  createdAt?: string;
};

export type RegisterErrorCode = "invalid" | "matric_taken" | "device_taken" | "face_exists" | "not_configured" | "unknown";

export class RegisterError extends Error {
  code: RegisterErrorCode;
  hint?: string;
  constructor(code: RegisterErrorCode, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export async function registerStudent(input: {
  fullName: string; matricNumber: string; department: string; level: string;
  phone: string; gender: Gender; deviceId: string; descriptor: number[]; photo: string;
}): Promise<void> {
  if (!supabase) throw new RegisterError("not_configured", "Database not configured.");
  const { error } = await supabase.rpc("register_student", { p: input });
  if (error) {
    const m = error.message.match(/(invalid|matric_taken|device_taken|face_exists)(?::([^\s"]+))?/);
    if (m) throw new RegisterError(m[1] as RegisterErrorCode, error.message, m[2]);
    if (/does not exist|schema cache/i.test(error.message)) {
      throw new RegisterError("not_configured", "Registration is not set up yet. Ask your lecturer to run students-migration.sql.");
    }
    throw new RegisterError("unknown", error.message);
  }
  try { localStorage.setItem("att.student.matric", input.matricNumber.toUpperCase()); } catch { /* ignore */ }
}

/** The matric number registered on this phone, if any. */
export function getRegisteredMatric(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("att.student.matric");
}

export async function fetchStudentProfile(matric: string): Promise<StudentProfile | null> {
  if (!supabase || !matric.trim()) return null;
  const { data, error } = await supabase.rpc("get_student_profile", { p_matric: matric.trim() });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    matricNumber: row.matric_number, fullName: row.full_name, department: row.department || "",
    level: row.level || "", phone: row.phone || "", gender: (row.gender as Gender) || "other",
    descriptor: (row.descriptor as number[]) || [], status: row.status || "active",
  };
}

export async function requestStudentReset(matric: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("request_student_reset", { p_matric: matric.trim() });
}

/** Lecturer only. */
export async function fetchStudents(): Promise<StudentProfile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("students").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    matricNumber: row.matric_number, fullName: row.full_name, department: row.department || "",
    level: row.level || "", phone: row.phone || "", gender: (row.gender as Gender) || "other",
    descriptor: [], status: row.status || "active", photo: row.photo, deviceId: row.device_id,
    createdAt: row.created_at,
  }));
}

/** Lecturer only: remove a registration so the student can register again. */
export async function deleteStudent(matric: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("students").delete().eq("matric_number", matric);
  if (error) throw new Error(error.message);
}

// ── Lecturer: blocked/failed check-in attempts (security-hardening.sql) ─────

export type CheckInAttempt = {
  id: number;
  linkId: string | null;
  deviceId: string | null;
  matric: string | null;
  reason: string;
  detail: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  at: string;
};

/** Lecturer only. Most recent first. */
export async function fetchAttempts(opts: { linkId?: string; sinceDays?: number; limit?: number } = {}): Promise<CheckInAttempt[]> {
  if (!supabase) return [];
  let q = supabase.from("attendance_attempts").select("*").order("at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.linkId) q = q.eq("link_id", opts.linkId);
  if (opts.sinceDays) q = q.gte("at", new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString());
  const { data, error } = await q;
  if (error) return [];
  return (data || []).map((r) => ({
    id: r.id, linkId: r.link_id, deviceId: r.device_id, matric: r.matric, reason: r.reason,
    detail: r.detail, lat: r.lat, lng: r.lng, accuracy: r.accuracy, at: r.at,
  }));
}

/** Lecturer decision on a flagged check-in. Approve keeps it; reject removes it. */
export function reviewRecord(record: AttendanceRecord, decision: "approved" | "rejected") {
  const all = loadRecords();
  if (decision === "rejected") {
    deleteRecordById(record.id, all);
    return;
  }
  const updated: AttendanceRecord = {
    ...record,
    customFields: { ...record.customFields, reviewed: "approved", reviewedAt: new Date().toISOString() },
  };
  saveRecords(all.map((r) => (r.id === record.id ? updated : r)));
  syncRecord(updated);
}

/** Move a link's closing time (lecturer). */
export function setLinkExpiry(id: string, expiresAt: string) {
  saveLinks(loadLinks().map((l) => (l.id === id ? { ...l, expiresAt } : l)));
  sync(supabase?.from("attendance_links").update({ expires_at: expiresAt }).eq("id", id));
}

// ── Student: view and correct own check-ins (student-edits.sql) ─────────────

export type MyCheckIn = {
  id: string;
  courseCode: string;
  submittedAt: string;
  fullName: string;
  matricNumber: string;
  department: string;
  distanceMeters: number | null;
  photo: string | null;
  flags: string;
  reviewed: string | null;
  edited: boolean;
};

export type MyAttendance = {
  profile: { matricNumber: string; fullName: string; department: string; level: string; photo: string | null } | null;
  records: MyCheckIn[];
};

/** Check-ins submitted from this phone (and its registered profile). */
export async function fetchMyAttendance(matric: string): Promise<MyAttendance> {
  if (!supabase) return { profile: null, records: [] };
  const { data, error } = await supabase.rpc("get_my_attendance", { p_device: getDeviceId(), p_matric: matric.trim() });
  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) throw new Error("not_configured");
    throw new Error(error.message);
  }
  const d = (data ?? {}) as MyAttendance;
  return { profile: d.profile ?? null, records: d.records ?? [] };
}

export type EditErrorCode = "invalid" | "not_owner" | "matric_taken" | "matric_conflict" | "too_many_edits" | "not_configured" | "unknown";

export class EditError extends Error {
  code: EditErrorCode;
  constructor(code: EditErrorCode, message: string) { super(message); this.code = code; }
}

/** Correct name / matric / department on this phone's check-ins (and profile). */
export async function updateMyDetails(input: { matricNumber: string; newMatricNumber: string; fullName: string; department: string }) {
  if (!supabase) throw new EditError("not_configured", "Database not configured.");
  const { data, error } = await supabase.rpc("update_my_details", { p: { deviceId: getDeviceId(), ...input } });
  if (error) {
    const m = error.message.match(/(invalid|not_owner|matric_taken|matric_conflict|too_many_edits)/);
    if (m) throw new EditError(m[1] as EditErrorCode, error.message);
    if (/does not exist|schema cache|Could not find/i.test(error.message)) throw new EditError("not_configured", "Editing isn't set up yet. Ask your lecturer to run student-edits.sql.");
    throw new EditError("unknown", error.message);
  }
  const r = data as { matricNumber: string };
  // Keep this phone's remembered matric in step with the change
  try {
    if (localStorage.getItem("att.student.matric")) localStorage.setItem("att.student.matric", r.matricNumber);
  } catch { /* ignore */ }
  return r;
}
