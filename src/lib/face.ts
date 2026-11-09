/**
 * Face detection, matching and liveness, all on the student's phone.
 * Models (~6 MB) are served from /models and cached by the browser.
 */
import type * as FaceApi from "@vladmandic/face-api";

type Api = typeof FaceApi;
let apiPromise: Promise<Api> | null = null;

export function loadFaceApi(): Promise<Api> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = await import("@vladmandic/face-api");
      // GPU (WebGL) is several times faster than CPU on phones
      // (setBackend/ready exist in the bundled TensorFlow.js but aren't in face-api's types)
      const tf = api.tf as unknown as { setBackend?: (b: string) => Promise<boolean>; ready?: () => Promise<void> };
      try { await tf.setBackend?.("webgl"); } catch { /* fall back to default */ }
      await tf.ready?.();
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri("/models"),
        api.nets.faceLandmark68TinyNet.loadFromUri("/models"),
        api.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      // Warm-up: the first run compiles GPU shaders (1–3 s on phones).
      // Do it now, in the background, instead of on the student's first frame.
      try {
        const c = document.createElement("canvas");
        c.width = 160; c.height = 160;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#888"; ctx.fillRect(0, 0, 160, 160);
        for (const inputSize of [224, 320, 416]) {
          await api.detectSingleFace(c, new api.TinyFaceDetectorOptions({ inputSize })).withFaceLandmarks(true);
        }
      } catch { /* warm-up is best effort */ }
      return api;
    })();
    apiPromise.catch(() => { apiPromise = null; });
  }
  return apiPromise;
}

/** Start downloading + warming up the face models early (no-op if already done). */
export function preloadFaceModels(): void {
  if (typeof window === "undefined") return;
  loadFaceApi().catch(() => { /* retried when the scan starts */ });
}

export type FaceFrame = {
  descriptor: Float32Array;
  /** 0..1, how open the eyes are (eye aspect ratio); blinks dip below ~0.2 */
  eyeOpenness: number;
  /** -1 (turned left) .. 0 (facing camera) .. 1 (turned right), from nose vs cheeks */
  yaw: number;
  /** Face box relative to the frame, 0..1 */
  box: { x: number; y: number; w: number; h: number };
};

/**
 * Copies the frame to a small canvas and, if it is dark, brightens it so the
 * detector can still find a face in a dim lecture hall. Also downsizes large
 * frames, which makes detection faster.
 */
let workCanvas: HTMLCanvasElement | null = null;
let probeCanvas: HTMLCanvasElement | null = null;
function prepareFrame(source: HTMLVideoElement | HTMLCanvasElement): HTMLCanvasElement {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const w = Math.min(480, sw);
  const h = Math.round((sh / sw) * w);

  // Average brightness from a tiny 24×18 copy
  probeCanvas ??= document.createElement("canvas");
  probeCanvas.width = 24; probeCanvas.height = 18;
  const pctx = probeCanvas.getContext("2d", { willReadFrequently: true })!;
  pctx.drawImage(source, 0, 0, 24, 18);
  const px = pctx.getImageData(0, 0, 24, 18).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const mean = sum / (px.length / 4);

  workCanvas ??= document.createElement("canvas");
  workCanvas.width = w; workCanvas.height = h;
  const ctx = workCanvas.getContext("2d")!;
  // Aim for a mid-grey average; never darken, cap the boost at 4×
  const gain = mean < 110 ? Math.min(4, 120 / Math.max(mean, 8)) : 1;
  ctx.filter = gain > 1 ? `brightness(${gain.toFixed(2)}) contrast(1.15)` : "none";
  ctx.drawImage(source, 0, 0, w, h);
  ctx.filter = "none";
  return workCanvas;
}

/** Detect the single largest face; returns null when none is found. */
export async function analyseFace(
  source: HTMLVideoElement | HTMLCanvasElement,
  opts: { withDescriptor?: boolean; inputSize?: number } = {},
): Promise<FaceFrame | null> {
  const api = await loadFaceApi();
  // Small input = fast enough for live checks; the descriptor frame uses a
  // larger one for accuracy. A lower threshold copes with dim lecture halls.
  const frame = prepareFrame(source);
  const run = (inputSize: number) => {
    const task = api.detectSingleFace(frame, new api.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.35 })).withFaceLandmarks(true);
    return opts.withDescriptor ? task.withFaceDescriptor() : task;
  };
  // Fast pass first; only if it finds nothing, one more try at a larger size
  const first = opts.inputSize ?? (opts.withDescriptor ? 320 : 224);
  let res = await run(first);
  if (!res && !opts.inputSize && first < 416) res = await run(416);
  if (!res) return null;

  const pts = res.landmarks.positions;
  const ear = (eye: FaceApi.Point[]) => {
    const d = (a: FaceApi.Point, b: FaceApi.Point) => Math.hypot(a.x - b.x, a.y - b.y);
    return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
  };
  const eyeOpenness = (ear(res.landmarks.getLeftEye()) + ear(res.landmarks.getRightEye())) / 2;

  const nose = pts[30];
  const leftCheek = pts[2];
  const rightCheek = pts[14];
  const span = rightCheek.x - leftCheek.x || 1;
  const yaw = ((nose.x - leftCheek.x) / span - 0.5) * 2;

  const w = frame.width;
  const h = frame.height;
  const b = res.detection.box;
  return {
    descriptor: "descriptor" in res ? (res as { descriptor: Float32Array }).descriptor : new Float32Array(0),
    eyeOpenness,
    yaw,
    box: { x: b.x / w, y: b.y / h, w: b.width / w, h: b.height / h },
  };
}

/** Euclidean distance between two descriptors; < 0.5 is the same person. */
export function faceDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 9;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Threshold used across the app: at or below = match. */
export const FACE_MATCH_THRESHOLD = 0.55;

/** Small square JPEG of the face area for the lecturer's list. */
export function cropFacePhoto(source: HTMLVideoElement | HTMLCanvasElement, box: FaceFrame["box"], size = 160): string {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const pad = 0.35;
  const cx = (box.x + box.w / 2) * w;
  const cy = (box.y + box.h / 2) * h;
  const side = Math.max(box.w * w, box.h * h) * (1 + pad * 2);
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  c.getContext("2d")!.drawImage(source, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.75);
}
