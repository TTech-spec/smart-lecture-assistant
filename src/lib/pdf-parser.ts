import type { TestQuestion } from "./attendance-store";

// ── PDF text extraction via pdfjs-dist ────────────────────────────────────────

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");

  // Use CDN worker — avoids bundler worker-setup complexity
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(pageText);
  }

  return pages.join("\n");
}

// ── Question parser ───────────────────────────────────────────────────────────
// Supports the formats most commonly exported from Word/Google Docs:
//
// 1. Question text here?
// A) Option A   OR   A. Option A
// B) Option B
// C) Option C
// D) Option D
// Answer: A     OR   Ans: A   OR   Correct: A   OR   *A)  (asterisk marks correct)

function parseQuestionsFromText(text: string): TestQuestion[] {
  const questions: TestQuestion[] = [];

  // Normalise line endings and compress whitespace runs
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split on question starters: "1." / "1)" / "Q1." / "Q1)" at start of line
  const blocks = clean.split(/(?=(?:^|\n)\s*(?:Q?\d+[.)]\s))/i);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 5) continue; // need at least question + 4 options

    // ── Extract question text ──────────────────────────────────────────────
    const qLine = lines[0].replace(/^Q?\d+[.)]\s*/i, "").trim();
    if (!qLine) continue;

    // ── Extract options and detect correct answer ─────────────────────────
    const options: string[] = [];
    let correctIndex: 0 | 1 | 2 | 3 = 0;
    let answerFound = false;

    for (const line of lines.slice(1)) {
      // Answer line: "Answer: B", "Ans: B", "Correct: B", "Key: B"
      const ansMatch = line.match(/^(?:answer|ans|correct|key)\s*:?\s*([A-Da-d])/i);
      if (ansMatch) {
        correctIndex = "abcd".indexOf(ansMatch[1].toLowerCase()) as 0 | 1 | 2 | 3;
        answerFound = true;
        continue;
      }

      // Option line: "A) ...", "A. ...", "A: ...", "*A) ..." (asterisk = correct)
      const optMatch = line.match(/^(\*?)([A-Da-d])[.):\s]\s*(.+)/);
      if (optMatch && options.length < 4) {
        const isMarkedCorrect = optMatch[1] === "*";
        const letter = optMatch[2].toLowerCase();
        const text = optMatch[3].trim();
        if (isMarkedCorrect && !answerFound) {
          correctIndex = "abcd".indexOf(letter) as 0 | 1 | 2 | 3;
          answerFound = true;
        }
        options.push(text);
      }
    }

    if (options.length !== 4) continue; // skip malformed questions

    questions.push({
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: qLine,
      options: options as [string, string, string, string],
      correctIndex,
    });
  }

  return questions;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; questions: TestQuestion[] }
  | { ok: false; error: string };

export async function parsePdfQuestions(file: File): Promise<ParseResult> {
  try {
    const text = await extractTextFromPdf(file);
    const questions = parseQuestionsFromText(text);
    if (questions.length === 0) {
      return {
        ok: false,
        error:
          "No questions found. Make sure the PDF uses numbered questions (1. Question text?) with A/B/C/D options and an Answer: X line.",
      };
    }
    return { ok: true, questions };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to read PDF.",
    };
  }
}
