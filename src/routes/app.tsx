import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Bell, BellOff, CheckCircle2, Download, Loader2, MapPin, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { IOSInstallHelp } from "@/components/IOSInstallHelp";
import { isStandalone, pushState, turnOffNotifications, turnOnNotifications, type PushState } from "@/lib/push-client";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Get the app — Attendly" }, { name: "description", content: "Add Attendly to your home screen and get notices from your lecturer." }] }),
  component: GetAppPage,
});

function GetAppPage() {
  const { canPromptInstall, isIOS, installed, promptInstall } = useInstallPrompt();
  const [iosHelp, setIosHelp] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [push, setPush] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setStandalone(isStandalone()); pushState().then(setPush); }, []);
  const onHome = installed || standalone;

  async function install() {
    if (canPromptInstall) { await promptInstall(); return; }
    setIosHelp(true);
  }
  async function toggleNotifications() {
    setBusy(true);
    if (push === "on") { await turnOffNotifications(); toast.success("Notifications turned off on this phone."); }
    else {
      const r = await turnOnNotifications();
      if (r.ok) toast.success("Notifications are on. You'll get notices from your lecturer here.");
      else toast.error(r.reason);
    }
    setPush(await pushState());
    setBusy(false);
  }

  const card = "rounded-3xl bg-card p-5 shadow-soft";
  return (
    <div className="min-h-[100svh] bg-background">
      <main className="mx-auto flex max-w-md flex-col gap-5 px-6 py-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Home</Link>
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> Attendly on your phone</p>
          <h1 className="mt-2 font-display text-[28px] font-bold leading-8 tracking-tight">Get the app</h1>
          <p className="mt-2 text-base leading-6 text-muted-foreground">Open Attendly from your home screen like any app, and get notices from your lecturer, like when check-in opens.</p>
        </div>

        <section className={card}>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Smartphone className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold">1. Add to home screen</h2>
              <p className="mt-0.5 text-[14px] leading-5 text-muted-foreground">{onHome ? "Done. Attendly is on your home screen." : isIOS ? "On iPhone: tap Share, then Add to Home Screen." : "One tap, no app store needed."}</p>
            </div>
          </div>
          {onHome ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-primary"><CheckCircle2 className="h-4 w-4" /> Installed</p>
          ) : (
            <Button onClick={install} disabled={!canPromptInstall && !isIOS} className="mt-4 h-12 w-full rounded-full bg-foreground text-base text-background hover:bg-foreground/85">
              <Download className="mr-2 h-4 w-4" /> {isIOS ? "Show me how" : canPromptInstall ? "Add to home screen" : "Use your browser menu: Add to Home screen"}
            </Button>
          )}
        </section>

        <section className={card}>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Bell className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold">2. Turn on notifications</h2>
              <p className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
                {push === "on" ? "On. Notices from your lecturer will appear on this phone."
                  : push === "needs-install" ? "On iPhone, add Attendly to your home screen first, then open it from there and come back here."
                  : push === "blocked" ? "Blocked for this site. Allow notifications in your phone's settings, then try again."
                  : push === "unsupported" ? "This browser can't show notifications. Use Chrome on Android, or Safari on iPhone."
                  : "Get a message when check-in opens or your lecturer posts a notice."}
              </p>
            </div>
          </div>
          {(push === "off" || push === "on" || push === "loading") && (
            <Button onClick={toggleNotifications} disabled={busy || push === "loading"} variant={push === "on" ? "outline" : "default"} className="mt-4 h-12 w-full rounded-full text-base">
              {busy || push === "loading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : push === "on" ? <BellOff className="mr-2 h-4 w-4" /> : <Bell className="mr-2 h-4 w-4" />}
              {push === "on" ? "Turn off notifications" : "Turn on notifications"}
            </Button>
          )}
        </section>

        <Button asChild variant="ghost" className="h-11 rounded-full"><Link to="/attendance"><MapPin className="mr-2 h-4 w-4" /> Sign attendance</Link></Button>
      </main>
      <IOSInstallHelp open={iosHelp} onClose={() => setIosHelp(false)} />
    </div>
  );
}
