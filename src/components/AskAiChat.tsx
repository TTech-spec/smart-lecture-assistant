import { playTour, tourById, tourForQuestion } from "@/lib/tours";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight, ArrowUp, Loader2, Mic, MicOff, PlayCircle, Sparkles, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { askAttendanceAi } from "@/lib/ai-server";

export type AiRow = {
  name: string; matric: string; dept?: string; level?: string; gender?: string; course?: string;
  status?: string; distance?: number; at: string; classCode?: string; tests?: string;
};

type Msg = { role: "user" | "assistant"; content: string; error?: boolean; actions?: { path: string; label: string }[]; tour?: string };

const SUGGESTIONS = [
  "How do I start attendance for my class?",
  "How many students signed in today?",
  "Who needs my review, and why?",
  "Students say their GPS is weak. What should they do?",
  "How do I stop a student I sent out from signing?",
];

// Browser speech (Chrome, Edge, Safari): listening and reading aloud
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
function makeRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  if (!C) return null;
  const r = new C();
  r.lang = "en-NG"; r.interimResults = true; r.continuous = false;
  return r;
}
function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
  u.lang = "en-GB"; u.rate = 1;
  window.speechSynthesis.speak(u);
}

/** Chat with the attendance records (OpenRouter, via the server). */
export function AskAiChat({ rows, onNavigate }: { rows: AiRow[]; onNavigate?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem("att.ai.voice") === "1"; } catch { return false; } });
  const recRef = useRef<Recognition | null>(null);
  const navigate = useNavigate();
  const page = useRouterState({ select: (st) => st.location.pathname });
  const canListen = typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);
  useEffect(() => () => { recRef.current?.stop(); if (typeof window !== "undefined") window.speechSynthesis?.cancel(); }, []);

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    try { localStorage.setItem("att.ai.voice", next ? "1" : "0"); } catch { /* ignore */ }
    if (!next) window.speechSynthesis?.cancel();
  }

  function listen() {
    if (listening) { recRef.current?.stop(); return; }
    const r = makeRecognition();
    if (!r) return;
    recRef.current = r;
    let finalText = "";
    r.onresult = (e) => {
      finalText = Array.from(e.results).map((res) => res[0].transcript).join(" ");
      setText(finalText);
    };
    r.onerror = () => setListening(false);
    r.onend = () => { setListening(false); if (finalText.trim()) ask(finalText); };
    setListening(true);
    r.start();
  }
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  function startTour(id: string) {
    setTimeout(() => { onNavigate?.(); playTour(id); }, 900);
  }

  /** AI unavailable: still show a matching walkthrough if there is one */
  function offerTour(question: string, fallback: string) {
    const t = tourForQuestion(question);
    if (!t) { setMsgs((m) => [...m, { role: "assistant", content: fallback, error: true }]); return; }
    setMsgs((m) => [...m, { role: "assistant", content: `Let me show you how to ${t.title.toLowerCase()}. Watch the screen.`, tour: t.id }]);
    startTour(t.id);
  }

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
      const r = await askAttendanceAi({ data: { accessToken: token, question, history, records: rows.slice(0, 3000), today: new Date().toDateString(), page } });
      if (r.ok) {
        // The AI picked a walkthrough: play it now, it opens the right page by itself
        const tour = r.tour ?? (/\b(how|show|where|can'?t|cannot|stuck|help|don'?t (understand|get))\b/i.test(question) ? tourForQuestion(question)?.id : undefined);
        setMsgs((m) => [...m, { role: "assistant", content: r.answer, actions: r.actions, tour }]);
        if (voiceOn) speak(r.answer);
        if (tour) startTour(tour);
      } else {
        offerTour(question, r.message);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Sign in")) setMsgs((m) => [...m, { role: "assistant", content: e.message, error: true }]);
      else offerTour(question, "Couldn't reach the AI. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-[240px] flex-1 flex-col gap-3 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" /> Ask how to do something, get help with a problem, or ask about your {rows.length} check-ins.</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className="rounded-2xl bg-secondary/60 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 self-end" : "mr-4 self-start"}>
            <div className={m.role === "user" ? "rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm text-background" :
              `whitespace-pre-wrap rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-6 ${m.error ? "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200" : "bg-secondary/60"}`}>
              {m.content}
            </div>
            {m.role === "assistant" && !m.error && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {m.actions?.map((a) => (
                  <button key={a.path} type="button" onClick={() => { navigate({ to: a.path }); onNavigate?.(); }}
                    className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[13px] font-semibold text-primary-foreground hover:opacity-90">
                    Open {a.label} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ))}
                {m.tour && (
                  <button type="button" onClick={() => { onNavigate?.(); playTour(m.tour!); }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3 text-[13px] font-semibold text-background hover:opacity-90">
                    <PlayCircle className="h-3.5 w-3.5" /> {tourById(m.tour)?.title ? `Show me how` : "Show me"}
                  </button>
                )}
                <button type="button" onClick={() => speak(m.content)} aria-label="Read this answer aloud"
                  className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] text-muted-foreground hover:bg-secondary"><Volume2 className="h-3.5 w-3.5" /> Listen</button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 self-start rounded-2xl bg-secondary/60 px-4 py-2.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>{listening ? "Listening… speak now" : canListen ? "Type or tap the mic to speak" : "Type your question"}</span>
        <button type="button" onClick={toggleVoice} className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-secondary" aria-pressed={voiceOn}>
          {voiceOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />} {voiceOn ? "Speaking answers" : "Answers silent"}
        </button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex items-end gap-2 rounded-2xl bg-secondary/60 p-2">
        {canListen && (
          <button type="button" onClick={listen} aria-label={listening ? "Stop listening" : "Speak your question"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${listening ? "animate-pulse bg-red-500 text-white" : "bg-card text-foreground hover:bg-secondary"}`}>
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <textarea id="ai-question" value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={800}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }}
          placeholder="Ask about attendance…" className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
      </form>
      <p className="text-[11px] leading-4 text-muted-foreground">Answers come from OpenRouter AI. For record questions it uses names, matric numbers, courses and check-in status (no phone numbers or photos). Check important numbers in the list.</p>
    </div>
  );
}
