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

export const LOCAL_MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";

export type LoadStage = "idle" | "loading" | "ready" | "error";
export type LoadProgress = { stage: LoadStage; text: string; progress: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Engine = any;

let enginePromise: Promise<Engine> | null = null;

export function isWebGPUSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return "gpu" in navigator;
}

/** Lazily creates (or returns the existing) WebLLM engine, downloading and
 * compiling the model on first call. Safe to call repeatedly — subsequent
 * calls reuse the same in-flight/finished engine. */
export async function getLocalEngine(onProgress?: (p: LoadProgress) => void): Promise<Engine> {
  if (!isWebGPUSupported()) {
    throw new Error("WEBGPU_UNSUPPORTED");
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      const webllm = await import("@mlc-ai/web-llm");
      onProgress?.({ stage: "loading", text: "Starting local AI model…", progress: 0 });
      const engine = await webllm.CreateMLCEngine(LOCAL_MODEL_ID, {
        initProgressCallback: (p: { text: string; progress: number }) => {
          onProgress?.({ stage: "loading", text: p.text, progress: p.progress });
        },
      });
      onProgress?.({ stage: "ready", text: "Local AI model ready.", progress: 1 });
      return engine;
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
