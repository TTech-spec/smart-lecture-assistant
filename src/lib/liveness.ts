/**
 * Liveness checks for the face scan: "open your mouth", then "turn your head".
 *
 * Why not "close your eyes": the small face model the app runs on phones
 * barely sees eyelids move (worse with glasses or in dim halls), so that
 * check often never passed. An open mouth and a turned head are big, clear
 * movements it reads reliably, and a printed photo can't do either.
 *
 * Nothing uses fixed numbers for a face: while the student holds still we
 * learn *their* closed-mouth value and *their* straight-ahead head angle,
 * then look for a clear change from those.
 *
 * It can never hang: if the mouth step isn't seen in 15 s it is swapped for
 * a stricter head check (turn to BOTH sides), and if the head step isn't
 * seen in 25 s the scan stops with tips and a "Start again" button.
 */

export type LivenessStep = "mouth" | "turn" | "done" | "stuck";

export type LivenessFrame = { mouthOpen: number; jawDrop: number; yaw: number };

export type LivenessState = {
  step: LivenessStep;
  baseMouth: number;
  baseJaw: number;
  baseYaw: number;
  mouthOpenSeen: boolean;
  /** Which side(s) the head has been turned to: -1, +1 */
  sidesSeen: number[];
  /** Waiting for the head to come back to the middle after a turn */
  awaitingBack: boolean;
  /** Mouth step was skipped → head must turn to both sides */
  needBothSides: boolean;
  stepStartedAt: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export const MOUTH_OPEN_DELTA = 0.16;   // above their closed-mouth value
export const MOUTH_OPEN_RATIO = 1.35;
export const MOUTH_SHUT_DELTA = 0.09;
export const JAW_OPEN_RATIO = 1.1;    // chin moves down 10% (second way to see an open mouth)
export const JAW_SHUT_RATIO = 1.05;
export const TURN_DELTA = 0.2;
export const BACK_DELTA = 0.12;
export const MOUTH_SKIP_MS = 15_000;
export const TURN_STUCK_MS = 25_000;

/** Start the checks from frames captured while the student held still. */
export function startLiveness(steadyFrames: LivenessFrame[], now: number): LivenessState {
  return {
    step: "mouth",
    baseMouth: median(steadyFrames.map((f) => f.mouthOpen)) || 0.35,
    baseJaw: median(steadyFrames.map((f) => f.jawDrop)) || 1.3,
    baseYaw: median(steadyFrames.map((f) => f.yaw)),
    mouthOpenSeen: false,
    sidesSeen: [],
    awaitingBack: false,
    needBothSides: false,
    stepStartedAt: now,
  };
}

/** Feed one camera frame; returns the next state and the hint to show. */
export function updateLiveness(s: LivenessState, f: LivenessFrame, now: number): { state: LivenessState; hint: string } {
  const st: LivenessState = { ...s, sidesSeen: [...s.sidesSeen] };
  const waited = now - st.stepStartedAt;

  if (st.step === "mouth") {
    const rise = f.mouthOpen - st.baseMouth;
    const jaw = f.jawDrop / st.baseJaw;
    // Seen either way: lips clearly apart, or the chin clearly lower
    const open = (rise > MOUTH_OPEN_DELTA && f.mouthOpen > st.baseMouth * MOUTH_OPEN_RATIO) || jaw > JAW_OPEN_RATIO;
    if (!st.mouthOpenSeen && open) st.mouthOpenSeen = true;
    if (st.mouthOpenSeen && rise < MOUTH_SHUT_DELTA && jaw < JAW_SHUT_RATIO) {
      return { state: { ...st, step: "turn", stepStartedAt: now }, hint: "Now turn your head to one side" };
    }
    if (st.mouthOpenSeen) return { state: st, hint: "Good. Now close your mouth" };
    if (waited > MOUTH_SKIP_MS) {
      // Couldn't read the mouth on this phone: use the stricter head check instead
      return {
        state: { ...st, step: "turn", needBothSides: true, stepStartedAt: now },
        hint: "Let's try another way. Turn your head to the left",
      };
    }
    return { state: st, hint: waited > 6000 ? "Open your mouth wide, like saying “Ahh”" : "Open your mouth wide" };
  }

  if (st.step === "turn") {
    const off = f.yaw - st.baseYaw;
    const side = off > 0 ? 1 : -1;
    if (!st.awaitingBack && Math.abs(off) > TURN_DELTA && !st.sidesSeen.includes(side)) {
      st.sidesSeen.push(side);
      st.awaitingBack = true;
    }
    if (st.awaitingBack && Math.abs(off) < BACK_DELTA) {
      st.awaitingBack = false;
      if (st.sidesSeen.length >= (st.needBothSides ? 2 : 1)) {
        return { state: { ...st, step: "done" }, hint: "All checks passed" };
      }
      // One side done; the clock restarts for the other side
      return { state: { ...st, stepStartedAt: now }, hint: "Good. Now turn to the other side" };
    }
    if (st.awaitingBack) return { state: st, hint: "Good. Now look back at the camera" };
    if (waited > TURN_STUCK_MS) return { state: { ...st, step: "stuck" }, hint: "We couldn't finish the check" };
    if (st.sidesSeen.length === 1) return { state: st, hint: "Now turn your head to the other side" };
    return { state: st, hint: waited > 7000 ? "Turn your head further, until you see your ear" : "Now turn your head to one side" };
  }

  return { state: st, hint: st.step === "stuck" ? "We couldn't finish the check" : "All checks passed" };
}
