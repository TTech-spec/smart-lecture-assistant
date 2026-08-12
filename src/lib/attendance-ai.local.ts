import { askLocalAi, type LoadProgress } from "./local-llm";

export type AiRecord = {
  fullName: string;
  matricNumber: string;
  department: string;
  phone?: string;
  courseCode: string;
  topic?: string;
  level?: string;
  gender: string;
  submittedAt: string;
  distanceMeters?: number;
  c1Score?: number;
  c1Total?: number;
  c2Score?: number;
  c2Total?: number;
  c3Score?: number;
  c3Total?: number;
  cheatedOnTest?: boolean;
};

export type AiTable = { columns: string[]; rows: string[][] } | null;
export type AiChatMsg = { role: "user" | "assistant"; content: string };

// The local model has a much smaller context window than a cloud model, so
// we cap how many raw records get dumped into the prompt. Exact counts don't
// depend on this cap — see computeAggregates below.
const MAX_SAMPLE_RECORDS = 80;

function countBy(records: AiRecord[], key: keyof AiRecord): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    const v = (r[key] as string) || "Unspecified";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${v}: ${n}`)
    .join(", ") || "none";
}

/** Exact, deterministic aggregate stats computed in JS — small models are
 * unreliable at counting rows out of a raw JSON dump, so anything that can be
 * answered as a plain count is handed to the model pre-computed. */
function computeAggregates(records: AiRecord[]): string {
  const cheated = records.filter((r) => r.cheatedOnTest).length;
  return [
    `Total records: ${records.length}`,
    `By gender: ${countBy(records, "gender")}`,
    `By department: ${countBy(records, "department")}`,
    `By level: ${countBy(records, "level")}`,
    `By course code: ${countBy(records, "courseCode")}`,
    `Flagged for cheating on a test: ${cheated}`,
  ].join("\n");
}

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

export async function askAttendanceAiLocal(
  question: string,
  records: AiRecord[],
  history: AiChatMsg[],
  onProgress?: (p: LoadProgress) => void,
): Promise<{ text: string; table: AiTable }> {
  const sample = records.slice(0, MAX_SAMPLE_RECORDS);
  const truncated = records.length > sample.length;
  const recordsJson = JSON.stringify(sample, null, 0);

  const system = [
    "You are an AI assistant for a university lecturer using Attendly, a GPS-verified attendance app.",
    "You help the lecturer sort, filter, and summarize attendance records. You run entirely on the lecturer's own device.",
    "Each record may include 'level' (the student's academic year) and continuous-assessment scores: 'c1Score'/'c1Total', 'c2Score'/'c2Total', 'c3Score'/'c3Total', plus 'cheatedOnTest' if flagged. Missing fields mean that assessment hasn't been taken yet.",
    "Exact totals computed in code (ALWAYS trust these over counting the sample yourself):",
    computeAggregates(records),
    truncated
      ? `Sample of ${sample.length} of ${records.length} records (for listing/filtering by name, department, etc. — NOT for counting; use the exact totals above for counts):`
      : `All ${records.length} records:`,
    recordsJson,
    "Be concise and conversational.",
    "You MUST respond with ONLY a raw JSON object (no markdown fences) of the exact shape: {\"reply\": string, \"table\": {\"columns\": string[], \"rows\": string[][]} | null}.",
    "'reply' is a short answer (1-3 sentences). For counting questions, use the exact totals provided, not the sample.",
    "Set 'table' when listing/comparing 2+ students — populate 'columns' (e.g. Name, Matric Number, Department, Level, C1, C2, C3) and 'rows' with one array per student. Otherwise set 'table' to null.",
    truncated
      ? "If a listing question can't be fully answered because the sample was truncated, say so honestly in 'reply' instead of guessing."
      : "",
    "If the data does not contain the answer, say so plainly in 'reply' and set 'table' to null.",
  ].filter(Boolean).join("\n");

  let raw: string;
  try {
    raw = await askLocalAi(system, history, question, true, onProgress);
  } catch (jsonErr) {
    const msg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
    if (msg === "WEBGPU_UNSUPPORTED") throw jsonErr;
    // Some quantized models are flaky with strict JSON grammar — retry plain.
    raw = await askLocalAi(system, history, question, false, onProgress);
  }
  return parseAiResponse(raw);
}
