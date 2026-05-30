import { createMimoClient, MIMO_VISION_MODEL, parseJsonFromModel } from "../lib/mimoClient.js";
import { matchReferenceImage } from "../lib/imageMatcher.js";
import { listScenes } from "./sceneRouter.js";

const UNKNOWN_RESULT = {
  sceneId: "unknown",
  landmarkName: "未识别到苏州地标",
  confidence: 0,
  isSuzhou: false,
  evidence: [],
  candidates: [],
  recommendedExperience: "continue_scanning",
  answerMode: "unknown"
};

const RECOGNITION_HINTS = [
  "核心地标优先：平江路、寒山寺、虎丘、山塘街、拙政园、留园、苏州博物馆、东方之门、金鸡湖、胥门、盘门、同里、周庄、甪直、木渎。",
  "文字线索优先：牌匾、路牌、门票、字幕、店招、视频标题里的地名，优先级高于画面占比。",
  "著名性优先：如果画面里同时出现普通店铺和著名地标，应优先返回著名地标。",
  "多个地标：如果画面或视频里可确认多个苏州地标，请按著名性和确定性排序列在 candidates。"
];

export async function recognizeLandmark({ mediaDataUrl, mediaType = "image", userText = "", skipReference = false }) {
  const scenes = await listScenes();
  const client = createMimoClient();
  const hasMedia = typeof mediaDataUrl === "string" && mediaDataUrl.startsWith("data:");

  if (!skipReference && mediaType === "image" && hasMedia) {
    const referenceMatch = await matchReferenceImage(mediaDataUrl);
    if (referenceMatch) {
      return { ...referenceMatch, source: "reference-match" };
    }
  }

  if (!client || !hasMedia) {
    return fallbackRecognize({
      userText,
      scenes,
      reason: client ? "missing_media" : "missing_mimo_key"
    });
  }

  const knownScenes = scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    aliases: scene.aliases || [],
    keywords: scene.keywords || [],
    visualFeatures: scene.visualFeatures || [],
    triggerRule: scene.triggerRule,
    fullDemo: scene.fullDemo
  }));

  const prompt = [
    "你是一镜入姑苏的视觉搜索 Agent。请识别图片/视频里的场景和地标，并决定下一步跳转。",
    "",
    "放开规则：",
    "1. 不要只局限于给定地标库。只要能判断为苏州地标，就返回地标名称并进入 light-card。",
    "2. 如果不是苏州，或只是普通街景、普通水面、普通室内，sceneId 返回 unknown。",
    "",
    "收紧规则：",
    "1. 优先识别核心地标、著名地标。著名性和地标性 > 画面占比。",
    "2. 优先读取文字：牌匾、路牌、字幕、视频标题、店招中的地名是最高权重证据。",
    "3. 如果出现多个可确认的苏州地标，必须在 candidates 中列出 2-5 个候选，按“著名性 + 确定性”排序。",
    "4. 平江路：看到“平江路”“遇见平江路”“Pingjiang Road”等牌匾文字可高置信；没有文字时，需要江南水巷+石桥+白墙黛瓦+河街/摇橹船等强组合。",
    "5. 东方之门：如果画面核心是双塔拱门或苏州中心天际线，必须识别为“东方之门”，不要泛化为“金鸡湖”。只有画面重点是湖面/湖区时才返回金鸡湖。",
    "6. 寒山寺：不只看山门文字。普明宝塔/寺塔、黄墙寺院、枫桥、钟楼、银杏林中的寺院塔景，都可作为寒山寺强证据。",
    "",
    "输出 JSON，不要输出 Markdown，不要解释 JSON 外内容。",
    "字段：sceneId, landmarkName, confidence, isSuzhou, evidence, candidates, recommendedExperience, answerMode。",
    "candidate 字段：{sceneId, landmarkName, confidence, reason}。",
    "sceneId 规则：命中 knownScenes 时返回对应 id；是苏州地标但不在 knownScenes 时返回 open_suzhou；不是苏州或证据不足时返回 unknown。",
    "recommendedExperience：open_full_demo / show_light_card / choose_landmark / continue_scanning。",
    "answerMode：full / lite / choose / unknown。",
    `knownScenes=${JSON.stringify(knownScenes)}`,
    `recognitionHints=${JSON.stringify(RECOGNITION_HINTS)}`,
    userText ? `用户补充文本：${userText}` : ""
  ].filter(Boolean).join("\n");

  const mediaPart = mediaType === "video"
    ? { type: "video_url", video_url: { url: mediaDataUrl } }
    : { type: "image_url", image_url: { url: mediaDataUrl } };

  try {
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model: MIMO_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            mediaPart
          ]
        }
      ],
      temperature: 0.1
    });

    const parsed = parseJsonFromModel(completion.choices?.[0]?.message?.content, UNKNOWN_RESULT);
    const normalized = normalizeRecognition(correctKnownConfusions(parsed), scenes);
    if (normalized.sceneId === "unknown") {
      const rescued = await rescueSuzhouLandmark(client, mediaPart, knownScenes);
      if (rescued.sceneId !== "unknown") {
        return {
          ...normalizeRecognition(correctKnownConfusions(rescued), scenes),
          source: "mimo-vision-rescue",
          latencyMs: Date.now() - startedAt
        };
      }
    }
    return {
      ...normalized,
      source: "mimo-vision",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    const fallback = fallbackRecognize({ userText, scenes, reason: "mimo_error" });
    return {
      ...fallback,
      source: "mimo-error-fallback",
      error: error?.message || String(error)
    };
  }
}

async function rescueSuzhouLandmark(client, mediaPart, knownScenes) {
  const rescuePrompt = [
    "请重新观察这张图。你的任务不是严格分类，而是尽量判断它是否为苏州文旅相关地标或场景。",
    "如果看到以下任一信息，请不要返回 unknown：",
    "1. 牌匾/路牌/字幕/店招出现苏州、姑苏、平江路、寒山寺、虎丘、山塘、拙政园、苏州博物馆、东方之门、金鸡湖、同里、周庄等字样。",
    "2. 画面是典型苏州/江南文旅场景：白墙黛瓦、水巷、石桥、园林、寺塔、古镇河道、苏州现代地标。",
    "3. 即使无法确认具体名称，只要较像苏州文旅场景，也返回 sceneId=open_suzhou，landmarkName=苏州地标。",
    "只有在画面明显不是苏州、没有地标、没有建筑/景区/城市线索时，才返回 sceneId=unknown。",
    "如果画面是东方之门双塔，请返回 dongfangzhimen，不要返回金鸡湖。",
    "如果画面是寒山寺寺塔/寺院建筑，请返回 hanshansi。",
    "如果画面有平江路牌匾/水巷石桥白墙黛瓦，请返回 pingjianglu。",
    "输出 JSON，不要 Markdown。字段：sceneId, landmarkName, confidence, isSuzhou, evidence, candidates, recommendedExperience, answerMode。",
    `knownScenes=${JSON.stringify(knownScenes)}`
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: MIMO_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: rescuePrompt },
            mediaPart
          ]
        }
      ],
      temperature: 0
    });
    return parseJsonFromModel(completion.choices?.[0]?.message?.content, UNKNOWN_RESULT);
  } catch {
    return UNKNOWN_RESULT;
  }
}

function normalizeRecognition(result, scenes) {
  const candidates = normalizeCandidates(result.candidates, scenes);
  if (candidates.length > 1) {
    const top = candidates[0];
    return {
      sceneId: top.sceneId,
      landmarkName: top.landmarkName,
      confidence: top.confidence,
      isSuzhou: true,
      evidence: toEvidence(result.evidence),
      candidates,
      recommendedExperience: "choose_landmark",
      answerMode: "choose"
    };
  }

  if (result.sceneId === "open_suzhou") {
    return {
      sceneId: "open_suzhou",
      landmarkName: result.landmarkName || "苏州地标",
      confidence: clampConfidence(result.confidence),
      isSuzhou: true,
      evidence: toEvidence(result.evidence),
      candidates,
      recommendedExperience: "show_light_card",
      answerMode: "lite"
    };
  }

  const scene = scenes.find((item) => item.id === result.sceneId);
  if (!scene) {
    return {
      ...UNKNOWN_RESULT,
      evidence: toEvidence(result.evidence),
      candidates
    };
  }

  return {
    sceneId: scene.id,
    landmarkName: result.landmarkName || scene.name,
    confidence: clampConfidence(result.confidence),
    isSuzhou: true,
    evidence: toEvidence(result.evidence),
    candidates: candidates.length ? candidates : [{
      sceneId: scene.id,
      landmarkName: scene.name,
      confidence: clampConfidence(result.confidence),
      reason: "主识别结果"
    }],
    recommendedExperience: result.recommendedExperience || (scene.fullDemo ? "open_full_demo" : "show_light_card"),
    answerMode: result.answerMode || (scene.fullDemo ? "full" : "lite")
  };
}

function correctKnownConfusions(result) {
  const text = JSON.stringify(result || {});
  const mentionsGate = /东方之门|東方之門|秋裤楼|Gate of the Orient|双塔|拱门|苏州中心/.test(text);
  if (mentionsGate && (result.sceneId === "jinjihu" || /金鸡湖/.test(text))) {
    return {
      ...result,
      sceneId: "dongfangzhimen",
      landmarkName: "东方之门",
      evidence: [...toEvidence(result.evidence), "纠偏：画面核心是东方之门双塔，不泛化为金鸡湖。"],
      recommendedExperience: "show_light_card",
      answerMode: "lite"
    };
  }

  const mentionsPingjiangSign = /遇见平江路|平江路|Pingjiang Road|红灯笼|白墙黛瓦|牌匾/.test(text);
  if (mentionsPingjiangSign && result.sceneId !== "pingjianglu") {
    return {
      ...result,
      sceneId: "pingjianglu",
      landmarkName: "平江路",
      confidence: Math.max(Number(result.confidence || 0), 0.86),
      isSuzhou: true,
      evidence: [...toEvidence(result.evidence), "纠偏：识别到平江路牌匾或典型街巷特征。"],
      recommendedExperience: "open_full_demo",
      answerMode: "full"
    };
  }

  const mentionsHanshanTower = /寒山寺|普明宝塔|寺塔|枫桥|钟楼|夜半钟声|姑苏城外/.test(text);
  if (mentionsHanshanTower && result.sceneId !== "hanshansi") {
    return {
      ...result,
      sceneId: "hanshansi",
      landmarkName: "寒山寺",
      confidence: Math.max(Number(result.confidence || 0), 0.84),
      isSuzhou: true,
      evidence: [...toEvidence(result.evidence), "纠偏：识别到寒山寺寺塔/钟声/枫桥相关特征。"],
      recommendedExperience: "open_full_demo",
      answerMode: "full"
    };
  }

  return result;
}

function normalizeCandidates(candidates, scenes) {
  if (!Array.isArray(candidates)) return [];

  return candidates
    .map((candidate) => {
      const scene = scenes.find((item) => item.id === candidate.sceneId);
      if (scene) {
        return {
          sceneId: scene.id,
          landmarkName: candidate.landmarkName || scene.name,
          confidence: clampConfidence(candidate.confidence),
          reason: String(candidate.reason || scene.triggerRule || "识别到苏州核心地标")
        };
      }
      if (candidate.sceneId === "open_suzhou" || candidate.landmarkName) {
        return {
          sceneId: "open_suzhou",
          landmarkName: String(candidate.landmarkName || "苏州地标"),
          confidence: clampConfidence(candidate.confidence),
          reason: String(candidate.reason || "识别到苏州相关地标")
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

function fallbackRecognize({ userText, scenes, reason }) {
  const text = String(userText || "").toLowerCase();
  const hits = scenes.filter((item) => {
    const tokens = [...(item.keywords || []), ...(item.aliases || []), item.name];
    return tokens.some((keyword) => text.includes(String(keyword).toLowerCase()));
  });

  if (hits.length > 1) {
    const candidates = hits.slice(0, 5).map((scene, index) => ({
      sceneId: scene.id,
      landmarkName: scene.name,
      confidence: Math.max(0.55, 0.78 - index * 0.06),
      reason: `演示模式命中关键词：${scene.name}`
    }));
    return {
      sceneId: candidates[0].sceneId,
      landmarkName: candidates[0].landmarkName,
      confidence: candidates[0].confidence,
      isSuzhou: true,
      evidence: ["演示模式：补充文本中出现多个苏州地标，交给用户选择。"],
      candidates,
      recommendedExperience: "choose_landmark",
      answerMode: "choose",
      fallbackReason: reason
    };
  }

  if (hits.length === 1) {
    const scene = hits[0];
    return {
      sceneId: scene.id,
      landmarkName: scene.name,
      confidence: 0.72,
      isSuzhou: true,
      evidence: [`演示模式命中关键词：${scene.name}`, scene.triggerRule],
      candidates: [{
        sceneId: scene.id,
        landmarkName: scene.name,
        confidence: 0.72,
        reason: scene.triggerRule
      }],
      recommendedExperience: scene.fullDemo ? "open_full_demo" : "show_light_card",
      answerMode: scene.fullDemo ? "full" : "lite",
      fallbackReason: reason
    };
  }

  const looksSuzhou = ["苏州", "姑苏", "园林", "水巷", "石桥", "白墙黛瓦", "江南"].some((word) => text.includes(word));
  if (looksSuzhou) {
    return {
      sceneId: "open_suzhou",
      landmarkName: "苏州地标",
      confidence: 0.5,
      isSuzhou: true,
      evidence: ["演示模式：当前根据补充文本判断为苏州相关。"],
      candidates: [],
      recommendedExperience: "show_light_card",
      answerMode: "lite",
      fallbackReason: reason
    };
  }

  return {
    ...UNKNOWN_RESULT,
    evidence: reason === "missing_media"
      ? ["没有收到可识别的图像/视频输入。"]
      : ["演示模式：未配置 MIMO_API_KEY，当前仅根据补充文本关键词做弱匹配。"],
    fallbackReason: reason
  };
}

function clampConfidence(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function toEvidence(evidence) {
  return Array.isArray(evidence) ? evidence.map(String).slice(0, 6) : [];
}
