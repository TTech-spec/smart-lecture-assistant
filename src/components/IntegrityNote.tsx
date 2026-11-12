import { AlertTriangle } from "lucide-react";
import type { TestIntegrity } from "@/lib/attendance-store";

/** Shown on the test once something was recorded, so the student knows. */
export function IntegrityNote({ counts }: { counts: TestIntegrity }) {
  const parts = [
    counts.focusLost ? `another app beside the test ${counts.focusLost}×` : "",
    counts.splitScreen ? `split screen or pop-up ${counts.splitScreen}×` : "",
    counts.copyAttempts ? `copy attempts ${counts.copyAttempts}×` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-5 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Recorded for your lecturer: {parts.join(", ")}.</span>
    </div>
  );
}
