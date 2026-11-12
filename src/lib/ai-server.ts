/**
 * "Ask AI" for lecturers: answers questions about attendance records using
 * OpenRouter. The API key stays on the server (Vercel env var "openrouterai",
 * or OPENROUTER_API_KEY) and only a signed-in lecturer can use it.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AI_APP_GUIDE, AI_PAGES } from "./ai-app-guide";

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
    records: z.array(Row).max(3000).default([]),
    today: z.string().max(40),
    page: z.string().max(80).default("/admin"),
  }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true; answer: string; actions: { path: string; label: string }[] } | { ok: false; message: string }> => {
    const key = openRouterKey();
    if (!key) return { ok: false, message: "AI isn't set up yet: add your OpenRouter key on Vercel as \"openrouterai\" and redeploy." };
    if (!(await isLecturer(data.accessToken))) return { ok: false, message: "Sign in as a lecturer to use Ask AI." };

    // Compact table: one line per check-in (no phone numbers or photos are sent)
    const header = "name|matric|department|level|gender|course|status|distance_m|signed_at|class_code|tests";
    const lines = data.records.map((r) =>
      [r.name, r.matric, r.dept ?? "", r.level ?? "", r.gender ?? "", r.course ?? "", r.status ?? "",
        r.distance ?? "", r.at, r.classCode ?? "", r.tests ?? ""].join("|"));

    const system = [
      "You are Attendly's assistant for a lecturer at Ekiti State University (EKSU). You help in three ways:",
      "(1) explain how to use the app and where to do things, (2) suggest fixes when something isn't working, (3) answer questions about the attendance records below.",
      "Use only the app guide and the records. Don't invent pages, buttons or numbers. Count carefully; numbers must match the rows.",
      "Be short and plain, like a helpful colleague: the answer first, then numbered steps if there are steps. No markdown headings. Your answer may be read aloud, so avoid tables unless asked.",
      "When a page would help, add one line per page at the very end in exactly this form: GO: /admin/links (only these paths: " + AI_PAGES.map((p) => p.path).join(", ") + "). At most 2 GO lines.",
      "Status meanings: Verified = location, code and face passed; Face mismatch, Different phone, Suspicious location, Matric changed = needs review; Not registered = no face registration.",
      `Today is ${data.today}. The lecturer is on page ${data.page}. There are ${lines.length} check-in rows.`,
      "\n\nAPP GUIDE:\n" + AI_APP_GUIDE,
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
      const raw = json?.choices?.[0]?.message?.content?.trim();
      if (!raw) return { ok: false, message: "The AI sent an empty answer. Try asking again." };
      // Pull out "GO: /admin/..." lines and turn them into page buttons
      const actions: { path: string; label: string }[] = [];
      const answer = raw.split("\n").filter((line) => {
        const m = line.trim().match(/^GO:\s*(\/admin[\w/-]*)\s*$/i);
        if (!m) return true;
        const page = AI_PAGES.find((p) => p.path === m[1].replace(/\/$/, "") || (m[1] === "/admin/" && p.path === "/admin"));
        if (page && !actions.some((a) => a.path === page.path)) actions.push(page);
        return false;
      }).join("\n").trim();
      return { ok: true, answer, actions };
    } catch {
      return { ok: false, message: "Couldn't reach the AI service. Check your connection and try again." };
    }
  });

/**
 * Suggests a mark for one theory answer and how likely it is to be AI-written.
 * The lecturer always has the final say; this is only a suggestion.
 */
export const markTheoryAnswer = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({
    accessToken: z.string().min(10),
    question: z.string().min(1).max(3000),
    guide: z.string().max(4000).default(""),
    marks: z.number().int().min(1).max(100),
    answer: z.string().max(12000),
    typingSeconds: z.number().min(0).max(100000),
    keystrokes: z.number().int().min(0).max(1000000),
    bigInserts: z.number().int().min(0).max(10000),
    pasteAttempts: z.number().int().min(0).max(10000),
  }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true; suggested: number; aiLikely: "low" | "medium" | "high"; note: string } | { ok: false; message: string }> => {
    const key = openRouterKey();
    if (!key) return { ok: false, message: "AI isn't set up yet: add your OpenRouter key on Vercel as \"openrouterai\" and redeploy." };
    if (!(await isLecturer(data.accessToken))) return { ok: false, message: "Sign in as a lecturer to use AI marking." };
    if (!data.answer.trim()) return { ok: true, suggested: 0, aiLikely: "low", note: "No answer was written." };

    const chars = data.answer.length;
    const system = [
      "You help a Nigerian university lecturer mark one written (theory) test answer.",
      "1) Suggest a mark out of the maximum, using the marking guide if given, otherwise your own knowledge of the subject. Be fair to answers in simple or non-native English: mark the ideas, not the grammar.",
      "2) Judge how likely the answer was written by an AI tool (ChatGPT etc.) instead of the student. Signs: polished generic textbook wording, perfect structure with headings or numbered points, American spelling, phrases like 'In conclusion' or 'plays a crucial role', far more than the question needs, facts not taught at this level.",
      "Also use the typing record: a person types roughly 1 to 4 characters per second on a phone. Much faster than that, few keystrokes for a long answer, or large blocks appearing at once suggest the text came from elsewhere. Blocked paste attempts mean they tried to paste.",
      "Reply with ONLY JSON: {\"suggested\": number, \"aiLikely\": \"low\"|\"medium\"|\"high\", \"note\": \"one or two plain sentences for the lecturer explaining the mark and the AI judgement\"}",
    ].join(" ");
    const user = [
      `QUESTION (${data.marks} marks):\n${data.question}`,
      `MARKING GUIDE:\n${data.guide.trim() || "(none given)"}`,
      `STUDENT ANSWER:\n${data.answer}`,
      `TYPING RECORD: ${chars} characters, ${data.keystrokes} keys pressed, ${Math.round(data.typingSeconds)} seconds typing, ${data.bigInserts} large blocks appeared at once, ${data.pasteAttempts} blocked paste attempts.`,
    ].join("\n\n");

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Attendly" },
        body: JSON.stringify({
          model: model(), max_tokens: 400, temperature: 0,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
      if (!res.ok) {
        if (res.status === 402) return { ok: false, message: "Your OpenRouter account is out of credit." };
        return { ok: false, message: `The AI couldn't mark this (status ${res.status}).` };
      }
      const raw = json?.choices?.[0]?.message?.content ?? "";
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = m ? (JSON.parse(m[0]) as { suggested?: number; aiLikely?: string; note?: string }) : null;
      if (!parsed) return { ok: false, message: "The AI's reply couldn't be read. Try again." };
      const suggested = Math.max(0, Math.min(data.marks, Math.round(Number(parsed.suggested) || 0)));
      const aiLikely = parsed.aiLikely === "high" || parsed.aiLikely === "medium" ? parsed.aiLikely : "low";
      return { ok: true, suggested, aiLikely, note: String(parsed.note ?? "").slice(0, 600) };
    } catch {
      return { ok: false, message: "Couldn't reach the AI service. Try again." };
    }
  });
