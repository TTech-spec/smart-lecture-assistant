import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { PasswordStrength, authButton, authInput } from "@/components/auth/AuthUI";
import { changeLecturerEmail, changeLecturerPassword, currentLecturerEmail } from "@/lib/lecturer-auth";
import { friendlyError } from "@/lib/friendly-error";

/** Lecturer account: change the sign-in email (where reset codes go) and the password. */
export function AccountSettings({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailPass, setEmailPass] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState<"email" | "pass" | null>(null);

  useEffect(() => { currentLecturerEmail().then(setEmail); }, []);

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    try {
      await changeLecturerEmail(newEmail, emailPass);
      setSentTo(newEmail.trim().toLowerCase());
      setEmailPass("");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't change your email."));
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("pass");
    try {
      await changeLecturerPassword(current, next);
      toast.success("Password updated.");
      setCurrent(""); setNext(""); setOpen(null);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't change the password."));
    } finally {
      setBusy(null);
    }
  }

  const [open, setOpen] = useState<"email" | "pass" | null>(null);
  const initials = (email ?? "?").slice(0, 2).toUpperCase();

  if (typeof document === "undefined") return null;
  // Drawn straight onto the page so animated parents can't blend it with what's behind
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="acct-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[92svh] w-full overflow-y-auto rounded-t-3xl border bg-background px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 shadow-soft sm:max-w-md sm:rounded-3xl sm:p-6">
        <div className="flex items-center gap-3 border-b pb-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{initials}</span>
          <div className="min-w-0 flex-1">
            <h2 id="acct-title" className="font-semibold">Your account</h2>
            <p className="truncate text-sm text-muted-foreground">{email ?? "…"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Sign-in email */}
        <div className="border-b py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium"><Mail className="h-4 w-4 text-primary" /> Sign-in email</p>
              <p className="truncate text-[13px] text-muted-foreground">Reset codes are sent here</p>
            </div>
            <button type="button" onClick={() => setOpen(open === "email" ? null : "email")}
              className="shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium hover:bg-secondary">{open === "email" ? "Cancel" : "Change"}</button>
          </div>
          {sentTo && (
            <div className="mt-3 space-y-2 rounded-xl bg-primary/10 p-3 text-[13px]">
              <p>Confirmation sent to <strong>{sentTo}</strong>. Open it to switch. Until then, keep signing in with <strong>{email}</strong>.</p>
              <p className="text-muted-foreground">Check spam. Your old email may also get a link to approve the change.</p>
            </div>
          )}
          {open === "email" && !sentTo && (
            <form onSubmit={saveEmail} className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="acct-new-email" className="text-[13px] font-medium">New email</label>
                <input id="acct-new-email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@gmail.com" className={authInput} autoFocus />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="acct-email-pass" className="text-[13px] font-medium">Current password</label>
                <input id="acct-email-pass" type="password" autoComplete="current-password" value={emailPass} onChange={(e) => setEmailPass(e.target.value)} className={authInput} />
              </div>
              <button type="submit" className={authButton} disabled={busy !== null || !newEmail || !emailPass}>{busy === "email" ? "Sending…" : "Send confirmation"}</button>
            </form>
          )}
        </div>

        {/* Password */}
        <div className="py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4 text-primary" /> Password</p>
              <p className="text-[13px] text-muted-foreground">Use 8 or more characters</p>
            </div>
            <button type="button" onClick={() => setOpen(open === "pass" ? null : "pass")}
              className="shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium hover:bg-secondary">{open === "pass" ? "Cancel" : "Change"}</button>
          </div>
          {open === "pass" && (
            <form onSubmit={savePassword} className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="acct-cur-pass" className="text-[13px] font-medium">Current password</label>
                <input id="acct-cur-pass" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={authInput} autoFocus />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="acct-new-pass" className="text-[13px] font-medium">New password</label>
                <input id="acct-new-pass" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" className={authInput} />
              </div>
              <PasswordStrength value={next} />
              <button type="submit" className={authButton} disabled={busy !== null || !current || next.length < 8}>{busy === "pass" ? "Saving…" : "Change password"}</button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
