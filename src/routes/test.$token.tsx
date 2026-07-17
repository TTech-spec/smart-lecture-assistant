import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Loader2,
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
  addTestSubmission,
  loadTestSubmissions,
  loadSettings,
  markClassCodeUsed,
  fetchTestLinkByToken,
  getDeviceId,
  hasDeviceTakenTest,
  hasDeviceTakenTestRemote,
  shuffledIndices,
  type TestConfig,
  type TestSubmission,
  type TestLink,
} from "@/lib/attendance-store";

const LEVEL_OPTIONS = ["100", "200", "300", "400", "500", "600"];

export const Route = createFileRoute("/test/$token")({
  head: () => ({
    meta: [
      { title: "Take Test — Attendly" },
      { name: "description", content: "Online test for enrolled students." },
    ],
  }),
  component: TestTokenPage,
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── Stages ────────────────────────────────────────────────────────────────────
type Stage = "loading" | "invalid" | "identity" | "class_code" | "taking" | "cheated" | "result" | "already_taken" | "device_used" | "not_signed";

function TestTokenPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  
  const [testLink, setTestLink] = useState<TestLink | null>(null);
  const [test, setTest] = useState<TestConfig | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [studentName, setStudentName] = useState("");
  const [matricNumber, setMatricNumber] = useState("");
  const [level, setLevel] = useState("");
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<TestSubmission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTestLink() {
      try {
        const link = await fetchTestLinkByToken(token);
        if (!link) {
          setStage("invalid");
          setLoading(false);
          return;
        }
        
        setTestLink(link);
        
        // Load the test associated with this link
        const testConfig = await fetchTestById(link.testId);
        if (!testConfig) {
          toast.error("Test not found");
          setStage("invalid");
          setLoading(false);
          return;
        }
        
        setTest(testConfig);
        setAnswers(Array(testConfig.questions.length).fill(null));
        setStage("identity");
      } catch (error) {
        console.error("Error loading test link:", error);
        toast.error("Failed to load test");
        setStage("invalid");
      } finally {
        setLoading(false);
      }
    }
    
    loadTestLink();
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-hero px-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading test...</p>
      </div>
    );
  }

  if (stage === "invalid" || !testLink || !test) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-hero px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <XCircle className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">Invalid or expired test link</h1>
        <p className="max-w-sm text-muted-foreground">
          This test link doesn't exist or has expired. Please contact your lecturer for a valid link.
        </p>
        <Button asChild variant="outline">
          <Link to="/">
            <MapPin className="mr-2 h-4 w-4" /> Back to home
          </Link>
        </Button>
      </div>
    );
  }

  const settings = loadSettings();

  async function handleIdentitySubmit(name: string, matric: string, lvl: string) {
    const deviceId = getDeviceId();

    // Check if this matric number has already taken this test — show them their own result
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

    // Device-level lock: this phone already submitted this test under any matric number
    if (
      hasDeviceTakenTest(deviceId, test.id) ||
      (await hasDeviceTakenTestRemote(deviceId, test.id))
    ) {
      setStudentName(name);
      setMatricNumber(matric);
      setLevel(lvl);
      setStage("device_used");
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
    markClassCodeUsed(matricNumber);
    setStage("taking");
  }

  function handleCheated() {
    setStage("cheated");
  }

  async function handleSubmit(finalAnswers: (number | null)[], cheated = false) {
    const deviceId = getDeviceId();

    // Re-check the device lock at submit time in case another tab/session on
    // this same phone already submitted while this one was in progress.
    const raced =
      hasDeviceTakenTest(deviceId, test.id) ||
      (await hasDeviceTakenTestRemote(deviceId, test.id));
    if (raced) {
      setStage("device_used");
      return;
    }

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
      deviceId,
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

          {stage === "cheated" && (
            <motion.div
              key="cheated"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <CheatedScreen onRetry={() => setStage("taking")} />
            </motion.div>
          )}

          {stage === "result" && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <ResultScreen result={result} test={test} />
            </motion.div>
          )}

          {stage === "already_taken" && result && (
            <motion.div
              key="already_taken"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <AlreadyTakenScreen result={result} test={test} />
            </motion.div>
          )}

          {stage === "device_used" && (
            <motion.div
              key="device_used"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
            >
              <div className="rounded-2xl border bg-card p-6 shadow-soft text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
                  <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                </div>
                <h2 className="mb-2 text-xl font-bold">This device already took this test</h2>
                <p className="mb-6 text-sm text-muted-foreground">
                  This phone has already been used to submit this test. Each test can only be taken once per device, regardless of the matric number entered.
                </p>
                <Button asChild className="w-full">
                  <Link to="/">
                    <MapPin className="mr-2 h-4 w-4" /> Back to home
                  </Link>
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ── Identity Form ─────────────────────────────────────────────────────────────
function IdentityForm({ test, onSubmit }: { test: TestConfig; onSubmit: (name: string, matric: string, level: string) => void }) {
  const [name, setName] = useState("");
  const [matric, setMatric] = useState("");
  const [level, setLevel] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Please enter your full name.");
    if (!matric.trim()) return toast.error("Please enter your matric number.");
    if (!level) return toast.error("Please select your level.");
    onSubmit(name.trim(), matric.trim(), level);
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft">
      <div className="mb-6">
        <h2 className="text-xl font-bold">{test.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {test.courseCode} &mdash; {test.durationMinutes} minutes
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label className="text-sm">Full Name</Label>
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your full name"
          />
        </div>

        <div>
          <Label className="text-sm">Matric Number</Label>
          <Input
            className="mt-1"
            value={matric}
            onChange={(e) => setMatric(e.target.value.toUpperCase())}
            placeholder="Enter your matric number"
          />
        </div>

        <div>
          <Label className="text-sm">Level</Label>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select your level" />
            </SelectTrigger>
            <SelectContent>
              {LEVEL_OPTIONS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l} Level
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" className="w-full">
          Start Test
        </Button>
      </form>
    </div>
  );
}

// ── Class Code Form ───────────────────────────────────────────────────────────
function ClassCodeForm({ settings, matricNumber, onSubmit }: { settings: any; matricNumber: string; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return toast.error("Please enter your class code.");
    
    setChecking(true);
    // Here you would validate the class code
    // For now, we'll just accept it
    onSubmit(code.trim());
    setChecking(false);
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft">
      <h2 className="mb-4 text-xl font-bold">Enter your class code</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Enter the unique class code that was assigned to you.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label className="text-sm">Class Code</Label>
          <Input
            className="mt-1"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Enter your class code"
          />
        </div>

        <Button type="submit" className="w-full" disabled={checking}>
          {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Submit Code
        </Button>
      </form>
    </div>
  );
}

// ── Taking Test ───────────────────────────────────────────────────────────────
function TakingTest({
  test,
  answers,
  setAnswers,
  onCheated,
  onSubmit,
}: {
  test: TestConfig;
  answers: (number | null)[];
  setAnswers: (answers: (number | null)[]) => void;
  onCheated: () => void;
  onSubmit: (answers: (number | null)[], cheated?: boolean) => void;
}) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [order] = useState(() => shuffledIndices(test.questions.length));
  const [timeLeft, setTimeLeft] = useState(test.durationMinutes * 60);
  const [tabCount, setTabCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onSubmit(answers);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [answers, onSubmit]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabCount((prev) => prev + 1);
        if (tabCount >= 2) {
          onCheated();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [tabCount, onCheated]);

  function handleAnswerSelect(optionIndex: number) {
    const newAnswers = [...answers];
    newAnswers[order[currentQuestion]] = optionIndex;
    setAnswers(newAnswers);
  }

  function handleNext() {
    if (currentQuestion < test.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      onSubmit(answers);
    }
  }

  function handlePrevious() {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  }

  const question = test.questions[order[currentQuestion]];
  const progress = ((currentQuestion + 1) / test.questions.length) * 100;

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft">
      {/* Timer and progress */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4" />
          <span className={timeLeft < 60 ? "text-destructive font-medium" : ""}>
            {formatSeconds(timeLeft)}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          Question {currentQuestion + 1} of {test.questions.length}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Question */}
      <div className="mb-6">
        <h3 className="mb-4 text-lg font-semibold">{question.text}</h3>
        <div className="space-y-3">
          {question.options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleAnswerSelect(index)}
              className={`w-full rounded-lg border p-4 text-left transition-all ${
                answers[order[currentQuestion]] === index
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-secondary"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/20 text-sm font-medium">
                  {String.fromCharCode(65 + index)}
                </div>
                <span className="text-sm">{option}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentQuestion === 0}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Previous
        </Button>
        <Button
          onClick={handleNext}
          disabled={answers[order[currentQuestion]] === null}
        >
          {currentQuestion === test.questions.length - 1 ? "Submit" : "Next"}
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {tabCount > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertTriangle className="inline h-4 w-4 mr-2" />
          Warning: Switching tabs during the test is monitored. {3 - tabCount} more switches will result in automatic submission.
        </div>
      )}
    </div>
  );
}

// ── Cheated Screen ─────────────────────────────────────────────────────────────
function CheatedScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive bg-destructive/10 p-6 shadow-soft text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/20">
        <XCircle className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-destructive">Test Terminated</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        You switched tabs multiple times during the test, which violates the test rules.
        Your test has been automatically submitted.
      </p>
      <Button onClick={onRetry}>Retry Test</Button>
    </div>
  );
}

// ── Result Screen ─────────────────────────────────────────────────────────────
function ResultScreen({ result, test }: { result: TestSubmission; test: TestConfig }) {
  const percentage = Math.round((result.score / result.total) * 100);
  const passed = percentage >= 50;

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft text-center">
      <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
        passed ? "bg-[color:var(--color-success)]/20" : "bg-destructive/20"
      }`}>
        {passed ? (
          <CheckCircle2 className="h-8 w-8 text-[color:var(--color-success)]" />
        ) : (
          <XCircle className="h-8 w-8 text-destructive" />
        )}
      </div>
      <h2 className={`mb-2 text-xl font-bold ${passed ? "text-[color:var(--color-success)]" : "text-destructive"}`}>
        {passed ? "Test Passed!" : "Test Failed"}
      </h2>
      <div className="mb-6">
        <div className="text-4xl font-bold">{result.score}/{result.total}</div>
        <div className="text-sm text-muted-foreground">{percentage}%</div>
      </div>
      <div className="mb-6 rounded-lg bg-secondary p-4 text-left">
        <h3 className="mb-2 font-semibold">Test Details</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">Student:</div>
          <div>{result.studentName}</div>
          <div className="text-muted-foreground">Matric Number:</div>
          <div>{result.matricNumber}</div>
          <div className="text-muted-foreground">Level:</div>
          <div>{result.level}</div>
          <div className="text-muted-foreground">Test Type:</div>
          <div>{result.testType}</div>
        </div>
      </div>
      <Button asChild className="w-full">
        <Link to="/">
          <MapPin className="mr-2 h-4 w-4" /> Back to home
        </Link>
      </Button>
    </div>
  );
}

// ── Already Taken Screen ───────────────────────────────────────────────────────
function AlreadyTakenScreen({ result, test }: { result: TestSubmission; test: TestConfig }) {
  const percentage = Math.round((result.score / result.total) * 100);

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-soft text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
        <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
      </div>
      <h2 className="mb-2 text-xl font-bold">Already Taken</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        You have already taken this test. Here are your previous results:
      </p>
      <div className="mb-6">
        <div className="text-4xl font-bold">{result.score}/{result.total}</div>
        <div className="text-sm text-muted-foreground">{percentage}%</div>
      </div>
      <Button asChild className="w-full">
        <Link to="/">
          <MapPin className="mr-2 h-4 w-4" /> Back to home
        </Link>
      </Button>
    </div>
  );
}

// ── Helper function to fetch test by ID ───────────────────────────────────────────
async function fetchTestById(testId: string): Promise<TestConfig | null> {
  try {
    const { supabase } = await import("@/lib/supabase");
    if (!supabase) return null;
    
    const { data, error } = await supabase
      .from("test_configs")
      .select("*")
      .eq("id", testId)
      .maybeSingle();
    
    if (error || !data) return null;
    
    return {
      id: data.id,
      title: data.title,
      courseCode: data.course_code,
      durationMinutes: data.duration_minutes || 30,
      isActive: Boolean(data.is_active),
      createdAt: data.created_at,
      questions: (data.questions as any[]) || [],
      testType: (data.test_type as any) || "C1",
    };
  } catch {
    return null;
  }
}
