import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Send, Volume2, VolumeX, Sparkles, Repeat } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAttendanceAi } from "@/lib/attendance-ai.functions";
import {
  loadRecords,
  loadTestSubmissions,
  syncFromSupabase,
  type AttendanceRecord,
  type TestSubmission,
  type TestType,
} from "@/lib/attendance-store";

type AiTable = { columns: string[]; rows: string[][] };
type Msg = { role: "user" | "assistant"; content: string; table?: AiTable };

// ── Response table ─────────────────────────────────────────────────────────
function ResponseTable({ table }: { table: AiTable }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-left text-xs">
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri} className="border-t">
              {row.map((cell, ci) => (
                <td key={ci} className="whitespace-nowrap px-2.5 py-1.5">{cell || "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
type VoiceState = "idle" | "listening" | "thinking" | "speaking";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Animated orb ─────────────────────────────────────────────────────────────
function VoiceOrb({ state, onToggle, supportsSTT, busy, conversationMode }: {
  state: VoiceState;
  onToggle: () => void;
  supportsSTT: boolean;
  busy: boolean;
  conversationMode: boolean;
}) {
  const isListening = state === "listening";
  const isThinking  = state === "thinking";
  const isSpeaking  = state === "speaking";
  const isActive = isListening || isThinking || isSpeaking;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
      {/* Pulse rings — visible when listening */}
      <AnimatePresence>
        {isListening && [0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border border-primary/40"
            style={{ width: 60 + i * 28, height: 60 + i * 28 }}
            initial={{ opacity: 0.7, scale: 0.8 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5, ease: "easeOut" }}
          />
        ))}
      </AnimatePresence>

      {/* Speaking equalizer bars */}
      <AnimatePresence>
        {isSpeaking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center gap-0.5"
          >
            {[0.6, 1, 0.8, 1.2, 0.7, 1, 0.9].map((h, i) => (
              <motion.div
                key={i}
                className="w-1 rounded-full bg-primary"
                style={{ height: 6 }}
                animate={{ height: [6, 6 + h * 20, 6] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.08, ease: "easeInOut" }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Thinking rotating ring */}
      <AnimatePresence>
        {isThinking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: 360 }}
            exit={{ opacity: 0 }}
            transition={{
              rotate: { duration: 1.2, repeat: Infinity, ease: "linear" },
              opacity: { duration: 0.2 },
            }}
            className="absolute h-20 w-20 rounded-full"
            style={{
              background: "conic-gradient(from 0deg, transparent 0%, hsl(var(--primary)) 60%, transparent 100%)",
              maskImage: "radial-gradient(circle, transparent 60%, black 65%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 60%, black 65%)",
            }}
          />
        )}
      </AnimatePresence>

      {/* Central orb button */}
      <motion.button
        onClick={onToggle}
        disabled={!supportsSTT || busy}
        animate={
          isActive
            ? {
                scale: [1, 1.06, 1],
                boxShadow: [
                  "0 0 0 0px hsl(var(--primary)/0.4)",
                  "0 0 0 12px hsl(var(--primary)/0)",
                  "0 0 0 0px hsl(var(--primary)/0.4)",
                ],
              }
            : { scale: 1 }
        }
        transition={isActive ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : {}}
        className={`relative z-10 flex h-16 w-16 items-center justify-center rounded-full shadow-lg focus:outline-none ${
          isListening
            ? "bg-red-500 text-white"
            : isThinking || isSpeaking
            ? "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
            : "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground hover:scale-105"
        }`}
        style={{ transition: "background 0.3s" }}
        aria-label={isListening ? "Stop listening" : "Start voice input"}
      >
        <AnimatePresence mode="wait">
          {isListening ? (
            <motion.span key="stop" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              className="block h-5 w-5 rounded bg-white" />
          ) : (
            <motion.span key="mic" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              <Mic className="h-6 w-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Status label */}
      <div className="absolute -bottom-6 left-0 right-0 text-center">
        <AnimatePresence mode="wait">
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium"
          >
            {state === "idle"      && (conversationMode ? "starting…" : "tap to speak")}
            {state === "listening" && "listening…"}
            {state === "thinking"  && "thinking…"}
            {state === "speaking"  && "speaking…"}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function VoiceAssistant({ records }: { records: AttendanceRecord[] }) {
  const ask = useServerFn(askAttendanceAi);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [speakReplies, setSpeakReplies] = useState(true);
  const [conversationMode, setConversationMode] = useState(false);
  const conversationModeRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supportsSTT = typeof window !== "undefined" && !!getSpeechRecognitionCtor();
  const supportsTTS = typeof window !== "undefined" && "speechSynthesis" in window;
  const busy = voiceState === "thinking";

  useEffect(() => {
    conversationModeRef.current = conversationMode;
  }, [conversationMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      if (supportsTTS) window.speechSynthesis.cancel();
    };
  }, [supportsTTS]);

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) {
        void submit(transcript);
      } else if (conversationModeRef.current) {
        // No speech captured — keep the conversation going.
        startListening();
      }
    };
    rec.onerror = (e) => {
      setVoiceState("idle");
      if (e.error && e.error !== "aborted" && e.error !== "no-speech") {
        toast.error(`Mic error: ${e.error}`);
        setConversationMode(false);
      } else if (e.error === "no-speech" && conversationModeRef.current) {
        startListening();
      }
    };
    rec.onend = () => { if (voiceState === "listening") setVoiceState("idle"); };
    recognitionRef.current = rec;
    try {
      rec.start();
      setVoiceState("listening");
    } catch {
      setVoiceState("idle");
    }
  }

  function speak(text: string) {
    if (!speakReplies || !supportsTTS) {
      if (conversationModeRef.current) startListening();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      u.onstart = () => setVoiceState("speaking");
      u.onend = () => {
        setVoiceState("idle");
        if (conversationModeRef.current) startListening();
      };
      u.onerror = () => {
        setVoiceState("idle");
        if (conversationModeRef.current) startListening();
      };
      window.speechSynthesis.speak(u);
    } catch {
      setVoiceState("idle");
      if (conversationModeRef.current) startListening();
    }
  }

  async function submit(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history = messages.slice(-10);
    setMessages((m) => [...m, { role: "user", content: q }]);
    setVoiceState("thinking");
    try {
      // Refresh from Supabase first so the assistant always answers from the
      // current attendance_records / test_submissions tables, not a stale cache.
      await syncFromSupabase();
      const freshRecords = loadRecords();
      const testSubmissions = loadTestSubmissions();
      const bestByMatricAndType = new Map<string, Map<TestType, TestSubmission>>();
      testSubmissions.forEach((s) => {
        const key = s.matricNumber.toLowerCase();
        const type = s.testType || "C1";
        const byType = bestByMatricAndType.get(key) ?? new Map<TestType, TestSubmission>();
        const existing = byType.get(type);
        if (!existing || s.score > existing.score) byType.set(type, s);
        bestByMatricAndType.set(key, byType);
      });

      const payloadRecords = (freshRecords.length > 0 ? freshRecords : records).map((r) => {
        const byType = bestByMatricAndType.get(r.matricNumber.toLowerCase());
        const c1 = byType?.get("C1");
        const c2 = byType?.get("C2");
        const c3 = byType?.get("C3");
        return {
          fullName: r.fullName,
          matricNumber: r.matricNumber,
          department: r.department,
          phone: r.phone,
          courseCode: r.courseCode,
          topic: r.topic,
          level: r.level,
          gender: r.gender,
          submittedAt: r.submittedAt,
          distanceMeters: r.distanceMeters,
          c1Score: c1?.score,
          c1Total: c1?.total,
          c2Score: c2?.score,
          c2Total: c2?.total,
          c3Score: c3?.score,
          c3Total: c3?.total,
          cheatedOnTest: c1?.cheated || c2?.cheated || c3?.cheated,
        };
      });
      const res = await ask({ data: { question: q, records: payloadRecords, history } });
      setMessages((m) => [...m, { role: "assistant", content: res.text, table: res.table ?? undefined }]);
      if (speakReplies && supportsTTS) {
        speak(res.text);
      } else {
        setVoiceState("idle");
        if (conversationModeRef.current) startListening();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      if (msg.toLowerCase().includes("failed to fetch")) {
        toast.error("Could not connect to the server. Make sure the dev server is running (npm run dev) and reload the page.");
      } else if (msg.includes("402")) {
        toast.error("AI credits exhausted.");
      } else {
        toast.error(`AI error: ${msg}`);
      }
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
      setVoiceState("idle");
      if (conversationModeRef.current) startListening();
    }
  }

  function toggleListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    if (voiceState === "listening") {
      setConversationMode(false);
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setVoiceState("idle");
      return;
    }
    startListening();
  }

  function toggleConversationMode() {
    if (!supportsSTT) {
      toast.error("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    const next = !conversationMode;
    setConversationMode(next);
    if (next && voiceState === "idle") {
      startListening();
    }
    if (!next && voiceState === "listening") {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setVoiceState("idle");
    }
  }

  return (
    <div
      className="rounded-2xl border bg-card shadow-soft overflow-hidden"
      style={{ background: "linear-gradient(145deg, hsl(var(--card)) 0%, hsl(var(--card)/0.95) 100%)" }}
    >
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-[color:var(--color-primary)]" />
          AI attendance assistant
          {conversationMode && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              Conversation mode
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          {supportsSTT && (
            <button
              onClick={toggleConversationMode}
              className={`rounded-lg p-1.5 transition-colors ${conversationMode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
              title={conversationMode ? "Turn off hands-free conversation mode" : "Turn on hands-free conversation mode"}
            >
              <Repeat className="h-4 w-4" />
            </button>
          )}
          {supportsTTS && (
            <button
              onClick={() => { setSpeakReplies((v) => !v); if (speakReplies) window.speechSynthesis.cancel(); }}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              title={speakReplies ? "Mute voice replies" : "Unmute voice replies"}
            >
              {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      <div
        className="flex flex-col items-center py-8 px-5"
        style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(var(--primary)/0.07) 0%, transparent 70%)" }}
      >
        <VoiceOrb state={voiceState} onToggle={toggleListening} supportsSTT={supportsSTT} busy={busy} conversationMode={conversationMode} />
        <p className="mt-10 text-center text-xs text-muted-foreground max-w-xs">
          Ask things like <em>"Who from Computer Science signed in?"</em> or <em>"How many female students?"</em>
        </p>
      </div>

      <div
        ref={scrollRef}
        className="mx-4 mb-3 max-h-56 overflow-y-auto rounded-xl border bg-secondary/50 p-3 space-y-2 scroll-smooth"
      >
        {messages.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No questions yet. Tap the orb or type below.
          </p>
        ) : (
          messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "mr-auto w-full max-w-full whitespace-pre-wrap rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-sm shadow-soft"
              }
            >
              {m.content}
              {m.table && <ResponseTable table={m.table} />}
            </motion.div>
          ))
        )}
        {voiceState === "thinking" && (
          <div className="mr-auto flex items-center gap-1.5 py-1 pl-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="h-2 w-2 rounded-full bg-primary"
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
              />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void submit(input); }}
        className="flex gap-2 px-4 pb-4"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={voiceState === "listening" ? "Listening…" : "Type a question…"}
          disabled={busy}
          className="flex-1 rounded-xl bg-secondary border-0 focus-visible:ring-1"
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0 rounded-xl">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
