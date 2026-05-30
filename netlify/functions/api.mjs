import { recognizeLandmark } from "../../server/agents/visionAgent.js";
import fs from "node:fs/promises";
import path from "node:path";
import { askSuShi } from "../../server/agents/characterAgent.js";
import { recommendNearby } from "../../server/agents/recommendationAgent.js";
import { listScenes, routeRecognition, routeSceneById } from "../../server/agents/sceneRouter.js";
import { probeMimo } from "../../server/lib/mimoClient.js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    const route = normalizeRoute(event.path);
    const body = parseBody(event.body);

    if (event.httpMethod === "GET" && route === "health") {
      const data = {
        ok: true,
        service: "一镜入姑苏 Agent",
        mode: process.env.MIMO_API_KEY ? "mimo" : "fallback-demo",
        runtime: "netlify-functions"
      };
      if (event.queryStringParameters?.probe === "1") {
        data.mimoProbe = await probeMimo();
      }
      return json(data);
    }

    if (event.httpMethod === "GET" && route === "scenes") {
      return json({ ok: true, scenes: await listScenes() });
    }

    if (event.httpMethod === "GET" && route === "vision-probe") {
      const sample = String(event.queryStringParameters?.sample || "pingjiang");
      const fileMap = {
        pingjiang: "server/data/reference-images/pingjianglu-r.jpg",
        gate: "server/data/reference-images/dongfangzhimen-0204.jpg",
        hanshan: "server/data/reference-images/hanshansi-pagoda.jpg"
      };
      const file = fileMap[sample] || fileMap.pingjiang;
      const buffer = await readBundledFile(file);
      const recognition = await recognizeLandmark({
        mediaDataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
        mediaType: "image",
        userText: "视觉探针：请识别这张图片里的苏州地标",
        skipReference: event.queryStringParameters?.raw === "1"
      });
      const routed = await routeRecognition(recognition);
      return json({ ok: true, sample, recognition, route: routed });
    }

    if (event.httpMethod === "POST" && route === "recognize/camera") {
      const recognition = await recognizeLandmark({
        mediaDataUrl: body.imageDataUrl,
        mediaType: "image",
        userText: body.userText
      });
      const routed = await routeRecognition(recognition);
      return json({ ok: true, recognition, route: routed });
    }

    if (event.httpMethod === "POST" && route === "recognize/video") {
      const mediaDataUrl = body.videoDataUrl || body.frameDataUrl;
      const recognition = await recognizeLandmark({
        mediaDataUrl,
        mediaType: body.videoDataUrl ? "video" : "image",
        userText: body.userText
      });
      const routed = await routeRecognition(recognition);
      return json({ ok: true, recognition, route: routed });
    }

    if (event.httpMethod === "POST" && route === "chat/sushi") {
      if (!body.message) return json({ ok: false, error: "message_required" }, 400);
      const reply = await askSuShi({ message: body.message, context: body.context });
      return json({ ok: true, reply });
    }

    if (event.httpMethod === "POST" && route === "route-scene") {
      if (!body.sceneId) return json({ ok: false, error: "sceneId_required" }, 400);
      const routed = await routeSceneById(body.sceneId, body.landmarkName);
      return json({ ok: true, route: routed });
    }

    if (event.httpMethod === "POST" && route === "recommendations") {
      if (!body.sceneId) return json({ ok: false, error: "sceneId_required" }, 400);
      const recommendation = await recommendNearby({
        sceneId: body.sceneId,
        userProfile: body.userProfile,
        limit: body.limit
      });
      return json({ ok: true, recommendation });
    }

    return json({ ok: false, error: "not_found", route }, 404);
  } catch (error) {
    return json({
      ok: false,
      error: "server_error",
      message: error?.message || String(error)
    }, 500);
  }
}

async function readBundledFile(relativePath) {
  const candidates = [
    path.resolve(relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve("/var/task", relativePath),
    path.resolve("/var/task", "src", relativePath),
    path.resolve("/var/task", "..", relativePath)
  ];

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {}
  }

  throw new Error(`Bundled file not found: ${relativePath}; tried ${candidates.join(", ")}`);
}

function normalizeRoute(pathname) {
  const path = String(pathname || "");
  const marker = "/api/";
  if (path.includes(marker)) return path.split(marker).pop().replace(/^\/+/, "");
  const functionMarker = "/.netlify/functions/api/";
  if (path.includes(functionMarker)) return path.split(functionMarker).pop().replace(/^\/+/, "");
  return path.replace(/^\/+/, "");
}

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function json(data, statusCode = 200) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(data)
  };
}
