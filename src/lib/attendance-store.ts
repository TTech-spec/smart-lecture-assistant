// Local-storage backed store for the UI-first prototype.
// Backend (Lovable Cloud + auth + AI) will replace this in the next step.

export type Gender = "male" | "female" | "other";

export type AttendanceRecord = {
  id: string;
  fullName: string;
  matricNumber: string;
  department: string;
  phone: string;
  courseCode: string;
  topic: string;
  gender: Gender;
  submittedAt: string; // ISO
  dayKey: string; // YYYY-MM-DD
  deviceId: string;
  distanceMeters: number;
  lat: number;
  lng: number;
};

export type AdminSettings = {
  classLat: number | null;
  classLng: number | null;
  radiusMeters: number;
  windowMinutes: number; // 0 = no time limit
  windowOpenedAt: string | null; // ISO when lecturer opened the window
  courseCode: string;
  topic: string;
};

const REC_KEY = "att.records.v1";
const SET_KEY = "att.settings.v1";
const DEV_KEY = "att.deviceId.v1";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEV_KEY);
  if (!id) {
    id =
      (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ||
      `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    localStorage.setItem(DEV_KEY, id);
  }
  return id;
}

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export const defaultSettings: AdminSettings = {
  classLat: null,
  classLng: null,
  radiusMeters: 100,
  windowMinutes: 15,
  windowOpenedAt: null,
  courseCode: "",
  topic: "",
};

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
}

export function loadRecords(): AttendanceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(REC_KEY) || "[]") as AttendanceRecord[];
  } catch {
    return [];
  }
}

export function saveRecords(records: AttendanceRecord[]) {
  localStorage.setItem(REC_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event("att:records"));
}

export function addRecord(r: AttendanceRecord) {
  const all = loadRecords();
  all.push(r);
  saveRecords(all);
}

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
