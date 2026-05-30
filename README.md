# 一镜入姑苏 Agent 版

这是在已完成静态 Demo 基础上拆出的独立 Agent 项目，不会修改原 `项目开发/demo` 或 `项目开发/一镜入姑苏`。

## 功能模块

- 相机识别入口：上传/拍摄图片，识别苏州地标；平江路、寒山寺进入完整 Demo，其它苏州地标返回轻量介绍卡。
- 视频识别入口：从视频或视频帧识别苏州地标；寒山寺适合作为视频入口演示，也支持虎丘、胥门、山塘街、拙政园、金鸡湖等开放识别。
- 苏轼对话入口：通过 MiMo 文本模型模拟苏轼 NPC；未配置 API key 时使用本地话术兜底。
- 周边推荐入口：进入地标生态页后，根据地标和用户偏好主动推荐冰淇淋、奶茶、文创、船票等转化项。

## 运行

```powershell
cd "G:\Dsektop\黑客松0530\项目开发\一镜入姑苏-Agent"
npm install
Copy-Item .env.example .env
# 编辑 .env，填入 MIMO_API_KEY
npm run dev
```

打开：

- Demo 首页：`http://localhost:8787/`
- Agent 调试台：`http://localhost:8787/agent-dev.html`
- 健康检查：`http://localhost:8787/api/health`

## Netlify 部署

本项目已经包含 `netlify.toml` 和 `netlify/functions/api.mjs`。上传到 Netlify 时：

1. Build command 可留空，或使用 `npm install`。
2. Publish directory 填 `public`。
3. Functions directory 填 `netlify/functions`。
4. 在 Netlify 的 Environment variables 中添加：
   - `MIMO_API_KEY`
   - `MIMO_BASE_URL=https://api.xiaomimimo.com/v1`
   - `MIMO_TEXT_MODEL=mimo-v2.5-pro`
   - `MIMO_VISION_MODEL=mimo-v2.5`

前端继续请求 `/api/...`，Netlify 会转发到 Function。不要把 API key 写进前端 JS。

## API

- `POST /api/recognize/camera`
  - body: `{ "imageDataUrl": "data:image/png;base64,...", "userText": "可选补充" }`
- `POST /api/recognize/video`
  - body: `{ "videoDataUrl": "data:video/mp4;base64,...", "frameDataUrl": "", "userText": "可选补充" }`
- `POST /api/chat/sushi`
  - body: `{ "message": "苏先生，我最近..." }`
- `POST /api/recommendations`
  - body: `{ "sceneId": "pingjianglu", "userProfile": { "likes": ["奶茶"] } }`

## MiMo 配置

服务端通过 OpenAI-compatible SDK 访问 Xiaomi MiMo：

- `MIMO_BASE_URL=https://api.xiaomimimo.com/v1`
- `MIMO_TEXT_MODEL=mimo-v2.5-pro`
- `MIMO_VISION_MODEL=mimo-v2.5`

没有 `MIMO_API_KEY` 时，项目会进入 fallback-demo 模式：识别接口只根据补充文本关键词做弱匹配，苏轼对话和推荐使用本地兜底内容。

## 地标识别策略

视觉 Agent 现在不是简单分类器，而是两阶段判断：

1. 先判断是不是苏州相关场景，优先读取牌匾、路牌、字幕、店招等文字。
2. 再判断是否命中已制作体验的地标。平江路和寒山寺会进入完整 Demo；其它苏州地标会返回 `open_suzhou` 或轻量介绍卡。

已内置重点地标：平江路、寒山寺、虎丘、胥门、山塘街、拙政园、留园、金鸡湖、苏州博物馆、同里古镇、周庄古镇。

平江路判定被保留为严格策略：看到“平江路”文字时可高置信；没有文字时，需要江南水巷、石桥、白墙黛瓦、河街/摇橹船等强组合特征。
