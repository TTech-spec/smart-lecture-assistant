import { useEffect, useState } from "react";
import {
  loadRecords,
  loadSettings,
  loadSessions,
  loadTests,
  loadTestSubmissions,
  loadLinks,
  loadTestLinks,
  syncFromSupabase,
  type AdminSettings,
  type AttendanceRecord,
  type AttendanceSession,
  type AttendanceLink,
  type TestConfig,
  type TestSubmission,
  type TestLink,
} from "@/lib/attendance-store";
import { loadMaterials, syncMaterialsFromSupabase, type Material } from "@/lib/materials-store";

export function useStore() {
  const [settings, setSettings] = useState<AdminSettings>(() => loadSettings());
  const [records, setRecords] = useState<AttendanceRecord[]>(() => loadRecords());
  const [sessions, setSessions] = useState<AttendanceSession[]>(() => loadSessions());
  const [tests, setTests] = useState<TestConfig[]>(() => loadTests());
  const [testSubmissions, setTestSubmissions] = useState<TestSubmission[]>(() => loadTestSubmissions());
  const [materials, setMaterials] = useState<Material[]>(() => loadMaterials());
  const [links, setLinks] = useState<AttendanceLink[]>(() => loadLinks());
  const [testLinks, setTestLinks] = useState<TestLink[]>(() => loadTestLinks());

  // On mount, pull latest data from Supabase and populate localStorage + state
  useEffect(() => {
    syncFromSupabase();
    syncMaterialsFromSupabase();
  }, []);

  useEffect(() => {
    const syncS   = () => setSettings(loadSettings());
    const syncR   = () => setRecords(loadRecords());
    const syncSes = () => setSessions(loadSessions());
    const syncT   = () => setTests(loadTests());
    const syncTS  = () => setTestSubmissions(loadTestSubmissions());
    const syncM   = () => setMaterials(loadMaterials());
    const syncL   = () => setLinks(loadLinks());
    const syncTL  = () => setTestLinks(loadTestLinks());
    const syncAll = () => { syncS(); syncR(); syncSes(); syncT(); syncTS(); syncM(); syncL(); syncTL(); };

    window.addEventListener("att:settings",         syncS);
    window.addEventListener("att:records",          syncR);
    window.addEventListener("att:sessions",         syncSes);
    window.addEventListener("att:tests",            syncT);
    window.addEventListener("att:test-submissions", syncTS);
    window.addEventListener("att:materials",        syncM);
    window.addEventListener("att:links",            syncL);
    window.addEventListener("att:test-links",        syncTL);
    window.addEventListener("storage",              syncAll);

    return () => {
      window.removeEventListener("att:settings",         syncS);
      window.removeEventListener("att:records",          syncR);
      window.removeEventListener("att:sessions",         syncSes);
      window.removeEventListener("att:tests",            syncT);
      window.removeEventListener("att:test-submissions", syncTS);
      window.removeEventListener("att:materials",        syncM);
      window.removeEventListener("att:links",            syncL);
      window.removeEventListener("att:test-links",        syncTL);
      window.removeEventListener("storage",              syncAll);
    };
  }, []);

  return { settings, setSettings, records, setRecords, sessions, tests, testSubmissions, materials, links, testLinks };
}
