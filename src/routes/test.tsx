import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  MapPin,
  XCircle,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getActiveTest,
  addTestSubmission,
  loadTestSubmissions,
  loadSettings,
  markClassCodeUsed,
  validateStudentCode,
  flagCodeFraud,
  getStudentCode,
  fetchActiveTestFromSupabase,
  type TestConfig,
  type TestSubmission,
} from "@/lib/attendance-store";
import { supabase } from "@/lib/supabase";

const LEVEL_OPTIONS = ["100", "200", "300", "400", "500", "600"];

export const Route = createFileRoute("/test")({
  head: () => ({
    meta: [
      { title: "Take Test — Attendly" },
      { name: "description", content: "Online test for enrolled students." },
    ],
  }),
  component: TestPage,
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── Stages ────────────────────────────────────────────────────────────────────
type Stage = "identity" | "class_code" | "taking" | "cheated" | "result" | "already_taken" | "not_signed";

function TestPage() {
  const [test, setTest] = useState<TestConfig | null>(() => getActiveTest());

  useEffect(() => {
    const sync = () => setTest(getActiveTest());
    window.addEventListener("att:tests", sync);
    window.addEventListener("storage", sync);

    // Always fetch from Supabase on mount so students on any device
    // see the test if the lecturer has activated it
    fetchActiveTestFromSupabase().then((t) => setTest(t));

    return () => {
      window.removeEventListener("att:tests", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!test) return <NoActiveTest />;
  return <TestFlow test={test} />;
}

// ── No active test ─────────────────────────────────────────────────────────────
function NoActiveTest() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-hero px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
        <GraduationCap className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-bold">No active test</h1>
      <p className="max-w-sm text-muted-foreground">
        Your lecturer hasn't opened a test yet. Check back later or wait for your
        lecturer to activate one.
      </p>
      <Button asChild variant="outline">
        <Link to="/">
          <MapPin className="mr-2 h-4 w-4" /> Back to home
        </Link>
      </Button>
    </div>
  );
}

// ── Main test flow ─────────────────────────────────────────────────────────────
function TestFlow({ test }: { test: TestConfig }) {
  const [stage, setStage] = useState<Stage>("identity");
  const [studentName, setStudentName] = useState("");
  const [matricNumber, setMatricNumber] = useState("");
  const [level, setLevel] = useState("");
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(test.questions.length).fill(null),
  );
  const [result, setResult] = useState<TestSubmission | null>(null);
  const settings = loadSettings();

  async function handleIdentitySubmit(name: string, matric: string, lvl: string) {
    // Check if student has already taken this test
    const existing = loadTestSubmissions().find(
      (s) => s.testId === test.id && s.matricNumber.toLowerCase() === matric.trim().toLowerCase(),
    );
    if (existing) {
      setStudentName(name);
      setMatricNumber(matric);
      setLevel(lvl);
      setResult(existing);
      setStage("already_taken");
      return;
    }
    
    setStudentName(name);
    setMatricNumber(matric);
    setLevel(lvl);
    
    // Check if class code is required (lecturer has generated one)
    if (settings.classCodeEnabled && settings.classCode) {
      setStage("class_code");
      return;
    }
    
    setStage("taking");
  }

  function handleClassCodeSubmit(code: string) {
    // validateStudentCode already confirmed this code belongs to matricNumber
    markClassCodeUsed(matricNumber);
    setStage("taking");
  }

  function handleCheated() {
    setStage("cheated");
  }

  function handleSubmit(finalAnswers: (number | null)[], cheated = false) {
    const score = finalAnswers.reduce<number>((acc, ans, i) => {
      return acc + (ans === test.questions[i].correctIndex ? 1 : 0);
    }, 0);

    const submission: TestSubmission = {
      id: `tsub-${Date.now()}`,
      testId: test.id,
      studentName,
      matricNumber,
      level,
      answers: finalAnswers,
      score,
      total: test.questions.length,
      submittedAt: new Date().toISOString(),
      cheated,
      testType: test.testType || "C1",
    };

    addTestSubmission(submission);
    setResult(submission);
    setStage("result");
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-md shadow-soft">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <MapPin className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">Attendly</span>
          </Link>
          <div className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
            {test.courseCode} &mdash; {test.title}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-20 pt-10">
        <AnimatePresence mode="wait">
          {stage === "identity" && (
            <motion.div
              key="identity"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <IdentityForm test={test} onSubmit={handleIdentitySubmit} />
            </motion.div>
          )}

          {stage === "class_code" && (
            <motion.div
              key="class_code"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <ClassCodeForm settings={settings} matricNumber={matricNumber} onSubmit={handleClassCodeSubmit} />
            </motion.div>
          )}

          {stage === "taking" && (
            <motion.div
              key="taking"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <TakingTest
                test={test}
                answers={answers}
                setAnswers={setAnswers}
                onCheated={handleCheated}
                onSubmit={handleSubmit}
              />
            </motion.div>
          )}

          {stage === "already_taken" && result && (
            <motion.div
              key="already_taken"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35 }}
            >
              <div className="mx-auto max-w-md text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30">
                  <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                </div>
                <h2 className="text-2xl font-bold">Already submitted</h2>
                <p className="mt-2 text-muted-foreground">
                  You already took this test. Each student can only attempt a test once.
                </p>
                <div className="mt-6 rounded-2xl border bg-card p-5 text-left shadow-soft space-y-2">
                  <p className="text-sm"><span className="text-muted-foreground">Name:</span> <span className="font-medium">{result.studentName}</span></p>
                  <p className="text-sm"><span className="text-muted-foreground">Matric:</span> <span className="font-medium">{result.matricNumber}</span></p>
                  {result.level && <p className="text-sm"><span className="text-muted-foreground">Level:</span> <span className="font-medium">{result.level} Level</span></p>}
                  <p className="text-sm"><span className="text-muted-foreground">Score:</span> <span className="font-semibold text-primary">{result.score}/{result.total}</span></p>
                  <p className="text-sm"><span className="text-muted-foreground">Submitted:</span> <span className="font-medium">{new Date(result.submittedAt).toLocaleString()}</span></p>
                </div>
                <Button asChild className="mt-6" variant="outline">
                  <Link to="/">Back to home</Link>
                </Button>
              </div>
            </motion.div>
          )}

          {stage === "not_signed" && (
            <motion.div
              key="not_signed"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35 }}
            >
              <div className="mx-auto max-w-md text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/30">
                  <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="text-2xl font-bold">Attendance not found</h2>
                <p className="mt-2 text-muted-foreground">
                  We couldn't find an attendance record for <span className="font-medium">{matricNumber}</span> under {test.courseCode}. You must sign attendance for this course before you can take the test.
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Button asChild>
                    <Link to="/">
                      <MapPin className="mr-2 h-4 w-4" /> Sign attendance
                    </Link>
                  </Button>
                  <Button variant="outline" onClick={() => setStage("identity")}>Try a different matric number</Button>
                </div>
              </div>
            </motion.div>
          )}

          {stage === "cheated" && (
            <motion.div
              key="cheated"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35 }}
            >
              <CheatedScreen onForceSubmit={() => handleSubmit(answers, true)} />
            </motion.div>
          )}

          {stage === "result" && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <ResultScreen test={test} submission={result} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ── Class code form ─────────────────────────────────────────────────────────────
function ClassCodeForm({
  settings,
  matricNumber,
  onSubmit,
}: {
  settings: any;
  matricNumber: string;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [fraudBlocked, setFraudBlocked] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(3);

  // If this student has no code assigned yet (got code on a different device /
  // storage was cleared), fall back to the global code check so they aren't
  // permanently locked out.
  const hasPersonalCode = !!getStudentCode(matricNumber);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const entered = code.trim();
    if (!entered) {
      toast.error("Please enter the class code");
      return;
    }

    setChecking(true);

    if (hasPersonalCode) {
      // ── Personal-code validation ─────────────────────────────────────────
      const valid = validateStudentCode(matricNumber, entered);

      if (!valid) {
        flagCodeFraud(matricNumber, entered);
        const remaining = attemptsLeft - 1;
        setAttemptsLeft(remaining);

        if (remaining <= 0) {
          setFraudBlocked(true);
          setChecking(false);
          toast.error("Too many incorrect attempts. You have been flagged for using someone else's code.");
          return;
        }

        setChecking(false);
        toast.error(
          `Wrong code. That code doesn't match your matric number. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
        );
        setCode("");
        return;
      }
    } else {
      // ── Fallback: global code (student got their code on another device) ──
      const expectedCode = settings.classCode.trim();
      if (entered !== expectedCode) {
        setChecking(false);
        toast.error("Invalid class code. Please check with your lecturer.");
        return;
      }
    }

    setChecking(false);
    onSubmit(entered);
  }

  // ── Fraud-blocked screen ────────────────────────────────────────────────────
  if (fraudBlocked) {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/30">
          <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="text-2xl font-bold text-red-600 dark:text-red-400">Access Blocked</h2>
        <p className="mt-2 text-muted-foreground">
          You entered a code that doesn't belong to your matric number too many times. This incident has been reported to your lecturer.
        </p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <GraduationCap className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">Enter Your Class Code</h1>
        <p className="mt-1 text-muted-foreground">
          Enter the personal class code assigned to your matric number.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border bg-card p-6 shadow-soft space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Each student has a <strong>unique</strong> code. Do not share yours — using someone else's code will flag you.
        </div>

        {attemptsLeft < 3 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-300">
            <XCircle className="mr-2 inline h-4 w-4" />
            {attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""} remaining before you are blocked.
          </div>
        )}

        <div>
          <Label htmlFor="classCode">Your Class Code</Label>
          <Input
            id="classCode"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your personal class code"
            className="mt-1 text-center text-lg tracking-wider"
            autoFocus
          />
        </div>
        <Button type="submit" className="w-full" disabled={checking}>
          {checking ? "Verifying..." : <>Verify & Start Test <ChevronRight className="ml-2 h-4 w-4" /></>}
        </Button>
      </form>
    </div>
  );
}

// ── Identity form ──────────────────────────────────────────────────────────────
function IdentityForm({ test, onSubmit }: { test: TestConfig; onSubmit: (name: string, matric: string, level: string) => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [matric, setMatric] = useState("");
  const [level, setLevel] = useState("");
  const [matched, setMatched] = useState(false);
  const [looking, setLooking] = useState(false);
  const [checking, setChecking] = useState(false);

  async function lookupMatric() {
    const m = matric.trim();
    if (!m || !supabase) return;
    setLooking(true);
    try {
      const { data } = await supabase
        .from("attendance_records")
        .select("full_name, level")
        .eq("course_code", test.courseCode)
        .ilike("matric_number", m)
        .limit(1)
        .maybeSingle();
      if (data) {
        setName(data.full_name || "");
        setLevel(data.level || "");
        setMatched(true);
      }
    } catch {
      // Lookup is best-effort — students can still fill in the fields manually.
    } finally {
      setLooking(false);
    }
  }

  function clearMatch() {
    setMatched(false);
    setName("");
    setLevel("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Enter your full name."); return; }
    if (!matric.trim()) { toast.error("Enter your matric number."); return; }
    if (!level) { toast.error("Select your level."); return; }
    setChecking(true);
    try {
      await onSubmit(name.trim(), matric.trim(), level);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <GraduationCap className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">{test.title}</h1>
        <p className="mt-1 text-muted-foreground">
          {test.courseCode} &nbsp;·&nbsp; {test.questions.length} question{test.questions.length !== 1 ? "s" : ""} &nbsp;·&nbsp; {test.durationMinutes} min
        </p>
      </div>

      <form onSubmit={submit} className="rounded-2xl border bg-card p-6 shadow-soft space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Do not switch tabs or minimize the window during the test. Doing so will flag you for cheating.
        </div>
        <div>
          <Label htmlFor="matric">Matric number</Label>
          <Input
            id="matric"
            value={matric}
            onChange={(e) => { setMatric(e.target.value); if (matched) clearMatch(); }}
            onBlur={lookupMatric}
            placeholder="e.g. 2021/12345"
            className="mt-1"
            autoFocus
          />
          {looking && <p className="mt-1 text-xs text-muted-foreground">Checking attendance records…</p>}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="name">Full name</Label>
            {matched && (
              <button type="button" onClick={clearMatch} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                Not you? Clear <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Amaka Okafor"
            className="mt-1"
            readOnly={matched}
          />
          {matched && <p className="mt-1 text-xs text-green-600 dark:text-green-400">Matched from your attendance record.</p>}
        </div>
        <div>
          <Label htmlFor="level">Level</Label>
          <Select value={level} onValueChange={setLevel} disabled={matched}>
            <SelectTrigger id="level" className="mt-1"><SelectValue placeholder="Select level" /></SelectTrigger>
            <SelectContent>
              {LEVEL_OPTIONS.map((l) => <SelectItem key={l} value={l}>{l} Level</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="w-full" disabled={checking}>
          {checking ? "Checking attendance…" : <>Start test <ChevronRight className="ml-2 h-4 w-4" /></>}
        </Button>
      </form>
    </div>
  );
}

// ── Taking test ────────────────────────────────────────────────────────────────
function TakingTest({
  test, answers, setAnswers, onCheated, onSubmit,
}: {
  test: TestConfig;
  answers: (number | null)[];
  setAnswers: React.Dispatch<React.SetStateAction<(number | null)[]>>;
  onCheated: () => void;
  onSubmit: (answers: (number | null)[]) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(test.durationMinutes * 60);
  const cheatedRef = useRef(false);
  const answersRef = useRef(answers);

  useEffect(() => { answersRef.current = answers; }, [answers]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          toast.warning("Time's up! Your answers have been submitted.");
          onSubmit(answersRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleViolation() {
      if (cheatedRef.current) return;
      cheatedRef.current = true;
      onCheated();
    }
    function onVisibilityChange() { if (document.hidden) handleViolation(); }
    function onBlur() { handleViolation(); }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
    };
  }, [onCheated]);

  const q = test.questions[current];
  const totalAnswered = answers.filter((a) => a !== null).length;
  const progress = (totalAnswered / test.questions.length) * 100;
  const timerDanger = secondsLeft <= 60;

  function selectAnswer(optionIndex: number) {
    setAnswers((prev) => { const next = [...prev]; next[current] = optionIndex; return next; });
  }

  function handleSubmitClick() {
    const unanswered = answers.filter((a) => a === null).length;
    if (unanswered > 0) {
      if (!window.confirm(`You have ${unanswered} unanswered question${unanswered !== 1 ? "s" : ""}. Submit anyway?`)) return;
    }
    onSubmit(answers);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-4 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">Question {current + 1} of {test.questions.length}</span>
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-mono font-semibold ${timerDanger ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-secondary text-foreground"}`}>
            <Clock className={`h-3.5 w-3.5 ${timerDanger ? "animate-pulse" : ""}`} />
            {formatSeconds(secondsLeft)}
          </div>
        </div>
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <motion.div className="h-full rounded-full bg-gradient-primary" animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{totalAnswered} of {test.questions.length} answered</p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={current} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.25 }} className="rounded-2xl border bg-card p-6 shadow-soft space-y-5">
          <p className="text-lg font-semibold leading-relaxed">{q.text}</p>
          <div className="space-y-3">
            {q.options.map((opt, i) => {
              const selected = answers[current] === i;
              return (
                <button key={i} type="button" onClick={() => selectAnswer(i)}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all duration-150 ${selected ? "border-primary bg-primary/10 text-primary shadow-soft" : "border-border bg-secondary/50 text-foreground hover:border-primary/40 hover:bg-secondary"}`}>
                  <span className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold">{String.fromCharCode(65 + i)}</span>
                  {opt}
                </button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Previous
        </Button>
        <div className="flex flex-1 flex-wrap justify-center gap-1.5">
          {test.questions.map((_, i) => (
            <button key={i} type="button" onClick={() => setCurrent(i)}
              className={`h-7 w-7 rounded-full text-xs font-medium transition-all ${i === current ? "bg-primary text-primary-foreground shadow-glow scale-110" : answers[i] !== null ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground hover:bg-secondary/80"}`}>
              {i + 1}
            </button>
          ))}
        </div>
        {current < test.questions.length - 1 ? (
          <Button onClick={() => setCurrent((c) => Math.min(test.questions.length - 1, c + 1))}>
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSubmitClick} className="bg-gradient-primary">Submit</Button>
        )}
      </div>
    </div>
  );
}

// ── Cheated screen ─────────────────────────────────────────────────────────────
function CheatedScreen({ onForceSubmit }: { onForceSubmit: () => void }) {
  useEffect(() => {
    const t = setTimeout(onForceSubmit, 5000);
    return () => clearTimeout(t);
  }, [onForceSubmit]);

  return (
    <div className="mx-auto max-w-md text-center">
      <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
        <AlertTriangle className="h-10 w-10 text-red-600 dark:text-red-400" />
      </motion.div>
      <h1 className="text-2xl font-bold text-red-600 dark:text-red-400">Caught cheating!</h1>
      <p className="mt-3 text-muted-foreground">You left or minimized the test window. Your answers will be submitted automatically.</p>
      <p className="mt-4 text-sm text-muted-foreground">Submitting in a few seconds…</p>
      <Button variant="destructive" className="mt-6" onClick={onForceSubmit}>Submit now</Button>
    </div>
  );
}

// ── Result screen ──────────────────────────────────────────────────────────────
function ResultScreen({ test, submission }: { test: TestConfig; submission: TestSubmission }) {
  const percentage = Math.round((submission.score / submission.total) * 100);
  const passed = percentage >= 50;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-2xl border bg-card p-8 shadow-soft text-center">
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${submission.cheated ? "bg-red-100 dark:bg-red-900/30" : passed ? "bg-green-100 dark:bg-green-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
          {submission.cheated ? <AlertTriangle className="h-10 w-10 text-red-600 dark:text-red-400" /> : passed ? <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" /> : <XCircle className="h-10 w-10 text-amber-600 dark:text-amber-400" />}
        </motion.div>
        <h1 className="text-3xl font-bold">{submission.score}/{submission.total}</h1>
        <p className="mt-1 text-xl font-semibold text-muted-foreground">{percentage}%</p>
        {submission.cheated && <p className="mt-2 text-sm text-red-600 dark:text-red-400 font-medium">Test ended due to cheating violation</p>}
        <p className="mt-3 text-muted-foreground">
          {submission.studentName} &middot; {submission.matricNumber}
          {submission.level && <> &middot; {submission.level} Level</>}
        </p>
        <div className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold ${passed ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
          {passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {passed ? "Passed" : "Failed"}
        </div>
      </div>

      <div className="rounded-2xl border bg-card shadow-soft">
        <div className="border-b p-5"><h2 className="text-lg font-semibold">Answer review</h2></div>
        <div className="divide-y">
          {test.questions.map((q, i) => {
            const chosen = submission.answers[i];
            const correct = q.correctIndex;
            const isRight = chosen === correct;
            const notAnswered = chosen === null || chosen === undefined;
            return (
              <div key={q.id} className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${notAnswered ? "bg-secondary text-muted-foreground" : isRight ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>{i + 1}</div>
                  <p className="font-medium leading-relaxed">{q.text}</p>
                </div>
                <div className="ml-9 space-y-2">
                  {q.options.map((opt, oi) => {
                    const isCorrectOpt = oi === correct;
                    const isChosenOpt = oi === chosen;
                    let cls = "rounded-lg border px-3 py-2 text-sm ";
                    if (isCorrectOpt) cls += "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300";
                    else if (isChosenOpt) cls += "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300";
                    else cls += "border-border bg-secondary/40 text-muted-foreground";
                    return (
                      <div key={oi} className={cls}>
                        <span className="mr-2 font-bold">{String.fromCharCode(65 + oi)}.</span>{opt}
                        {isCorrectOpt && <span className="ml-2 text-xs font-semibold text-green-600 dark:text-green-400">✓ Correct</span>}
                        {isChosenOpt && !isCorrectOpt && <span className="ml-2 text-xs font-semibold text-red-600 dark:text-red-400">✗ Your answer</span>}
                      </div>
                    );
                  })}
                  {notAnswered && <p className="text-xs text-muted-foreground italic">Not answered</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-center">
        <Button asChild variant="outline"><Link to="/"><MapPin className="mr-2 h-4 w-4" /> Back to home</Link></Button>
      </div>
    </div>
  );
}
