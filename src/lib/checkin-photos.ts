/**
 * Upload a check-in selfie (and a small thumbnail) to Supabase Storage so the
 * attendance record only stores two short links (photo-storage.sql).
 * Returns null if Storage isn't set up or the upload fails; callers then fall
 * back to keeping the photo inside the record as before.
 */
import { supabase } from "@/lib/supabase";

const BUCKET = "checkin-photos";
const MAX_BYTES = 400 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toJpeg(img: HTMLImageElement, maxW: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", quality));
}

export async function uploadCheckinPhoto(dataUrl: string): Promise<{ photo: string; photoThumb: string } | null> {
  if (!supabase || !dataUrl.startsWith("data:image")) return null;
  try {
    const img = await loadImage(dataUrl);
    let full = await toJpeg(img, 1280, 0.72);
    if (full && full.size > MAX_BYTES) full = await toJpeg(img, 960, 0.6);
    const thumb = await toJpeg(img, 200, 0.7);
    if (!full || !thumb || full.size > MAX_BYTES) return null;

    const id = crypto.randomUUID();
    const day = new Date().toISOString().slice(0, 10);
    const fullPath = `checkins/${day}/${id}.jpg`;
    const thumbPath = `checkins/${day}/${id}_t.jpg`;
    const store = supabase.storage.from(BUCKET);
    const [a, b] = await Promise.all([
      store.upload(fullPath, full, { contentType: "image/jpeg", upsert: false }),
      store.upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: false }),
    ]);
    if (a.error || b.error) return null;
    return { photo: store.getPublicUrl(fullPath).data.publicUrl, photoThumb: store.getPublicUrl(thumbPath).data.publicUrl };
  } catch {
    return null;
  }
}

/** Wait for an upload, but never longer than `ms` (slow network → keep the inline photo). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}
