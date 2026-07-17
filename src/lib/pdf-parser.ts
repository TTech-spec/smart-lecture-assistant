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
    // pdf.js splits a page into many small text runs. Each run's `hasEOL` flag
    // tells us whether a real line break follows it — without checking that,
    // an entire page collapses into one giant line and question numbers,
    // options, and "Answer:" lines can no longer be told apart.
    const pageText = content.items
      .map((item) => {
        if (!("str" in item)) return "";
        const eol = "hasEOL" in item && item.hasEOL;
        return item.str + (eol ? "\n" : " ");
      })
      .join("");
    pages.push(pageText);
  }

  return pages.join("\n");
}

// ── Question parser ───────────────────────────────────────────────────────────
// Supports the formats most commonly produced by Word/Google Docs and by
// lecturers pasting from other sources, including:
//
// 1. Question text here?
// A) Option A   OR   A. Option A          (one option per line)
// B) Option B
// C) Option C
// D) Option D
// Answer: A     OR   Ans: A   OR   Correct: A   OR   Key: A   OR   *A)  (asterisk marks correct)
//
// ...as well as all four options crammed onto a single line:
// 1. Question text here?
//    a) Option A  b) Option B  c) Option C  d) Option D
//    Answer: b) Option B
//
// and question/option text that wraps across multiple lines mid-sentence.

type OptionMarker = { start: number; end: number; starred: boolean };

/** Finds the next "A)"/"b."/"*C)" style marker for `letter`, starting the
 *  search at `fromIndex`. Requires the marker to be preceded by whitespace
 *  or the start of the block so we don't match a stray letter inside a word. */
function findOptionMarker(letter: "A" | "B" | "C" | "D", fromIndex: number, str: string): OptionMarker | null {
  const re = new RegExp(`(?:^|[ \\t\\n])(\\*?)${letter}[.)]\\s+`, "i");
  const sub = str.slice(fromIndex);
  const match = re.exec(sub);
  if (!match) return null;
  const start = fromIndex + match.index;
  return { start, end: start + match[0].length, starred: match[1] === "*" };
}

const collapseSpace = (s: string) => s.replace(/\s+/g, " ").trim();

function parseQuestionsFromText(text: string): TestQuestion[] {
  const questions: TestQuestion[] = [];

  // Normalise line endings
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split on question starters: "1." / "1)" / "Q1." / "Q1)" at start of a line
  const blocks = clean.split(/(?=^\s*Q?\d+[.)]\s)/im);

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const withoutNumber = block.replace(/^Q?\d+[.)]\s*/i, "");
    if (withoutNumber === block) continue; // block didn't start with a question number

    // Find the "Answer:"/"Ans:"/"Correct:"/"Key:" line, wherever it appears,
    // and cut the block there so its text doesn't pollute question/option parsing.
    const answerMatch = withoutNumber.match(/(?:answer|ans|correct|key)\s*:?\s*([A-Da-d])\b/i);
    const beforeAnswer = answerMatch ? withoutNumber.slice(0, answerMatch.index) : withoutNumber;

    // Locate all four option markers in order, regardless of whether each is
    // on its own line or all four share one line.
    const aPos = findOptionMarker("A", 0, beforeAnswer);
    if (!aPos) continue;
    const bPos = findOptionMarker("B", aPos.end, beforeAnswer);
    if (!bPos) continue;
    const cPos = findOptionMarker("C", bPos.end, beforeAnswer);
    if (!cPos) continue;
    const dPos = findOptionMarker("D", cPos.end, beforeAnswer);
    if (!dPos) continue;

    const qText = collapseSpace(beforeAnswer.slice(0, aPos.start));
    const optA = collapseSpace(beforeAnswer.slice(aPos.end, bPos.start));
    const optB = collapseSpace(beforeAnswer.slice(bPos.end, cPos.start));
    const optC = collapseSpace(beforeAnswer.slice(cPos.end, dPos.start));
    const optD = collapseSpace(beforeAnswer.slice(dPos.end));

    if (!qText || !optA || !optB || !optC || !optD) continue; // skip malformed questions

    let correctIndex: 0 | 1 | 2 | 3 | null = null;
    if (answerMatch) {
      correctIndex = "abcd".indexOf(answerMatch[1].toLowerCase()) as 0 | 1 | 2 | 3;
    } else if (aPos.starred) correctIndex = 0;
    else if (bPos.starred) correctIndex = 1;
    else if (cPos.starred) correctIndex = 2;
    else if (dPos.starred) correctIndex = 3;

    if (correctIndex === null) continue; // no answer indicated at all — skip rather than guess

    questions.push({
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: qText,
      options: [optA, optB, optC, optD],
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
