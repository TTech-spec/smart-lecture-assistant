/**
 * Upload a check-in selfie (and a small thumbnail) to Supabase Storage so the
 * attendance record only stores two short links (photo-storage.sql).
 * Returns null if Storage isn't set up or the upload fails; callers then fall
 * back to keeping the photo inside the record as before.
 */
import { supabase } from "@/lib/supabase";
import { signCloudinaryUpload } from "@/lib/cloudinary-server";

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

/**
 * Cloudinary first (signed by our server for an open check-in link); the
 * thumbnail is a Cloudinary transformation of the same file. Falls back to
 * Supabase Storage, then to null (photo stays inside the record).
 */
export async function uploadCheckinPhoto(dataUrl: string, linkToken?: string): Promise<{ photo: string; photoThumb: string } | null> {
  if (!dataUrl.startsWith("data:image")) return null;
  let img: HTMLImageElement;
  try { img = await loadImage(dataUrl); } catch { return null; }
  if (linkToken) {
    const viaCloudinary = await uploadToCloudinary(img, linkToken).catch(() => null);
    if (viaCloudinary) return viaCloudinary;
  }
  return uploadToSupabase(img);
}

async function uploadToCloudinary(img: HTMLImageElement, token: string): Promise<{ photo: string; photoThumb: string } | null> {
  const sig = await signCloudinaryUpload({ data: { token } });
  if (!sig.ok) return null;
  let full = await toJpeg(img, 1280, 0.75);
  if (full && full.size > 900 * 1024) full = await toJpeg(img, 960, 0.6);
  if (!full) return null;
  const form = new FormData();
  form.append("file", full, "selfie.jpg");
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("signature", sig.signature);
  form.append("folder", sig.folder);
  form.append("public_id", sig.publicId);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/image/upload`, { method: "POST", body: form });
  if (!res.ok) return null;
  const json = (await res.json()) as { secure_url?: string };
  const url = json.secure_url;
  if (!url || !url.includes("/image/upload/")) return null;
  // Delivery transformations: auto format/quality, and a small face-centred thumbnail
  return {
    photo: url.replace("/image/upload/", "/image/upload/f_auto,q_auto/"),
    photoThumb: url.replace("/image/upload/", "/image/upload/c_thumb,g_face,w_200,h_200,f_auto,q_auto/"),
  };
}

async function uploadToSupabase(img: HTMLImageElement): Promise<{ photo: string; photoThumb: string } | null> {
  if (!supabase) return null;
  try {
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
