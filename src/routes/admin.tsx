import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, LogOut, ClipboardList, LayoutDashboard, MapPin, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Lecturer dashboard — Attendly" },
      { name: "description", content: "Pin the class location, set the radius and time window, and review attendance." },
    ],
  }),
  component: AdminPage,
});

const AUTH_KEY = "att.admin.auth.v1";
export const PASS_KEY = "att.admin.pass.v1";
const DEFAULT_PASS = "lecturer123";

export function getStoredPass(): string {
  if (typeof window === "undefined") return DEFAULT_PASS;
  return localStorage.getItem(PASS_KEY) || DEFAULT_PASS;
}

function AdminPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(sessionStorage.getItem(AUTH_KEY) === "1");
  }, []);

  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;
  return <AdminShell onLogout={() => { sessionStorage.removeItem(AUTH_KEY); setAuthed(false); }} />;
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [pass, setPass] = useState("");
  const [showHint, setShowHint] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pass === getStoredPass()) {
      sessionStorage.setItem(AUTH_KEY, "1");
      toast.success("Welcome back, lecturer.");
      onSuccess();
    } else {
      toast.error("Wrong password.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
      </header>
      <main className="mx-auto flex max-w-md flex-col items-center px-6 pt-16">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">Lecturer access only</h1>
        <p className="mt-2 text-center text-muted-foreground">
          Enter the admin password to open the dashboard. Students don't have access to this area.
        </p>
        <form onSubmit={submit} className="mt-8 w-full rounded-2xl border bg-card p-6 shadow-soft">
          <Label htmlFor="pass">Admin password</Label>
          <Input
            id="pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            placeholder="Enter password" className="mt-2" autoFocus
          />
          <Button type="submit" className="mt-4 w-full">Unlock dashboard</Button>
          <button
            type="button" onClick={() => setShowHint((s) => !s)}
            className="mt-3 block w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {showHint ? `Default password: ${DEFAULT_PASS}` : "Forgot password?"}
          </button>
        </form>
      </main>
    </div>
  );
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-md shadow-soft">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
                <MapPin className="h-4 w-4" />
              </div>
              <span className="font-semibold tracking-tight">Attendly</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Link
                to="/admin"
                activeOptions={{ exact: true }}
                className="[&.active]:bg-primary/10 [&.active]:text-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
              </Link>
              <Link
                to="/admin/records"
                className="[&.active]:bg-primary/10 [&.active]:text-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                <ClipboardList className="h-3.5 w-3.5" /> Records
              </Link>
              <Link
                to="/admin/materials"
                className="[&.active]:bg-primary/10 [&.active]:text-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5" /> Materials
              </Link>
            </nav>
          </div>
          <Button size="sm" variant="outline" onClick={onLogout}>
            <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
