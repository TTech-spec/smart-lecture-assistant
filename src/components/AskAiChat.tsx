import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { askAttendanceAi } from "@/lib/ai-server";

export type AiRow = {
  name: string; matric: string; dept?: string; level?: string; gender?: string; course?: string;
  status?: string; distance?: number; at: string; classCode?: string; tests?: string;
};

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

const SUGGESTIONS = [
  "How many students signed in today?",
  "Who needs my review, and why?",
  "Which students from Computer Science signed in this week?",
  "Who has missed the most classes?",
];

/** Chat with the attendance records (OpenRouter, via the server). */
export function AskAiChat({ rows }: { rows: AiRow[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    const history = msgs.filter((m) => !m.error).slice(-8).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setBusy(true);
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again to use Ask AI.");
      const r = await askAttendanceAi({ data: { accessToken: token, question, history, records: rows.slice(0, 3000), today: new Date().toDateString() } });
      setMsgs((m) => [...m, r.ok ? { role: "assistant", content: r.answer } : { role: "assistant", content: r.message, error: true }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: e instanceof Error && e.message.startsWith("Sign in") ? e.message : "Couldn't reach the AI. Check your connection and try again.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-[240px] flex-1 flex-col gap-3 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" /> Ask anything about your {rows.length} check-ins.</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className="rounded-2xl bg-secondary/60 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 self-end rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm text-background" :
            `mr-4 self-start whitespace-pre-wrap rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-6 ${m.error ? "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200" : "bg-secondary/60"}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 self-start rounded-2xl bg-secondary/60 px-4 py-2.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Thinking…</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex items-end gap-2 rounded-2xl bg-secondary/60 p-2">
        <textarea id="ai-question" value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={800}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }}
          placeholder="Ask about attendance…" className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
      </form>
      <p className="text-[11px] leading-4 text-muted-foreground">Answers come from OpenRouter AI using names, matric numbers, courses and check-in status (no phone numbers or photos). Check important numbers in the list.</p>
    </div>
  );
}
