// ── In-browser AI engine (WebLLM) ───────────────────────────────────────────
// Runs a small open-weight model entirely on the lecturer's own device via
// WebGPU. No API key, no account, no server call — the model weights are
// fetched once (public, unauthenticated) from Hugging Face / MLC's CDN and
// cached in the browser afterwards.
//
// Because it's on-device, the model is much smaller than a cloud model like
// Groq's Llama-3.1-8B, so it's worse at things like counting rows out of a
// big JSON dump. To keep answers trustworthy we compute counts/aggregates in
// plain JS (see computeAggregates in attendance-ai.local.ts) and only ask the
// model to translate/summarize in natural language.
//
// A smaller model (~1GB) is used deliberately, rather than a bigger/better
// one — on flaky connections a multi-minute, multi-gigabyte download is much
// more likely to get cut off partway through, and every byte spent on model
// size is a byte that has to survive the transfer.

export const LOCAL_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

const MAX_LOAD_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1500, 3000, 6000];

export type LoadStage = "idle" | "loading" | "ready" | "error";
export type LoadProgress = { stage: LoadStage; text: string; progress: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Engine = any;

let enginePromise: Promise<Engine> | null = null;

export function isWebGPUSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return "gpu" in navigator;
}

function isRetryableLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("cache.add") || msg.includes("network error") || msg.includes("failed to fetch") || msg.includes("networkerror");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lazily creates (or returns the existing) WebLLM engine, downloading and
 * compiling the model on first call. Safe to call repeatedly — subsequent
 * calls reuse the same in-flight/finished engine. Automatically retries a
 * few times on network/cache errors (already-cached shards from a previous
 * attempt are skipped, so a retry resumes rather than starting over). */
export async function getLocalEngine(onProgress?: (p: LoadProgress) => void): Promise<Engine> {
  if (!isWebGPUSupported()) {
    throw new Error("WEBGPU_UNSUPPORTED");
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      const webllm = await import("@mlc-ai/web-llm");
      let lastErr: unknown;
      for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
        try {
          onProgress?.({
            stage: "loading",
            text: attempt === 1 ? "Starting local AI model…" : `Network hiccup — resuming download (attempt ${attempt} of ${MAX_LOAD_ATTEMPTS})…`,
            progress: 0,
          });
          const engine = await webllm.CreateMLCEngine(LOCAL_MODEL_ID, {
            initProgressCallback: (p: { text: string; progress: number }) => {
              onProgress?.({ stage: "loading", text: p.text, progress: p.progress });
            },
          });
          onProgress?.({ stage: "ready", text: "Local AI model ready.", progress: 1 });
          return engine;
        } catch (err) {
          lastErr = err;
          if (!isRetryableLoadError(err) || attempt === MAX_LOAD_ATTEMPTS) throw err;
          await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 6000);
        }
      }
      throw lastErr;
    })().catch((err) => {
      // Let the next call retry instead of caching a broken promise forever.
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/** Ask the local model a question, OpenAI-chat-style. Mirrors the old
 * callGroq() signature so callers barely change. */
export async function askLocalAi(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  jsonMode = false,
  onProgress?: (p: LoadProgress) => void,
): Promise<string> {
  const engine = await getLocalEngine(onProgress);

  const messages = [
    { role: "system" as const, content: system },
    ...history,
    { role: "user" as const, content: question },
  ];

  const reply = await engine.chat.completions.create({
    messages,
    temperature: 0.2,
    max_tokens: 800,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  return reply.choices?.[0]?.message?.content ?? "No response from the local AI model.";
}
