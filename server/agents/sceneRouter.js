import fs from "node:fs/promises";
import path from "node:path";

const scenesPath = path.resolve("server/data/scenes.json");

let sceneCache;

export async function listScenes() {
  if (!sceneCache) {
    sceneCache = JSON.parse(await fs.readFile(scenesPath, "utf8"));
  }
  return sceneCache;
}

export async function findScene(sceneId) {
  const scenes = await listScenes();
  return scenes.find((scene) => scene.id === sceneId) || null;
}

export async function routeRecognition(recognition) {
  if (recognition.recommendedExperience === "choose_landmark" && recognition.candidates?.length > 1) {
    return {
      experienceLevel: "choose",
      scene: null,
      nextAction: "choose_landmark",
      candidates: recognition.candidates,
      message: "识别到多个苏州地标，请选择你想进入的地标生态页。"
    };
  }

  if (recognition.sceneId === "open_suzhou") {
    return openSuzhouRoute(recognition.landmarkName);
  }

  const scene = await findScene(recognition.sceneId);

  if (!scene) {
    return {
      experienceLevel: "unknown",
      scene: null,
      nextAction: "show_generic_search",
      message: "未识别到苏州地标。可以继续拍摄牌匾、建筑、水巷或视频字幕细节。"
    };
  }

  if (scene.fullDemo) {
    return {
      experienceLevel: "full-demo",
      scene,
      nextAction: "open_demo_scene",
      demoPath: scene.demoPath
    };
  }

  return lightCardRoute(scene);
}

export async function routeSceneById(sceneId, landmarkName = "") {
  if (sceneId === "open_suzhou") return openSuzhouRoute(landmarkName || "苏州地标");

  const scene = await findScene(sceneId);
  if (!scene) return openSuzhouRoute(landmarkName || "苏州地标");
  if (scene.fullDemo) {
    return {
      experienceLevel: "full-demo",
      scene,
      nextAction: "open_demo_scene",
      demoPath: scene.demoPath
    };
  }
  return lightCardRoute(scene);
}

function lightCardRoute(scene) {
  return {
    experienceLevel: "light-card",
    scene,
    nextAction: "show_landmark_card",
    card: {
      title: scene.name,
      subtitle: `${scene.city}关键地标`,
      body: scene.summary,
      suggestedPrompts: [
        `给我讲讲${scene.name}的历史`,
        `推荐${scene.name}附近适合拍视频的位置`,
        `生成一张${scene.name}的打卡分享卡`
      ]
    }
  };
}

function openSuzhouRoute(landmarkName) {
  const name = landmarkName || "苏州地标";
  return {
    experienceLevel: "light-card",
    scene: {
      id: "open_suzhou",
      name,
      city: "苏州",
      summary: `${name}已被识别为苏州相关场景。完整版可继续接入知识库或联网搜索，生成历史介绍、拍摄建议和附近推荐。`
    },
    nextAction: "show_landmark_card",
    card: {
      title: name,
      subtitle: "苏州开放地标识别",
      body: "这是暂未制作完整互动页的苏州地标，可先返回轻量介绍、路线建议和附近消费推荐。",
      suggestedPrompts: [
        `介绍${name}的历史`,
        `推荐${name}附近适合拍视频的位置`,
        `生成一张苏州打卡分享卡`
      ]
    }
  };
}
