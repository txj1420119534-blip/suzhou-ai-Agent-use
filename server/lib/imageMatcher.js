import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const referencesPath = path.resolve("server/data/referenceLandmarks.json");
const referenceImageDir = path.resolve("server/data/reference-images");
const HASH_SIZE = 16;
const MATCH_THRESHOLD = 34;
const SECONDARY_MATCH_THRESHOLD = 52;

let referenceCache;

export async function matchReferenceImage(dataUrl) {
  const input = dataUrlToBuffer(dataUrl);
  if (!input) return null;

  const inputHash = await imageHash(input);
  const references = await loadReferences();

  const scored = references
    .map((reference) => {
      const distance = hammingDistance(inputHash, reference.hash);
      const similarity = 1 - distance / inputHash.length;
      return { ...reference, distance, similarity };
    })
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  const second = scored[1];
  if (!best) return null;
  const hasClearLead = !second || second.distance - best.distance >= 18;
  const isStrongMatch = best.distance <= MATCH_THRESHOLD || (best.distance <= SECONDARY_MATCH_THRESHOLD && hasClearLead);
  if (!isStrongMatch) return null;

  return {
    sceneId: best.sceneId,
    landmarkName: best.landmarkName,
    confidence: Math.max(0.82, Number(best.similarity.toFixed(2))),
    isSuzhou: true,
    evidence: [best.reason, `参考图相似度 ${Math.round(best.similarity * 100)}%`],
    candidates: [{
      sceneId: best.sceneId,
      landmarkName: best.landmarkName,
      confidence: Math.max(0.82, Number(best.similarity.toFixed(2))),
      reason: best.reason
    }],
    recommendedExperience: best.sceneId === "pingjianglu" || best.sceneId === "hanshansi"
      ? "open_full_demo"
      : "show_light_card",
    answerMode: best.sceneId === "pingjianglu" || best.sceneId === "hanshansi" ? "full" : "lite"
  };
}

async function loadReferences() {
  if (referenceCache) return referenceCache;

  const references = JSON.parse(await fs.readFile(referencesPath, "utf8"));
  referenceCache = await Promise.all(references.map(async (reference) => {
    const buffer = await fs.readFile(path.join(referenceImageDir, reference.file));
    return {
      ...reference,
      hash: await imageHash(buffer)
    };
  }));
  return referenceCache;
}

async function imageHash(buffer) {
  const pixels = await sharp(buffer)
    .resize(HASH_SIZE, HASH_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  const avg = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  return Array.from(pixels, (value) => value >= avg ? "1" : "0").join("");
}

function hammingDistance(a, b) {
  let distance = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance + Math.abs(a.length - b.length);
}

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}
