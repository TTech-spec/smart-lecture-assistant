import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const strength = pass.length === 0 ? null : pass.length < 8 ? "Too short" : /[0-9]/.test(pass) && /[A-Za-z]/.test(pass) && pass.length >= 10 ? "Strong" : "OK";

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
    <div className="min-h-screen bg-gradient-hero">
      <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-20 sm:px-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-center text-2xl font-bold tracking-tight sm:text-3xl">Choose a new password</h1>

        {state === "checking" && (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your reset link…</p>
        )}

        {state === "invalid" && (
          <div className="mt-8 w-full space-y-3 rounded-2xl border bg-card p-6 text-center shadow-soft">
            <p className="font-semibold">This reset link has expired or was already used</p>
            <p className="text-sm text-muted-foreground">Reset links work once and expire after an hour. Ask for a new one from the sign-in page.</p>
            <Button asChild className="w-full"><Link to="/admin">Back to sign in</Link></Button>
          </div>
        )}

        {state === "ready" && (
          <form onSubmit={save} className="mt-8 w-full space-y-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-6">
            <div>
              <Label htmlFor="new-pass">New password</Label>
              <div className="relative mt-2">
                <Input id="new-pass" type={show ? "text" : "password"} autoComplete="new-password" value={pass}
                  onChange={(e) => setPass(e.target.value)} placeholder="At least 8 characters" className="h-10 pr-10" autoFocus />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {strength && <p className={`mt-1 text-xs ${strength === "Too short" ? "text-destructive" : strength === "Strong" ? "text-primary" : "text-muted-foreground"}`}>{strength}{strength === "OK" ? " · add numbers and make it longer for a stronger one" : ""}</p>}
            </div>
            <div>
              <Label htmlFor="new-pass-2">Type it again</Label>
              <Input id="new-pass-2" type={show ? "text" : "password"} autoComplete="new-password" value={again}
                onChange={(e) => setAgain(e.target.value)} className="mt-2 h-10" />
            </div>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <Button type="submit" className="h-10 w-full" disabled={busy}>{busy ? "Saving…" : "Save new password"}</Button>
          </form>
        )}
      </main>
    </div>
  );
}
