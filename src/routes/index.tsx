import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  MapPin, ShieldCheck, Clock, Sparkles,
  FileQuestion, KeyRound, X, UserPlus, ArrowRight, Check, Menu, Plus, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import studentWoman from "@/assets/creator-woman.jpg";
import studentMan from "@/assets/creator-man.jpg";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence, MotionConfig, animate as animateValue, useInView, type Variants } from "framer-motion";
import * as THREE from "three";
import { toast } from "sonner";
import { getActiveTest, loadSettings, lookupStudentRemote, hasUsedClassCode, markClassCodeUsed, findStudentByMatric, updateStudentClassCode, generateStudentClassCode, getStudentCode, claimClassCode, fetchActiveTestFromSupabase, fetchSettingsFromSupabase, pollActiveTest, type TestConfig, type AdminSettings } from "@/lib/attendance-store";
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

const gridStagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.35 } } };
const card: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: "circOut" } },
};

/** Little label on a photo that pops in, then floats gently. */
function FloatTag({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: [0, -4, 0] }}
      transition={{ opacity: { delay, duration: 0.4 }, y: { delay: delay + 0.4, duration: 3, repeat: Infinity, ease: "easeInOut" } }}
      className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] font-medium sm:bottom-3 sm:left-3 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs">
      {children}
    </motion.span>
  );
}

/** Counts up from 0 once it's on screen. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [n, setN] = useState(to);
  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setN(to); return; }
    const c = animateValue(0, to, { duration: 1.4, delay: 1, ease: "easeOut", onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [inView, to]);
  return <span ref={ref}>{n}</span>;
}

function Landing() {
  const [activeTest, setActiveTest] = useState<TestConfig | null>(() => getActiveTest());
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState("Live GPS check");
  const [settings, setSettings] = useState<AdminSettings>(() => loadSettings());
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeName, setCodeName] = useState("");
  const [codeMatric, setCodeMatric] = useState("");
  const [codeLevel, setCodeLevel] = useState("");
  const [codeRevealed, setCodeRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeChecking, setCodeChecking] = useState(false);
  const [studentCode, setStudentCode] = useState("");
  const CODE_AUTO_CLOSE_SECONDS = 180;
  const [codeSecondsLeft, setCodeSecondsLeft] = useState(CODE_AUTO_CLOSE_SECONDS);

  useEffect(() => {
    const syncTests = () => setActiveTest(getActiveTest());
    const syncSettings = () => setSettings(loadSettings());
    window.addEventListener("att:tests", syncTests);
    window.addEventListener("att:settings", syncSettings);
    window.addEventListener("storage", () => { syncTests(); syncSettings(); });

    // Fetch from Supabase immediately so students on any device see the live test state
    fetchActiveTestFromSupabase().then((t) => { if (t !== undefined) setActiveTest(t); });

    // Poll settings so the "Get class code" button appears/disappears as the
    // lecturer activates/deactivates the class code on their own device.
    const pollSettings = async () => {
      const remote = await fetchSettingsFromSupabase();
      if (remote) {
        setSettings((current) => {
          const remoteStr = JSON.stringify(remote);
          return JSON.stringify(current) === remoteStr ? current : remote;
        });
      }
    };
    pollSettings();

    // Poll every 15 s so the buttons appear/disappear as the lecturer activates/deactivates
    const pollInterval = setInterval(() => {
      pollActiveTest().then((t) => setActiveTest(t));
      pollSettings();
    }, 15_000);

    return () => {
      window.removeEventListener("att:tests", syncTests);
      window.removeEventListener("att:settings", syncSettings);
      clearInterval(pollInterval);
    };
  }, []);

  // Give students a countdown window to copy/write down their class code before
  // the modal auto-closes — otherwise the code could disappear before they're ready.
  useEffect(() => {
    if (!codeRevealed) return;
    setCodeSecondsLeft(CODE_AUTO_CLOSE_SECONDS);
    const tick = setInterval(() => {
      setCodeSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          closeCodeModal();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeRevealed]);

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
      const r = await claimClassCode(codeMatric, codeName, codeLevel);
      if (r.ok) {
        setStudentCode(r.code);
        setCodeRevealed(true);
        toast.success(r.existing ? "Here's your class code again." : "Your personal class code is ready.");
        return;
      }
      const messages: Record<string, string> = {
        invalid: "Enter your matric number and full name.",
        not_signed: "We couldn't find an attendance record for that matric number. Sign attendance first, then get your code.",
        name_mismatch: "That name doesn't match the one on your attendance record. Use the same name you signed in with.",
        level_mismatch: "That level doesn't match your attendance record. Choose the level you signed in with.",
        disabled: "Your lecturer hasn't switched class codes on yet. Try again when they do.",
        not_configured: "Class codes aren't switched on yet. Please let your lecturer know.",
        offline: "We couldn't reach the server. Check your internet connection and try again.",
      };
      toast.error(messages[r.reason] ?? messages.offline);
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

  const features = ["Live GPS check", "Face match", "Class code", "Live selfie", "Study materials"];
  const featureText: Record<string, string> = {
    "Live GPS check": "Students sign only inside the lecturer's pinned radius",
    "Face match": "Each check-in is matched to the face scanned at registration",
    "Class code": "A code on the projector changes every 30 seconds",
    "Live selfie": "A fresh photo with time and place, no gallery uploads",
    "Study materials": "Course files, with paid ones unlocked after a confirmed payment",
  };
  const scrollTo = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); setMenuOpen(false); };

  return (
    <MotionConfig reducedMotion="user"><div className="flex min-h-[100svh] flex-col bg-background lg:h-[100svh] lg:overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col bg-background">
        <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="relative z-10 flex items-center justify-between gap-6 px-6 pb-3 pt-6 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:px-14">
          <Link to="/" className="flex items-center gap-2.5 font-display text-xl font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"><MapPin className="h-4 w-4" /></span>
            Attendly
          </Link>
          <nav className={`${menuOpen ? "flex" : "hidden"} absolute inset-x-4 top-full flex-col gap-1 rounded-2xl border bg-background p-3 shadow-soft lg:static lg:flex lg:flex-row lg:justify-center lg:gap-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}>
            {[["how", "How it works"], ["features", "Features"]].map(([id, label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="px-2 py-2 text-left text-sm hover:opacity-60">{label}</button>
            ))}
            <Link to="/register" className="px-2 py-2 text-sm hover:opacity-60">Register</Link>
            <Link to="/me" className="px-2 py-2 text-sm hover:opacity-60">My attendance</Link>
            <Link to="/materials" className="px-2 py-2 text-sm hover:opacity-60">Materials</Link>
          </nav>
          <div className="flex items-center justify-end gap-2">
            <Button asChild className="hidden rounded-full bg-foreground text-background hover:bg-foreground/85 sm:inline-flex"><Link to="/attendance">Sign attendance</Link></Button>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </motion.header>

        <main className="grid min-h-0 flex-1 items-center gap-8 px-5 pb-8 pt-2 sm:px-6 lg:gap-10 lg:grid-cols-[0.83fr_1.17fr] lg:gap-14 lg:px-14 lg:pb-8">
          <section>
            <motion.p custom={0} variants={hero} initial="hidden" animate="show" className="mb-4 flex items-center gap-2 text-[11px] font-bold tracking-widest text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> EKSU · GPS-VERIFIED ATTENDANCE
            </motion.p>
            <motion.h1 custom={0.1} variants={hero} initial="hidden" animate="show" className="font-display text-[40px] font-bold leading-[0.99] tracking-tight sm:text-6xl xl:text-7xl lg:[@media(max-height:760px)]:text-5xl lg:[@media(max-height:600px)]:text-4xl">
              Attendance<br />that can't<br />be faked{" "}
              <span className="inline-flex h-9 w-9 -translate-y-1 items-center justify-center rounded-full bg-accent align-middle"><ShieldCheck className="h-5 w-5 text-primary" /></span>
            </motion.h1>
            <motion.p custom={0.2} variants={hero} initial="hidden" animate="show" className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground lg:[@media(max-height:600px)]:mt-3 lg:[@media(max-height:600px)]:text-xs">
              Students sign in only when they are really in the lecture hall: live location, a face match and a class code that keeps changing. No more signing from the hostel.
            </motion.p>
            <motion.div custom={0.3} variants={hero} initial="hidden" animate="show" className="mt-6 flex flex-wrap gap-2.5">
              <Button asChild size="lg" className="rounded-full bg-foreground text-background hover:bg-foreground/85">
                <Link to="/attendance">Sign my attendance <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full"><Link to="/register"><UserPlus className="mr-1 h-4 w-4" /> Register once</Link></Button>
              {settings.classCodeEnabled && settings.classCode && (
                <Button size="lg" variant="outline" className="rounded-full border-amber-400 text-amber-600" onClick={() => setCodeOpen(true)}>
                  <KeyRound className="mr-1 h-4 w-4" /> Get class code
                </Button>
              )}
              {activeTest && (
                <Button asChild size="lg" variant="outline" className="rounded-full border-primary text-primary"><Link to="/test"><FileQuestion className="mr-1 h-4 w-4" /> Take test</Link></Button>
              )}
            </motion.div>
            {activeTest && (
              <p className="mt-3 text-sm text-muted-foreground"><span className="font-medium text-primary">{activeTest.courseCode}</span> — {activeTest.title} is now open</p>
            )}

            <motion.div custom={0.4} variants={hero} initial="hidden" animate="show" id="features" className="mt-6 flex flex-wrap gap-2 lg:[@media(max-height:700px)]:hidden">
              {features.map((f) => (
                <button key={f} onClick={() => setActiveFeature(f)} aria-pressed={activeFeature === f}
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${activeFeature === f ? "border-foreground bg-foreground text-background" : "hover:bg-secondary"}`}>
                  {f} <Plus className="h-3 w-3" />
                </button>
              ))}
            </motion.div>
            <div className="mt-3 h-5 overflow-hidden lg:[@media(max-height:700px)]:hidden">
              <AnimatePresence mode="wait">
                <motion.p key={activeFeature} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.25 }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-primary" /> {featureText[activeFeature]}</motion.p>
              </AnimatePresence>
            </div>
          </section>

          <motion.section id="how" variants={gridStagger} initial="hidden" animate="show"
            className="grid grid-cols-2 gap-3 lg:h-full lg:max-h-[720px] lg:min-h-0 lg:grid-rows-2 xl:gap-4">
            <motion.div variants={card} whileHover={{ y: -4 }} className="relative aspect-square min-h-0 overflow-hidden rounded-3xl bg-accent lg:aspect-auto">
              <motion.img src={studentWoman} alt="A student signing attendance on her phone" className="h-full w-full object-cover" width={1024} height={1024} fetchPriority="high"
                initial={{ scale: 1.12 }} animate={{ scale: 1 }} transition={{ duration: 1.4, ease: "easeOut" }} />
              <FloatTag delay={1}><MapPin className="h-3.5 w-3.5 text-primary" /> Inside the hall</FloatTag>
            </motion.div>
            <motion.div variants={card} whileHover={{ y: -4 }} className="flex aspect-square min-h-0 flex-col rounded-3xl bg-primary p-3.5 text-primary-foreground sm:p-6 lg:aspect-auto">
              <div className="flex items-center justify-between gap-1 text-xs font-semibold sm:text-sm"><span className="whitespace-nowrap">CSC 401</span><span className="whitespace-nowrap rounded-full bg-background/90 px-2 py-0.5 text-[10px] tabular-nums text-foreground sm:text-xs"><CountUp to={42} /> signed</span></div>
              <div className="mt-auto flex h-1/2 items-end gap-1 sm:gap-2" aria-hidden="true">
                {[36, 54, 47, 69, 57, 79].map((h, i) => (
                  <motion.span key={i} className="flex-1 origin-bottom rounded-t-md bg-background/80 sm:rounded-t-lg" style={{ height: `${h}%` }}
                    initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.9 + i * 0.08, duration: 0.6, ease: "circOut" }} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[9px] opacity-80 sm:text-[10px]" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
              <span className="mt-1.5 text-[9px] font-bold tracking-widest sm:mt-2 sm:text-[10px]">CLASS TURNOUT THIS WEEK</span>
            </motion.div>
            <motion.div variants={card} whileHover={{ y: -4 }} className="flex aspect-square min-h-0 flex-col justify-between rounded-3xl bg-secondary p-3.5 sm:p-6 lg:aspect-auto">
              <div className="flex -space-x-3">
                <img src={studentWoman} alt="" className="h-9 w-9 rounded-full border-2 border-background object-cover sm:h-12 sm:w-12" loading="lazy" />
                <img src={studentMan} alt="" className="h-9 w-9 rounded-full border-2 border-background object-cover sm:h-12 sm:w-12" loading="lazy" />
                <motion.span className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground sm:h-12 sm:w-12"
                  animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}>
                  <ScanFace className="h-4 w-4 sm:h-5 sm:w-5" />
                  <motion.span className="absolute inset-x-1.5 h-0.5 rounded bg-background/90" initial={{ top: "25%" }} animate={{ top: ["25%", "75%", "25%"] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 1.2 }} />
                </motion.span>
              </div>
              <div>
                <p className="font-display text-base font-bold leading-tight sm:text-2xl">Face matched,<br />not just named</p>
                <p className="mt-1 text-[9px] font-bold tracking-widest text-muted-foreground sm:text-[10px]">NO PROXY SIGN-INS</p>
              </div>
            </motion.div>
            <motion.div variants={card} whileHover={{ y: -4 }} className="relative aspect-square min-h-0 overflow-hidden rounded-3xl bg-accent lg:aspect-auto">
              <motion.img src={studentMan} alt="A student checking in for his lecture" className="h-full w-full object-cover" width={1024} height={1024} loading="lazy"
                initial={{ scale: 1.12 }} animate={{ scale: 1 }} transition={{ duration: 1.4, ease: "easeOut", delay: 0.2 }} />
              <FloatTag delay={1.3}><Clock className="h-3.5 w-3.5 text-primary" /> Signed at 08:02</FloatTag>
            </motion.div>
          </motion.section>
        </main>
      </div>


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
                    <Button onClick={closeCodeModal} className="w-full">Continue</Button>
                    <p className="text-xs text-muted-foreground">
                      Make sure to copy or write down your code — this closes automatically in{" "}
                      <span className="font-medium text-foreground">
                        {Math.floor(codeSecondsLeft / 60)}:{String(codeSecondsLeft % 60).padStart(2, "0")}
                      </span>
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div></MotionConfig>
  );
}
