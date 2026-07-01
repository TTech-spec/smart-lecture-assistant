import { motion, AnimatePresence } from "framer-motion";

// ── Icon ─────────────────────────────────────────────────────────────────────

const ICON = 160;

const ROWS = [
  { y: 0.28, hasCheck: false, w: 0.55 },
  { y: 0.44, hasCheck: true,  w: 0.72 },
  { y: 0.60, hasCheck: true,  w: 0.60 },
  { y: 0.76, hasCheck: false, w: 0.45 },
] as const;

function AttendlyIcon() {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 280, damping: 20, delay: 0 }}
      style={{
        width: ICON, height: ICON,
        borderRadius: ICON * 0.22,
        background: "linear-gradient(145deg, #2ecc71 0%, #1a7a4a 100%)",
        boxShadow: "0 24px 60px rgba(26,122,74,0.45)",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {ROWS.map((row, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.45 + i * 0.1, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: "absolute",
            left: ICON * 0.13,
            top: ICON * row.y - ICON * 0.05,
            display: "flex",
            alignItems: "center",
            gap: ICON * 0.07,
          }}
        >
          <div style={{
            width: ICON * 0.1, height: ICON * 0.1,
            borderRadius: "50%",
            background: row.hasCheck ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            {row.hasCheck && (
              <svg width={ICON * 0.065} height={ICON * 0.065} viewBox="0 0 10 10">
                <polyline
                  points="2,5 4,7.5 8,3"
                  stroke="#1a7a4a"
                  strokeWidth="1.8"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: ICON * row.w }}
            transition={{ delay: 0.5 + i * 0.1, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            style={{
              height: ICON * 0.075,
              borderRadius: ICON * 0.04,
              background: row.hasCheck ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
              overflow: "hidden",
            }}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}

// ── Wordmark ──────────────────────────────────────────────────────────────────

const SERIF = "'Georgia', 'Times New Roman', serif";

function Wordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", lineHeight: 1 }}>
        <motion.span
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          style={{
            fontFamily: SERIF,
            fontSize: "clamp(52px, 5.5vw, 80px)",
            fontWeight: 700,
            color: "#1a4a2e",
            letterSpacing: "-2px",
            display: "inline-block",
          }}
        >
          attend
        </motion.span>
        <motion.span
          initial={{ opacity: 0, y: -24, scale: 0.6 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.65, type: "spring", stiffness: 260, damping: 18 }}
          style={{
            fontFamily: SERIF,
            fontSize: "clamp(52px, 5.5vw, 80px)",
            fontWeight: 700,
            color: "#2ecc71",
            letterSpacing: "-2px",
            display: "inline-block",
            transformOrigin: "bottom left",
          }}
        >
          ly
        </motion.span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.4 }}
        style={{
          fontFamily: SERIF,
          fontSize: "clamp(13px, 1.4vw, 18px)",
          fontWeight: 400,
          letterSpacing: "6px",
          color: "#2ecc71",
          marginTop: 6,
        }}
      >
        CLASS ATTENDANCE
      </motion.div>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 1.1, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        style={{
          height: 1.5,
          background: "linear-gradient(90deg, #2ecc71, #1a7a4a)",
          marginTop: 10,
          borderRadius: 2,
          transformOrigin: "left",
        }}
      />
    </div>
  );
}

// ── Loading dots ───────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.4, duration: 0.4 }}
      style={{ display: "flex", gap: 10, alignItems: "center" }}
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{ scale: [0.5, 1, 0.5], opacity: [0.3, 1, 0.3] }}
          transition={{
            repeat: Infinity,
            duration: 1.0,
            delay: i * 0.22,
            ease: "easeInOut",
          }}
          style={{
            width: 10, height: 10,
            borderRadius: "50%",
            background: "#2ecc71",
          }}
        />
      ))}
    </motion.div>
  );
}

// ── LoadingScreen ─────────────────────────────────────────────────────────────

export function LoadingScreen() {
  return (
    <motion.div
      key="loading-screen"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
      style={{
        position: "fixed",
        inset: 0,
        background: "#f7faf8",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 60,
        zIndex: 9999,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 55% 45% at 50% 48%, rgba(46,204,113,0.12) 0%, rgba(26,122,74,0.05) 55%, transparent 80%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "clamp(28px, 4vw, 56px)",
          flexWrap: "wrap",
          justifyContent: "center",
          padding: "0 24px",
        }}
      >
        <AttendlyIcon />
        <Wordmark />
      </div>

      <div style={{ position: "relative" }}>
        <LoadingDots />
      </div>
    </motion.div>
  );
}

// ── Wrapper with AnimatePresence ──────────────────────────────────────────────

export function AppLoadingScreen({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && <LoadingScreen />}
    </AnimatePresence>
  );
}
