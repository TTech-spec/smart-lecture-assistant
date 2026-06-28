import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
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

export const askAttendanceAi = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const recordsJson = JSON.stringify(data.records, null, 0);
    const system = [
      "You are an AI voice assistant for a university lecturer using Campus Presence, an attendance app.",
      "You help the lecturer sort, filter, count, and summarize today's attendance records.",
      "Be concise and conversational since your replies will be spoken out loud.",
      "Prefer short sentences. When listing students, group by department or course and keep it brief.",
      "If the data does not contain the answer, say so plainly.",
      `Here is the current attendance dataset as JSON (${data.records.length} records): ${recordsJson}`,
    ].join("\n");

    const { text } = await generateText({
      model,
      system,
      messages: [
        ...data.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: data.question },
      ],
    });

    return { text };
  });
