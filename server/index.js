import "dotenv/config";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import serve from "koa-static";
import { recognizeLandmark } from "./agents/visionAgent.js";
import { askSuShi } from "./agents/characterAgent.js";
import { recommendNearby } from "./agents/recommendationAgent.js";
import { listScenes, routeRecognition, routeSceneById } from "./agents/sceneRouter.js";
import { badRequest, ok, serverError } from "./lib/response.js";
import { probeMimo } from "./lib/mimoClient.js";

const app = new Koa();
const router = new Router({ prefix: "/api" });
const port = Number(process.env.PORT || 8787);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");

router.get("/health", async (ctx) => {
  const data = {
    service: "一镜入姑苏 Agent",
    mode: process.env.MIMO_API_KEY ? "mimo" : "fallback-demo"
  };
  if (ctx.query.probe === "1") {
    data.mimoProbe = await probeMimo();
  }
  ok(ctx, data);
});

router.get("/vision-probe", async (ctx) => {
  const sample = String(ctx.query.sample || "pingjiang");
  const fileMap = {
    pingjiang: "server/data/reference-images/pingjianglu-r.jpg",
    gate: "server/data/reference-images/dongfangzhimen-0204.jpg",
    hanshan: "server/data/reference-images/hanshansi-pagoda.jpg"
  };
  const file = path.join(projectRoot, fileMap[sample] || fileMap.pingjiang);
  const buffer = await fs.readFile(file);
  const recognition = await recognizeLandmark({
    mediaDataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    mediaType: "image",
    userText: "视觉探针：请识别这张图片里的苏州地标",
    skipReference: ctx.query.raw === "1"
  });
  const route = await routeRecognition(recognition);
  ok(ctx, { sample, recognition, route });
});

router.get("/scenes", async (ctx) => {
  ok(ctx, { scenes: await listScenes() });
});

router.post("/recognize/camera", async (ctx) => {
  const { imageDataUrl, userText } = ctx.request.body || {};
  const recognition = await recognizeLandmark({
    mediaDataUrl: imageDataUrl,
    mediaType: "image",
    userText
  });
  const route = await routeRecognition(recognition);
  ok(ctx, { recognition, route });
});

router.post("/recognize/video", async (ctx) => {
  const { videoDataUrl, frameDataUrl, userText } = ctx.request.body || {};
  const mediaDataUrl = videoDataUrl || frameDataUrl;
  const recognition = await recognizeLandmark({
    mediaDataUrl,
    mediaType: videoDataUrl ? "video" : "image",
    userText
  });
  const route = await routeRecognition(recognition);
  ok(ctx, { recognition, route });
});

router.post("/chat/sushi", async (ctx) => {
  const { message, context } = ctx.request.body || {};
  if (!message) return badRequest(ctx, "message_required");

  const reply = await askSuShi({ message, context });
  ok(ctx, { reply });
});

router.post("/route-scene", async (ctx) => {
  const { sceneId, landmarkName } = ctx.request.body || {};
  if (!sceneId) return badRequest(ctx, "sceneId_required");

  const route = await routeSceneById(sceneId, landmarkName);
  ok(ctx, { route });
});

router.post("/recommendations", async (ctx) => {
  const { sceneId, userProfile, limit } = ctx.request.body || {};
  if (!sceneId) return badRequest(ctx, "sceneId_required");

  const recommendation = await recommendNearby({ sceneId, userProfile, limit });
  ok(ctx, { recommendation });
});

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    serverError(ctx, error);
  }
});

app.use(bodyParser({ jsonLimit: "80mb" }));
app.use(router.routes());
app.use(router.allowedMethods());
app.use(serve(publicDir));

app.listen(port, () => {
  console.log(`一镜入姑苏 Agent running at http://localhost:${port}`);
});
