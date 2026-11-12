/**
 * "Ask AI" for lecturers: answers questions about attendance records using
 * OpenRouter. The API key stays on the server (Vercel env var "openrouterai",
 * or OPENROUTER_API_KEY) and only a signed-in lecturer can use it.
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

const openRouterKey = () => env("openrouterai", "OPENROUTERAI", "OPENROUTER_API_KEY", "OPENROUTER_KEY");
// Any OpenRouter model id; override with the OPENROUTER_MODEL env var.
const model = () => env("OPENROUTER_MODEL") || "anthropic/claude-haiku-4.5";

/** True only for a signed-in account on the lecturers list. */
async function isLecturer(accessToken: string): Promise<boolean> {
  const url = env("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anon) return false;
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await sb.rpc("is_lecturer");
  return !error && data === true;
}

const Row = z.object({
  name: z.string().max(120), matric: z.string().max(40), dept: z.string().max(120).optional(),
  level: z.string().max(10).optional(), gender: z.string().max(10).optional(), course: z.string().max(40).optional(),
  status: z.string().max(40).optional(), distance: z.number().optional(), at: z.string().max(40),
  classCode: z.string().max(40).optional(), tests: z.string().max(80).optional(),
});

export const askAttendanceAi = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({
    accessToken: z.string().min(10),
    question: z.string().min(2).max(800),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(10).default([]),
    records: z.array(Row).max(3000),
    today: z.string().max(40),
  }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true; answer: string } | { ok: false; message: string }> => {
    const key = openRouterKey();
    if (!key) return { ok: false, message: "AI isn't set up yet: add your OpenRouter key on Vercel as \"openrouterai\" and redeploy." };
    if (!(await isLecturer(data.accessToken))) return { ok: false, message: "Sign in as a lecturer to use Ask AI." };

    // Compact table: one line per check-in (no phone numbers or photos are sent)
    const header = "name|matric|department|level|gender|course|status|distance_m|signed_at|class_code|tests";
    const lines = data.records.map((r) =>
      [r.name, r.matric, r.dept ?? "", r.level ?? "", r.gender ?? "", r.course ?? "", r.status ?? "",
        r.distance ?? "", r.at, r.classCode ?? "", r.tests ?? ""].join("|"));

    const system = [
      "You are the attendance assistant for a lecturer at Ekiti State University (EKSU) using the Attendly app.",
      "Answer only from the attendance records provided. Count carefully; when you give a number, it must match the rows.",
      "Be short and plain: a direct answer first, then a small list or table if useful. Use Nigerian date style (e.g. 12 Nov).",
      "Status meanings: Verified = location, class code and face all passed; Face mismatch, Different phone, Suspicious location, Matric changed = needs the lecturer's review; Not registered = student hasn't registered their face.",
      "If the records can't answer the question, say so and suggest what the lecturer could check.",
      `Today is ${data.today}. There are ${lines.length} check-in rows.`,
    ].join(" ");

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Attendly",
        },
        body: JSON.stringify({
          model: model(),
          max_tokens: 900,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `Attendance records (pipe-separated):\n${header}\n${lines.join("\n")}` },
            { role: "assistant", content: "Got the records. What would you like to know?" },
            ...data.history,
            { role: "user", content: data.question },
          ],
        }),
      });
      const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
      if (!res.ok) {
        const msg = json?.error?.message ?? `status ${res.status}`;
        if (res.status === 401) return { ok: false, message: "OpenRouter rejected the key. Check the \"openrouterai\" value on Vercel." };
        if (res.status === 402) return { ok: false, message: "Your OpenRouter account is out of credit. Top it up at openrouter.ai and try again." };
        if (res.status === 429) return { ok: false, message: "The AI is busy right now. Wait a few seconds and ask again." };
        return { ok: false, message: `The AI couldn't answer (${msg}).` };
      }
      const answer = json?.choices?.[0]?.message?.content?.trim();
      return answer ? { ok: true, answer } : { ok: false, message: "The AI sent an empty answer. Try asking again." };
    } catch {
      return { ok: false, message: "Couldn't reach the AI service. Check your connection and try again." };
    }
  });
