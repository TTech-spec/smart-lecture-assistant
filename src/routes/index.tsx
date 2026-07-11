import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  MapPin, ShieldCheck, Clock, Sparkles,
  GraduationCap, FileQuestion, KeyRound, X, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import * as THREE from "three";
import { toast } from "sonner";
import { getActiveTest, loadSettings, hasUsedClassCode, markClassCodeUsed, findStudentByMatric, updateStudentClassCode, generateStudentClassCode, getStudentCode, type TestConfig, type AdminSettings } from "@/lib/attendance-store";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Attendly — GPS-verified class attendance" },
      {
        name: "description",
        content:
          "Stop proxy attendance. Students sign in only when they are physically in class, on one device per day.",
      },
    ],
  }),
  component: Landing,
});

// ── Three.js particle network background ──────────────────────────────────────
function ParticleNetwork() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 18;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const COUNT = 90;
    const positions = new Float32Array(COUNT * 3);
    const vels = new Float32Array(COUNT * 2);

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
      vels[i * 2]     = (Math.random() - 0.5) * 0.005;
      vels[i * 2 + 1] = (Math.random() - 0.5) * 0.005;
    }

    const ptGeo = new THREE.BufferGeometry();
    const ptAttr = new THREE.BufferAttribute(positions, 3);
    ptAttr.setUsage(THREE.DynamicDrawUsage);
    ptGeo.setAttribute("position", ptAttr);

    const ptMat = new THREE.PointsMaterial({ size: 0.22, color: 0x34d399, transparent: true, opacity: 0.75, sizeAttenuation: true });
    scene.add(new THREE.Points(ptGeo, ptMat));

    const maxPairs = (COUNT * (COUNT - 1)) / 2;
    const lineBuf = new Float32Array(maxPairs * 6);
    const lineGeo = new THREE.BufferGeometry();
    const lineAttr = new THREE.BufferAttribute(lineBuf, 3);
    lineAttr.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute("position", lineAttr);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.1 });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    const THRESH_SQ = 5.5 * 5.5;

    function tick() {
      for (let i = 0; i < COUNT; i++) {
        positions[i * 3]     += vels[i * 2];
        positions[i * 3 + 1] += vels[i * 2 + 1];
        if (Math.abs(positions[i * 3])     > 15) vels[i * 2]     *= -1;
        if (Math.abs(positions[i * 3 + 1]) > 9)  vels[i * 2 + 1] *= -1;
      }
      ptAttr.needsUpdate = true;

      let idx = 0;
      for (let i = 0; i < COUNT; i++) {
        for (let j = i + 1; j < COUNT; j++) {
          const dx = positions[i * 3] - positions[j * 3];
          const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
          if (dx * dx + dy * dy < THRESH_SQ) {
            lineBuf[idx++] = positions[i * 3];     lineBuf[idx++] = positions[i * 3 + 1]; lineBuf[idx++] = positions[i * 3 + 2];
            lineBuf[idx++] = positions[j * 3];     lineBuf[idx++] = positions[j * 3 + 1]; lineBuf[idx++] = positions[j * 3 + 2];
          }
        }
      }
      lineAttr.needsUpdate = true;
      lineGeo.setDrawRange(0, idx / 3);
      renderer.render(scene, camera);
    }

    let id: number;
    function loop() { id = requestAnimationFrame(loop); tick(); }
    loop();

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
      ptGeo.dispose(); ptMat.dispose(); lineGeo.dispose(); lineMat.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={mountRef} className="fixed inset-0 -z-10 pointer-events-none" style={{ opacity: 0.45 }} aria-hidden="true" />
  );
}

// ── Animation variants ─────────────────────────────────────────────────────────
const hero: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: (d: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: d, duration: 0.55, ease: "circOut" as const },
  }),
};

const featureContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.6 } },
};

const featureItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "circOut" as const } },
};

function Feature({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <motion.div
      variants={featureItem}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="rounded-2xl border bg-card p-6 shadow-soft cursor-default"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </motion.div>
  );
}

function Landing() {
  const [activeTest, setActiveTest] = useState<TestConfig | null>(() => getActiveTest());
  const [settings, setSettings] = useState<AdminSettings>(() => loadSettings());
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeName, setCodeName] = useState("");
  const [codeMatric, setCodeMatric] = useState("");
  const [codeLevel, setCodeLevel] = useState("");
  const [codeRevealed, setCodeRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeChecking, setCodeChecking] = useState(false);
  const [studentCode, setStudentCode] = useState("");

  useEffect(() => {
    const syncTests = () => setActiveTest(getActiveTest());
    const syncSettings = () => setSettings(loadSettings());
    window.addEventListener("att:tests", syncTests);
    window.addEventListener("att:settings", syncSettings);
    window.addEventListener("storage", () => { syncTests(); syncSettings(); });
    return () => {
      window.removeEventListener("att:tests", syncTests);
      window.removeEventListener("att:settings", syncSettings);
    };
  }, []);

  function closeCodeModal() {
    setCodeOpen(false);
    setCodeName(""); setCodeMatric(""); setCodeLevel(""); setCodeRevealed(false); setCopied(false); setStudentCode("");
  }

  async function requestCode(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!codeName.trim()) { toast.error("Enter your full name."); return; }
    if (!codeMatric.trim()) { toast.error("Enter your matric number."); return; }
    if (!codeLevel.trim()) { toast.error("Select your level."); return; }

    setCodeChecking(true);
    try {
      // First check localStorage (same device that submitted attendance)
      let student = findStudentByMatric(codeMatric);

      // If not found locally, fall back to Supabase (different device or cleared storage)
      if (!student && supabase) {
        const { data } = await supabase
          .from("attendance_records")
          .select("full_name, level, matric_number")
          .ilike("matric_number", codeMatric.trim())
          .limit(1)
          .maybeSingle();
        if (data) {
          student = {
            id: "", fullName: data.full_name, matricNumber: data.matric_number,
            department: "", phone: "", courseCode: "", topic: "", level: data.level || "",
            gender: "other", submittedAt: "", dayKey: "", deviceId: "",
            distanceMeters: 0, lat: 0, lng: 0, sessionId: "", customFields: {},
          };
        }
      }

      if (!student) {
        toast.error("You must mark attendance first before you can get a class code. Please sign attendance and try again.");
        return;
      }

      // Verify the name and level match the attendance record
      if (student.fullName.toLowerCase() !== codeName.trim().toLowerCase()) {
        toast.error("The name you entered doesn't match your attendance record. Please use the same name you used to sign attendance.");
        return;
      }

      if (student.level !== codeLevel) {
        toast.error("The level you entered doesn't match your attendance record. Please use the same level you used to sign attendance.");
        return;
      }

      if (hasUsedClassCode(codeMatric)) {
        // Already assigned — just show them their code again
        const existing = getStudentCode(codeMatric);
        if (existing) {
          setStudentCode(existing);
          setCodeRevealed(true);
          toast.success("Here is your previously assigned class code.");
        } else {
          toast.error("You have already received your class code on another device. Contact your lecturer if you need it again.");
        }
        return;
      }

      if (settings.classCodeLevel && codeLevel !== settings.classCodeLevel) {
        toast.error(`This class code is for ${settings.classCodeLevel} Level students only.`);
        return;
      }

      // Generate a unique code for this student based on the global code prefix
      const uniqueCode = generateStudentClassCode(codeMatric, settings.classCode, settings.classCodeFormat);

      // Update the student's attendance record with their unique code
      updateStudentClassCode(codeMatric, uniqueCode);
      markClassCodeUsed(codeMatric);
      setStudentCode(uniqueCode);
      setCodeRevealed(true);
      toast.success("Your personal class code has been assigned!");
    } finally {
      setCodeChecking(false);
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(studentCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-hero">
      <ParticleNetwork />

      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6"
      >
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <MapPin className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Attendly</span>
        </Link>
        <nav>
          <Button asChild><Link to="/attendance">Sign attendance</Link></Button>
        </nav>
      </motion.header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24 pt-10">
        <section className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <motion.span custom={0} variants={hero} initial="hidden" animate="show"
              className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              GPS-verified · One device per day
            </motion.span>

            <motion.h1 custom={0.1} variants={hero} initial="hidden" animate="show"
              className="mt-5 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
              Attendance that{" "}
              <span className="bg-gradient-primary bg-clip-text text-transparent">can't be faked</span>.
            </motion.h1>

            <motion.p custom={0.2} variants={hero} initial="hidden" animate="show"
              className="mt-5 max-w-lg text-lg text-muted-foreground">
              No more signing in from the hostel. Students can only mark attendance when they're
              physically inside the lecturer's class radius — and only once per device, per day.
            </motion.p>

            <motion.div custom={0.32} variants={hero} initial="hidden" animate="show"
              className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/attendance"><GraduationCap className="mr-2 h-4 w-4" /> Sign my attendance</Link>
              </Button>

              <Button asChild size="lg" variant="outline">
                <Link to="/materials"><BookOpen className="mr-2 h-4 w-4" /> Study Materials</Link>
              </Button>

              {settings.classCodeEnabled && settings.classCode && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.08, duration: 0.3 }}>
                  <Button size="lg" variant="outline"
                    className="border-amber-400 text-amber-600 hover:bg-amber-50 dark:border-amber-500 dark:text-amber-400 dark:hover:bg-amber-900/20"
                    onClick={() => setCodeOpen(true)}>
                    <KeyRound className="mr-2 h-4 w-4" /> Get class code
                  </Button>
                </motion.div>
              )}

              {activeTest && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1, duration: 0.3 }}>
                  <Button asChild size="lg" variant="outline" className="border-primary text-primary hover:bg-primary/10">
                    <Link to="/test"><FileQuestion className="mr-2 h-4 w-4" /> Take test</Link>
                  </Button>
                </motion.div>
              )}
            </motion.div>

            {activeTest && (
              <motion.div custom={0.42} variants={hero} initial="hidden" animate="show" className="mt-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  <span className="font-medium text-primary">{activeTest.courseCode}</span>
                  <span className="text-muted-foreground">— {activeTest.title} is now open</span>
                </div>
              </motion.div>
            )}
          </div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25, duration: 0.6, ease: "circOut" }}
            className="relative"
          >
            <div className="absolute -inset-4 rounded-3xl bg-gradient-primary opacity-20 blur-2xl" />
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="relative rounded-3xl border bg-card p-6 shadow-soft"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Live session</p>
                  <p className="mt-1 font-semibold">CSC 401 — Distributed Systems</p>
                </div>
                <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium" style={{ color: "var(--color-success)" }}>
                  Open
                </span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                {[{ value: "42", label: "Signed in" }, { value: "100m", label: "Radius" }, { value: "08:14", label: "Closes in" }].map((s) => (
                  <div key={s.label} className="rounded-xl bg-secondary p-3">
                    <p className="text-2xl font-semibold">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                <MapPin className="mr-2 inline h-4 w-4" />
                Lecturer pinned <span className="font-medium text-foreground">Hall B, Block 3</span> as today's location.
              </div>
            </motion.div>
          </motion.div>
        </section>

        <motion.section variants={featureContainer} initial="hidden" animate="show" className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={MapPin} title="GPS check" desc="Student location must match the lecturer's pin within the chosen radius." />
          <Feature icon={ShieldCheck} title="One device per day" desc="Each device can only submit attendance once per day, per course." />
          <Feature icon={Clock} title="Timed window" desc="Lecturer sets how long the form stays open. After that, it auto-locks." />
          <Feature icon={Sparkles} title="AI assistant" desc="Ask the dashboard things like 'who from Computer Science signed today?'" />
        </motion.section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="flex items-center justify-center border-t pt-6">
          <Link to="/admin" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            Lecturer login
          </Link>
        </div>
      </footer>

      {/* Class code modal */}
      <AnimatePresence>
        {codeOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) closeCodeModal(); }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ duration: 0.25, ease: "circOut" }}
              className="relative w-full max-w-sm rounded-2xl border bg-card p-6 shadow-soft"
            >
              <button onClick={closeCodeModal}
                className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <X className="h-4 w-4" />
              </button>

              <AnimatePresence mode="wait">
                {!codeRevealed ? (
                  <motion.div key="form" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
                    <div className="mb-5 flex flex-col items-center gap-2 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                        <KeyRound className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                      </div>
                      <h2 className="text-lg font-semibold">Get your class code</h2>
                      <p className="text-sm text-muted-foreground">Enter your details to receive today's class code.</p>
                    </div>
                    <form onSubmit={requestCode} className="space-y-3">
                      <Input value={codeName} onChange={(e) => setCodeName(e.target.value)} placeholder="Full name" autoFocus />
                      <Input value={codeMatric} onChange={(e) => setCodeMatric(e.target.value)} placeholder="Matric number (e.g. 2021/12345)" />
                      <select value={codeLevel} onChange={(e) => setCodeLevel(e.target.value)}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                        <option value="">Select your level</option>
                        {["100","200","300","400","500","600"].map((l) => <option key={l} value={l}>{l} Level</option>)}
                      </select>
                      <Button type="submit" className="w-full" disabled={codeChecking || !codeName.trim() || !codeMatric.trim() || !codeLevel}>
                        {codeChecking ? "Checking…" : "Get class code"}
                      </Button>
                    </form>
                  </motion.div>
                ) : (
                  <motion.div key="reveal" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.22 }}
                    className="flex flex-col items-center gap-4 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/30">
                      <KeyRound className="h-6 w-6 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Hello, <span className="font-medium text-foreground">{codeName}</span></p>
                      <p className="mt-0.5 text-sm text-muted-foreground">Your class code for today is:</p>
                    </div>
                    <div className="w-full rounded-2xl border-2 border-primary/30 bg-primary/5 py-5">
                      <p className="font-mono text-3xl font-bold tracking-widest text-primary">{studentCode}</p>
                      <p className="mt-1 text-xs text-muted-foreground uppercase tracking-wider">
                        Your personal code · {codeLevel} Level
                      </p>
                    </div>
                    <button onClick={copyCode} className="w-full rounded-xl border bg-secondary py-2 text-sm font-medium hover:bg-secondary/80 transition-colors">
                      {copied ? "✓ Copied!" : "Copy code"}
                    </button>
                    <button onClick={closeCodeModal} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Close</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
