import { TourPlayer } from "@/components/TourPlayer";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { friendlyError } from "@/lib/friendly-error";
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, LogOut, ClipboardList, LayoutDashboard, MapPin, BookOpen, Menu, X, Link2, Settings2, Download, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InstallAppButton } from "@/components/InstallAppButton";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { AdminAssistant } from "@/components/AdminAssistant";
import {
  loadDashboardTheme, getThemeVars, loadDeveloperAccess, loadDeveloperAccessEmail,
  fetchDashboardPreferences, isOnboardingDone, type ThemeId,
} from "@/lib/dashboard-preferences";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { IOSInstallHelp } from "@/components/IOSInstallHelp";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { useStore } from "@/hooks/use-store";
import { isLecturerSignedIn, onLecturerAuthChange, signInLecturer, signOutLecturer, usesSupabaseAuth, sendLecturerPasswordReset } from "@/lib/lecturer-auth";

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
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">("signin");

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await sendLecturerPasswordReset(email);
      setMode("sent");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't send the reset email."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (usesSupabaseAuth && !email.trim()) return toast.error("Enter your email.");
    setBusy(true);
    try {
      await signInLecturer(email, pass);
      toast.success("Welcome back, lecturer.");
      onSuccess();
    } catch (err) {
      toast.error(friendlyError(err, "Could not sign in."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
      </header>
      <main className="mx-auto flex max-w-md flex-col items-center px-4 sm:px-6 pt-16">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl sm:text-3xl font-bold tracking-tight text-center">Lecturer sign in</h1>
        <p className="mt-2 text-center text-sm sm:text-base text-muted-foreground">
          {usesSupabaseAuth
            ? "Sign in with your lecturer account. Students don't have access to this area."
            : "Enter the admin password to open the dashboard."}
        </p>
        {mode === "sent" ? (
          <div className="mt-8 w-full space-y-3 rounded-2xl border bg-card p-6 text-center shadow-soft">
            <p className="text-lg font-semibold">Check your email</p>
            <p className="text-sm text-muted-foreground">If <strong className="text-foreground">{email.trim()}</strong> has a lecturer account, a reset link is on its way. Open it on this device to choose a new password. Check spam if it doesn't arrive in a few minutes.</p>
            <Button variant="outline" className="w-full" onClick={() => setMode("signin")}>Back to sign in</Button>
          </div>
        ) : mode === "forgot" ? (
          <form onSubmit={sendReset} className="mt-8 w-full rounded-2xl border bg-card p-4 sm:p-6 shadow-soft space-y-4">
            <div>
              <p className="font-semibold">Reset your password</p>
              <p className="mt-1 text-sm text-muted-foreground">Enter the email you sign in with. We'll email you a link to choose a new password.</p>
            </div>
            <div>
              <Label htmlFor="reset-email">Email</Label>
              <Input id="reset-email" type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu.ng" className="mt-2 h-10" autoFocus />
            </div>
            <Button type="submit" className="h-10 w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
            <button type="button" onClick={() => setMode("signin")} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">Back to sign in</button>
          </form>
        ) : (
        <form onSubmit={submit} className="mt-8 w-full rounded-2xl border bg-card p-4 sm:p-6 shadow-soft space-y-4">
          {usesSupabaseAuth && (
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email" type="email" autoComplete="username" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu.ng" className="mt-2 h-10" autoFocus
              />
            </div>
          )}
          <div>
            <Label htmlFor="pass">Password</Label>
            <Input
              id="pass" type="password" autoComplete="current-password" value={pass}
              onChange={(e) => setPass(e.target.value)} placeholder="Enter password" className="mt-2 h-10" autoFocus={!usesSupabaseAuth}
            />
          </div>
          <Button type="submit" className="w-full h-10" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          {usesSupabaseAuth && (
            <button type="button" onClick={() => setMode("forgot")}
              className="w-full text-center text-sm font-medium text-primary underline-offset-4 hover:underline">
              Forgot password?
            </button>
          )}
        </form>
        )}
      </main>
    </div>
  );
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    if (!isOnboardingDone()) setWizardOpen(true);
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
        <button
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>
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
