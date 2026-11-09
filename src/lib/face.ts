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
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri("/models"),
        api.nets.faceLandmark68TinyNet.loadFromUri("/models"),
        api.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      return api;
    })();
    apiPromise.catch(() => { apiPromise = null; });
  }
  return apiPromise;
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

/** Detect the single largest face; returns null when none is found. */
export async function analyseFace(
  source: HTMLVideoElement | HTMLCanvasElement,
  opts: { withDescriptor?: boolean } = {},
): Promise<FaceFrame | null> {
  const api = await loadFaceApi();
  const options = new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const task = api.detectSingleFace(source, options).withFaceLandmarks(true);
  const res = opts.withDescriptor ? await task.withFaceDescriptor() : await task;
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

  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
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
