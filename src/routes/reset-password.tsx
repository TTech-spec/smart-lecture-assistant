import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell, AuthTitle, PasswordStrength, authButton, authInput } from "@/components/auth/AuthUI";
import { toast } from "sonner";
import { openPasswordResetLink, setNewLecturerPassword } from "@/lib/lecturer-auth";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password — Attendly" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ResetPasswordPage,
});

/** Opened from the reset email: choose a new lecturer password. */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openPasswordResetLink().then((ok) => setState(ok ? "ready" : "invalid"));
  }, []);


  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pass.length < 8) return setError("Use at least 8 characters.");
    if (pass !== again) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await setNewLecturerPassword(pass);
      toast.success("Password changed. You're signed in.");
      navigate({ to: "/admin" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell step="Reset · 3 of 3" back={<Link to="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Sign in</Link>}>
      {state === "checking" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your reset link…</p>
      )}

      {state === "invalid" && (
        <>
          <AuthTitle title="This link has expired" sub="Reset links and codes work once and expire after an hour. Ask for a new one." />
          <Link to="/admin" className={authButton}>Back to sign in</Link>
        </>
      )}

      {state === "ready" && (
        <>
          <AuthTitle title="Choose a new password" sub="You'll use it next time you sign in." />
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="new-pass" className="text-sm font-medium">New password</label>
              <div className="relative">
                <input id="new-pass" type={show ? "text" : "password"} autoComplete="new-password" value={pass}
                  onChange={(e) => setPass(e.target.value)} placeholder="At least 8 characters" className={`${authInput} pr-11`} autoFocus />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <PasswordStrength value={pass} />
            <div className="space-y-1.5">
              <label htmlFor="new-pass-2" className="text-sm font-medium">Confirm</label>
              <input id="new-pass-2" type={show ? "text" : "password"} autoComplete="new-password" value={again}
                onChange={(e) => setAgain(e.target.value)} className={authInput} />
            </div>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <button type="submit" className={authButton} disabled={busy}>{busy ? "Saving…" : "Save and sign in"}</button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
