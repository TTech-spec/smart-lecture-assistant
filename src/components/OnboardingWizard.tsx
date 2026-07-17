import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Palette, UserCog, BookOpen, Check, X, Download, Monitor,
  ChevronLeft, ChevronRight, KeyRound, GraduationCap, ArrowRight, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DASHBOARD_THEMES, saveDashboardTheme, saveDeveloperAccess, submitDeveloperAccessEmail,
  markOnboardingDone, type ThemeId,
} from "@/lib/dashboard-preferences";
import { getStoredPass, PASS_KEY } from "@/routes/admin";
import { toast } from "sonner";
import type { MaterialAccessType } from "@/lib/materials-store";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { IOSInstallHelp } from "@/components/IOSInstallHelp";

const STEPS = [
  { key: "theme", label: "Color Theme", icon: Palette },
  { key: "access", label: "Developer Access", icon: UserCog },
  { key: "install", label: "Install App", icon: Download },
  { key: "materials", label: "Materials", icon: BookOpen },
] as const;

interface OnboardingWizardProps {
  initialTheme: ThemeId;
  initialDevAccess: boolean;
  initialDevAccessEmail: string | null;
  onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OnboardingWizard({ initialTheme, initialDevAccess, initialDevAccessEmail, onClose }: OnboardingWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(initialTheme);
  const [devAccess, setDevAccess] = useState(initialDevAccess);
  const [devAccessEmail, setDevAccessEmail] = useState(initialDevAccessEmail);
  const [devEmailInput, setDevEmailInput] = useState(initialDevAccessEmail || "");
  const [submittingDevEmail, setSubmittingDevEmail] = useState(false);
  const [materialsChoice, setMaterialsChoice] = useState<"yes" | "no" | null>(null);
  const [materialsAccessType, setMaterialsAccessType] = useState<MaterialAccessType>("free");
  const { canPromptInstall, isIOS, installed, promptInstall } = useInstallPrompt();
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  async function handleInstallClick() {
    if (canPromptInstall) {
      await promptInstall();
      return;
    }
    if (isIOS) setShowIOSHelp(true);
  }

  function pickTheme(id: ThemeId) {
    setSelectedTheme(id);
    saveDashboardTheme(id);
  }

  function toggleDevAccess() {
    const next = !devAccess;
    setDevAccess(next);
    saveDeveloperAccess(next);
    toast.success(next ? "Developer access enabled." : "Developer access disabled.");
  }

  async function submitDevEmail() {
    const email = devEmailInput.trim();
    if (!EMAIL_RE.test(email)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setSubmittingDevEmail(true);
    const ok = await submitDeveloperAccessEmail(email);
    setSubmittingDevEmail(false);
    if (ok) {
      setDevAccessEmail(email);
      setDevAccess(true);
      toast.success(`Developer access granted to ${email}.`);
    } else {
      toast.error("Couldn't save — check your connection and try again.");
    }
  }

  function changePassword() {
    const current = prompt("Enter current admin password:");
    if (current == null) return;
    if (current !== getStoredPass()) { toast.error("Wrong current password."); return; }
    const next = prompt("Enter a new admin password (min 4 chars):");
    if (!next || next.length < 4) { toast.error("Password too short."); return; }
    localStorage.setItem(PASS_KEY, next);
    toast.success("Admin password updated.");
  }

  function finish(goToMaterials: boolean) {
    markOnboardingDone();
    onClose();
    if (goToMaterials) {
      navigate({ to: "/admin/materials", search: { accessType: materialsAccessType } });
    }
  }

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish(false);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "circOut" }}
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border bg-card shadow-soft"
      >
        <button
          onClick={() => { markOnboardingDone(); onClose(); }}
          aria-label="Close setup"
          className="absolute right-4 top-4 z-10 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Stepper header */}
        <div className="border-b bg-secondary/40 px-6 pb-6 pt-7 sm:px-8">
          <div className="mb-1 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Quick setup</p>
          </div>
          <div className="mx-auto grid max-w-md grid-cols-4">
            {STEPS.map((s, i) => {
              const isDone = i < step;
              const isActive = i === step;
              return (
                <div key={s.key} className="flex flex-col items-center gap-2">
                  <div className="relative flex h-10 w-full items-center justify-center">
                    {i < STEPS.length - 1 && (
                      <div className={`absolute left-1/2 top-1/2 h-0.5 w-full -translate-y-1/2 transition-colors ${isDone ? "bg-primary" : "bg-border"}`} />
                    )}
                    <div
                      className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                        isDone
                          ? "border-primary bg-primary text-primary-foreground"
                          : isActive
                            ? "border-primary bg-card text-primary"
                            : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {isDone ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                    </div>
                  </div>
                  <span className={`text-center text-[11px] font-medium sm:text-xs ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-6 sm:px-8">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="theme" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
                <h2 className="text-lg font-semibold">Choose your dashboard color theme</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a look for your admin dashboard. You can change this anytime from setup again.
                </p>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {DASHBOARD_THEMES.map((t) => {
                    const selected = selectedTheme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => pickTheme(t.id)}
                        className={`flex items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-colors ${
                          selected ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                        }`}
                      >
                        <div className="mt-0.5 flex shrink-0 -space-x-1.5">
                          {t.swatches.slice(0, 4).map((c, idx) => (
                            <span
                              key={idx}
                              className="h-5 w-5 rounded-full border-2 border-card"
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium">{t.name}</p>
                            {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="access" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
                <h2 className="text-lg font-semibold">Grant developer access?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  If you'd like a developer to be able to log in and make edits to your dashboard when you need changes, turn this on.
                </p>

                <button
                  onClick={toggleDevAccess}
                  className={`mt-5 flex w-full items-center justify-between rounded-xl border-2 p-4 text-left transition-colors ${
                    devAccess ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${devAccess ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                      <UserCog className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Developer access</p>
                      <p className="text-xs text-muted-foreground">{devAccess ? "Enabled" : "Disabled"}</p>
                    </div>
                  </div>
                  <span
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${devAccess ? "bg-primary" : "bg-border"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${devAccess ? "translate-x-5" : "translate-x-0.5"}`}
                    />
                  </span>
                </button>

                <AnimatePresence>
                  {devAccess && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 rounded-xl border p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                            <Mail className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">Developer's email address</p>
                            <p className="text-xs text-muted-foreground">
                              Ask your developer for the email address they'd like access with, then enter it below.
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Input
                            type="email"
                            value={devEmailInput}
                            onChange={(e) => setDevEmailInput(e.target.value)}
                            placeholder="developer@example.com"
                            className="h-10"
                          />
                          <Button size="sm" className="h-10 shrink-0" onClick={submitDevEmail} disabled={submittingDevEmail}>
                            {submittingDevEmail ? "Saving…" : "Grant access"}
                          </Button>
                        </div>
                        {devAccessEmail && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Access currently granted to <span className="font-medium text-foreground">{devAccessEmail}</span>.
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="mt-4 flex items-center justify-between rounded-xl border p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Admin password</p>
                      <p className="text-xs text-muted-foreground">Update the password used to unlock this dashboard.</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={changePassword}>Change</Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="install" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
                <h2 className="text-lg font-semibold">Install Attendly on your device?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add it to your home screen or desktop for quick, app-like access — no browser bar, opens like a native app.
                </p>

                <div className="mt-5 rounded-xl border-2 border-border p-6 text-center">
                  {installed ? (
                    <>
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Check className="h-6 w-6" />
                      </div>
                      <p className="mt-3 text-sm font-medium">Already installed on this device</p>
                    </>
                  ) : canPromptInstall || isIOS ? (
                    <>
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Download className="h-6 w-6" />
                      </div>
                      <p className="mt-3 text-sm font-medium">Install Attendly</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isIOS && !canPromptInstall
                          ? "We'll show you how in a couple of taps."
                          : "One click and it's on your device — mobile or desktop."}
                      </p>
                      <Button className="mt-4" onClick={handleInstallClick}>
                        <Download className="mr-2 h-4 w-4" /> Install now
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                        <Monitor className="h-6 w-6" />
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        This browser doesn't support one-click install. You can skip this step — most Chrome/Edge browsers and phones support it.
                      </p>
                    </>
                  )}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="materials" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
                <h2 className="text-lg font-semibold">Prepare your students for exams or tests?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload study materials — notes, past questions, slides or videos — for your students to access. You choose whether each one is free or paid.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setMaterialsChoice("yes")}
                    className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${
                      materialsChoice === "yes" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                    }`}
                  >
                    <GraduationCap className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">Yes, let's set it up</span>
                  </button>
                  <button
                    onClick={() => setMaterialsChoice("no")}
                    className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${
                      materialsChoice === "no" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                    }`}
                  >
                    <X className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">Not right now</span>
                  </button>
                </div>

                <AnimatePresence>
                  {materialsChoice === "yes" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="mb-2 mt-5 text-sm font-medium">Should students pay for these materials?</p>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setMaterialsAccessType("free")}
                          className={`rounded-xl border-2 p-3 text-sm font-medium transition-colors ${
                            materialsAccessType === "free" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                          }`}
                        >
                          Free for students
                        </button>
                        <button
                          onClick={() => setMaterialsAccessType("paid")}
                          className={`rounded-xl border-2 p-3 text-sm font-medium transition-colors ${
                            materialsAccessType === "paid" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                          }`}
                        >
                          Paid — students pay to unlock
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4 sm:px-8">
          <button
            onClick={() => { markOnboardingDone(); onClose(); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={back}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            )}
            {step === STEPS.length - 1 ? (
              materialsChoice === "yes" ? (
                <Button size="sm" onClick={() => finish(true)}>
                  Go to Materials <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" onClick={() => finish(false)}>Finish</Button>
              )
            ) : (
              <Button size="sm" onClick={next}>
                Continue <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <IOSInstallHelp open={showIOSHelp} onClose={() => setShowIOSHelp(false)} />
    </div>
  );
}
