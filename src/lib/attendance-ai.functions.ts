import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RecordSchema = z.object({
  fullName: z.string(),
  matricNumber: z.string(),
  department: z.string(),
  phone: z.string().optional().default(""),
  courseCode: z.string(),
  topic: z.string().optional().default(""),
  level: z.string().optional().default(""),
  gender: z.string(),
  submittedAt: z.string(),
  distanceMeters: z.number().optional().default(0),
  c1Score: z.number().optional(),
  c1Total: z.number().optional(),
  c2Score: z.number().optional(),
  c2Total: z.number().optional(),
  c3Score: z.number().optional(),
  c3Total: z.number().optional(),
  cheatedOnTest: z.boolean().optional(),
});

const InputSchema = z.object({
  question: z.string().min(1).max(2000),
  records: z.array(RecordSchema).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .optional()
    .default([]),
});

type AiTable = { columns: string[]; rows: string[][] } | null;

function parseAiResponse(raw: string): { text: string; table: AiTable } {
  try {
    const parsed = JSON.parse(raw) as { reply?: unknown; table?: unknown };
    const text = typeof parsed.reply === "string" ? parsed.reply : raw;
    let table: AiTable = null;
    if (parsed.table && typeof parsed.table === "object") {
      const t = parsed.table as { columns?: unknown; rows?: unknown };
      if (Array.isArray(t.columns) && Array.isArray(t.rows)) {
        const columns = t.columns.map((c) => String(c));
        const rows = t.rows
          .filter((r): r is unknown[] => Array.isArray(r))
          .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
        if (columns.length > 0 && rows.length > 0) table = { columns, rows };
      }
    }
    return { text, table };
  } catch {
    return { text: raw, table: null };
  }
}

// ── Server function ───────────────────────────────────────────────────────────
export const askAttendanceAi = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    // Support both server-side and client-side environment variables
    const apiKey = (process.env.GROQ_API_KEY || import.meta.env.VITE_GROQ_API_KEY) as string | undefined;

    if (!apiKey) {
      return { text: "Groq API key not configured. Add VITE_GROQ_API_KEY to your .env file and restart the server.", table: null as AiTable };
    }

    try {
      const { callGroq } = await import("./ai-gateway.server");

      const recordsJson = JSON.stringify(data.records, null, 0);
      const system = [
        "You are an AI voice assistant for a university lecturer using Attendly, a GPS-verified attendance app.",
        "You help the lecturer sort, filter, count, and summarize attendance records.",
        "Each record may include 'level' (the student's academic year, e.g. 100/200/300 level) and continuous-assessment scores: 'c1Score'/'c1Total', 'c2Score'/'c2Total', 'c3Score'/'c3Total' for the C1, C2, and C3 tests, plus 'cheatedOnTest' if flagged for cheating on any of them. Missing fields mean that assessment hasn't been taken yet.",
        "Be concise and conversational since your reply may be spoken out loud.",
        "You MUST respond with ONLY a raw JSON object (no markdown fences) of the exact shape: {\"reply\": string, \"table\": {\"columns\": string[], \"rows\": string[][]} | null}.",
        "'reply' is a short spoken-style answer (1-3 sentences).",
        "Set 'table' when the answer involves listing, comparing, or enumerating 2 or more students (e.g. 'fetch all students', 'who signed in', 'list students with low C1 scores') — populate 'columns' with relevant headers (e.g. Name, Matric Number, Department, Level, C1, C2, C3) and 'rows' with one array of string values per student, using the same column order. Otherwise set 'table' to null (counts, yes/no answers, single-student lookups, general questions).",
        "If the data does not contain the answer, say so plainly in 'reply' and set 'table' to null.",
        `Current attendance dataset (${data.records.length} records): ${recordsJson}`,
      ].join("\n");

      let raw: string;
      try {
        raw = await callGroq(apiKey, system, data.history, data.question, true);
      } catch (jsonErr) {
        // Some models/plans reject response_format — fall back to a plain-text reply.
        const jsonMsg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
        if (!jsonMsg.includes("response_format") && !jsonMsg.includes("json_object") && !jsonMsg.includes("json_validate_failed")) throw jsonErr;
        raw = await callGroq(apiKey, system, data.history, data.question, false);
      }
      const { text, table } = parseAiResponse(raw);
      return { text, table };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("quota")) {
        return { text: "Groq rate limit reached. Try again later or check your Groq API plan.", table: null as AiTable };
      }
      if (msg.includes("401") || msg.includes("403") || msg.includes("invalid_api_key")) {
        return { text: `Groq API key rejected. Make sure VITE_GROQ_API_KEY is copied correctly from console.groq.com and you have restarted the dev server.`, table: null as AiTable };
      }
      if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror") || msg.toLowerCase().includes("fetch")) {
        return { text: "Could not reach the Groq API. Check your internet connection and make sure nothing is blocking outbound requests.", table: null as AiTable };
      }
      console.error("[Groq] Request failed:", err);
      return { text: `AI error: ${msg}`, table: null as AiTable };
    }
  });
