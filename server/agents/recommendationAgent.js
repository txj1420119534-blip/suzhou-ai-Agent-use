import fs from "node:fs/promises";
import path from "node:path";
import { createMimoClient, MIMO_TEXT_MODEL, parseJsonFromModel } from "../lib/mimoClient.js";
import { findScene } from "./sceneRouter.js";

const recommendationsPath = path.resolve("server/data/recommendations.json");
let recommendationsCache;

export async function recommendNearby({ sceneId, userProfile = {}, limit = 2 }) {
  const data = await loadRecommendations();
  const scene = await findScene(sceneId);
  const candidates = data[sceneId] || data.default;
  const client = createMimoClient();

  if (!client) {
    return {
      scene,
      products: candidates.slice(0, limit),
      source: "fallback"
    };
  }

  const fallback = { products: candidates.slice(0, limit) };
  try {
    const completion = await client.chat.completions.create({
      model: MIMO_TEXT_MODEL,
      messages: [
        {
          role: "system",
          content: "你是一镜入姑苏的主动推荐 Agent。请从候选商品中选择最适合当前用户和地标的 1-3 个，输出 JSON：{products:[{type,title,reason,cta}]}。不要输出 Markdown。"
        },
        {
          role: "user",
          content: JSON.stringify({
            scene,
            userProfile,
            candidates
          })
        }
      ],
      temperature: 0.45
    });

    const parsed = parseJsonFromModel(completion.choices?.[0]?.message?.content, fallback);
    return {
      scene,
      products: Array.isArray(parsed.products) ? parsed.products.slice(0, limit) : fallback.products,
      source: "mimo"
    };
  } catch (error) {
    return {
      scene,
      products: fallback.products,
      source: "fallback",
      error: error.message
    };
  }
}

async function loadRecommendations() {
  if (!recommendationsCache) {
    recommendationsCache = JSON.parse(await fs.readFile(recommendationsPath, "utf8"));
  }
  return recommendationsCache;
}
