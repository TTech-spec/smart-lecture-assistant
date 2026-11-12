import { useRef } from "react";
import { toast } from "sonner";
import type { TheoryAnswer } from "@/lib/attendance-store";

export const emptyTheoryAnswer = (): TheoryAnswer => ({ text: "", typingMs: 0, keystrokes: 0, bigInserts: 0, pasteAttempts: 0 });

/**
 * Written answer box for a theory question. Pasting is blocked, and it quietly
 * records how the answer was typed: time spent, keys pressed and any big block
 * of text that appeared at once (autofill, keyboard clipboard, dictation).
 * Answers typed by hand grow a few letters at a time; AI answers usually don't.
 */
export function TheoryAnswerBox({ value, marks, onChange }: {
  value: TheoryAnswer;
  marks: number;
  onChange: (next: TheoryAnswer) => void;
}) {
  const lastKey = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const words = value.text.trim() ? value.text.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-2">
      <textarea
        value={value.text}
        rows={7}
        placeholder="Type your answer in your own words…"
        className="w-full resize-y rounded-xl border bg-background p-3 text-base leading-6 outline-none focus:ring-2 focus:ring-primary/40"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onPaste={(e) => {
          e.preventDefault();
          onChange({ ...valueRef.current, pasteAttempts: valueRef.current.pasteAttempts + 1 });
          toast.warning("Pasting isn't allowed. Type your answer yourself; this is recorded.", { id: "theory-paste" });
        }}
        onDrop={(e) => e.preventDefault()}
        onKeyDown={() => {
          const now = Date.now();
          const gap = lastKey.current == null ? 0 : now - lastKey.current;
          lastKey.current = now;
          // Count thinking/typing time, but not long breaks away from the box
          const v = valueRef.current;
          onChange({ ...v, keystrokes: v.keystrokes + 1, typingMs: v.typingMs + Math.min(gap, 15_000) });
        }}
        onChange={(e) => {
          const v = valueRef.current;
          const text = e.target.value;
          const added = text.length - v.text.length;
          // Phone keyboards add a whole word at once (autocomplete), so only flag big jumps
          const big = added >= 40;
          if (big) toast.warning("A large block of text appeared at once. This is recorded.", { id: "theory-big" });
          onChange({ ...v, text, bigInserts: v.bigInserts + (big ? 1 : 0) });
        }}
      />
      <p className="flex justify-between text-xs text-muted-foreground">
        <span>{words} word{words === 1 ? "" : "s"}</span>
        <span>{marks} mark{marks === 1 ? "" : "s"} · marked by your lecturer</span>
      </p>
    </div>
  );
}
