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
