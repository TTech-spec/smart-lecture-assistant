import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Send, Sparkles, Volume2, VolumeX, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAttendanceAi } from "@/lib/attendance-ai.functions";
import type { AttendanceRecord } from "@/lib/attendance-store";

type Msg = { role: "user" | "assistant"; content: string };

// Minimal typings for the Web Speech API (not in lib.dom)
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

export function VoiceAssistant({ records }: { records: AttendanceRecord[] }) {
  const ask = useServerFn(askAttendanceAi);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supportsSTT = typeof window !== "undefined" && !!getSpeechRecognitionCtor();
  const supportsTTS = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
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
      window.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }

  async function submit(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history = messages.slice(-10);
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setBusy(true);
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
      speak(res.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      toast.error(msg.includes("402") ? "AI credits exhausted. Add credits in Workspace settings." : "AI request failed.");
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't process that." }]);
    } finally {
      setBusy(false);
    }
  }

  function toggleListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setListening(false);
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
      setListening(false);
      if (e.error && e.error !== "aborted" && e.error !== "no-speech") {
        toast.error(`Mic error: ${e.error}`);
      }
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-[color:var(--color-primary)]" /> Voice AI assistant
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Talk or type. Ask things like "Who from Computer Science signed in?" or "How many female students attended?"
          </p>
        </div>
        {supportsTTS && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setSpeakReplies((v) => !v);
              if (speakReplies) window.speechSynthesis.cancel();
            }}
            title={speakReplies ? "Mute voice replies" : "Unmute voice replies"}
          >
            {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-xl bg-secondary p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions yet. Tap the mic or type below.</p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-card px-3 py-2 text-sm shadow-soft"
              }
            >
              {m.content}
            </div>
          ))
        )}
        {busy && (
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
      >
        <Button
          type="button"
          variant={listening ? "destructive" : "outline"}
          size="icon"
          onClick={toggleListening}
          disabled={!supportsSTT || busy}
          title={supportsSTT ? "Hold a conversation with voice" : "Voice input unsupported in this browser"}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Ask about today's attendance…"}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
