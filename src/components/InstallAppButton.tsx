import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { IOSInstallHelp } from "@/components/IOSInstallHelp";

const DISMISS_KEY = "attendly:installDismissed";
const SEEN_KEY = "attendly:installSeen";

export function InstallAppButton() {
  const { canPromptInstall, isIOS, installed, promptInstall } = useInstallPrompt();
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
      // Shown once per visit, and it goes away by itself: it must never sit on top of the page
      if (sessionStorage.getItem(SEEN_KEY) === "1") return;
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch { return; }
    setDismissed(false);
    const t = setTimeout(() => setDismissed(true), 9000);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    setShowIOSHelp(false);
  }

  async function handleInstall() {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === "accepted") dismiss();
      return;
    }
    if (isIOS) setShowIOSHelp(true);
  }

  if (installed || (dismissed && !showIOSHelp) || (!canPromptInstall && !isIOS)) return null;

  return (
    <>
      {!dismissed && <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.4, ease: "circOut" }}
        className="fixed left-1/2 top-[68px] z-40 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-2 rounded-2xl border bg-card p-2.5 pl-3.5 shadow-soft sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:w-auto sm:translate-x-0"
      >
        <Download className="h-4 w-4 shrink-0 text-primary" />
        <p className="flex-1 text-sm">
          <span className="font-medium">Install Attendly</span>{" "}
          <span className="hidden text-muted-foreground sm:inline">for quick, offline-ready access.</span>
        </p>
        <Button size="sm" onClick={handleInstall}>
          Install
        </Button>
        <button
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </motion.div>}

      <IOSInstallHelp open={showIOSHelp} onClose={dismiss} />
    </>
  );
}
