import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence, MotionConfig, animate, type Variants } from "framer-motion";
import { AlertTriangle, Check, CheckCircle2, Clock, Home, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTheory, questionMarks, type TestConfig, type TestSubmission } from "@/lib/attendance-store";


const list: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.2 } } };
const item: Variants = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } } };

/** Number that counts up from 0 */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const c = animate(0, to, { duration: 1.2, ease: "easeOut", onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [to]);
  return <>{v}{suffix}</>;
}

/** Small celebration burst for a pass */
function Burst() {
  const dots = Array.from({ length: 18 }, (_, i) => i);
  const colors = ["#12b886", "#f6d860", "#0f1b2d", "#7ee2bf"];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {dots.map((i) => {
        const a = (i / dots.length) * Math.PI * 2;
        const r = 110 + (i % 3) * 22;
        return (
          <motion.span key={i} className="absolute h-2 w-2 rounded-full" style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
            animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r, opacity: 0, scale: 1.2 }}
            transition={{ duration: 1.1, delay: 0.9, ease: "easeOut" }} />
        );
      })}
    </div>
  );
}

/**
 * The student's result after submitting a test: animated score ring, a
 * summary, what was recorded during the test, and an answer review.
 * `correct` holds the right options sent by the server after submitting;
 * without it the review shows the student's answers only.
 */
export function TestResultView({ test, submission, correct }: {
  test: TestConfig;
  submission: TestSubmission;
  correct?: (number | null)[] | null;
}) {
  const pct = submission.total ? Math.round((submission.score / submission.total) * 100) : 0;
  const passed = pct >= 50;
  const state = submission.cheated ? "cheated" : passed ? "passed" : "failed";
  const look = {
    cheated: { ring: "#dc2626", chip: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", icon: AlertTriangle, label: "Test ended: cheating detected" },
    waiting: { ring: "#d97706", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", icon: Clock, label: "Awaiting marking" },
    passed: { ring: "#12b886", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", icon: CheckCircle2, label: "Passed" },
    failed: { ring: "#e11d48", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", icon: XCircle, label: "Below pass mark" },
  }[state];
  const StateIcon = look.icon;

  const keyOf = (i: number) => (correct ? correct[i] : test.questions[i]?.correctIndex);
  const rows = useMemo(() => test.questions.map((q, i) => {
    if (isTheory(q)) return { q, i, kind: "written" as const, ok: false };
    const chosen = submission.answers[i];
    const right = keyOf(i);
    const known = right !== undefined && right !== null;
    return { q, i, kind: chosen == null ? "blank" as const : !known ? "unknown" as const : chosen === right ? "right" as const : "wrong" as const, ok: known && chosen === right };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [test, submission, correct]);
  const shown = rows;

  const R = 70, C = 2 * Math.PI * R;

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-2xl space-y-5">
        {/* Score */}
        <motion.section initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 22 }}
          className="relative overflow-hidden rounded-3xl border bg-card p-6 text-center shadow-soft sm:p-8">
          {state === "passed" && <Burst />}
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{test.courseCode} · {test.title}</p>
          <div className="relative mx-auto mt-5 h-44 w-44">
            <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="currentColor" strokeWidth="12" className="text-secondary" />
              <motion.circle cx="80" cy="80" r={R} fill="none" stroke={look.ring} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - pct / 100) }}
                transition={{ duration: 1.3, ease: [0.2, 0.8, 0.2, 1], delay: 0.2 }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-5xl font-bold tabular-nums"><CountUp to={submission.score} /></span>
              <span className="text-sm text-muted-foreground">out of {submission.total}</span>
            </div>
          </div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-3 font-display text-2xl font-semibold tabular-nums">
            <CountUp to={pct} suffix="%" />
          </motion.p>
          <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.15, type: "spring", stiffness: 300, damping: 18 }}
            className={`mt-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold ${look.chip}`}>
            <StateIcon className="h-4 w-4" /> {look.label}
          </motion.span>
        </motion.section>

        {/* Answer review */}
        <section className="rounded-3xl border bg-card shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <h2 className="font-display text-lg font-semibold">Your answers</h2>
            <p className="text-xs text-muted-foreground">Green is the right answer · red is where you missed it</p>
          </div>
          <motion.ol variants={list} initial="hidden" animate="show" className="divide-y">
            <AnimatePresence>
              {shown.length === 0 && (
                <motion.li variants={item} className="p-8 text-center text-sm text-muted-foreground">Nothing here. Well done.</motion.li>
              )}
              {shown.map(({ q, i, kind }) => {
                const chosen = submission.answers[i];
                const right = keyOf(i);
                const badge = {
                  right: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                  wrong: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
                  blank: "bg-secondary text-muted-foreground",
                  unknown: "bg-secondary text-muted-foreground",
                  written: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
                }[kind];
                const t = submission.theory?.[i];
                return (
                  <motion.li key={q.id} variants={item} className="space-y-3 p-5">
                    <div className="flex items-start gap-3">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge}`}>
                        {kind === "right" ? <Check className="h-3.5 w-3.5" /> : kind === "wrong" ? <X className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <p className="min-w-0 font-medium leading-relaxed">{q.text}</p>
                    </div>
                    {kind === "written" ? (
                      <div className="ml-10 space-y-1.5">
                        <p className="whitespace-pre-wrap rounded-xl border bg-secondary/40 px-3 py-2 text-sm">{t?.text || <span className="italic text-muted-foreground">Not answered</span>}</p>
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                          {t?.marks != null ? `Marked: ${t.marks}/${questionMarks(q)}` : `${questionMarks(q)} marks`}
                        </p>
                      </div>
                    ) : (
                      <div className="ml-10 grid gap-2">
                        {q.options.map((opt, oi) => {
                          const isRight = oi === right;
                          const isMine = oi === chosen;
                          const cls = isRight
                            ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200"
                            : isMine
                              ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200"
                              : "border-border bg-secondary/30 text-muted-foreground";
                          return (
                            <div key={oi} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${cls}`}>
                              <span className="font-bold">{String.fromCharCode(65 + oi)}.</span>
                              <span className="min-w-0 flex-1">{opt}</span>
                              {isRight && <span className="text-xs font-semibold">Correct</span>}
                              {isMine && !isRight && <span className="text-xs font-semibold">Your answer</span>}
                            </div>
                          );
                        })}
                        {kind === "blank" && <p className="text-xs italic text-muted-foreground">You didn't answer this one.</p>}
                      </div>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ol>
        </section>

        <div className="pb-4 text-center">
          <Button asChild variant="outline" className="rounded-full"><Link to="/"><Home className="mr-2 h-4 w-4" /> Back to home</Link></Button>
        </div>
      </div>
    </MotionConfig>
  );
}
