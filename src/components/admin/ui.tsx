import type { ReactNode } from "react";

/** Page header used by the redesigned admin pages. */
export function PageHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-grow">
        {eyebrow && <p className="text-[13px] text-muted-foreground">{eyebrow}</p>}
        <h1 className="mt-0.5 font-display text-2xl font-semibold sm:text-[28px]">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Raised surface: one step up from the page with a hairline border. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[18px] border border-[rgba(27,36,57,0.08)] bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${className}`}>{children}</section>;
}

export function PanelTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "green" | "amber" }) {
  return (
    <div className="rounded-2xl border border-[rgba(27,36,57,0.08)] bg-card px-5 py-4">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1.5 font-display text-[30px] font-semibold leading-none ${tone === "amber" ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</p>
      {hint && <p className={`mt-1.5 text-xs ${tone === "green" ? "text-[#0f8a66]" : "text-muted-foreground"}`}>{hint}</p>}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: "green" | "amber" | "grey" | "red"; children: ReactNode }) {
  const cls = {
    green: "bg-[#e7f8f1] text-[#0b6b4f] dark:bg-emerald-900/30 dark:text-emerald-300",
    amber: "bg-[#fdf3e2] text-[#92400e] dark:bg-amber-900/30 dark:text-amber-300",
    grey: "bg-secondary text-muted-foreground",
    red: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function Avatar({ src, name, size = 32 }: { src?: string | null; name: string; size?: number }) {
  if (src) return <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground" style={{ width: size, height: size }}>
      {initials || "?"}
    </span>
  );
}

/** Human label + tone for a record's server flags. */
export function checkStatus(customFields: Record<string, unknown> | undefined): { label: string; tone: "green" | "amber" | "grey" } {
  const f = String(customFields?.flags ?? "");
  if (customFields?.reviewed === "approved") return { label: "Approved", tone: "green" };
  if (f.includes("matric_changed")) return { label: "Matric changed", tone: "amber" };
  if (/gps_too_still|gps_round|same_spot|on_pin|off_campus_net/.test(f)) return { label: "Suspicious location", tone: "amber" };
  if (f.includes("gps_help") && !/face_mismatch|different_phone|no_face_check/.test(f)) return { label: "GPS help", tone: "green" };
  if (f.includes("face_mismatch")) return { label: "Face mismatch", tone: "amber" };
  if (f.includes("different_phone")) return { label: "Different phone", tone: "amber" };
  if (f.includes("no_face_check")) return { label: "No face check", tone: "amber" };
  if (f.includes("not_registered")) return { label: "Not registered", tone: "grey" };
  if (customFields?.serverChecked) {
    const edited = Array.isArray(customFields?.edits) && (customFields.edits as unknown[]).length > 0;
    return { label: edited ? "Verified · edited" : "Verified", tone: "green" };
  }
  return { label: "Unverified", tone: "grey" };
}

export const ATTEMPT_LABEL: Record<string, string> = {
  out_of_range: "Out of range",
  wrong_code: "Wrong class code",
  weak_gps: "Weak GPS",
  no_gps: "Location off",
  closed: "After closing",
};
