# 一镜入姑苏 · 平江路·文化展演场景 MVP

抖音壳子 + AI 船票 + 芸娘三步互动 + 姑苏修学卡分享卡, 纯 vanilla HTML/CSS/JS, 无构建工具, 单页应用.

---

## 如何运行

### 方案 A: 静态服务器 (推荐)

由于 `fetch('./data/*.json')` 在 `file://` 协议下会被浏览器 CORS 拦截, 推荐起一个本地静态服务器:

```bash
# Python 3
cd g:/Dsektop/黑客松0530/项目开发/demo
python -m http.server 8000
# 然后浏览器访问 http://localhost:8000
```

```bash
# 或 Node (npx, 无需安装)
npx http-server -p 8000
```

或使用 VSCode 的 Live Server 插件, 在 `index.html` 上右键 "Open with Live Server".

### 方案 B: 直接双击 index.html

双击 `index.html` 也能跑大部分功能 (Chrome 90+ / Edge 已宽松), 但是 3 份 JSON 数据可能 fetch 失败, 此时会自动回退到模块内置的 fallback 数据, 体验略简但流程完整.

### 调试参数

- `?resume=1` — 从上次 localStorage 进度恢复
- `?debug=1` — 预留调试模式 (打开 console 用 `__DEBUG.jumpTo('STEP_PINGTAN')` 跳到任意状态)

控制台直接可用:

```js
__DEBUG.dumpState();             // 查看当前状态机 + ticket + scene
__DEBUG.jumpTo('STEP_SHOPS');    // 强跳到老字号步
__DEBUG.clear();                 // 清掉 localStorage
```

---

## 文件结构

```
demo/
├── index.html                   主入口
├── README.md                    本文件
├── styles/
│   ├── tokens.css               全局设计 token (色板 / 字体 / 尺寸 / 动画曲线)
│   ├── shell.css                抖音壳子样式 + 长按反馈 + 水墨晕染 + 地标抽屉
│   ├── ticket.css               AI 船票卡片 / 印章 / 金边升级态
│   ├── scene.css                场景 / 立绘 / 对话气泡 / 3 步交互
│   └── share-card.css           分享卡 6 帧动画 / 波形 / 印章
├── scripts/
│   ├── main.js                  window.App 状态机 + 事件总线 + 持久化 + INTRO 钩子
│   ├── ticket.js                window.Ticket 船票引擎
│   ├── shell.js                 window.Shell 抖音壳子 + 长按 + 抽屉
│   ├── scene-pingjianglu.js     window.Scene 3 步互动引擎
│   └── share-card.js            window.ShareCard 分享卡 + html2canvas 导出
├── data/
│   ├── characters.json          芸娘 + 沈复 (彩蛋角色) 立绘路径 / 性格 / 开场白
│   ├── dialogues.json           苏州话 3 句 + 评弹歌词 + 兜底对话池
│   └── shops.json               陆稿荐 / 采芝斋 / 伏羲会馆 3 家老字号
└── assets/                      真实美术资产落地处 (placeholder 期间为空也能跑)
    ├── images/
    ├── videos/
    └── audio/
```

---

## 真实资产替换路径

所有占位都用 CSS / SVG / Emoji 渲染, 真资产到位后**只替换文件即可, 不需要改 DOM 结构**.

### `assets/images/`

| 文件名 | 用途 | 占位实现 |
|---|---|---|
| `yuniang_portrait_01.png` | 芸娘立绘 (主) | CSS 圆形头像 `.character-portrait[data-char="yunniang"]` 显示 "芸" 字 |
| `shenfu_portrait_01.png` | 沈复立绘 (彩蛋) | CSS 圆形头像显示 "复" 字 |
| `pingjianglu-bg.jpg` | 平江路场景背景 | `.scene-bg` CSS 渐变 + SVG 拱桥剪影 + 水面 keyframes |
| `ink-ripple.svg` | 水墨晕染纹理 | `.ink-ripple` CSS keyframes (径向渐变 + scale + blur) |
| `shops/lugaojian_icon.png` | 陆稿荐 icon | Emoji 🥩 + 朱砂红圆角块 |
| `shops/caizhizhai_icon.png` | 采芝斋 icon | Emoji 🍬 + 暖金圆角块 |
| `shops/fuxihuiguan_icon.png` | 伏羲会馆 icon | Emoji 🍵 + 烟雨青圆角块 |

### `assets/videos/`

| 文件名 | 用途 | 占位实现 |
|---|---|---|
| `VID-001-boat-pov.mp4` | 信息流游船 POV (船过平江路) | `.feed__video` CSS 水波 keyframes + 灯笼 + 拱桥剪影 |
| `VID-002-ink-ripple.mp4` | 长按触发的水墨晕染 | `.ink-ripple` 1.5s CSS keyframes |
| `VID-003-rowing-boat.mp4` | 摇橹船入场 | `.boat-rowing` 1.8s CSS keyframes (左→中, 带轻微旋转) |
| `VID-005-intro-hook.mp4` | 1.2s 开场钩子片头 | `.intro-hook` CSS 水墨 + 标题渐显 |

真视频接入示意 (`shell.js` `playFeed`):
```html
<video src="assets/videos/VID-001-boat-pov.mp4"
       muted playsinline autoplay loop
       webkit-playsinline="true"
       x5-video-player-type="h5-page" preload="auto"></video>
```

### `assets/audio/`

| 文件名 | 用途 | 占位实现 |
|---|---|---|
| `suzhou_line_1_neihao.mp3` | 苏州话第 1 句"倷好呀" | 静音 mock (按钮转 "♪ 播放中..." 0.9s) |
| `suzhou_line_2_baixiang.mp3` | 苏州话第 2 句"蛮好白相" | 同上 |
| `suzhou_line_3_zaihui.mp3` | 苏州话第 3 句"再会, 下趟来白相" | 同上 |
| `pingtan_yuniang_youhu.mp3` | 评弹《白蛇·游湖》半阕 | 静音 mock (3s 录音进度条 + 假波形) |
| `BGM-pingjianglu.mp3` | 平江路场景背景音乐 | 未播 |
| `SFX-stamp.mp3` | 盖章音效 | 未播 (注释里已留 TODO) |

音频解锁: 用户首次点击 "开始姑苏之旅" 按钮时由 `main.js unlockAudio()` 静音 play 一次 dummy Audio, 之后真音频可直接 play.

---

## 已知 TODO

- [ ] **真实 P0 视频接入** — 替换 4 段 `assets/videos/` 后, 在 `shell.js playFeed()` 内将 `.feed-video__placeholder` 切成 `<video>` 标签 (已留 TODO 注释)
- [ ] **真实 P0 音频接入** — 替换 `assets/audio/` 后, `scene-pingjianglu.js _runSuzhou()` 的 `playBtn` 内取消 mock, 改为 `new Audio(line.audio).play()` (`// TODO: integrate real audio` 已标注)
- [ ] **真实麦克风录音** — 评弹跟唱用 `navigator.mediaDevices.getUserMedia({audio:true})` + `MediaRecorder` 取波形, MVP 阶段全程 mock 3s 进度条 + 假波形 (`// TODO: integrate MediaRecorder` 已标注)
- [ ] **真实美术立绘** — 替换 `assets/images/yuniang_portrait_01.png` 与 `shenfu_portrait_01.png` 后, 在 `scene.css` 把 `.character-portrait[data-char="yunniang"]::before` 的 `content: "芸"` 改成 `background-image: url(...)`, 移除字体兜底
- [ ] **真实 Claude / AI 接入** — 当前芸娘对话池硬编码在 `characters.json` 的 `fallbackPool` 与 `dialogues.json` 的 `scene_transition_lines`, 后续可接 Claude API (建议 Sonnet 4.6 / Opus 4.6, 用 system prompt 注入芸娘 `systemPromptSummary`, 接入入口在 `Scene.showDialogue` 调用前)
- [ ] **真抖音跳转** — `share-card.js simulateDouyinJump()` 当前用 `snssdk1128://` schema 尝试调起, 失败也只是 toast, 真接入需对接抖音开放平台 SDK
- [ ] **iOS Safari 录音权限弹窗** — 真接入麦克风时需要在用户点击事件回调内首次请求权限, 当前 mock 不触发该弹窗

---

## 演示路径 (10 步主循环)

完整体验大约 90 秒:

1. **打开链接 / 启动** — 加载 Noto Serif SC 字体, INTRO 钩子片头 1.2s (`.intro-hook` 水墨 + "一镜入姑苏 · 平江路 ·" 渐显)
2. **AI 船票从右上滑入** — 随机生成 `姑苏号·MMDD-XXXX` + `{苏州姓氏}客` + `品级/角色/元素/特长` 身份, 显示 "开始姑苏之旅" 红色 CTA
3. **点击 CTA** — `unlockAudio()` 首次音频解锁, 状态机进入 `FEED_BROWSING`
4. **抖音壳子展开 + 信息流自动播放** — VID-001 占位 (CSS 水波 + 灯笼 + 拱桥剪影), 右侧操作栏可点 (toast 兜底), 底部"长按视频试试看 →"提示
5. **长按视频 ≥ 500ms** — 触发 `.ink-ripple` 水墨晕染 1.5s (从按下点径向扩散)
6. **平江路地标卡浮现** — 底部抽屉滑入, 显示 "平江路 · 国家级历史文化街区" + 800 年河巷 / 评弹 / 老字号 chip + "和芸娘聊聊" / "回去看视频" 双按钮
7. **点 "和芸娘聊聊"** — 隐藏抖音壳子, 进入场景: 摇橹船 ⛵ 从左划入 (1.8s) + 芸娘立绘登场 (CSS 圆形头像)
8. **开场对话气泡 (×2)** — 点击气泡 / 对话区推进
9. **第 1 桩 · 苏州话听辨挑战** — 3 道选择题, 每题给出苏州话原句 + 翻译 + 3 个读音选项 (普通话/上海话/真苏州话). 用户选 → 即时反馈对错 + 解释 (入声/吴语特征) + 文化彩蛋. 全部答完按对题数评级"苏州话品鉴师 X 品" → 船票第 1 个印章
10. **第 2 桩 · 评弹半句跟唱** — 芸娘 pose 切 singing, 显示 《白蛇·游湖》半阕歌词, 点 "按住跟唱" → 3s mock 录音进度条 → 朱砂红波形 SVG + "共鸣度 X/10" → 船票第 2 个印章
11. **第 3 桩 · 老字号探宝** — 3 张横滑卡 (陆稿荐 / 采芝斋 / 伏羲会馆), 点 ♡ 收藏, 3 张全收藏后 "完成探宝 →" 可点 → 船票第 3 个印章
12. **姑苏修学卡 6 帧动画生成** — 每帧 ~600ms (共 3.6s): 底纹 → 边框 → 标题 → 嗲度+印章 → 波形+老字号 → 二维码+卡号
13. **船票升级金边版** — `.is-golden` 类加金边脉冲 + 寄语更新为 "三章既毕, 嗲度满分..."
14. **分享按钮可用** — "保存 PNG" (html2canvas 导出 / 移动端长按保存模态) + "一键发抖音" (复制文案 + 调起 `snssdk1128://` schema)

---

## 状态机 (20 个状态)

`window.App.STATES`, 严格按 `ALLOWED_TRANSITIONS` 校验:

```
IDLE → INTRO_PLAYING → TICKET_ISSUING → TICKET_READY → FEED_BROWSING
  → LANDMARK_LONGPRESS ⇄ FEED_BROWSING
  → LANDMARK_DETECTED → LANDMARK_CARD_SHOW → SCENE_ENTERING → SCENE_DIALOGUE_INTRO
  → STEP_SUZHOU → STEP_SUZHOU_DONE
  → STEP_PINGTAN → STEP_PINGTAN_DONE
  → STEP_SHOPS → STEP_SHOPS_DONE
  → CARD_GENERATING → TICKET_UPGRADING → SHARE_DISPLAY → SHARE_DONE → IDLE
```

非法跳转仅 `console.warn` 拒绝, 不抛错. 持久化只在锚点写盘 (`TICKET_READY` / `SCENE_DIALOGUE_INTRO` / `STEP_PINGTAN` / `STEP_SHOPS` / `SHARE_DISPLAY`).

localStorage keys:
- `gusu.ticket.v1` — 船票数据
- `gusu.progress.v1` — 进度 (state / scores / collectedShops / timestamp)
- `gusu.flags.v1` — 音频解锁等 flag

---

## 浏览器兼容

- Chrome 90+ / Edge 90+ / Safari 14+ (推荐)
- 桌面 + 移动端均可 (9:16 抖音竖屏, `max-width: 432px` 居中)
- iOS Safari 已处理: `100dvh` 兜底 / `-webkit-user-select: none` / `touchstart` `passive: false`
- 微信 X5 内核: 真视频接入时记得加 `x5-video-player-type="h5-page"` 属性
