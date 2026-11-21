import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BookOpen, ClipboardList, Download, LayoutGrid, Link2, LogOut, MonitorPlay,
  Settings2, SlidersHorizontal, Users, KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isLinkValid, type AttendanceLink, type AttendanceRecord } from "@/lib/attendance-store";

type Item = { to: string; label: string; icon: React.ReactNode; exact?: boolean; badge?: React.ReactNode };

/** Records the server flagged that the lecturer hasn't decided on yet. */
export function needsReview(r: AttendanceRecord): boolean {
  const flags = String(r.customFields?.flags ?? "");
  const decided = r.customFields?.reviewed;
  if (decided) return false;
  if (/same_face_maybe|face_is_other_student|face_mismatch|no_face_check|different_phone|matric_changed|gps_too_still|gps_round|same_spot|on_pin|off_campus_net|loc_far/.test(flags)) return true;
  // Unverified: never went through the server checks (and not added by the lecturer)
  return isUnverified(r);
}

/** A check-in the server never checked, that the lecturer didn't add by hand */
export function isUnverified(r: AttendanceRecord): boolean {
  const cf = r.customFields ?? {};
  return !cf.serverChecked && !cf.flags && !cf.reviewed && !cf.addedByLecturer && !String(r.id ?? "").startsWith("manual-");
}

export function AdminSidebar({
  links, records, onNavigate, onLogout, onSetup, onInstall, showInstall, onAccount,
}: {
  links: AttendanceLink[];
  records: AttendanceRecord[];
  onNavigate?: () => void;
  onLogout: () => void;
  onAccount?: () => void;
  onSetup: () => void;
  onInstall: () => void;
  showInstall: boolean;
}) {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase?.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const live = useMemo(
    () => links.some((l) => (l.linkType ?? "attendance") === "attendance" && isLinkValid(l)),
    [links],
  );
  const reviewCount = useMemo(() => records.filter(needsReview).length, [records]);

  const attendance: Item[] = [
    { to: "/admin", label: "Overview", icon: <LayoutGrid className="h-[17px] w-[17px]" />, exact: true },
    {
      to: "/admin/live", label: "Live session", icon: <MonitorPlay className="h-[17px] w-[17px]" />,
      badge: live ? <span className="ml-auto rounded-full bg-[#12b886] px-1.5 py-px text-[10px] font-bold text-[#0e1a17]">LIVE</span> : null,
    },
    { to: "/admin/records", label: "Records", icon: <ClipboardList className="h-[17px] w-[17px]" /> },
    { to: "/admin/students", label: "Students", icon: <Users className="h-[17px] w-[17px]" /> },
    { to: "/admin/links", label: "Links", icon: <Link2 className="h-[17px] w-[17px]" /> },
    {
      to: "/admin/review", label: "To review", icon: <AlertTriangle className="h-[17px] w-[17px]" />,
      badge: reviewCount > 0 ? <span className="ml-auto rounded-full bg-amber-400/20 px-1.5 py-px text-[11px] font-bold text-amber-300">{reviewCount}</span> : null,
    },
  ];
  const teaching: Item[] = [
    { to: "/admin/manage", label: "Tests & settings", icon: <SlidersHorizontal className="h-[17px] w-[17px]" /> },
    { to: "/admin/materials", label: "Materials", icon: <BookOpen className="h-[17px] w-[17px]" /> },
  ];

  const initials = (email ?? "L").slice(0, 2).toUpperCase();

  return (
    <aside className="flex h-full w-[248px] flex-col bg-[#121a2b] px-3.5 py-5 text-[#eef2f7]">
      <Link to="/admin" onClick={onNavigate} className="flex items-center gap-2.5 px-2.5 pb-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#12b886] text-[#0e1a17]">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><path d="M9 9.5l2 2 4-4" /></svg>
        </span>
        <span className="font-display text-lg font-semibold text-white">Attendly</span>
      </Link>

      <Group label="Attendance" items={attendance} onNavigate={onNavigate} />
      <Group label="Teaching" items={teaching} onNavigate={onNavigate} className="mt-4" />

      {/* Account: sign-in email and password, easy to find */}
      <p className="mx-2.5 mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-[#aeb9cb]">Account</p>
      <SideButton onClick={() => { onAccount?.(); onNavigate?.(); }} icon={<KeyRound className="h-[17px] w-[17px]" />} label="Email & password" />

      <div className="flex-grow" />

      {showInstall && (
        <SideButton onClick={onInstall} icon={<Download className="h-[17px] w-[17px]" />} label="Install app" />
      )}
      <SideButton onClick={onSetup} icon={<Settings2 className="h-[17px] w-[17px]" />} label="Setup wizard" />

      <div className="mt-2.5 flex items-center gap-2.5 border-t border-white/10 px-2.5 pt-3">
        <button type="button" onClick={() => { onAccount?.(); onNavigate?.(); }} title="Your account: email and password"
          className="-ml-1 flex min-w-0 flex-grow items-center gap-2.5 rounded-xl p-1 text-left transition-colors hover:bg-white/5">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#12b886]/20 text-xs font-semibold text-[#4fd8a8]">{initials}</span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-white">Your account</span>
            <span className="block truncate text-[13px] text-[#c7d0dd]">{email ?? "Signed in"}</span>
          </span>
        </button>
        <button
          onClick={onLogout} aria-label="Sign out" title="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#c7d0dd] transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function Group({ label, items, onNavigate, className }: { label: string; items: Item[]; onNavigate?: () => void; className?: string }) {
  return (
    <nav className={className} aria-label={label}>
      <p className="mx-2.5 mb-2 mt-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#aeb9cb]">{label}</p>
      <div className="flex flex-col gap-0.5">
        {items.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            onClick={onNavigate}
            activeOptions={{ exact: it.exact ?? false }}
            className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2.5 text-[15px] font-medium text-[#eef2f7] transition-colors hover:bg-white/10 hover:text-white [&.active]:bg-[#4fd8a8]/[0.12] [&.active]:font-medium [&.active]:text-white [&.active_svg]:text-[#4fd8a8]"
          >
            {it.icon}
            {it.label}
            {it.badge}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function SideButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2.5 text-left text-[15px] font-medium text-[#eef2f7] transition-colors hover:bg-white/10 hover:text-white"
    >
      {icon}
      {label}
    </button>
  );
}
