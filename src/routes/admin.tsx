import { TourPlayer } from "@/components/TourPlayer";
import { AccountSettings } from "@/components/admin/AccountSettings";
import { AuthShell, AuthMark, AuthTitle, CodeBoxes, PasswordInput, authInput, authButton } from "@/components/auth/AuthUI";
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { friendlyError } from "@/lib/friendly-error";
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, LogOut, ClipboardList, LayoutDashboard, MapPin, BookOpen, Menu, X, Link2, Settings2, Download, Users, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InstallAppButton } from "@/components/InstallAppButton";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { AdminAssistant } from "@/components/AdminAssistant";
import {
  loadDashboardTheme, getThemeVars, loadDeveloperAccess, loadDeveloperAccessEmail,
  fetchDashboardPreferences, type ThemeId,
} from "@/lib/dashboard-preferences";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { IOSInstallHelp } from "@/components/IOSInstallHelp";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { useStore } from "@/hooks/use-store";
import { isLecturerSignedIn, onLecturerAuthChange, signInLecturer, signOutLecturer, usesSupabaseAuth, sendLecturerPasswordReset, verifyPasswordResetCode, currentLecturerEmail } from "@/lib/lecturer-auth";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Lecturer dashboard — Attendly" },
      { name: "description", content: "Pin the class location, set the radius and time window, and review attendance." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

// Password handling lives in src/lib/lecturer-auth.ts (Supabase Auth when
// configured, local password otherwise). Kept for older imports:
export const PASS_KEY = "att.admin.pass.v1";
export function getStoredPass(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(PASS_KEY) || "";
}

function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    isLecturerSignedIn().then(setAuthed);
    return onLecturerAuthChange(setAuthed);
  }, []);

  if (authed === null) return null;
  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;
  return <AdminShell onLogout={() => { signOutLecturer().then(() => setAuthed(false)); }} />;
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot" | "code">("signin");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (usesSupabaseAuth && !email.trim()) return toast.error("Enter your email.");
    setBusy(true);
    try {
      await signInLecturer(email, pass);
      toast.success("Welcome back.");
      onSuccess();
    } catch (err) {
      toast.error(friendlyError(err, "Could not sign in."));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      await sendLecturerPasswordReset(email);
      setCode("");
      setResendIn(60);
      setMode("code");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't send the code.", { duration: 10000 });
    } finally {
      setBusy(false);
    }
  }

  async function useCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyPasswordResetCode(email, code);
      navigate({ to: "/reset-password" });
    } catch (err) {
      toast.error(friendlyError(err, "That code didn't work."));
    } finally {
      setBusy(false);
    }
  }

  const backToSignIn = (
    <button type="button" onClick={() => setMode("signin")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Sign in
    </button>
  );

  if (mode === "forgot") {
    return (
      <AuthShell step="Reset · 1 of 3" back={backToSignIn}>
        <AuthTitle title="Reset your password" sub="We'll email you a 6-digit code." />
        <form onSubmit={sendCode} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium">Email</label>
            <input id="reset-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@eksu.edu.ng" className={authInput} autoFocus />
          </div>
          <button type="submit" className={authButton} disabled={busy || !email.trim()}>{busy ? "Sending…" : "Send code"}</button>
        </form>
      </AuthShell>
    );
  }

  if (mode === "code") {
    return (
      <AuthShell step="Reset · 2 of 3" back={backToSignIn}>
        <AuthTitle title="Check your email" sub="Enter the code we sent. It expires in 1 hour." />
        <div className="mb-5 flex items-center gap-3 rounded-2xl border p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="h-4 w-4" /></span>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{email.trim().toLowerCase()}</p>
            <button type="button" onClick={() => setMode("forgot")} className="text-muted-foreground hover:text-foreground">Not you? Change email</button>
          </div>
        </div>
        <form onSubmit={useCode} className="space-y-5">
          <CodeBoxes value={code} onChange={setCode} disabled={busy} />
          <button type="submit" className={authButton} disabled={busy || code.length < 6}>{busy ? "Checking…" : "Continue"}</button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Didn't get it?{" "}
          {resendIn > 0
            ? <span className="font-medium text-foreground tabular-nums">Resend in {Math.floor(resendIn / 60)}:{String(resendIn % 60).padStart(2, "0")}</span>
            : <button type="button" onClick={() => sendCode()} className="font-medium text-foreground underline-offset-4 hover:underline">Resend code</button>}
          <span className="mt-1 block text-xs">Check spam too. The email also has a link you can tap instead.</span>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthMark />
      <AuthTitle title="Welcome back" sub={usesSupabaseAuth ? "Sign in to your lecturer dashboard." : "Enter the admin password to open the dashboard."} />
      <form onSubmit={submit} className="space-y-4">
        {usesSupabaseAuth && (
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@eksu.edu.ng" className={authInput} autoFocus />
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="pass" className="text-sm font-medium">Password</label>
            {usesSupabaseAuth && (
              <button type="button" onClick={() => setMode("forgot")} className="text-sm text-muted-foreground hover:text-primary">Forgot password?</button>
            )}
          </div>
          <PasswordInput id="pass" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)}
            placeholder="Enter password" autoFocus={!usesSupabaseAuth} />
        </div>
        <button type="submit" className={authButton} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-8 text-center text-xs text-muted-foreground">Students don't need an account.</p>
    </AuthShell>
  );
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  useEffect(() => { currentLecturerEmail().then(setMyEmail); }, [accountOpen]);
  const [themeId, setThemeId] = useState<ThemeId>(() => loadDashboardTheme());
  const [wizardOpen, setWizardOpen] = useState(false);
  const { canPromptInstall, isIOS, installed, promptInstall } = useInstallPrompt();
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  async function handleInstallClick() {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === "accepted") toast.success("Attendly installed!");
      return;
    }
    if (isIOS) {
      setShowIOSHelp(true);
      return;
    }
    toast.info("Your browser doesn't support one-click install. Look for an \"Install app\" option in your browser's menu, or the install icon in the address bar.");
  }

  useEffect(() => {
    // Show the setup wizard every time the dashboard is opened (once per visit,
    // not on every page change within the visit)
    let shown = false;
    try { shown = sessionStorage.getItem("att.wizard.shown") === "1"; sessionStorage.setItem("att.wizard.shown", "1"); } catch { /* private mode */ }
    if (!shown) setWizardOpen(true);
    const syncTheme = () => setThemeId(loadDashboardTheme());
    window.addEventListener("att:theme", syncTheme);

    // Poll Supabase so a theme (or dev access) change made on another device
    // shows up here without needing a page refresh.
    const poll = () => { fetchDashboardPreferences(); };
    poll();
    const timer = setInterval(poll, 15_000);

    return () => {
      window.removeEventListener("att:theme", syncTheme);
      clearInterval(timer);
    };
  }, []);

  const { links, records } = useStore();
  const sidebar = (onNavigate?: () => void) => (
    <AdminSidebar
      links={links}
      records={records}
      onNavigate={onNavigate}
      onLogout={onLogout}
      onSetup={() => { setWizardOpen(true); onNavigate?.(); }}
      onInstall={() => { handleInstallClick(); onNavigate?.(); }}
      showInstall={!installed}
      onAccount={() => setAccountOpen(true)}
    />
  );

  return (
    <div className="admin-soft min-h-screen bg-[#f6f8f8] pb-28 lg:flex lg:pb-0" style={getThemeVars(themeId)}>
      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block">{sidebar()}</div>

      {/* Mobile top bar + slide-in sidebar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-[#121a2b] px-4 py-3 text-white lg:hidden">
        <Link to="/admin" className="flex items-center gap-2 font-display text-lg font-semibold">
          <ShieldCheck className="h-5 w-5 text-[#4fd8a8]" /> Attendly
        </Link>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setAccountOpen(true)} aria-label={`Your account${myEmail ? `: ${myEmail}` : ""}`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#12b886]/20 text-xs font-semibold text-[#4fd8a8] ring-1 ring-white/10 hover:ring-[#4fd8a8]/60">
            {(myEmail ?? "L").slice(0, 2).toUpperCase()}
          </button>
          <button
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>
      {accountOpen && <AccountSettings onClose={() => setAccountOpen(false)} onSignOut={onLogout} />}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative h-full w-[248px] shadow-xl">
            {sidebar(() => setMobileMenuOpen(false))}
            <button
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
              className="absolute right-2 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-[#c9d1dc] hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="min-w-0 flex-grow">
      <Outlet />
      </div>
      <InstallAppButton />
      <AdminAssistant />
      <TourPlayer />
      <IOSInstallHelp open={showIOSHelp} onClose={() => setShowIOSHelp(false)} />
      {wizardOpen && (
        <OnboardingWizard
          initialTheme={themeId}
          initialDevAccess={loadDeveloperAccess()}
          initialDevAccessEmail={loadDeveloperAccessEmail()}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
