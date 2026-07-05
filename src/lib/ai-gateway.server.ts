export async function callGroq(
  apiKey: string,
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  jsonMode = false,
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
      max_tokens: 800,
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Groq API error:", res.status, errorText);
    throw new Error(`Groq API error: ${res.status} - ${errorText}`);
  }

  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; type?: string; code?: string };
  };

  if (json.error) {
    throw new Error(JSON.stringify(json.error));
  }

  return json.choices?.[0]?.message?.content ?? "No response from Groq.";
}
