/* Agent bridge: keep the polished demo UI, replace hard-coded recognition with Agent API. */
(function () {
  "use strict";

  const FULL_DEMO_SCENES = new Set(["pingjianglu", "hanshansi"]);
  const FEED_MODES = {
    boat: {
      video: "assets/videos/pingjiang_boat.mp4",
      tag: "",
      tip: "点我，感受姑苏雅韵",
      author: "@今天也在河边发呆",
      desc: "游苏州，不必赶路。点击小镜，打开相机识别你眼前的姑苏地标。",
      tags: ["#一镜入姑苏", "#苏州文旅", "#视觉搜索"],
      bgm: "♪ 游苏州"
    },
    pingjiang: {
      video: "assets/videos/pingjiang.mp4",
      tag: "[VID-002 · 平江路]",
      tip: "识别到平江路，点我继续探索",
      author: "@平江路慢游局",
      desc: "水巷、石桥、白墙黛瓦都在镜头里。AI 已识别平江路，点击小镜进入芸娘的姑苏旧梦。",
      tags: ["#一镜入姑苏", "#平江路", "#苏州citywalk"],
      bgm: "♪ 平江路水巷"
    },
    hanshan: {
      video: "assets/videos/hanshansi.mp4",
      tag: "[VID-003 · 寒山寺]",
      tip: "识别到寒山寺，点我继续探索",
      author: "@枫桥夜泊不睡觉",
      desc: "钟声、寺塔和枫桥夜色都被小镜认出来了。点击进入寒山寺，与苏轼聊一聊。",
      tags: ["#一镜入姑苏", "#寒山寺", "#枫桥夜泊"],
      bgm: "♪ 寒山寺钟声"
    }
  };

  function patchWhenReady() {
    if (!window.Shell) {
      setTimeout(patchWhenReady, 60);
      return;
    }
    patchShell(window.Shell);
  }

  function patchShell(Shell) {
    if (Shell.__agentBridgePatched) return;
    Shell.__agentBridgePatched = true;

    injectStyles();

    const originalWireFeedAgent = Shell._wireFeedAgent?.bind(Shell);
    const originalWireDemoSwitcher = Shell._wireDemoSwitcher?.bind(Shell);
    const originalSimulateScan = Shell._simulateScan?.bind(Shell);
    const originalHandleCapture = Shell._handleCapture?.bind(Shell);

    Shell._wireDemoSwitcher = function patchedWireDemoSwitcher(root) {
      if (originalWireDemoSwitcher) originalWireDemoSwitcher(root);
      const currentRoot = root || this.rootEl || document.getElementById("shell-root");
      currentRoot?.querySelectorAll("[data-demo-mode]").forEach((btn) => {
        btn.onclick = (event) => {
          event.stopPropagation();
          this._setFeedMode(btn.getAttribute("data-demo-mode") || "boat");
        };
      });
    };

    Shell._setFeedMode = function patchedSetFeedMode(mode = "boat", silent) {
      const root = this.rootEl || document.getElementById("shell-root");
      const feed = root?.querySelector(".feed");
      if (!root || !feed) return;
      const next = normalizeFeedMode(mode);
      this._feedMode = next;
      root.dataset.demoMode = next;
      feed.dataset.demoMode = next;

      root.querySelectorAll("[data-demo-mode]").forEach((btn) => {
        btn.classList.toggle("is-active", normalizeFeedMode(btn.getAttribute("data-demo-mode")) === next);
      });

      applyFeedMode(root, next);
      this._wireFeedAgent(root);
      if (!silent) {
        const toastText = next === "boat" ? "已切到游苏州入口" : next === "pingjiang" ? "已切到平江路视频入口" : "已切到寒山寺视频入口";
        this.toast?.(toastText, 900);
      }
    };

    Shell._wireFeedAgent = function patchedWireFeedAgent(root) {
      if (originalWireFeedAgent) originalWireFeedAgent(root);
      const currentRoot = root || this.rootEl || document.getElementById("shell-root");
      if (!currentRoot) return;

      const enter = (event) => {
        event?.preventDefault();
        event?.stopPropagation();
        event?.stopImmediatePropagation();
        recognizeCurrentVideoOrCamera(this, currentRoot);
      };

      currentRoot.querySelector(".feed-agent")?.addEventListener("click", enter, { capture: true });
      currentRoot.querySelector(".feed-agent-tip")?.addEventListener("click", enter, { capture: true });
      applyFeedMode(currentRoot, currentRoot.dataset.demoMode || this._feedMode || "boat", true);
    };

    Shell._simulateScan = async function patchedSimulateScan(silent) {
      const root = this.rootEl || document.getElementById("shell-root");
      const shell = root?.querySelector(".camera-shell");
      if (!shell) {
        return originalSimulateScan ? originalSimulateScan(silent) : undefined;
      }

      const label = root.querySelector(".scan-label");
      const recognize = root.querySelector(".camera-recognize");
      if (recognize) recognize.hidden = true;
      if (label) label.textContent = "AI 正在识别画面里的苏州地标，可以放下手机稍等。";
      shell.classList.add("is-locking");

      const frameDataUrl = captureVideoFrame(root.querySelector(".camera-live"));
      showRecognitionPreview(root, frameDataUrl);
      const result = await postJson("/api/recognize/camera", {
        imageDataUrl: frameDataUrl,
        userText: frameDataUrl ? "" : "相机画面，等待识别苏州地标"
      });

      if (label) label.textContent = "识别结果已生成，正在进入对应页面...";
      await routeAgentResult(this, result, { fromCamera: true });
    };

    Shell._handleCapture = function patchedHandleCapture() {
      const root = this.rootEl || document.getElementById("shell-root");
      const isRecognitionCamera = !!root?.querySelector(".camera-shell") && !root?.querySelector(".photo-capture-page");
      if (isRecognitionCamera) {
        this._simulateScan?.();
        return;
      }
      if (originalHandleCapture) originalHandleCapture();
    };

    Shell._showHanshanTalk = function patchedShowHanshanTalk() {
      const talks = [
        {
          title: "打工人版",
          user: "苏先生，我最近被老板针对，想辞职，又怕找不到下家。",
          reply: "客官，你这点遭遇，我老苏听了想笑。我四十四岁被乌台诗案一路送到黄州，米都买不起，倒把东坡肉炖出来了。辞不辞职你自己定，但记住：人生海海，挂个几次，东坡肉就出来了。"
        },
        {
          title: "深夜 emo 版",
          user: "苏先生，深夜睡不着，特别想一个人。",
          reply: "我懂。我也想过一个人。十年生死两茫茫，不思量，自难忘。客官，寒山寺外有月亮，你抬头看一看。但愿人长久，千里共婵娟。"
        },
        {
          title: "在外漂泊版",
          user: "苏先生，我在外漂泊好多年，一直没有归属感。",
          reply: "客官，归属感不在户口本上，在你自己心里安不安。我把一句话记了一辈子：此心安处，便是吾乡。等钟声响，那一刻你也是苏州人。"
        }
      ];

      const panel = this._setHanshanPanel?.(`
        <div class="hanshan-card hanshan-card--talk">
          <button class="panel-close" type="button" data-hanshan-close>×</button>
          <div class="camera-page__eyebrow">苏轼夜话</div>
          <h2>和苏轼对话</h2>
          <div class="hanshan-talk"></div>
        </div>
      `);
      const box = panel && panel.querySelector(".hanshan-talk");
      if (!box) return;

      const renderChoice = () => {
        box.innerHTML = `
          <p>客官，今夜钟声正好。你可以选一个问题，也可以自己问苏先生。</p>
          <div class="camera-quiz__options">
            ${talks.map((item, i) => `<button type="button" data-talk-choice="${i}">${escapeHtml(item.user)}</button>`).join("")}
          </div>
          <div class="hanshan-talk__custom">
            <textarea data-sushi-input placeholder="写下你想问苏轼的话"></textarea>
            <button type="button" data-sushi-send>问苏轼</button>
          </div>
          <div class="hanshan-talk__result" hidden></div>
        `;

        box.querySelectorAll("[data-talk-choice]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const item = talks[Number(btn.getAttribute("data-talk-choice"))];
            renderReply(item.user, item.reply, item.title);
          });
        });

        box.querySelector("[data-sushi-send]")?.addEventListener("click", async () => {
          const input = box.querySelector("[data-sushi-input]");
          const message = String(input?.value || "").trim();
          if (!message) {
            this.toast?.("先写一句想问苏轼的话", 1000);
            return;
          }
          const result = box.querySelector(".hanshan-talk__result");
          result.hidden = false;
          result.innerHTML = "<strong>苏轼正在听你说...</strong>";
          try {
            const data = await postJson("/api/chat/sushi", { message });
            const answer = data.reply?.answer || "客官，风过寒山寺，话已在钟声里。";
            renderReply(message, answer, "自由提问");
          } catch {
            result.innerHTML = "<strong>苏轼暂时没有听清，请再问一次。</strong>";
          }
        });
      };

      const renderReply = (question, answer, title) => {
        const paragraphs = String(answer).split(/\n+/).filter(Boolean);
        box.innerHTML = `
          <div class="hanshan-talk__thread">
            <div class="hanshan-talk__user"><strong>你</strong><span>${escapeHtml(question)}</span></div>
            <div class="hanshan-talk__sushi">
              <strong>苏轼</strong>
              ${paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
            </div>
          </div>
          <div class="memory-actions hanshan-talk__actions">
            <button type="button" data-talk-more>换个问题</button>
            <button type="button" data-hanshan-share>分享苏轼金句</button>
          </div>
        `;
        box.querySelector("[data-talk-more]")?.addEventListener("click", renderChoice);
        box.querySelector("[data-hanshan-share]")?.addEventListener("click", () => this._showDouyinShareDialog?.(panel, `${title || "苏轼"}寒山寺夜话已带入发布器`));
      };

      renderChoice();
    };

    const originalMountCameraShell = Shell._mountCameraShell?.bind(Shell);
    Shell._mountCameraShell = function patchedMountCameraShell(root) {
      if (originalMountCameraShell) originalMountCameraShell(root);
      const currentRoot = this.rootEl || root || document.getElementById("shell-root");
      const recognize = currentRoot?.querySelector(".camera-recognize");
      if (recognize) recognize.hidden = true;
      const label = currentRoot?.querySelector(".scan-label");
      if (label) label.textContent = "对准苏州地标，点击下方拍摄键开始识别";
    };

    Shell._mountOpenLandmarkPage = function mountOpenLandmarkPage(scene, card) {
      const root = this.rootEl || document.getElementById("shell-root");
      if (!root) return;
      this._pausePingjiangBgm?.(false);
      this._pauseHanshanBgm?.(false);
      stopCameraStream(this);
      const title = scene?.name || card?.title || "苏州地标";
      const body = card?.body || scene?.summary || `${title}已被识别为苏州地标。这里可以接入知识库，生成景点介绍、历史背景和附近推荐。`;

      root.innerHTML = `
        <div class="agent-landmark-page">
          <button class="camera-back" type="button" data-agent-back aria-label="返回">‹</button>
          <div class="agent-landmark-page__wash"></div>
          <div class="agent-landmark-page__card">
            <span>识别到苏州地标</span>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(body)}</p>
            <small>AI 已根据画面中的文字、建筑形态和苏州地标特征生成此介绍。</small>
          </div>
        </div>
      `;
      root.querySelector("[data-agent-back]")?.addEventListener("click", () => this._returnToFeed?.());
      this.rootEl = root;
      this.shellEl = root;
    };

    Shell._showAgentCandidates = function showAgentCandidates(candidates) {
      const root = this.rootEl || document.getElementById("shell-root");
      if (!root) return;
      root.querySelector(".agent-choice-overlay")?.remove();
      const overlay = document.createElement("div");
      overlay.className = "agent-choice-overlay";
      overlay.innerHTML = `
        <div class="agent-choice-card">
          <button class="agent-choice-card__close" type="button" data-agent-choice-close>×</button>
          <strong>识别到多个苏州地标</strong>
          <p>请选择你想进入的地标生态页。</p>
          <div class="agent-choice-list">
            ${candidates.map((item) => `
              <button type="button" data-agent-scene="${escapeHtml(item.sceneId)}" data-agent-name="${escapeHtml(item.landmarkName)}">
                <span>${escapeHtml(item.landmarkName)}</span>
                <small>${Math.round((item.confidence || 0) * 100)}% · ${escapeHtml(item.reason || "苏州地标候选")}</small>
              </button>
            `).join("")}
          </div>
        </div>
      `;
      root.appendChild(overlay);
      overlay.querySelector("[data-agent-choice-close]")?.addEventListener("click", () => overlay.remove());
      overlay.querySelectorAll("[data-agent-scene]").forEach((button) => {
        button.addEventListener("click", async () => {
          const sceneId = button.getAttribute("data-agent-scene");
          const landmarkName = button.getAttribute("data-agent-name");
          overlay.remove();
          const routed = await postJson("/api/route-scene", { sceneId, landmarkName });
          await routeDirectScene(this, routed.route, { sceneId, landmarkName });
        });
      });
    };

    Shell._showAgentUnknown = function showAgentUnknown() {
      const root = this.rootEl || document.getElementById("shell-root");
      const label = root?.querySelector(".scan-label");
      if (label) label.textContent = "未识别到苏州地标，请靠近牌匾、路牌、寺塔、园林或水巷细节再试。";
      this.toast?.("未识别到苏州地标", 1300);
      const recognize = root?.querySelector(".camera-recognize");
      if (recognize) recognize.hidden = false;
      root?.querySelector(".camera-shell")?.classList.remove("is-locking");
    };

    Shell._wireDemoSwitcher(Shell.rootEl || document.getElementById("shell-root"));
    Shell._wireFeedAgent(Shell.rootEl || document.getElementById("shell-root"));
    Shell._setFeedMode(Shell._feedMode || "boat", true);
  }

  async function recognizeCurrentVideoOrCamera(shell, root) {
    const mode = normalizeFeedMode(root.dataset.demoMode || shell._feedMode || "boat");
    if (mode === "boat") {
      shell._enterCameraFromFeed?.(root);
      return;
    }

    if (mode === "pingjiang") {
      showInlineStatus(root, "识别到平江路，正在进入生态页...");
      setTimeout(() => {
        hideInlineStatus(root);
        shell._playPingjiangInkOpen?.();
      }, 620);
      return;
    }

    if (mode === "hanshan") {
      showInlineStatus(root, "识别到寒山寺，正在进入生态页...");
      setTimeout(() => {
        hideInlineStatus(root);
        shell._mountHanshanScene?.(root);
      }, 620);
      return;
    }
  }

  async function routeAgentResult(shell, result) {
    hideRecognitionPreview(shell.rootEl || document.getElementById("shell-root"));
    const route = result.route || {};
    const recognition = result.recognition || {};

    if (route.nextAction === "choose_landmark") {
      shell._showAgentCandidates?.(route.candidates || recognition.candidates || []);
      return;
    }

    if (route.nextAction === "open_demo_scene") {
      await routeDirectScene(shell, route, recognition);
      return;
    }

    if (route.nextAction === "show_landmark_card") {
      shell._mountOpenLandmarkPage?.(route.scene, route.card);
      return;
    }

    shell._showAgentUnknown?.();
  }

  async function routeDirectScene(shell, route, recognition) {
    const sceneId = route?.scene?.id || recognition?.sceneId;
    if (sceneId === "pingjianglu") {
      shell._playPingjiangInkOpen?.();
      return;
    }
    if (sceneId === "hanshansi") {
      const root = shell.rootEl || document.getElementById("shell-root");
      showInlineStatus(root, "水墨转场，进入寒山寺...");
      setTimeout(() => {
        hideInlineStatus(root);
        shell._mountHanshanScene?.(root);
      }, 720);
      return;
    }
    shell._mountOpenLandmarkPage?.(route?.scene, route?.card);
  }

  function normalizeFeedMode(mode) {
    if (mode === "hanshan" || mode === "hanshansi") return "hanshan";
    if (mode === "pingjiang" || mode === "pingjianglu") return "pingjiang";
    return "boat";
  }

  function applyFeedMode(root, mode, keepPlayingState) {
    if (!root) return;
    const next = normalizeFeedMode(mode);
    const config = FEED_MODES[next];
    const tag = root.querySelector(".feed__tag");
    const tip = root.querySelector(".feed-agent-tip");
    const author = root.querySelector(".feed__author");
    const desc = root.querySelector(".feed__desc");
    const tags = root.querySelector(".feed__tags");
    const bgm = root.querySelector(".feed__bgm-text");
    if (tag) tag.textContent = config.tag;
    if (tip) tip.textContent = config.tip;
    if (author) author.textContent = config.author;
    if (desc) desc.textContent = config.desc;
    if (tags) {
      tags.innerHTML = config.tags.map((item) => `<button class="feed__tag-item" type="button" data-feed-link="tag">${item}</button>`).join("");
    }
    if (bgm) bgm.textContent = config.bgm;

    const video = root.querySelector(".feed__real-video");
    if (!video) return;
    const src = config.video;
    if (!video.getAttribute("src")?.endsWith(src)) {
      video.dataset.userPaused = "0";
      video.src = src;
    }
    video.hidden = false;
    if (!keepPlayingState && video.dataset.userPaused !== "1") video.play().catch(() => {});
  }

  function captureVideoFrame(video) {
    if (!video || !video.videoWidth || !video.videoHeight) return "";
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return response.json();
  }

  function showInlineStatus(root, text) {
    if (!root) return;
    root.querySelector(".agent-inline-status")?.remove();
    const status = document.createElement("div");
    status.className = "agent-inline-status";
    status.innerHTML = `<span></span><strong>${escapeHtml(text)}</strong>`;
    root.appendChild(status);
  }

  function hideInlineStatus(root) {
    root?.querySelector(".agent-inline-status")?.remove();
  }

  function showRecognitionPreview(root, frameDataUrl) {
    if (!root) return;
    root.querySelector(".agent-recognition-preview")?.remove();
    const preview = document.createElement("div");
    preview.className = "agent-recognition-preview";
    preview.innerHTML = `
      <div class="agent-recognition-preview__shot">
        ${frameDataUrl ? `<img src="${frameDataUrl}" alt="拍摄画面">` : "<div></div>"}
      </div>
      <div class="agent-recognition-preview__copy">
        <span></span>
        <strong>AI 正在识别苏州地标</strong>
        <p>画面已捕捉，可以放下手机稍等。</p>
      </div>
    `;
    root.appendChild(preview);
  }

  function hideRecognitionPreview(root) {
    root?.querySelector(".agent-recognition-preview")?.remove();
  }

  function stopCameraStream(shell) {
    if (shell._cameraStream) {
      shell._cameraStream.getTracks().forEach((track) => track.stop());
      shell._cameraStream = null;
    }
    shell._stopVisualDetector?.();
    shell._clearCameraTimers?.();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .agent-inline-status,
      .agent-choice-overlay {
        position: absolute;
        z-index: 80;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(16, 11, 8, .36);
        backdrop-filter: blur(6px);
      }

      .camera-shell .camera-recognize {
        display: none !important;
      }

      .agent-recognition-preview {
        position: absolute;
        z-index: 90;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 26px;
        background: rgba(16, 12, 9, .48);
        backdrop-filter: blur(9px);
      }

      .agent-recognition-preview__shot {
        width: 76%;
        aspect-ratio: 9 / 14;
        overflow: hidden;
        border: 1px solid rgba(255, 245, 210, .55);
        border-radius: 22px;
        box-shadow: 0 18px 70px rgba(0,0,0,.42);
        background: linear-gradient(160deg, #50636a, #17242a);
      }

      .agent-recognition-preview__shot img,
      .agent-recognition-preview__shot div {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .agent-recognition-preview__copy {
        margin-top: 18px;
        padding: 18px 20px;
        border-radius: 20px;
        color: #fff8dc;
        background: rgba(42, 31, 22, .72);
        text-align: center;
        box-shadow: 0 12px 46px rgba(0,0,0,.3);
      }

      .agent-recognition-preview__copy span {
        display: block;
        width: 34px;
        height: 34px;
        margin: 0 auto 10px;
        border: 3px solid rgba(255,255,255,.24);
        border-top-color: #fff1bd;
        border-radius: 50%;
        animation: agentSpin 850ms linear infinite;
      }

      .agent-recognition-preview__copy strong {
        display: block;
        font-size: 18px;
      }

      .agent-recognition-preview__copy p {
        margin: 8px 0 0;
        color: rgba(255, 248, 220, .78);
      }

      .agent-inline-status {
        pointer-events: none;
      }

      .agent-inline-status span {
        width: 42px;
        height: 42px;
        margin-bottom: 14px;
        border: 3px solid rgba(255,255,255,.32);
        border-top-color: #fff1c0;
        border-radius: 50%;
        animation: agentSpin 850ms linear infinite;
      }

      .agent-inline-status {
        color: #fff7dd;
        font-weight: 800;
        text-shadow: 0 2px 10px rgba(0,0,0,.45);
      }

      .agent-choice-card {
        width: min(86%, 340px);
        padding: 22px;
        border-radius: 24px;
        color: #30241b;
        background: rgba(255, 249, 235, .94);
        box-shadow: 0 22px 70px rgba(0,0,0,.32);
      }

      .agent-choice-card__close {
        float: right;
        width: 34px;
        height: 34px;
        border: 0;
        border-radius: 50%;
        background: rgba(0,0,0,.08);
        font-size: 22px;
      }

      .agent-choice-card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 20px;
      }

      .agent-choice-card p {
        margin: 0 0 14px;
        color: #756452;
      }

      .agent-choice-list {
        display: grid;
        gap: 10px;
      }

      .agent-choice-list button {
        border: 1px solid rgba(129, 94, 48, .18);
        border-radius: 14px;
        padding: 12px 14px;
        color: #34271d;
        background: rgba(255,255,255,.78);
        text-align: left;
      }

      .agent-choice-list span,
      .agent-choice-list small {
        display: block;
      }

      .agent-choice-list span {
        font-weight: 900;
      }

      .agent-choice-list small {
        margin-top: 4px;
        color: #7d6d5d;
      }

      .agent-landmark-page {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: linear-gradient(180deg, #f6ead2, #dfc79f);
      }

      .agent-landmark-page::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          url("assets/images/welcome_suzhou.png") center top / cover no-repeat,
          radial-gradient(circle at 30% 15%, rgba(255,255,255,.7), transparent 34%);
        opacity: .62;
      }

      .agent-landmark-page__wash {
        position: absolute;
        inset: -10%;
        background: radial-gradient(circle at 45% 38%, rgba(255,255,255,.8), transparent 28%),
                    radial-gradient(circle at 72% 68%, rgba(163, 54, 42, .16), transparent 32%);
      }

      .agent-landmark-page__card {
        position: absolute;
        left: 24px;
        right: 24px;
        bottom: 52px;
        padding: 22px;
        border-radius: 24px;
        color: #33271d;
        background: rgba(255, 250, 239, .88);
        box-shadow: 0 18px 60px rgba(85, 57, 27, .22);
      }

      .agent-landmark-page__card span {
        color: #a43b2f;
        font-weight: 900;
      }

      .agent-landmark-page__card h1 {
        margin: 8px 0 10px;
        font-size: 30px;
      }

      .agent-landmark-page__card p {
        margin: 0 0 14px;
        line-height: 1.7;
        color: #655645;
      }

      .agent-landmark-page__card small {
        color: #8a7865;
      }

      .hanshan-talk__custom {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }

      .hanshan-talk__custom textarea {
        min-height: 92px;
        width: 100%;
        resize: vertical;
        border: 1px solid rgba(121, 88, 48, .22);
        border-radius: 14px;
        padding: 12px;
        font: inherit;
        color: #32261c;
        background: rgba(255, 250, 239, .9);
      }

      .hanshan-talk__custom button {
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        color: #fff;
        background: #b9342d;
        font: inherit;
        font-weight: 900;
      }

      .hanshan-talk__result {
        margin-top: 12px;
        padding: 12px;
        border-radius: 14px;
        color: #5d4b3b;
        background: rgba(255, 250, 239, .78);
      }

      @keyframes agentSpin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  patchWhenReady();
})();
