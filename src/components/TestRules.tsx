import { useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TestConfig } from "@/lib/attendance-store";

/** What every student is told, even if the lecturer wrote nothing */
const STANDARD_RULES = [
  "Stay on this page until you submit. Leaving it, using split screen or a pop-up app is recorded.",
  "Copying and pasting are blocked, and every attempt is recorded.",
  "Written answers must be typed by you. How you typed them is shown to your lecturer.",
];

/**
 * Shown before a test starts: the lecturer's own warning about cheating plus
 * the standard rules. The student must tap "I understand" to continue.
 */
export function TestRules({ test, children }: { test: TestConfig; children: ReactNode }) {
  const [agreed, setAgreed] = useState(false);
  const [ticked, setTicked] = useState(false);
  if (agreed) return <>{children}</>;
  const hasTheory = test.questions.some((q) => q.kind === "theory");
  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-soft dark:border-amber-800 dark:bg-amber-950/30">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">Before you start</p>
            <h2 className="text-lg font-semibold">{test.courseCode} · {test.title}</h2>
          </div>
        </div>
        {test.warning?.trim() && (
          <div className="mt-4 rounded-xl bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">Message from your lecturer</p>
            <p className="mt-1 whitespace-pre-wrap text-[15px] font-medium leading-6">{test.warning.trim()}</p>
          </div>
        )}
        <ul className="mt-4 space-y-2 text-sm text-amber-950 dark:text-amber-100">
          {STANDARD_RULES.filter((r, i) => i < 2 || hasTheory).map((r) => (
            <li key={r} className="flex gap-2"><span aria-hidden>•</span><span>{r}</span></li>
          ))}
          <li className="flex gap-2"><span aria-hidden>•</span><span>You have {test.durationMinutes} minutes and one attempt.</span></li>
        </ul>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4">
        <input id="rules-ok" type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
        <span className="text-sm">I have read this and I will not cheat. I understand my lecturer will see anything recorded.</span>
      </label>
      <Button className="h-12 w-full rounded-full text-base" disabled={!ticked} onClick={() => setAgreed(true)}>
        I understand, continue
      </Button>
    </div>
  );
}
