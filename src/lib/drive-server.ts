/**
 * Downloads one passport photo from Google Drive for the student import.
 * Browsers can't read Drive files directly (Google blocks it), so the server
 * fetches it. Lecturers only; Google Drive only; 12 MB at most.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const MAX_BYTES = 12 * 1024 * 1024;

type Result =
  | { ok: true; contentType: string; base64: string; name: string }
  | { ok: false; reason: "not_signed_in" | "not_shared" | "too_big" | "not_found" | "error" };

async function isLecturer(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !anon) return false;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await sb.rpc("is_lecturer");
  return !error && data === true;
}

export const fetchDrivePhoto = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({
    accessToken: z.string().min(10),
    fileId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  }).parse(d))
  .handler(async ({ data }): Promise<Result> => {
    if (!(await isLecturer(data.accessToken))) return { ok: false, reason: "not_signed_in" };
    try {
      let res = await fetch(`https://drive.google.com/uc?export=download&id=${data.fileId}`, { redirect: "follow" });
      let type = res.headers.get("content-type") || "";
      // Bigger files get a "can't scan for viruses" page first: follow its confirm link
      if (res.ok && type.includes("text/html")) {
        const html = await res.text();
        const m = html.match(/href="(\/uc\?export=download[^"]+confirm=[^"]+)"/) || html.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/);
        if (/accounts\.google\.com|ServiceLogin|You need access|Request access/i.test(html)) return { ok: false, reason: "not_shared" };
        if (!m) return { ok: false, reason: "not_shared" };
        const next = m[1].startsWith("http") ? m[1].replace(/&amp;/g, "&") : `https://drive.google.com${m[1].replace(/&amp;/g, "&")}`;
        res = await fetch(next.includes("id=") ? next : `${next}${next.includes("?") ? "&" : "?"}id=${data.fileId}&export=download&confirm=t`, { redirect: "follow" });
        type = res.headers.get("content-type") || "";
        if (type.includes("text/html")) return { ok: false, reason: "not_shared" };
      }
      if (res.status === 404) return { ok: false, reason: "not_found" };
      if (!res.ok) return { ok: false, reason: res.status === 403 || res.status === 401 ? "not_shared" : "error" };
      const len = Number(res.headers.get("content-length") || 0);
      if (len > MAX_BYTES) return { ok: false, reason: "too_big" };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) return { ok: false, reason: "too_big" };
      const cd = res.headers.get("content-disposition") || "";
      const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] || cd.match(/filename="([^"]+)"/)?.[1] || "photo"));
      return { ok: true, contentType: type.split(";")[0] || "application/octet-stream", base64: buf.toString("base64"), name };
    } catch {
      return { ok: false, reason: "error" };
    }
  });
