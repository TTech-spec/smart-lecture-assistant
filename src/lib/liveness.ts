/**
 * Liveness checks for the face scan: "close your eyes", then "turn your head".
 *
 * Every face is different, so nothing here uses fixed numbers. While the
 * student holds still we learn *their* open-eye value and *their* straight-
 * ahead head angle, then look for a clear change from those:
 *  - eyes: closed = below 72% of their open value, open again = above 88%;
 *  - head: turned = 0.25 away from their straight-ahead angle (either side),
 *          back = within 0.15 of it.
 * "Close your eyes for a second" is used instead of "blink" because a blink
 * (~150 ms) is shorter than the gap between camera checks on most phones.
 */

export type LivenessStep = "eyes" | "turn" | "done";

export type LivenessFrame = { eyeOpenness: number; yaw: number };

export type LivenessState = {
  step: LivenessStep;
  baseEyes: number;
  baseYaw: number;
  eyesClosedSeen: boolean;
  turnSeen: boolean;
  /** Frames seen in the current step, to give gentler hints when it takes long */
  framesInStep: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Start the checks from frames captured while the student held still. */
export function startLiveness(steadyFrames: LivenessFrame[]): LivenessState {
  return {
    step: "eyes",
    baseEyes: median(steadyFrames.map((f) => f.eyeOpenness)) || 0.3,
    baseYaw: median(steadyFrames.map((f) => f.yaw)),
    eyesClosedSeen: false,
    turnSeen: false,
    framesInStep: 0,
  };
}

export const CLOSED_RATIO = 0.72;
export const OPEN_RATIO = 0.88;
export const TURN_DELTA = 0.25;
export const BACK_DELTA = 0.15;

/** Feed one camera frame; returns the next state and the hint to show. */
export function updateLiveness(s: LivenessState, f: LivenessFrame): { state: LivenessState; hint: string } {
  const st = { ...s, framesInStep: s.framesInStep + 1 };

  if (st.step === "eyes") {
    const ratio = f.eyeOpenness / st.baseEyes;
    if (!st.eyesClosedSeen && ratio < CLOSED_RATIO) st.eyesClosedSeen = true;
    if (st.eyesClosedSeen && ratio > OPEN_RATIO) {
      return { state: { ...st, step: "turn", framesInStep: 0 }, hint: "Now turn your head to one side" };
    }
    if (st.eyesClosedSeen) return { state: st, hint: "Good — now open your eyes" };
    return {
      state: st,
      hint: st.framesInStep > 25 ? "Close your eyes fully for a second, then open them" : "Close your eyes for a second",
    };
  }

  if (st.step === "turn") {
    const delta = Math.abs(f.yaw - st.baseYaw);
    if (!st.turnSeen && delta > TURN_DELTA) st.turnSeen = true;
    if (st.turnSeen && delta < BACK_DELTA) {
      return { state: { ...st, step: "done" }, hint: "All checks passed" };
    }
    if (st.turnSeen) return { state: st, hint: "Now look back at the camera" };
    return {
      state: st,
      hint: st.framesInStep > 25 ? "Turn your head further to the left or right" : "Now turn your head to one side",
    };
  }

  return { state: st, hint: "All checks passed" };
}
