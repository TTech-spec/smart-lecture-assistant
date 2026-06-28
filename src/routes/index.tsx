import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin, ShieldCheck, Clock, Sparkles, GraduationCap, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Attendly — GPS-verified class attendance" },
      { name: "description", content: "Stop proxy attendance. Students sign in only when they are physically in class, on one device per day." },
    ],
  }),
  component: Landing,
});

function Feature({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <MapPin className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Attendly</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost"><Link to="/admin">Lecturer</Link></Button>
          <Button asChild><Link to="/attendance">Sign attendance</Link></Button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        <section className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" />
              GPS-verified · One device per day
            </span>
            <h1 className="mt-5 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
              Attendance that <span className="bg-gradient-primary bg-clip-text text-transparent">can't be faked</span>.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              No more signing in from the hostel. Students can only mark attendance when they're physically inside the lecturer's class radius — and only once per device, per day.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/attendance"><GraduationCap className="mr-2 h-4 w-4" />I'm a student</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/admin"><UserCog className="mr-2 h-4 w-4" />I'm a lecturer</Link>
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-primary opacity-20 blur-2xl" />
            <div className="relative rounded-3xl border bg-card p-6 shadow-soft">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Live session</p>
                  <p className="mt-1 font-semibold">CSC 401 — Distributed Systems</p>
                </div>
                <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success-foreground" style={{ color: "var(--color-success)" }}>Open</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-2xl font-semibold">42</p>
                  <p className="text-xs text-muted-foreground">Signed in</p>
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-2xl font-semibold">100m</p>
                  <p className="text-xs text-muted-foreground">Radius</p>
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-2xl font-semibold">08:14</p>
                  <p className="text-xs text-muted-foreground">Closes in</p>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                <MapPin className="mr-2 inline h-4 w-4" />
                Lecturer pinned <span className="text-foreground font-medium">Hall B, Block 3</span> as today's location.
              </div>
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={MapPin} title="GPS check" desc="Student location must match the lecturer's pin within the chosen radius." />
          <Feature icon={ShieldCheck} title="One device per day" desc="Each device can only submit attendance once per day, per course." />
          <Feature icon={Clock} title="Timed window" desc="Lecturer sets how long the form stays open. After that, it auto-locks." />
          <Feature icon={Sparkles} title="AI assistant" desc="Ask the dashboard things like 'who from Computer Science signed today?'" />
        </section>
      </main>
    </div>
  );
}
