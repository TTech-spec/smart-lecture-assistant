import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  /** Checks the code and finishes the check-in. Resolves false when the code is not the one on the screen. */
  onCode: (code: string) => Promise<boolean>;
  /** The lecturer scans the student's phone instead */
  onAskHelp?: () => void;
  /** True while the check-in is being sent */
  busy?: boolean;
};

/** After this many wrong codes the phone has to wait, so say so instead of "wrong code" again */
const MAX_WRONG_TRIES = 5;

/**
 * A normal step, not an error: the phone's location was not clear enough on its
 * own, so the student confirms with the code on the lecturer's screen.
 */
export function RoomProofSheet({ onCode, onAskHelp, busy = false }: Props) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [wrongTries, setWrongTries] = useState(0);
  const [showWrong, setShowWrong] = useState(false);
  const working = busy || checking;

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (working || code.length !== 4) return;
    setChecking(true);
    setShowWrong(false);
    let ok = true;
    try {
      ok = await onCode(code);
    } finally {
      setChecking(false);
    }
    if (!ok) {
      setWrongTries((n) => n + 1);
      setShowWrong(true);
      setCode("");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <form onSubmit={confirm} className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold leading-tight">One more step</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Your phone's location isn't clear enough indoors. Enter the 4-character code on your lecturer's screen.
        </p>

        <div className="mt-6">
          <Input
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4)); setShowWrong(false); }}
            placeholder="e.g. K7P2"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            readOnly={working}
            aria-label="Code on your lecturer's screen"
            aria-invalid={showWrong}
            className="h-14 text-center font-mono text-2xl font-bold tracking-[0.4em]"
          />
          {showWrong ? (
            <p role="alert" className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              {wrongTries >= MAX_WRONG_TRIES
                ? "Too many wrong tries. Wait 5 minutes, or ask your lecturer to scan you."
                : "That code isn't right. Enter the one showing now."}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">The code changes every 30 seconds. Letters are never O or I.</p>
          )}
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" /> Your photo and details are saved. You won't need to redo them.
        </p>

        <div className="flex-grow" />

        <Button type="submit" disabled={working || code.length !== 4} className="mt-6 h-12 w-full rounded-full text-base">
          {working ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…</> : "Confirm"}
        </Button>
        {onAskHelp && (
          <Button type="button" variant="ghost" disabled={working} className="mt-2 h-11 w-full rounded-full" onClick={onAskHelp}>
            Ask your lecturer to scan me
          </Button>
        )}
      </form>
    </div>
  );
}
