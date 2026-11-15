import { useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Eye, EyeOff, MapPin } from "lucide-react";

/** Calm single-column page for sign-in, reset and new-password screens */
export function AuthShell({ step, children, back }: { step?: string; children: ReactNode; back?: ReactNode }) {
  return (
    <div className="min-h-[100svh] bg-background">
      <div className="mx-auto flex min-h-[100svh] w-full max-w-[400px] flex-col px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        <div className="flex h-10 items-center justify-between">
          {back ?? (
            <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Home
            </Link>
          )}
          {step && <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">{step}</span>}
        </div>
        <div className="flex flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-center text-xs text-muted-foreground/70">Attendly · EKSU</p>
      </div>
    </div>
  );
}

export function AuthMark() {
  return (
    <span className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
      <MapPin className="h-[18px] w-[18px]" />
    </span>
  );
}

export function AuthTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
      {sub && <p className="mt-1.5 text-[15px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Inputs and buttons share these looks */
export const authInput = "h-12 w-full rounded-xl border border-border bg-card px-3.5 text-[15px] outline-none transition focus:border-foreground focus:ring-4 focus:ring-foreground/5";
export const authButton = "inline-flex h-12 w-full items-center justify-center rounded-xl bg-foreground text-[15px] font-semibold text-background transition hover:bg-foreground/90 active:scale-[0.99] disabled:opacity-50";
export const authGhost = "inline-flex h-12 w-full items-center justify-center rounded-xl border border-border text-[15px] font-medium transition hover:bg-secondary";

/** Six separate boxes for an emailed code; paste fills them all */
export function CodeBoxes({ value, onChange, length = 6, disabled }: { value: string; onChange: (v: string) => void; length?: number; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, d: string) => {
    const chars = value.padEnd(length, " ").split("");
    chars[i] = d || " ";
    onChange(chars.join("").replace(/\s+$/, "").replace(/\s/g, ""));
  };
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
      onPaste={(e) => {
        const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
        if (!digits) return;
        e.preventDefault();
        onChange(digits);
        refs.current[Math.min(digits.length, length - 1)]?.focus();
      }}>
      {Array.from({ length }, (_, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} id={i === 0 ? "reset-code" : undefined}
          aria-label={`Digit ${i + 1}`} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={1} disabled={disabled}
          value={value[i] ?? ""}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(-1);
            set(i, d);
            if (d && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) { set(i - 1, ""); refs.current[i - 1]?.focus(); e.preventDefault(); }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
          }}
          className={`h-14 w-full min-w-0 rounded-xl border bg-card text-center font-mono text-2xl outline-none transition focus:border-foreground focus:ring-4 focus:ring-foreground/5 ${value[i] ? "border-foreground" : "border-border"}`} />
      ))}
    </div>
  );
}

/** Four-bar strength meter plus a live checklist */
export function PasswordStrength({ value }: { value: string }) {
  const rules = [
    { ok: value.length >= 8, label: "At least 8 characters" },
    { ok: /\d/.test(value), label: "Contains a number" },
    { ok: /[a-z]/.test(value) && /[A-Z]/.test(value), label: "Upper and lower case" },
  ];
  const score = rules.filter((r) => r.ok).length + (value.length >= 12 ? 1 : 0);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1">
        {[0, 1, 2, 3].map((i) => <i key={i} className={`h-1 rounded-full transition-colors ${i < score ? "bg-primary" : "bg-border"}`} />)}
      </div>
      <ul className="grid gap-0.5 text-xs">
        {rules.map((r) => (
          <li key={r.label} className={r.ok ? "text-foreground" : "text-muted-foreground"}>
            <span className={r.ok ? "text-primary" : "text-muted-foreground/60"}>{r.ok ? "●" : "○"}</span> {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Password box with a show / hide eye */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${props.className ?? authInput} pr-12`} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
        className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
