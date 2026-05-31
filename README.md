# 一镜入姑苏 Agent 版

这是《一镜入姑苏》的完整 Agent 项目，包含静态 Demo、Node API 服务、MiMo 视觉识别、苏轼 LLM 对话和部署配置。

## 本地运行

```powershell
cd "G:\Dsektop\黑客松0530\项目开发\一镜入姑苏-Agent"
npm install
Copy-Item .env.example .env
# 编辑 .env，填入 MIMO_API_KEY
npm run dev
```

打开：

- 首页：`http://localhost:8787/`
- 健康检查：`http://localhost:8787/api/health`
- MiMo 文本探针：`http://localhost:8787/api/health?probe=1`
- 视觉探针：`http://localhost:8787/api/vision-probe?sample=pingjiang&raw=1`

## Render 部署

推荐用 Render 部署，因为本项目已经有完整 Node 服务，Render 可以直接运行 `server/index.js`，不需要 Netlify Functions。

1. 进入 Render，选择 `New +` -> `Web Service`。
2. 连接 GitHub 仓库。
3. 选择本项目仓库。
4. 配置：
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm run start`
   - Health Check Path: `/api/health`
5. 添加环境变量：
   - `MIMO_API_KEY`
   - `MIMO_BASE_URL=https://api.xiaomimimo.com/v1`
   - `MIMO_TEXT_MODEL=mimo-v2.5-pro`
   - `MIMO_VISION_MODEL=mimo-v2.5`

部署完成后访问：

- `https://你的-render域名/`
- `https://你的-render域名/api/health?probe=1`

如果返回里 `mimoProbe.ok` 为 `true`，说明文本模型调用成功。

## API

- `GET /api/health`
- `GET /api/health?probe=1`
- `GET /api/vision-probe?sample=pingjiang&raw=1`
- `POST /api/recognize/camera`
- `POST /api/recognize/video`
- `POST /api/chat/sushi`
- `POST /api/route-scene`
- `POST /api/recommendations`

## 说明

- `.env` 不应上传 GitHub。
- `.env.example` 可以上传，用作环境变量模板。
- 真实 API Key 应放在 Render 的 Environment Variables 里。
- `public/` 是前端静态页面和素材。
- `server/` 是 Agent API 后端。
- `netlify/` 和 `netlify.toml` 保留为 Netlify 兼容配置，但当前推荐 Render。
