import OpenAI from "openai";

export const MIMO_BASE_URL = process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1";
export const MIMO_TEXT_MODEL = process.env.MIMO_TEXT_MODEL || "mimo-v2.5-pro";
export const MIMO_VISION_MODEL = process.env.MIMO_VISION_MODEL || "mimo-v2.5";

export function createMimoClient() {
  if (!process.env.MIMO_API_KEY) return null;

  return new OpenAI({
    apiKey: process.env.MIMO_API_KEY,
    baseURL: MIMO_BASE_URL
  });
}

export async function probeMimo() {
  const client = createMimoClient();
  if (!client) {
    return {
      ok: false,
      mode: "fallback-demo",
      error: "missing_MIMO_API_KEY"
    };
  }

  try {
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model: MIMO_TEXT_MODEL,
      messages: [
        {
          role: "user",
          content: "只回复两个字：姑苏"
        }
      ],
      temperature: 0
    });

    return {
      ok: true,
      mode: "mimo",
      model: MIMO_TEXT_MODEL,
      latencyMs: Date.now() - startedAt,
      sample: completion.choices?.[0]?.message?.content || ""
    };
  } catch (error) {
    return {
      ok: false,
      mode: "mimo-configured-but-call-failed",
      model: MIMO_TEXT_MODEL,
      error: error?.message || String(error)
    };
  }
}

export function parseJsonFromModel(text, fallback) {
  if (!text) return fallback;

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return fallback;
      }
    }
  }

  return fallback;
}
