import { useEffect, useState } from "react";
import { KeyRound, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      setCurrent(""); setNext("");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't change the password."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="acct-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[90svh] w-full max-w-md space-y-5 overflow-y-auto rounded-2xl border bg-card p-6 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="acct-title" className="text-lg font-semibold">Your account</h2>
            <p className="text-sm text-muted-foreground">Signed in as <strong className="text-foreground">{email ?? "…"}</strong></p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={saveEmail} className="space-y-3 rounded-xl border p-4">
          <p className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4 text-primary" /> Change sign-in email</p>
          <p className="text-xs text-muted-foreground">Password reset codes and links go to this email. Use one you check.</p>
          {sentTo ? (
            <div className="space-y-2 rounded-lg bg-primary/10 p-3 text-sm">
              <p>We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish the change. Until then, keep signing in with <strong>{email}</strong>.</p>
              <p className="text-xs text-muted-foreground">If nothing arrives, check spam. Your old email may also get a link to approve the change.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => { setSentTo(null); setNewEmail(""); }}>Use a different email</Button>
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="acct-new-email">New email</Label>
                <Input id="acct-new-email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@gmail.com" className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="acct-email-pass">Your current password</Label>
                <Input id="acct-email-pass" type="password" autoComplete="current-password" value={emailPass} onChange={(e) => setEmailPass(e.target.value)} className="mt-1.5 h-10" />
              </div>
              <Button type="submit" className="h-10 w-full" disabled={busy !== null || !newEmail || !emailPass}>{busy === "email" ? "Sending…" : "Send confirmation"}</Button>
            </>
          )}
        </form>

        <form onSubmit={savePassword} className="space-y-3 rounded-xl border p-4">
          <p className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4 text-primary" /> Change password</p>
          <div>
            <Label htmlFor="acct-cur-pass">Current password</Label>
            <Input id="acct-cur-pass" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="mt-1.5 h-10" />
          </div>
          <div>
            <Label htmlFor="acct-new-pass">New password</Label>
            <Input id="acct-new-pass" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" className="mt-1.5 h-10" />
          </div>
          <Button type="submit" variant="outline" className="h-10 w-full" disabled={busy !== null || !current || next.length < 8}>{busy === "pass" ? "Saving…" : "Change password"}</Button>
        </form>
      </div>
    </div>
  );
}
