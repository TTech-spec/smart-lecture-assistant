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
};

export type AttendanceSession = {
  id: string;
  courseCode: string;
  level: string;
  topic: string;
  openedAt: string;
  closedAt?: string;
};

export type TestQuestion = {
  id: string;
  text: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
};

export type TestType = "C1" | "C2" | "C3";

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
};

// ── Storage keys ──────────────────────────────────────────────────────────────
const REC_KEY      = "att.records.v1";
const SET_KEY      = "att.settings.v1";
const DEV_KEY      = "att.deviceId.v1";
const SES_KEY      = "att.sessions.v1";
const TST_KEY      = "att.tests.v1";
const TSUB_KEY     = "att.test-submissions.v1";
const CODE_USED_KEY = "att.code.used.v1";

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
      sync(supabase.from("attendance").update({ assigned_class_code: classCode }).eq("matric_number", matricNumber));
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
  localStorage.removeItem(SES_KEY);
  window.dispatchEvent(new Event("att:sessions"));
  sync(supabase?.from("attendance_sessions").delete().gte("created_at", "1970-01-01T00:00:00Z"));
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

// ── Class code tracking ───────────────────────────────────────────────────────
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
};

export async function fetchAllFromSupabaseOnce(): Promise<AllData | null> {
  if (!supabase) return null;
  try {
    const [settingsRes, recordsRes, sessionsRes, testsRes, subsRes] = await Promise.all([
      supabase.from("admin_settings").select("data").eq("id", "default").maybeSingle(),
      supabase.from("attendance_records").select("*"),
      supabase.from("attendance_sessions").select("*"),
      supabase.from("test_configs").select("*"),
      supabase.from("test_submissions").select("*"),
    ]);

    return {
      settings: settingsRes.data ? (settingsRes.data.data as AdminSettings) : null,
      records: (recordsRes.data || []).map(recordFromDb),
      sessions: (sessionsRes.data || []).map(sessionFromDb),
      tests: (testsRes.data || []).map(testFromDb),
      testSubmissions: (subsRes.data || []).map(submissionFromDb),
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
  if (data.sessions.length > 0) {
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
