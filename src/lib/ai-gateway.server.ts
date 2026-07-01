export async function callGemini(
  apiKey: string,
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
): Promise<string> {
  const contents = [
    ...history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: question }] },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 600 },
      }),
    },
  );

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { code: number; message: string; status: string };
  };

  if (!res.ok || json.error) {
    throw new Error(JSON.stringify(json.error ?? { code: res.status, message: res.statusText }));
  }

  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response from Gemini.";
}
