import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RecordSchema = z.object({
  fullName: z.string(),
  matricNumber: z.string(),
  department: z.string(),
  phone: z.string().optional().default(""),
  courseCode: z.string(),
  topic: z.string().optional().default(""),
  gender: z.string(),
  submittedAt: z.string(),
  distanceMeters: z.number().optional().default(0),
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

// ── Server function ───────────────────────────────────────────────────────────
export const askAttendanceAi = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return { text: "⚠️ Gemini API key not configured. Add GEMINI_API_KEY to your .env file and restart the server. Get a free key at aistudio.google.com/apikey" };
    }

    try {
      const { callGemini } = await import("./ai-gateway.server");

      const recordsJson = JSON.stringify(data.records, null, 0);
      const system = [
        "You are an AI voice assistant for a university lecturer using Attendly, a GPS-verified attendance app.",
        "You help the lecturer sort, filter, count, and summarize attendance records.",
        "Be concise and conversational since your replies may be spoken out loud.",
        "Prefer short sentences. When listing students, group by department or course and keep it brief.",
        "If the data does not contain the answer, say so plainly.",
        `Current attendance dataset (${data.records.length} records): ${recordsJson}`,
      ].join("\n");

      const text = await callGemini(apiKey, system, data.history, data.question);
      return { text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
        return { text: "Gemini quota reached for today. Try again tomorrow or upgrade your Gemini API plan." };
      }
      if (msg.includes("401") || msg.includes("403") || msg.includes("UNAUTHENTICATED") || msg.includes("PERMISSION_DENIED")) {
        return { text: `⚠️ Gemini API key rejected (${msg.includes("401") ? "401" : "403"}). Make sure the key is copied correctly from aistudio.google.com/apikey and the Gemini API is enabled for your Google account.` };
      }
      console.error("[Gemini] Request failed:", err);
      return { text: `AI error: ${msg}` };
    }
  });
