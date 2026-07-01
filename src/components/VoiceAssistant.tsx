import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Send, Volume2, VolumeX, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAttendanceAi } from "@/lib/attendance-ai.functions";
import type { AttendanceRecord } from "@/lib/attendance-store";

type Msg = { role: "user" | "assistant"; content: string };
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
function VoiceOrb({ state, onToggle, supportsSTT, busy }: {
  state: VoiceState;
  onToggle: () => void;
  supportsSTT: boolean;
  busy: boolean;
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
            {state === "idle"      && "tap to speak"}
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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supportsSTT = typeof window !== "undefined" && !!getSpeechRecognitionCtor();
  const supportsTTS = typeof window !== "undefined" && "speechSynthesis" in window;
  const busy = voiceState === "thinking";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      if (supportsTTS) window.speechSynthesis.cancel();
    };
  }, [supportsTTS]);

  function speak(text: string) {
    if (!speakReplies || !supportsTTS) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      u.onstart = () => setVoiceState("speaking");
      u.onend = () => setVoiceState("idle");
      u.onerror = () => setVoiceState("idle");
      window.speechSynthesis.speak(u);
    } catch {
      setVoiceState("idle");
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
      const payloadRecords = records.map((r) => ({
        fullName: r.fullName,
        matricNumber: r.matricNumber,
        department: r.department,
        phone: r.phone,
        courseCode: r.courseCode,
        topic: r.topic,
        gender: r.gender,
        submittedAt: r.submittedAt,
        distanceMeters: r.distanceMeters,
      }));
      const res = await ask({ data: { question: q, records: payloadRecords, history } });
      setMessages((m) => [...m, { role: "assistant", content: res.text }]);
      if (speakReplies && supportsTTS) {
        speak(res.text);
      } else {
        setVoiceState("idle");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      toast.error(msg.includes("402") ? "AI credits exhausted." : "AI request failed.");
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't process that." }]);
      setVoiceState("idle");
    }
  }

  function toggleListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    if (voiceState === "listening") {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setVoiceState("idle");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) void submit(transcript);
    };
    rec.onerror = (e) => {
      setVoiceState("idle");
      if (e.error && e.error !== "aborted" && e.error !== "no-speech") {
        toast.error(`Mic error: ${e.error}`);
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

  return (
    <div
      className="rounded-2xl border bg-card shadow-soft overflow-hidden"
      style={{ background: "linear-gradient(145deg, hsl(var(--card)) 0%, hsl(var(--card)/0.95) 100%)" }}
    >
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-[color:var(--color-primary)]" />
          AI attendance assistant
        </h2>
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

      <div
        className="flex flex-col items-center py-8 px-5"
        style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(var(--primary)/0.07) 0%, transparent 70%)" }}
      >
        <VoiceOrb state={voiceState} onToggle={toggleListening} supportsSTT={supportsSTT} busy={busy} />
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
                  : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border bg-card px-3 py-2 text-sm shadow-soft"
              }
            >
              {m.content}
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
