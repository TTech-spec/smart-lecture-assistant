/**
 * Signs a one-time Cloudinary upload for a check-in selfie. The API secret
 * stays on the server (Vercel env CLOUDINARY_API_SECRET). A signature is only
 * given out for an attendance link that is currently open, and it only allows
 * one file with a random name in the attendly-checkins folder.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Is this attendance link real and open right now? */
async function linkIsOpen(token: string): Promise<boolean> {
  const url = env("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anon) return false;
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("get_attendance_link", { p_token: token });
  if (error) return false;
  const row = (Array.isArray(data) ? data[0] : data) as { is_active?: boolean; expires_at?: string } | null;
  return Boolean(row?.is_active && row.expires_at && new Date(row.expires_at).getTime() > Date.now());
}

export const signCloudinaryUpload = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ token: z.string().min(4).max(100) }).parse(d))
  .handler(async ({ data }): Promise<
    | { ok: true; cloudName: string; apiKey: string; timestamp: number; signature: string; folder: string; publicId: string }
    | { ok: false; reason: "not_configured" | "closed" }
  > => {
    const cloudName = env("CLOUDINARY_CLOUD_NAME");
    const apiKey = env("CLOUDINARY_API_KEY");
    const secret = env("CLOUDINARY_API_SECRET");
    if (!cloudName || !apiKey || !secret) return { ok: false, reason: "not_configured" };
    if (!(await linkIsOpen(data.token))) return { ok: false, reason: "closed" };

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `attendly-checkins/${new Date().toISOString().slice(0, 10)}`;
    const publicId = crypto.randomUUID();
    // Cloudinary signature: the upload parameters in alphabetical order, then the secret
    const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
    const signature = await sha1Hex(toSign + secret);
    return { ok: true, cloudName, apiKey, timestamp, signature, folder, publicId };
  });
