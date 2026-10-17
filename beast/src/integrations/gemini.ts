export type Assistant = (message: string) => Promise<string>;

export const SYSTEM_PROMPT =
  "You are a guidance assistant for a benefits navigation program. Explain eligibility basics, required documents, " +
  "application steps and where to get help for public benefits (food, health coverage, housing, energy, child care, " +
  "vocational rehabilitation). Do not give legal advice and do not claim to know a person's eligibility or case status. " +
  "Never ask for or repeat personal identifiers such as full names, SSNs, addresses or case numbers; if given any, ignore them. " +
  "If unsure, say so and suggest contacting the relevant agency.";

/** Best-effort removal of obvious identifiers before text leaves the system. Not a guarantee. */
export function redact(text: string): string {
  return text
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "[redacted]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted]")
    .replace(/\b(?:\+?1[ -.]?)?\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}\b/g, "[redacted]");
}

export function createGeminiAssistant(apiKey: string, model = "gemini-2.0-flash", fetchFn: typeof fetch = fetch): Assistant {
  if (!apiKey) throw new Error("GEMINI_API_KEY required");
  return async (message) => {
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: redact(message) }] }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}`);
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Empty Gemini response");
    return text;
  };
}
