export async function callGroq(
  apiKey: string,
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
): Promise<string> {
  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: question },
  ];

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      messages,
      max_tokens: 600,
      temperature: 0.2,
    }),
  });

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; type?: string; code?: string };
  };

  if (!res.ok || json.error) {
    throw new Error(JSON.stringify(json.error ?? { code: res.status, message: res.statusText }));
  }

  return json.choices?.[0]?.message?.content ?? "No response from Groq.";
}
