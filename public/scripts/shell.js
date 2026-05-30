/* =========================================================================
 * shell.js — 抖音壳子 + 信息流 + 长按检测 + 水墨晕染 + 地标抽屉
 * Builder 3 交付
 *
 * 职责:
 *   1. mount(root): 构建抖音 9:16 壳子 (顶 statusbar / 中间 feed / 右操作栏 / 底 tabbar)
 *   2. playFeed/pauseFeed: 信息流视频 (placeholder div + CSS 模拟船过画面)
 *   3. 双击屏幕 → 大红心爆裂动画
 *   4. 长按检测 (mouse+touch 双兼容, 500ms 阈值, 移动 12px 取消)
 *   5. showInkRipple(x,y): 1.5s 水墨晕染
 *   6. showLandmarkDrawer('pingjianglu'): 底部抽屉
 *   7. hideShell/showShell: 进入场景时整体隐藏
 *   8. 右操作栏 (头像/❤/💬/⭐/↗) 点击只 toast
 *
 * 全部通过 CustomEvent 与外界通信, 不直接调其他模块函数 (除 App.toast)
 * ========================================================================= */

(function () {
  'use strict';

  const PRESS_MS = 500;
  const MOVE_THRESHOLD_PX = 12;
  const DOUBLE_TAP_MS = 280;
  const CAMERA_SCENES = [
    { id: 'gate', title: '东方之门', detect: '城市天际线', confidence: '', scanText: '镜头扫过东方之门，继续寻找水巷纹理' },
    { id: 'lake', title: '金鸡湖', detect: '湖面与城市岸线', confidence: '', scanText: '金鸡湖入镜，水面开阔，还不是平江路' },
    { id: 'pingjiang', title: '平江路', detect: '水陆并行的河街', confidence: '', scanText: '小桥、河街与白墙靠近，平江路正在显影' },
  ];
  const PINGJIANG_SCENE_INDEX = 2;

  const Shell = {
    rootEl: null,
    shellEl: null,
    feedEl: null,
    videoLayerEl: null,
    drawerEl: null,
    _longPressEnabled: false,
    _pressTimer: null,
    _pressOrigin: null,
    _lastTapTime: 0,
    _singleTapTimer: null,
    _inkRunning: false,
    _drawerOpen: false,
    _doubleTapWiredEl: null,
    _cameraMode: false,
    _cameraStream: null,
    _cameraFacing: 'environment',
    _yunniangPosition: 'right',
    _cameraSceneIndex: 0,
    _cameraLocked: false,
    _cameraPanOrigin: null,
    _cameraTimers: [],
    _cameraDetectorTimer: null,
    _cameraDetectorCanvas: null,
    _cameraDetectorHits: 0,
    _cameraOcrBusy: false,
    _cameraOcrLastAt: 0,
    _cameraOcrHitUntil: 0,
    _captureMode: 'photo',
    _captureStore: [],
    _mediaRecorder: null,
    _recordedChunks: [],
    _recordingCanvas: null,
    _recordingFrame: null,
    _recordingStopTimer: null,
    _pingjiangBgm: null,
    _pingjiangBgmWanted: false,
    _hanshanBgm: null,
    _hanshanBgmWanted: false,
    _feedTemplate: '',
    _feedMode: 'pingjiang',

    // -----------------------------------------------------------------------
    // mount: 构建整个抖音壳子 DOM
    // -----------------------------------------------------------------------
    mount(rootEl) {
      const root = rootEl || document.getElementById('shell-root');
      if (!root) {
        console.warn('[Shell] #shell-root not found');
        return;
      }

      // index.html 已经提供了一套完整且有样式的抖音壳子。优先复用它,
      // 避免重建一套 class 不匹配的 DOM 导致长按区域和布局失效。
      const existingFeed = root.querySelector('.feed');
      if (existingFeed) {
        this.rootEl = root;
        this.shellEl = root;
        this.feedEl = existingFeed;
        this.videoLayerEl = root.querySelector('#feed-video') || existingFeed.querySelector('.feed__video');
        this._feedTemplate = root.innerHTML;
        this.drawerEl = root.querySelector('.landmark-drawer');
        if (!this.drawerEl) {
          this.drawerEl = document.createElement('div');
          this.drawerEl.className = 'landmark-drawer';
          this.drawerEl.hidden = true;
          this.drawerEl.innerHTML = `
            <div class="landmark-drawer__handle"></div>
            <div class="landmark-drawer__body"></div>
          `;
          root.appendChild(this.drawerEl);
        }
        this._wireFeedActions(root);
        this._wireDemoSwitcher(root);
        this._wireFeedAgent(root);
        this._setFeedMode(root.dataset.demoMode || 'pingjiang', true);
        this._wireDoubleTap();
        this.showShell();
        window.dispatchEvent(new CustomEvent('shell:feed-ready', {
          detail: { videoId: (this.videoLayerEl && this.videoLayerEl.dataset.videoId) || 'VID-001' },
        }));
        return;
      }

      // 已挂载则只显示
      if (this.shellEl && root.contains(this.shellEl)) {
        this.showShell();
        return;
      }
      this.rootEl = root;
      root.innerHTML = '';

      const shell = document.createElement('div');
      shell.className = 'douyin-shell';
      shell.innerHTML = `
        <!-- 顶部状态栏 (iOS 风格) -->
        <div class="douyin-statusbar">
          <span class="douyin-statusbar__time" data-status-time>10:24</span>
          <span class="douyin-statusbar__notch"></span>
          <span class="douyin-statusbar__icons">
            <span class="sb-icon">●●●●</span>
            <span class="sb-icon">📶</span>
            <span class="sb-icon">🔋</span>
          </span>
        </div>

        <!-- 顶部 tab -->
        <div class="douyin-toptab">
          <span class="douyin-toptab__item">同城</span>
          <span class="douyin-toptab__item douyin-toptab__item--active">推荐</span>
          <span class="douyin-toptab__item">关注</span>
          <span class="douyin-toptab__search">🔍</span>
        </div>

        <!-- 视频信息流主体 -->
        <div class="feed-video" data-video-id="">
          <div class="feed-video__placeholder">
            <div class="ripple-water"></div>
            <div class="ripple-water ripple-water--2"></div>
            <span class="video-tag">[VID-001 · 船过平江路]</span>
            <span class="video-hint">长按视频试试看 →</span>
          </div>
          <!-- 信息层 (作者+文案) -->
          <div class="feed-meta">
            <div class="feed-meta__author">@姑苏文旅·官方</div>
            <div class="feed-meta__desc">坐船过平江路, 这一程把姑苏看穿了 🛶</div>
            <div class="feed-meta__music">🎵 评弹·声声慢 - 芸娘</div>
          </div>
          <!-- 右侧操作栏 -->
          <div class="feed-actions">
            <div class="feed-action" data-action="avatar">
              <div class="feed-action__avatar">苏</div>
              <div class="feed-action__plus">+</div>
            </div>
            <div class="feed-action" data-action="like">
              <div class="feed-action__icon">❤</div>
              <div class="feed-action__num">2.3w</div>
            </div>
            <div class="feed-action" data-action="comment">
              <div class="feed-action__icon">💬</div>
              <div class="feed-action__num">892</div>
            </div>
            <div class="feed-action" data-action="star">
              <div class="feed-action__icon">⭐</div>
              <div class="feed-action__num">156</div>
            </div>
            <div class="feed-action" data-action="share">
              <div class="feed-action__icon">↗</div>
              <div class="feed-action__num">分享</div>
            </div>
            <div class="feed-action feed-action--music" data-action="music">
              <div class="feed-action__music">♬</div>
            </div>
          </div>
        </div>

        <!-- 底部 tabbar -->
        <div class="douyin-tabbar">
          <span class="douyin-tabbar__item douyin-tabbar__item--active">首页</span>
          <span class="douyin-tabbar__item">朋友</span>
          <span class="douyin-tabbar__item douyin-tabbar__item--plus">＋</span>
          <span class="douyin-tabbar__item">消息</span>
          <span class="douyin-tabbar__item">我</span>
        </div>

        <!-- 地标抽屉 (默认 hidden) -->
        <div class="landmark-drawer" hidden>
          <div class="landmark-drawer__handle"></div>
          <div class="landmark-drawer__body"></div>
        </div>
      `;
      root.appendChild(shell);
      this.shellEl = shell;
      this.feedEl = shell.querySelector('.feed-video');
      this.videoLayerEl = shell.querySelector('.feed-video__placeholder');
      this.drawerEl = shell.querySelector('.landmark-drawer');

      // 绑定操作栏
      shell.querySelectorAll('.feed-action').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const act = el.dataset.action;
          this._handleActionTap(act, el);
        });
      });

      // 双击红心
      this._wireDoubleTap();

      window.dispatchEvent(new CustomEvent('shell:feed-ready', { detail: { videoId: '' } }));
    },

    // -----------------------------------------------------------------------
    // 相机扫描壳子: 赛道四主路径
    // -----------------------------------------------------------------------
    _mountCameraShell(root) {
      this._cameraMode = true;
      this.rootEl = root;
      this.shellEl = root;
      this.feedEl = null;
      this.videoLayerEl = null;
      this.drawerEl = null;

      this._cameraSceneIndex = 0;
      this._cameraLocked = false;
      this._cameraPanOrigin = null;
      this._cameraFacing = 'environment';
      this._clearCameraTimers();

      root.innerHTML = `
        <div class="camera-shell" data-camera-scene="gate">
          <video class="camera-live" autoplay muted playsinline webkit-playsinline="true"></video>
          <button class="camera-back" type="button" data-camera-action="back" aria-label="返回信息流">‹</button>
          <div class="camera-fallback camera-panorama is-visible" aria-hidden="true">
            <div class="camera-panorama__track">
              <section class="camera-scene camera-scene--gate" data-scene="东方之门">
                <div class="scene-sky"></div>
                <div class="scene-wall scene-wall--left"></div>
                <div class="scene-wall scene-wall--right"></div>
                <div class="scene-bridge"></div>
                <div class="scene-water"></div>
                <div class="scene-boat"></div>
                <div class="scene-grain"></div>
              </section>
              <section class="camera-scene camera-scene--lake" data-scene="金鸡湖">
                <div class="scene-sky"></div>
                <div class="scene-wall scene-wall--wide"></div>
                <div class="scene-window scene-window--one"></div>
                <div class="scene-window scene-window--two"></div>
                <div class="scene-tree"></div>
                <div class="scene-water"></div>
                <div class="scene-grain"></div>
              </section>
              <section class="camera-scene camera-scene--pingjiang" data-scene="平江路">
                <div class="scene-sky"></div>
                <div class="scene-wall scene-wall--left"></div>
                <div class="scene-wall scene-wall--right"></div>
                <div class="scene-bridge"></div>
                <div class="scene-signboard">平江路</div>
                <div class="scene-lantern scene-lantern--one"></div>
                <div class="scene-lantern scene-lantern--two"></div>
                <div class="scene-water"></div>
                <div class="scene-boat"></div>
                <div class="scene-gusu-mist"></div>
                <div class="scene-grain"></div>
              </section>
            </div>
          </div>
          <div class="camera-motion" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div class="camera-paper-ui" aria-hidden="true"></div>
          <audio class="camera-bgm" src="assets/audio/Dminor Canal.mp3" preload="auto" loop></audio>

          <div class="scene-title-art" aria-label="一镜入姑苏"></div>

          <div class="scan-hud">
            <div class="ink-scan" aria-hidden="true"></div>
            <div class="scan-label">请把相机对准平江路水巷、石桥或河街牌匾</div>
          </div>
          <button class="camera-recognize" type="button" data-camera-action="recognize">
            <span>手动识别平江路</span>
          </button>
          <button class="photo-native-hotspot photo-native-hotspot--photo is-active" type="button" data-camera-action="set-photo" aria-label="照片"></button>
          <button class="photo-native-hotspot photo-native-hotspot--video" type="button" data-camera-action="set-video" aria-label="视频"></button>
          <button class="photo-native-hotspot photo-native-hotspot--shutter" type="button" data-camera-action="capture" aria-label="拍摄"></button>
          <div class="camera-capture-preview" hidden></div>
          <div class="camera-found-title" hidden aria-label="一镜入姑苏"></div>

          <div class="ar-yunniang" data-pos="right" hidden>
            <div class="ar-yunniang__glow"></div>
            <div class="ar-yunniang__sprite" aria-hidden="true"></div>
            <div class="ar-yunniang__bubble" aria-hidden="true"></div>
          </div>

          <div class="camera-actions" hidden>
            <button type="button" data-camera-action="chat"><span>了解平江路</span></button>
            <button type="button" data-camera-action="quiz"><span>苏州话挑战</span></button>
            <button type="button" data-camera-action="photo"><span>和芸娘合照</span></button>
          </div>
          <button class="memory-card-entry" type="button" data-camera-action="card" hidden>电子纪念卡</button>

          <div class="camera-panel" hidden></div>
          <div class="camera-flash" hidden></div>
          <div class="ink-route" hidden><div>欢迎来到苏州</div></div>
        </div>
      `;

      this._wireCameraActions();
      this._wireCameraPan();
      this._captureMode = 'photo';
      this._startCamera();
      this._startCameraAudio();
      window.dispatchEvent(new CustomEvent('shell:camera-ready', { detail: { landmarkId: 'pingjianglu' } }));
    },

    _startCameraAudio() {
      const audio = this.rootEl && this.rootEl.querySelector('.camera-bgm');
      if (!audio) return;
      audio.volume = 0.34;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    },

    _getPingjiangBgm() {
      if (!this._pingjiangBgm) {
        this._pingjiangBgm = new Audio('assets/audio/Canal Crackle.mp3');
        this._pingjiangBgm.loop = true;
        this._pingjiangBgm.preload = 'auto';
        this._pingjiangBgm.volume = 0.42;
      }
      return this._pingjiangBgm;
    },

    _playPingjiangBgm() {
      this._pingjiangBgmWanted = true;
      this._pauseHanshanBgm(false);
      const audio = this._getPingjiangBgm();
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    },

    _pausePingjiangBgm(keepWanted = true) {
      if (!keepWanted) this._pingjiangBgmWanted = false;
      if (this._pingjiangBgm) this._pingjiangBgm.pause();
    },

    _resumePingjiangBgmIfNeeded() {
      const root = this.rootEl || document.getElementById('shell-root');
      if (root && root.querySelector('.douyin-search-page, .feed')) return;
      if (this._pingjiangBgmWanted) this._playPingjiangBgm();
    },

    _getHanshanBgm() {
      if (!this._hanshanBgm) {
        this._hanshanBgm = new Audio('assets/audio/Suzhou Bell Mist.mp3');
        this._hanshanBgm.loop = true;
        this._hanshanBgm.preload = 'auto';
        this._hanshanBgm.volume = 0.42;
      }
      return this._hanshanBgm;
    },

    _playHanshanBgm() {
      this._hanshanBgmWanted = true;
      this._pausePingjiangBgm(false);
      const audio = this._getHanshanBgm();
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    },

    _pauseHanshanBgm(keepWanted = true) {
      if (!keepWanted) this._hanshanBgmWanted = false;
      if (this._hanshanBgm) this._hanshanBgm.pause();
    },

    _resumeHanshanBgmIfNeeded() {
      const root = this.rootEl || document.getElementById('shell-root');
      if (root && root.querySelector('.douyin-search-page, .feed')) return;
      if (this._hanshanBgmWanted) this._playHanshanBgm();
    },

    _startCamera() {
      const video = this.rootEl && this.rootEl.querySelector('.camera-live');
      const fallback = this.rootEl && this.rootEl.querySelector('.camera-fallback, .photo-fallback');
      if (!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (fallback) fallback.classList.add('is-visible');
        return;
      }
      if (this._cameraStream) {
        this._cameraStream.getTracks().forEach((track) => track.stop());
        this._cameraStream = null;
      }
      this._stopActiveRecording();
      this._stopVisualDetector();
      const preferredFacing = this._cameraFacing || 'environment';
      const openCamera = (constraints) => navigator.mediaDevices.getUserMedia(constraints);
      openCamera({
        video: { facingMode: { ideal: preferredFacing } },
        audio: false,
      }).catch(() => openCamera({
        video: true,
        audio: false,
      })).then((stream) => {
        this._cameraStream = stream;
        video.srcObject = stream;
        video.classList.add('is-live');
        if (fallback) fallback.classList.remove('is-visible');
        this._startVisualDetector(video);
      }).catch(() => {
        video.classList.remove('is-live');
        if (fallback) fallback.classList.add('is-visible');
        const label = this.rootEl && this.rootEl.querySelector('.scan-label');
        if (label) label.textContent = '未获取到相机权限，可用手动入口演示识别平江路';
      });
    },

    _startVisualDetector(video) {
      const label = this.rootEl && this.rootEl.querySelector('.scan-label');
      this._stopVisualDetector();
      this._cameraDetectorHits = 0;
      if (label) label.textContent = '正在寻找：江南水巷组合 + “平江路”字样';

      const tick = () => {
        if (!video || this._cameraLocked || !this.rootEl || !this.rootEl.querySelector('.camera-shell')) return;
        const result = this._inspectCameraFrame(video);
        if (result.ready) {
          this._scanPingjiangText(video, label);
          if (result.matched) {
            this._cameraDetectorHits += 1;
            if (label) label.textContent = `江南水巷特征成立：${result.features.join('、')}，请保持镜头`;
          } else {
            this._cameraDetectorHits = Math.max(0, this._cameraDetectorHits - 2);
            if (label) label.textContent = result.features.length
              ? `已见${result.features.join('、')}，还需要画面里出现“平江路”三个字`
              : '请把相机对准平江路牌匾/路牌：需同时看到江南水巷和“平江路”';
          }
          if (this._cameraDetectorHits >= 2) {
            if (label) label.textContent = '江南水巷画面稳定，正在进入平江路';
            this._simulateScan(false);
            return;
          }
        }
        this._cameraDetectorTimer = setTimeout(tick, 620);
      };

      if (video.readyState >= 2) {
        tick();
      } else {
        video.addEventListener('loadeddata', tick, { once: true });
      }
    },

    _stopVisualDetector() {
      if (this._cameraDetectorTimer) clearTimeout(this._cameraDetectorTimer);
      this._cameraDetectorTimer = null;
      this._cameraDetectorHits = 0;
      this._cameraOcrBusy = false;
      this._cameraOcrLastAt = 0;
      this._cameraOcrHitUntil = 0;
    },

    _stopActiveRecording() {
      if (this._recordingStopTimer) clearTimeout(this._recordingStopTimer);
      this._recordingStopTimer = null;
      if (this._recordingFrame) cancelAnimationFrame(this._recordingFrame);
      this._recordingFrame = null;
      if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
        try { this._mediaRecorder.stop(); } catch (e) {}
      }
      this._mediaRecorder = null;
    },

    _scanPingjiangText(video, label) {
      if (this._cameraOcrBusy || Date.now() - this._cameraOcrLastAt < 1600) return;
      if (!window.Tesseract || !video.videoWidth || !video.videoHeight) {
        if (label) label.textContent = '文字识别模型加载中；请对准带“平江路”的牌匾，或使用手动入口';
        return;
      }
      this._cameraOcrBusy = true;
      this._cameraOcrLastAt = Date.now();

      const canvas = document.createElement('canvas');
      const sourceW = video.videoWidth;
      const sourceH = video.videoHeight;
      canvas.width = 760;
      canvas.height = 980;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        this._cameraOcrBusy = false;
        return;
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.filter = 'grayscale(1) contrast(1.9) brightness(1.12)';
      ctx.drawImage(video, 0, 0, sourceW, sourceH, 0, 0, canvas.width, canvas.height);
      window.Tesseract.recognize(canvas, 'chi_sim', {
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '0',
      })
        .then(({ data }) => {
          const text = String((data && data.text) || '').replace(/\s+/g, '');
          if (this._isPingjiangText(text)) {
            this._cameraOcrHitUntil = Date.now() + 7600;
            if (label) label.textContent = '已读到“平江路”，正在确认江南水巷画面';
          } else if (label) {
            label.textContent = '正在读牌匾/路牌，请让“平江路”三个字更靠近画面中央';
          }
        })
        .catch(() => {
          if (label) label.textContent = '文字识别暂未读到“平江路”，请靠近牌匾/路牌';
        })
        .finally(() => {
          this._cameraOcrBusy = false;
        });
    },

    _isPingjiangText(text) {
      if (!text) return false;
      const normalized = text
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
        .replace(/[评苹萍坪]/g, '平')
        .replace(/[泾汀汪红]/g, '江')
        .replace(/[踣潞璐]/g, '路');
      return /平江路/.test(normalized)
        || /平.{0,3}江.{0,3}路/.test(normalized)
        || (normalized.includes('平') && normalized.includes('江') && normalized.includes('路'));
    },

    _inspectCameraFrame(video) {
      if (!video.videoWidth || !video.videoHeight) return { ready: false, matched: false, features: [] };
      const canvas = this._cameraDetectorCanvas || document.createElement('canvas');
      this._cameraDetectorCanvas = canvas;
      const width = 96;
      const height = 128;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ready: false, matched: false, features: [] };
      ctx.drawImage(video, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      let water = 0;
      let whiteWall = 0;
      let darkRoof = 0;
      let stone = 0;
      let horizontalEdges = 0;
      let verticalEdges = 0;
      let lowerWater = 0;
      let upperWall = 0;
      let midStructure = 0;
      const total = width * height;

      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const lum = (r + g + b) / 3;
          const sat = max - min;
          if (g > 58 && b > 48 && g >= r * 0.82 && b >= r * 0.7 && lum < 150) water++;
          if (lum > 172 && sat < 42) whiteWall++;
          if (lum < 72 && sat < 54) darkRoof++;
          if (lum > 82 && lum < 165 && sat < 34) stone++;
          if (y > height * 0.45 && g > 54 && b > 44 && g >= r * 0.8 && b >= r * 0.68 && lum < 145) lowerWater++;
          if (y < height * 0.56 && lum > 160 && sat < 46) upperWall++;
          if (y > height * 0.28 && y < height * 0.76 && lum > 70 && lum < 170 && sat < 42) midStructure++;
          if (x + 2 < width) {
            const next = ((y * width) + x + 2) * 4;
            const lum2 = (data[next] + data[next + 1] + data[next + 2]) / 3;
            if (Math.abs(lum - lum2) > 42) verticalEdges++;
          }
          if (y + 2 < height) {
            const below = (((y + 2) * width) + x) * 4;
            const lum3 = (data[below] + data[below + 1] + data[below + 2]) / 3;
            if (Math.abs(lum - lum3) > 42) horizontalEdges++;
          }
        }
      }

      const sampled = total / 4;
      const lowerSampled = sampled * 0.55;
      const upperSampled = sampled * 0.56;
      const features = [];
      const waterRatio = water / sampled;
      const lowerWaterRatio = lowerWater / lowerSampled;
      const wallRatio = whiteWall / sampled;
      const upperWallRatio = upperWall / upperSampled;
      const roofRatio = darkRoof / sampled;
      const stoneRatio = stone / sampled;
      const midStructureRatio = midStructure / sampled;
      const horizontalEdgeRatio = horizontalEdges / sampled;
      const verticalEdgeRatio = verticalEdges / sampled;

      const hasCanalWater = waterRatio > 0.12 && lowerWaterRatio > 0.12;
      const hasJiangnanWall = wallRatio > 0.07 && upperWallRatio > 0.075;
      const hasBridgeStreetStructure = (stoneRatio > 0.13 || midStructureRatio > 0.22)
        && horizontalEdgeRatio > 0.055
        && verticalEdgeRatio > 0.052;
      const hasDarkTiles = roofRatio > 0.065;
      const hasPingjiangText = Date.now() < this._cameraOcrHitUntil;

      if (hasCanalWater) features.push('水面在画面下半部');
      if (hasJiangnanWall) features.push('白墙灰墙');
      if (hasBridgeStreetStructure) features.push('石桥/河街结构');
      if (hasDarkTiles) features.push('黛瓦暗部');
      if (hasPingjiangText) features.push('平江路字样');
      const visualCandidate = hasCanalWater || hasJiangnanWall || hasBridgeStreetStructure || hasDarkTiles;
      const matched = hasPingjiangText && (features.length >= 2 || visualCandidate);
      return { ready: true, matched, visualCandidate, features };
    },

    _simulateScan(silent) {
      const shell = this.rootEl && this.rootEl.querySelector('.camera-shell');
      const panel = this.rootEl && this.rootEl.querySelector('.camera-panel');
      const foundTitle = this.rootEl && this.rootEl.querySelector('.camera-found-title');
      const yunniang = this.rootEl && this.rootEl.querySelector('.ar-yunniang');
      const actions = this.rootEl && this.rootEl.querySelector('.camera-actions');
      const memory = this.rootEl && this.rootEl.querySelector('.memory-card-entry');
      const recognize = this.rootEl && this.rootEl.querySelector('.camera-recognize');
      if (!shell) return;

      this._stopVisualDetector();
      this._clearCameraTimers();
      this._cameraLocked = false;
      shell.classList.remove('is-detected', 'is-locking', 'is-gusu-open');
      if (panel) {
        panel.hidden = true;
        panel.innerHTML = '';
      }
      if (foundTitle) foundTitle.hidden = true;
      if (yunniang) yunniang.hidden = true;
      if (actions) actions.hidden = true;
      if (memory) memory.hidden = true;
      if (recognize) recognize.hidden = true;
      this._setCameraScene(PINGJIANG_SCENE_INDEX, true);
      this._addCameraTimer(() => this._lockPingjiang(), silent ? 620 : 1100);
    },

    _clearCameraTimers() {
      (this._cameraTimers || []).forEach((timer) => clearTimeout(timer));
      this._cameraTimers = [];
    },

    _addCameraTimer(callback, delay) {
      const timer = setTimeout(() => {
        this._cameraTimers = (this._cameraTimers || []).filter((item) => item !== timer);
        callback();
      }, delay);
      this._cameraTimers.push(timer);
    },

    _setCameraScene(index, keepTimers) {
      const shell = this.rootEl && this.rootEl.querySelector('.camera-shell');
      const track = this.rootEl && this.rootEl.querySelector('.camera-panorama__track');
      const label = this.rootEl && this.rootEl.querySelector('.scan-label');
      if (!shell || !track || this._cameraLocked) return;
      if (!keepTimers) this._clearCameraTimers();
      const max = CAMERA_SCENES.length - 1;
      const next = Math.max(0, Math.min(max, index));
      this._cameraSceneIndex = next;
      const scene = CAMERA_SCENES[next];
      shell.dataset.cameraScene = scene.id;
      track.style.transform = `translate3d(${-next * 100}%, 0, 0)`;
      if (label) {
        label.textContent = scene.scanText || `镜头扫过${scene.title}`;
      }
      this._updateAgentHud(scene);
      if (scene.id === 'pingjiang' && !keepTimers) {
        this._addCameraTimer(() => this._lockPingjiang(), 520);
      }
    },

    _updateAgentHud(scene) {
      const sceneEl = this.rootEl && this.rootEl.querySelector('.agent-scene');
      const detectEl = this.rootEl && this.rootEl.querySelector('.agent-detect');
      const confidenceEl = this.rootEl && this.rootEl.querySelector('.agent-confidence');
      if (sceneEl) sceneEl.textContent = scene.title;
      if (detectEl) detectEl.textContent = scene.detect;
      if (confidenceEl) confidenceEl.textContent = scene.confidence;
    },

    _lockPingjiang() {
      const shell = this.rootEl && this.rootEl.querySelector('.camera-shell');
      const recognize = this.rootEl && this.rootEl.querySelector('.camera-recognize');
      if (!shell || this._cameraLocked) return;

      this._cameraLocked = true;
      if (recognize) recognize.hidden = true;
      shell.classList.add('is-locking');
      this._playPingjiangInkOpen();
    },

    _playPingjiangInkOpen() {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root) {
        this._mountPingjiangTheme();
        return;
      }
      const ink = document.createElement('div');
      ink.className = 'pingjiang-ink-open';
      ink.innerHTML = '<span></span><span></span><span></span>';
      root.appendChild(ink);
      setTimeout(() => this._mountPingjiangTheme(), 760);
    },

    _mountPingjiangTheme() {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root) return;
      this._playPingjiangBgm();
      if (this._cameraStream) {
        this._cameraStream.getTracks().forEach((track) => track.stop());
        this._cameraStream = null;
      }
      root.querySelector('.pingjiang-ink-open')?.remove();
      this._stopActiveRecording();
      this._stopVisualDetector();
      this._clearCameraTimers();
      root.innerHTML = `
        <div class="pingjiang-theme">
          <button class="camera-back" type="button" data-theme-action="back" aria-label="返回信息流">‹</button>
          <div class="pingjiang-theme__shade"></div>
          <img class="pingjiang-theme__yunniang" src="assets/images/yuniang.gif" alt="芸娘">
          <div class="pingjiang-theme__actions">
            <button type="button" data-theme-action="search"><span>了解平江路</span><small>抖音视频</small></button>
            <button type="button" data-theme-action="quiz"><span>苏州话挑战</span><small>三题听辨</small></button>
            <button type="button" data-theme-action="photo"><span>和芸娘合照</span><small>照片 / 视频</small></button>
            <button type="button" data-theme-action="tour"><span>畅游平江路</span><small>团购攻略</small></button>
          </div>
          <button class="pingjiang-theme__card" type="button" data-theme-action="card">电子纪念卡</button>
        </div>
      `;
      this.rootEl = root;
      this.shellEl = root;
      root.querySelectorAll('[data-theme-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-theme-action');
          if (action === 'back') this._returnToFeed();
          if (action === 'search') this._openDouyinSearchWithTransition('平江路', 'video');
          if (action === 'tour') this._openDouyinSearchWithTransition('平江路附近吃喝玩乐', 'deal');
          if (action === 'quiz') this._showSuzhouQuiz();
          if (action === 'photo') this._mountPhotoCapturePage();
          if (action === 'card') this._showMemoryCard();
        });
      });
    },

    _returnToPingjiangTheme() {
      this._mountPingjiangTheme();
    },

    _wireCameraActions() {
      const root = this.rootEl;
      if (!root) return;
      root.querySelectorAll('[data-camera-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-camera-action');
          if (action === 'back') this._returnToFeed();
          if (action === 'rescan') this._simulateScan();
          if (action === 'recognize') this._simulateScan();
          if (action === 'set-photo') this._setCaptureMode('photo');
          if (action === 'set-video') this._setCaptureMode('video');
          if (action === 'capture') this._handleCapture();
          if (action === 'pan-left') this._setCameraScene(this._cameraSceneIndex - 1);
          if (action === 'pan-right') this._setCameraScene(this._cameraSceneIndex + 1);
          if (action === 'chat') this._showHistoryChat();
          if (action === 'quiz') this._showSuzhouQuiz();
          if (action === 'photo') this._showPhotoMode();
          if (action === 'card') this._showMemoryCard();
          if (action === 'voice') this._mockVoiceAsk();
        });
      });
    },

    _setCaptureMode(mode) {
      this._captureMode = mode === 'video' ? 'video' : 'photo';
      const root = this.rootEl;
      if (!root) return;
      root.querySelectorAll('[data-camera-action="set-photo"], [data-photo-mode="photo"]').forEach((btn) => {
        btn.classList.toggle('is-active', this._captureMode === 'photo');
      });
      root.querySelectorAll('[data-camera-action="set-video"], [data-photo-mode="video"]').forEach((btn) => {
        btn.classList.toggle('is-active', this._captureMode === 'video');
      });
      root.querySelector('.camera-shell')?.classList.toggle('is-video-mode', this._captureMode === 'video');
      root.querySelector('.photo-capture-page')?.classList.toggle('is-video-mode', this._captureMode === 'video');
    },

    _handleCapture() {
      if (this._captureMode === 'video') {
        this._toggleVideoRecording();
      } else {
        this._capturePhoto();
      }
    },

    _getActiveCameraVideo() {
      return this.rootEl && this.rootEl.querySelector('.camera-live');
    },

    _drawCameraComposite(canvas) {
      const video = this._getActiveCameraVideo();
      const root = this.rootEl;
      const width = 720;
      const height = 1280;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      if (video && video.videoWidth && video.videoHeight && video.classList.contains('is-live')) {
        const sourceRatio = video.videoWidth / video.videoHeight;
        const targetRatio = width / height;
        let sx = 0;
        let sy = 0;
        let sw = video.videoWidth;
        let sh = video.videoHeight;
        if (sourceRatio > targetRatio) {
          sw = video.videoHeight * targetRatio;
          sx = (video.videoWidth - sw) / 2;
        } else {
          sh = video.videoWidth / targetRatio;
          sy = (video.videoHeight - sh) / 2;
        }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
      } else {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#78909c');
        gradient.addColorStop(1, '#20323d');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      const yunniang = root && root.querySelector('.photo-yunniang-corner, .ar-yunniang__sprite');
      if (yunniang) {
        const img = yunniang.tagName === 'IMG' ? yunniang : null;
        try {
          if (img && img.complete) {
            const stage = root.querySelector('.photo-capture-page, .camera-shell');
            const stageRect = stage && stage.getBoundingClientRect();
            const imgRect = img.getBoundingClientRect();
            const hasRect = stageRect && imgRect.width > 0 && imgRect.height > 0;
            const x = hasRect ? ((imgRect.left - stageRect.left) / stageRect.width) * width : width * 0.66;
            const y = hasRect ? ((imgRect.top - stageRect.top) / stageRect.height) * height : height * 0.54;
            const w = hasRect ? (imgRect.width / stageRect.width) * width : width * 0.26;
            const h = hasRect ? (imgRect.height / stageRect.height) * height : height * 0.33;
            ctx.drawImage(img, x, y, w, h);
          }
        } catch (e) {}
      }
      return true;
    },

    _capturePhoto() {
      this._pausePingjiangBgm(true);
      const canvas = document.createElement('canvas');
      if (!this._drawCameraComposite(canvas)) {
        this._resumePingjiangBgmIfNeeded();
        this.toast('暂未获取到相机画面', 1200);
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      const record = { type: 'photo', url: dataUrl, time: Date.now() };
      this._captureStore.push(record);
      this._showCapturePreview(record);
      const flash = this.rootEl && this.rootEl.querySelector('.camera-flash');
      if (flash) {
        flash.hidden = false;
        flash.classList.add('is-active');
        setTimeout(() => { flash.hidden = true; flash.classList.remove('is-active'); }, 360);
      }
      this._resumePingjiangBgmIfNeeded();
      this.toast('拍摄完成', 900);
    },

    _toggleVideoRecording() {
      if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
        this._mediaRecorder.stop();
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        this.toast('当前浏览器不支持视频录制', 1400);
        return;
      }
      const canvas = document.createElement('canvas');
      this._recordingCanvas = canvas;
      const stream = canvas.captureStream ? canvas.captureStream(18) : null;
      if (!stream) {
        this.toast('当前浏览器不支持画面录制', 1400);
        return;
      }
      this._recordedChunks = [];
      const draw = () => {
        this._drawCameraComposite(canvas);
        this._recordingFrame = requestAnimationFrame(draw);
      };
      draw();
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
      this._mediaRecorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) this._recordedChunks.push(e.data);
      };
      recorder.onstop = () => {
        if (this._recordingFrame) cancelAnimationFrame(this._recordingFrame);
        this._recordingFrame = null;
        if (this._recordingStopTimer) clearTimeout(this._recordingStopTimer);
        this._recordingStopTimer = null;
        const blob = new Blob(this._recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const record = { type: 'video', url, blob, time: Date.now() };
        this._captureStore.push(record);
        this._showCapturePreview(record);
        this.rootEl?.querySelector('.photo-capture-page, .camera-shell')?.classList.remove('is-recording');
        this._resumePingjiangBgmIfNeeded();
        this.toast('录制完成', 900);
      };
      recorder.start();
      this._pausePingjiangBgm(true);
      this.rootEl?.querySelector('.photo-capture-page, .camera-shell')?.classList.add('is-recording');
      this.toast('正在录制', 900);
      this._recordingStopTimer = setTimeout(() => {
        if (this._mediaRecorder && this._mediaRecorder.state === 'recording') this._mediaRecorder.stop();
      }, 4200);
    },

    _showCapturePreview(record) {
      const root = this.rootEl;
      if (!root || !record) return;
      let preview = root.querySelector('.camera-capture-preview');
      if (!preview) {
        preview = document.createElement('div');
        preview.className = 'camera-capture-preview';
        root.appendChild(preview);
      }
      preview.hidden = false;
      preview.innerHTML = `
        <button class="camera-capture-preview__close" type="button" data-capture-close>×</button>
        <div class="camera-capture-preview__media">
          ${record.type === 'photo'
            ? `<img src="${record.url}" alt="拍摄照片">`
            : `<video src="${record.url}" controls autoplay loop playsinline></video>`}
        </div>
        <div class="camera-capture-preview__actions">
          <button type="button" data-capture-save>保存</button>
          <button type="button" data-capture-publish>发布到抖音</button>
        </div>
      `;
      preview.querySelector('[data-capture-close]').addEventListener('click', () => {
        preview.hidden = true;
        const yunniang = this.rootEl && this.rootEl.querySelector('.photo-yunniang-corner');
        if (yunniang) {
          yunniang.src = 'assets/images/yuniang.gif';
          yunniang.classList.remove('is-captured', 'is-recorded');
        }
      });
      preview.querySelector('[data-capture-save]').addEventListener('click', () => this.toast('保存成功', 1000));
      preview.querySelector('[data-capture-publish]').addEventListener('click', () => this.toast('发布成功', 1000));
    },

    _wireCameraPan() {
      const root = this.rootEl;
      const viewport = root && root.querySelector('.camera-shell');
      if (!viewport) return;
      const onStart = (e) => {
        if (this._cameraLocked || (e.target && e.target.closest && e.target.closest('button, .camera-panel'))) return;
        const point = (e.touches && e.touches[0]) || e;
        this._cameraPanOrigin = { x: point.clientX, y: point.clientY };
        viewport.classList.add('is-panning');
      };
      const onMove = (e) => {
        if (!this._cameraPanOrigin || this._cameraLocked) return;
        const point = (e.touches && e.touches[0]) || e;
        const dx = point.clientX - this._cameraPanOrigin.x;
        const dy = point.clientY - this._cameraPanOrigin.y;
        if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy)) return;
        this._setCameraScene(this._cameraSceneIndex + (dx < 0 ? 1 : -1));
        this._cameraPanOrigin = { x: point.clientX, y: point.clientY };
      };
      const onEnd = () => {
        this._cameraPanOrigin = null;
        viewport.classList.remove('is-panning');
      };
      viewport.addEventListener('mousedown', onStart);
      viewport.addEventListener('mousemove', onMove);
      viewport.addEventListener('mouseup', onEnd);
      viewport.addEventListener('mouseleave', onEnd);
      viewport.addEventListener('touchstart', onStart, { passive: true });
      viewport.addEventListener('touchmove', onMove, { passive: true });
      viewport.addEventListener('touchend', onEnd);
      viewport.addEventListener('touchcancel', onEnd);
    },

    _wireDemoSwitcher(root) {
      root.querySelectorAll('[data-demo-mode]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this._setFeedMode(btn.getAttribute('data-demo-mode') || 'pingjiang');
        };
      });
    },

    _setFeedMode(mode, silent) {
      const root = this.rootEl || document.getElementById('shell-root');
      const feed = root && root.querySelector('.feed');
      if (!root || !feed) return;
      const next = mode === 'hanshan' ? 'hanshan' : 'pingjiang';
      this._feedMode = next;
      root.dataset.demoMode = next;
      feed.dataset.demoMode = next;
      root.querySelectorAll('[data-demo-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-demo-mode') === next);
      });

      const tag = root.querySelector('.feed__tag');
      const tip = root.querySelector('.feed-agent-tip');
      const author = root.querySelector('.feed__author');
      const desc = root.querySelector('.feed__desc');
      const tags = root.querySelector('.feed__tags');
      const bgm = root.querySelector('.feed__bgm-text');
      const video = root.querySelector('.feed__real-video');
      const setVideoSource = (src) => {
        if (!video) return;
        const current = video.getAttribute('src') || '';
        if (!current.endsWith(src)) {
          video.dataset.userPaused = '0';
          video.setAttribute('src', src);
        }
        video.hidden = false;
        if (video.dataset.userPaused !== '1' && video.paused) video.play().catch(() => {});
      };

      if (next === 'hanshan') {
        if (tag) tag.textContent = '[VID-002 · 寒山寺钟声]';
        if (tip) tip.textContent = '识别到寒山寺，点我继续探索';
        if (author) author.textContent = '@枫桥夜泊不睡觉';
        if (desc) desc.textContent = '刷到寒山寺，AI 小向导把钟声、古诗和苏轼都认出来了。';
        if (tags) tags.innerHTML = `
          <button class="feed__tag-item" type="button" data-feed-link="tag">#一镜入姑苏</button>
          <button class="feed__tag-item" type="button" data-feed-link="tag">#寒山寺</button>
          <button class="feed__tag-item" type="button" data-feed-link="tag">#枫桥夜泊</button>
        `;
        if (bgm) bgm.textContent = '♪ 寒山寺钟声';
        setVideoSource('assets/videos/hanshansi.mp4');
      } else {
        if (tag) tag.textContent = '';
        if (tip) tip.textContent = '点我，感受姑苏雅韵';
        if (author) author.textContent = '@今天也在河边发呆';
        if (desc) desc.textContent = '下高铁就上船，苏州的水巷会把时间放慢。粉墙黛瓦、橹声评弹，都在一条平江路里。';
        if (tags) tags.innerHTML = `
          <button class="feed__tag-item" type="button" data-feed-link="tag">#一镜入姑苏</button>
          <button class="feed__tag-item" type="button" data-feed-link="tag">#苏州园林水巷</button>
          <button class="feed__tag-item" type="button" data-feed-link="tag">#视觉搜索</button>
        `;
        if (bgm) bgm.textContent = '♪ 下高铁就上船';
        setVideoSource('assets/videos/pingjiang_boat.mp4');
      }
      this._wireFeedAgent(root);
      if (!silent) this.toast(next === 'hanshan' ? '已切到寒山寺视频流' : '已切到平江路相机流', 900);
    },

    _wireFeedAgent(root) {
      const agent = root.querySelector('.feed-agent');
      const tip = root.querySelector('.feed-agent-tip');
      if (!agent) return;
      const enter = () => {
        if ((root.dataset.demoMode || this._feedMode) === 'hanshan') {
          this._enterHanshanFromFeed(root);
        } else {
          this._enterCameraFromFeed(root);
        }
      };
      agent.onclick = (e) => {
        e.stopPropagation();
        enter();
      };
      if (tip) {
        tip.onclick = (e) => {
          e.stopPropagation();
          enter();
        };
      }
      root.querySelectorAll('[data-feed-link]').forEach((el) => {
        el.onclick = (e) => {
          e.stopPropagation();
          const text = el.textContent.trim();
          this._showFeedMiniSheet(text.startsWith('#') ? 'tag' : 'profile', text);
        };
      });
    },

    _enterHanshanFromFeed(root) {
      this._feedTemplate = root.innerHTML;
      const layer = document.createElement('div');
      layer.className = 'video-recognition video-recognition--hanshan';
      layer.innerHTML = `
        <div class="video-recognition__scan"></div>
        <div class="video-recognition__copy">
          <span>画面识别中</span>
          <strong>寒山寺 · 枫桥钟声</strong>
        </div>
      `;
      root.appendChild(layer);
      setTimeout(() => layer.classList.add('is-done'), 980);
      setTimeout(() => {
        layer.remove();
        this._mountHanshanScene(root);
      }, 1500);
    },

    _mountHanshanScene(root) {
      this.rootEl = root;
      this.shellEl = root;
      root.innerHTML = `
        <div class="hanshan-scene">
          <video class="hanshan-scene__video" src="assets/videos/hanshansi.mp4" muted loop autoplay playsinline webkit-playsinline="true"></video>
          <button class="camera-back" type="button" data-hanshan-action="back" aria-label="返回信息流">‹</button>
          <div class="hanshan-scene__wash" aria-hidden="true"></div>
          <div class="hanshan-scene__poet" aria-hidden="true"><div class="hanshan-scene__poet-sleeve"></div></div>
          <div class="hanshan-scene__text">
            <span>寒山寺</span>
            <strong>苏轼在钟声里吟诗</strong>
            <p>“姑苏城外寒山寺，夜半钟声到客船。”他抬头看向镜头，邀你接一句诗，也可以一起拍一段摇花手。</p>
          </div>
          <div class="hanshan-actions">
            <button type="button" data-hanshan-action="poem">和苏轼对弈</button>
            <button type="button" data-hanshan-action="dance">和苏轼一起摇花手</button>
          </div>
          <div class="hanshan-panel" hidden></div>
        </div>
      `;
      root.querySelector('.hanshan-scene__video')?.play().catch(() => {});
      root.querySelectorAll('[data-hanshan-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-hanshan-action');
          if (action === 'back') this._returnToFeed();
          if (action === 'poem') this._showHanshanPoemGame();
          if (action === 'dance') this._showHanshanDance();
        });
      });
    },

    _setHanshanPanel(html) {
      const panel = this.rootEl && this.rootEl.querySelector('.hanshan-panel');
      if (!panel) return null;
      panel.innerHTML = html;
      panel.hidden = false;
      const closePanel = () => {
        panel.hidden = true;
        panel.innerHTML = '';
      };
      panel.querySelectorAll('[data-hanshan-close]').forEach((btn) => btn.addEventListener('click', closePanel));
      panel.addEventListener('click', (e) => {
        if (e.target === panel) closePanel();
      });
      return panel;
    },

    _showHanshanPoemGame() {
      const quiz = [
        { ask: '“竹外桃花三两枝”的下一句是？', options: ['春江水暖鸭先知', '夜半钟声到客船', '明月几时有'], answer: 0, note: '出自苏轼《惠崇春江晚景》，画面感特别适合短视频接龙。' },
        { ask: '“但愿人长久”的下一句是？', options: ['千里共婵娟', '把酒问青天', '不知天上宫阙'], answer: 0, note: '《水调歌头》里的名句，适合做许愿钟声分享卡。' },
        { ask: '“欲把西湖比西子”的下一句是？', options: ['淡妆浓抹总相宜', '横看成岭侧成峰', '也无风雨也无晴'], answer: 0, note: '苏轼写景最会把地方变成情绪，寒山寺也可以这样被重新理解。' },
      ];
      let idx = 0;
      let score = 0;
      const panel = this._setHanshanPanel(`
        <div class="hanshan-card hanshan-card--quiz">
          <button class="panel-close" type="button" data-hanshan-close>×</button>
          <div class="camera-page__eyebrow">飞花令</div>
          <h2>和苏轼对弈三句词</h2>
          <div class="hanshan-quiz"></div>
        </div>
      `);
      const box = panel && panel.querySelector('.hanshan-quiz');
      if (!box) return;
      const render = () => {
        const q = quiz[idx];
        box.innerHTML = `
          <div class="camera-quiz__progress">${idx + 1} / ${quiz.length}</div>
          <div class="camera-quiz__ask">${q.ask}</div>
          <div class="camera-quiz__options">
            ${q.options.map((opt, i) => `<button type="button" data-hanshan-option="${i}">${opt}</button>`).join('')}
          </div>
          <div class="camera-quiz__feedback" hidden></div>
        `;
        box.querySelectorAll('[data-hanshan-option]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const picked = Number(btn.getAttribute('data-hanshan-option'));
            const right = picked === q.answer;
            if (right) score++;
            box.querySelectorAll('[data-hanshan-option]').forEach((item, i) => {
              item.disabled = true;
              if (i === q.answer) item.classList.add('is-right');
              if (i === picked && !right) item.classList.add('is-wrong');
            });
            const feedback = box.querySelector('.camera-quiz__feedback');
            feedback.hidden = false;
            feedback.innerHTML = `
              <strong>${right ? '接得漂亮' : '苏轼笑而不语'}</strong>
              <span>${q.note}</span>
              <button type="button">${idx === quiz.length - 1 ? '生成结果' : '下一题'}</button>
            `;
            feedback.querySelector('button').addEventListener('click', () => {
              idx++;
              if (idx >= quiz.length) {
                box.innerHTML = `
                  <div class="camera-quiz__result">
                    <div>寒山寺飞花令完成</div>
                    <strong>${score} / ${quiz.length}</strong>
                    <p>苏轼给你敲了一声钟：把这局诗词对弈发到抖音，等朋友来接下一句。</p>
                    <button type="button" data-hanshan-share>分享到抖音</button>
                    <button type="button" data-hanshan-close>回到寒山寺</button>
                  </div>
                `;
                box.querySelector('[data-hanshan-share]').addEventListener('click', () => this.toast('已唤醒抖音分享页', 1300));
                box.querySelector('[data-hanshan-close]').addEventListener('click', () => {
                  panel.hidden = true;
                  panel.innerHTML = '';
                });
              } else {
                render();
              }
            });
          });
        });
      };
      render();
    },

    _showHanshanDance() {
      const panel = this._setHanshanPanel(`
        <div class="hanshan-card hanshan-card--dance">
          <button class="panel-close" type="button" data-hanshan-close>×</button>
          <div class="camera-page__eyebrow">共创短视频</div>
          <h2>和苏轼一起摇花手</h2>
          <div class="sushi-dance-stage">
            <div class="sushi-dance-stage__phone"></div>
            <div class="sushi-dance-stage__poet"></div>
            <div class="sushi-dance-stage__hands"><span></span><span></span></div>
          </div>
          <p>系统已把寒山寺视频、苏轼 NPC 和节拍卡点合成一段竖屏草稿。</p>
          <div class="memory-actions">
            <button type="button" data-hanshan-close>重拍</button>
            <button type="button" data-hanshan-share>发到抖音</button>
          </div>
        </div>
      `);
      if (!panel) return;
      panel.querySelector('[data-hanshan-share]').addEventListener('click', () => this.toast('已唤醒抖音视频发布页', 1300));
    },

    _enterHanshanFromFeed(root) {
      this._feedTemplate = root.innerHTML;
      const layer = document.createElement('div');
      layer.className = 'feed-ink-transition';
      layer.innerHTML = '<div class="feed-ink-transition__art"></div>';
      root.appendChild(layer);
      setTimeout(() => {
        this._mountHanshanScene(root);
        root.appendChild(layer);
        requestAnimationFrame(() => layer.classList.add('is-out'));
        setTimeout(() => layer.remove(), 520);
      }, 1540);
    },

    _mountHanshanScene(root = this.rootEl || document.getElementById('shell-root')) {
      if (!root) return;
      this._playHanshanBgm();
      this.rootEl = root;
      this.shellEl = root;
      root.innerHTML = `
        <div class="hanshan-theme">
          <button class="camera-back" type="button" data-hanshan-action="back" aria-label="返回信息流">‹</button>
          <img class="hanshan-theme__sushi" src="assets/images/sushi.gif" alt="苏轼">
          <div class="hanshan-theme__actions">
            <button type="button" data-hanshan-action="info">了解寒山寺</button>
            <button type="button" data-hanshan-action="talk">和苏轼对话</button>
            <button type="button" data-hanshan-action="poem">词曲飞花令</button>
            <button type="button" data-hanshan-action="tour">畅游寒山寺</button>
          </div>
          <button class="hanshan-theme__card" type="button" data-hanshan-action="card">电子纪念卡</button>
          <div class="hanshan-panel" hidden></div>
        </div>
      `;
      root.querySelectorAll('[data-hanshan-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-hanshan-action');
          if (action === 'back') this._returnToFeed();
          if (action === 'info') this._openHanshanSearchWithTransition('寒山寺', 'video');
          if (action === 'tour') this._openHanshanSearchWithTransition('寒山寺附近吃喝玩乐', 'deal');
          if (action === 'talk') this._showHanshanTalk();
          if (action === 'poem') this._showHanshanPoemGame();
          if (action === 'card') this._showHanshanMemoryCard();
        });
      });
    },

    _showHanshanTalk() {
      const lines = [
        {
          ask: '夜半钟声传到客船，你第一句想问苏轼什么？',
          options: ['为什么人在旅途更容易想家？', '寒山寺的钟声为什么出名？', '我最近有点迷茫怎么办？'],
          replies: [
            '人远行时，心会替你把故乡照亮。你不必急着抵达，先听清此刻的风声。',
            '钟声出名，不只因寺，也因有人把一夜客愁写成了千年共鸣。',
            '迷茫不是坏事，是旧路走到尽头，新路还没亮。先把脚下这一寸走稳。',
          ],
        },
        {
          ask: '苏轼举杯笑问：若把今天拍成一条抖音，你选什么标题？',
          options: ['在寒山寺，把焦虑交给钟声', '苏轼陪我过了一次夜半钟', '姑苏城外，今天很适合慢下来'],
          replies: [
            '好标题。焦虑若有形，就让它随钟声散在江面。',
            '有趣。古人未见短视频，却懂一瞬入心。',
            '慢下来，是难得的本事。你已经会听见自己了。',
          ],
        },
      ];
      let idx = 0;
      const panel = this._setHanshanPanel(`
        <div class="hanshan-card hanshan-card--talk">
          <button class="panel-close" type="button" data-hanshan-close>×</button>
          <div class="camera-page__eyebrow">苏轼夜话</div>
          <h2>和苏轼对话</h2>
          <div class="hanshan-talk"></div>
        </div>
      `);
      const box = panel && panel.querySelector('.hanshan-talk');
      if (!box) return;
      const render = () => {
        const step = lines[idx];
        box.innerHTML = `
          <p>${step.ask}</p>
          <div class="camera-quiz__options">
            ${step.options.map((opt, i) => `<button type="button" data-talk-option="${i}">${opt}</button>`).join('')}
          </div>
          <div class="camera-quiz__feedback" hidden></div>
        `;
        box.querySelectorAll('[data-talk-option]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const picked = Number(btn.getAttribute('data-talk-option'));
            const feedback = box.querySelector('.camera-quiz__feedback');
            feedback.hidden = false;
            feedback.innerHTML = `
              <strong>苏轼答</strong>
              <span>${step.replies[picked]}</span>
              <button type="button">${idx === lines.length - 1 ? '生成夜话卡' : '继续聊'}</button>
            `;
            box.querySelectorAll('[data-talk-option]').forEach((item) => { item.disabled = true; });
            feedback.querySelector('button').addEventListener('click', () => {
              idx++;
              if (idx >= lines.length) {
                box.innerHTML = `
                  <div class="camera-quiz__result">
                    <div>寒山寺夜话完成</div>
                    <strong>一念千年</strong>
                    <p>苏轼替你留下一句：人生如逆旅，姑苏有钟声。</p>
                    <button type="button" data-hanshan-share>分享到抖音</button>
                    <button type="button" data-hanshan-close>返回</button>
                  </div>
                `;
                box.querySelector('[data-hanshan-share]').addEventListener('click', () => this._showDouyinShareDialog(panel, '寒山寺夜话卡已带入发布器'));
                box.querySelector('[data-hanshan-close]').addEventListener('click', () => {
                  panel.hidden = true;
                  panel.innerHTML = '';
                });
              } else {
                render();
              }
            });
          });
        });
      };
      render();
    },

    _showHanshanPoemGame() {
      const quiz = [
        { ask: '“竹外桃花三两枝”的下一句是？', options: ['春江水暖鸭先知', '夜半钟声到客船', '明月几时有'], answer: 0, note: '出自苏轼《惠崇春江晚景》，画面感很适合寒山寺的春日短视频。' },
        { ask: '“但愿人长久”的下一句是？', options: ['千里共婵娟', '把酒问青天', '不知天上宫阙'], answer: 0, note: '这一句天然适合许愿、钟声和分享卡。' },
        { ask: '“姑苏城外寒山寺”的下一句是？', options: ['夜半钟声到客船', '春风又绿江南岸', '烟花三月下扬州'], answer: 0, note: '张继这一句让寒山寺成了中国人共同的夜色记忆。' },
      ];
      let idx = 0;
      let score = 0;
      const panel = this._setHanshanPanel(`
        <div class="hanshan-card hanshan-card--quiz">
          <button class="panel-close" type="button" data-hanshan-close>×</button>
          <div class="camera-page__eyebrow">词曲飞花令</div>
          <h2>和苏轼接三句诗</h2>
          <div class="hanshan-quiz"></div>
        </div>
      `);
      const box = panel && panel.querySelector('.hanshan-quiz');
      if (!box) return;
      const render = () => {
        const q = quiz[idx];
        box.innerHTML = `
          <div class="camera-quiz__progress">${idx + 1} / ${quiz.length}</div>
          <div class="camera-quiz__ask">${q.ask}</div>
          <div class="camera-quiz__options">
            ${q.options.map((opt, i) => `<button type="button" data-hanshan-option="${i}">${opt}</button>`).join('')}
          </div>
          <div class="camera-quiz__feedback" hidden></div>
        `;
        box.querySelectorAll('[data-hanshan-option]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const picked = Number(btn.getAttribute('data-hanshan-option'));
            const right = picked === q.answer;
            if (right) score++;
            box.querySelectorAll('[data-hanshan-option]').forEach((item, i) => {
              item.disabled = true;
              if (i === q.answer) item.classList.add('is-right');
              if (i === picked && !right) item.classList.add('is-wrong');
            });
            const feedback = box.querySelector('.camera-quiz__feedback');
            feedback.hidden = false;
            feedback.innerHTML = `
              <strong>${right ? '接得漂亮' : '苏轼笑而不语'}</strong>
              <span>${q.note}</span>
              <button type="button">${idx === quiz.length - 1 ? '生成结果' : '下一题'}</button>
            `;
            feedback.querySelector('button').addEventListener('click', () => {
              idx++;
              if (idx >= quiz.length) {
                box.innerHTML = `
                  <div class="camera-quiz__result">
                    <div>寒山寺飞花令完成</div>
                    <strong>${score} / ${quiz.length}</strong>
                    <p>苏轼给你敲了一声钟：把这局诗词接龙发到抖音，等朋友来接下一句。</p>
                    <button type="button" data-hanshan-share>分享到抖音</button>
                    <button type="button" data-hanshan-close>返回</button>
                  </div>
                `;
                box.querySelector('[data-hanshan-share]').addEventListener('click', () => this._showDouyinShareDialog(panel, '寒山寺飞花令已带入发布器'));
                box.querySelector('[data-hanshan-close]').addEventListener('click', () => {
                  panel.hidden = true;
                  panel.innerHTML = '';
                });
              } else {
                render();
              }
            });
          });
        });
      };
      render();
    },

    _showHanshanMemoryCard() {
      const code = 'AI-HANSHAN-' + String(Date.now()).slice(-5);
      const panel = this._setHanshanPanel(`
        <div class="hanshan-card hanshan-card--memory">
          <button class="panel-close" type="button" data-hanshan-close>×</button>
          <div class="hanshan-souvenir-card">
            <div class="hanshan-souvenir-card__avatar">苏</div>
            <div class="hanshan-souvenir-card__name">小成寻茶客</div>
            <div class="hanshan-souvenir-card__code">${code}</div>
          </div>
          <div class="memory-actions">
            <button type="button" data-hanshan-save>保存</button>
            <button type="button" data-hanshan-share>分享</button>
          </div>
        </div>
      `);
      if (!panel) return;
      panel.querySelector('[data-hanshan-save]').addEventListener('click', () => this.toast('保存成功', 1000));
      panel.querySelector('[data-hanshan-share]').addEventListener('click', () => this._showDouyinShareDialog(panel, '寒山寺电子纪念卡已带入发布器'));
    },

    _openHanshanSearchWithTransition(keyword, mode) {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root) {
        this._mountHanshanSearch(keyword, mode);
        return;
      }
      const overlay = document.createElement('div');
      overlay.className = 'douyin-search-transition';
      overlay.innerHTML = `
        <div class="douyin-search-transition__bar">
          <span>${keyword}</span>
          <i>搜索</i>
        </div>
        <div class="douyin-search-transition__pulse"></div>
      `;
      root.appendChild(overlay);
      setTimeout(() => overlay.classList.add('is-fly'), 120);
      setTimeout(() => {
        overlay.remove();
        this._mountHanshanSearch(keyword, mode);
      }, 760);
    },

    _mountHanshanSearch(keyword, mode) {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root) return;
      this._pauseHanshanBgm(true);
      const isDeal = mode === 'deal';
      const items = isDeal
        ? [
            { title: '寒山寺钟声祈愿套票', desc: '祈福牌 · 夜游讲解 · 今日可约', price: '¥66', cover: 'assets/images/search_hanshan_deal_01.png' },
            { title: '枫桥夜泊游船', desc: '寒山寺外河道 · 灯影与钟声同框', price: '¥88', cover: 'assets/images/search_hanshan_deal_02.png' },
            { title: '姑苏素斋茶点', desc: '寺前小食 · 桂花糕 · 碧螺春', price: '¥42', cover: 'assets/images/search_hanshan_deal_03.png' },
            { title: '寒山寺文创拓印体验', desc: '钟声印章 · 诗词明信片 · 可带走', price: '¥36', cover: 'assets/images/search_hanshan_deal_04.png' },
          ]
        : [
            { title: '一分钟听懂寒山寺钟声', desc: '18.2w赞 · 枫桥夜泊为什么写进课本', cover: 'assets/images/search_hanshan_01.png' },
            { title: '苏轼如果来到寒山寺会说什么', desc: '9.6w赞 · AI NPC 夜话版', cover: 'assets/images/search_hanshan_02.png' },
            { title: '姑苏城外寒山寺打卡路线', desc: '7.1w赞 · 从枫桥走到钟楼', cover: 'assets/images/search_hanshan_03.png' },
            { title: '夜半钟声到底有多治愈', desc: '5.8w赞 · 适合发给最近睡不着的人', cover: 'assets/images/search_hanshan_04.png' },
          ];
      root.innerHTML = `
        <div class="douyin-search-page hanshan-search-page ${isDeal ? 'is-deal' : ''}">
          <div class="douyin-search-top">
            <button type="button" data-search-back>‹</button>
            <div class="douyin-search-box">${keyword}</div>
            <span>搜索</span>
          </div>
          <div class="douyin-search-tabs">
            <button class="${!isDeal ? 'is-active' : ''}">视频</button>
            <button>用户</button>
            <button>经验</button>
            <button class="${isDeal ? 'is-active' : ''}">团购</button>
          </div>
          <div class="douyin-search-list">
            ${items.map((item, i) => `
              <article class="douyin-search-item">
                <div class="douyin-search-thumb hanshan-search-thumb has-cover">
                  <img src="${item.cover}" alt="${item.title}">
                  <span>${i + 1}</span>
                </div>
                <div>
                  <strong>${item.title}</strong>
                  <p>${item.desc}</p>
                  ${isDeal ? `<em>${item.price}</em>` : '<small>#寒山寺 #枫桥夜泊 #一镜入姑苏</small>'}
                </div>
              </article>
            `).join('')}
          </div>
        </div>
      `;
      this.rootEl = root;
      this.shellEl = root;
      root.querySelector('[data-search-back]').addEventListener('click', () => {
        this._mountHanshanScene(root);
        this._resumeHanshanBgmIfNeeded();
      });
    },

    _showHanshanTalk() {
      const talks = [
        {
          title: '打工人版',
          user: '苏先生, 我最近被老板针对, 想辞职, 又怕找不到下家。',
          reply: [
            '客官, 你这点遭遇, 我老苏听了想笑。',
            '我四十四岁被一封“乌台诗案”撸到黄州, 当地连米都买不起, 我才发明的东坡肉——便宜猪肉慢火炖六小时, 一吃就是几十年。后来又被发到惠州、儋州, 一路向南, 贬到天涯海角。',
            '你猜我那时候写了什么? “莫听穿林打叶声, 何妨吟啸且徐行。竹杖芒鞋轻胜马, 谁怕? 一蓑烟雨任平生。”',
            '翻译给你: 领导骂就让他骂, 反正我穿着蓑衣在雨里走, 一辈子就这样过。',
            '辞不辞职你自己定, 但记住一句——人生海海, 挂科算啥, 挂个几次, 东坡肉就出来了。',
          ],
        },
        {
          title: '深夜 emo 版',
          user: '苏先生, 深夜睡不着, 特别想一个人。',
          reply: [
            '我懂。我也想过一个人——我妻子王弗, 二十七岁就走了。',
            '十年后我梦见她, 梦里她在窗前梳妆, 我们什么话都没说, 只是相顾无言, 惟有泪千行。醒来我写下: “十年生死两茫茫, 不思量, 自难忘。”',
            '你今天睡不着, 无非是想念一个还能见到的人。这比我幸运多了。',
            '客官, 寒山寺外有月亮, 你抬头看一看——“但愿人长久, 千里共婵娟。” 这是我那年中秋为我弟弟苏辙写的。',
            '月亮挂在天上, 你想念的那个人, 也许此刻正抬头看着同一个月亮。',
          ],
        },
        {
          title: '在外漂泊版',
          user: '苏先生, 我在外漂泊好多年, 一直没有归属感。',
          reply: [
            '我那时候被贬到岭南, 朋友王巩跟着我倒霉。他家有个歌姬叫寓娘, 跟着王巩一起流放, 九死一生回来。我问她: 岭南苦不苦?',
            '她笑着说: “此心安处, 便是吾乡。”',
            '客官, 我把这句话记了一辈子。归属感不在户口本上, 不在你父母那栋楼里, 在你自己心里安不安。',
            '你今天能站在姑苏城外的寒山寺, 听到张继 1200 年前没听完的那记钟声——你已经是这片土地的一部分了。',
            '再坐一会, 等钟声响, 那一刻你就是苏州人。',
          ],
        },
      ];
      let idx = 0;
      const panel = this._setHanshanPanel(`
        <div class="hanshan-card hanshan-card--talk">
          <button class="panel-close" type="button" data-hanshan-close>×</button>
          <div class="camera-page__eyebrow">苏轼夜话</div>
          <h2>和苏轼对话</h2>
          <div class="hanshan-talk"></div>
        </div>
      `);
      const box = panel && panel.querySelector('.hanshan-talk');
      if (!box) return;
      const renderChoice = () => {
        box.innerHTML = `
          <p>客官, 今夜钟声正好。你想把哪件心事讲给老苏听?</p>
          <div class="camera-quiz__options">
            ${talks.map((item, i) => `<button type="button" data-talk-choice="${i}">${item.user}</button>`).join('')}
          </div>
        `;
        box.querySelectorAll('[data-talk-choice]').forEach((btn) => {
          btn.addEventListener('click', () => {
            idx = Number(btn.getAttribute('data-talk-choice'));
            renderReply();
          });
        });
      };
      const renderReply = () => {
        const item = talks[idx];
        box.innerHTML = `
          <div class="hanshan-talk__thread">
            <div class="hanshan-talk__user"><strong>用户</strong><span>${item.user}</span></div>
            <div class="hanshan-talk__sushi">
              <strong>苏轼</strong>
              ${item.reply.map((line) => `<p>${line}</p>`).join('')}
            </div>
          </div>
          <div class="memory-actions hanshan-talk__actions">
            <button type="button" data-talk-more>换个问题</button>
            <button type="button" data-hanshan-share>分享苏轼金句</button>
          </div>
        `;
        box.querySelector('[data-talk-more]').addEventListener('click', renderChoice);
        box.querySelector('[data-hanshan-share]').addEventListener('click', () => this._showDouyinShareDialog(panel, `${item.title}寒山寺夜话已带入发布器`));
      };
      renderChoice();
    },

    _enterCameraFromFeed(root) {
      this._feedTemplate = root.innerHTML;
      const layer = document.createElement('div');
      layer.className = 'feed-ink-transition';
      layer.innerHTML = '<div class="feed-ink-transition__art"></div>';
      root.appendChild(layer);
      setTimeout(() => {
        this._mountCameraShell(root);
        root.appendChild(layer);
        requestAnimationFrame(() => layer.classList.add('is-out'));
        setTimeout(() => layer.remove(), 520);
      }, 1540);
    },

    _returnToFeed() {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root || !this._feedTemplate) return;
      this._pausePingjiangBgm(false);
      this._pauseHanshanBgm(false);
      if (this._cameraStream) {
        this._cameraStream.getTracks().forEach((track) => track.stop());
        this._cameraStream = null;
      }
      this._stopVisualDetector();
      this._clearCameraTimers();
      root.innerHTML = this._feedTemplate;
      this.rootEl = root;
      this.shellEl = root;
      this.feedEl = root.querySelector('.feed');
      this.videoLayerEl = root.querySelector('#feed-video') || root.querySelector('.feed__video');
      this._wireFeedActions(root);
      this._wireDemoSwitcher(root);
      this._wireFeedAgent(root);
      this._setFeedMode(root.dataset.demoMode || this._feedMode || 'pingjiang', true);
      this._wireDoubleTap();
      this.showShell();
    },

    _showFeedMiniSheet(type, label) {
      const root = this.rootEl;
      if (!root) return;
      root.querySelector('.feed-mini-sheet')?.remove();
      const sheet = document.createElement('div');
      sheet.className = 'feed-mini-sheet';
      if (type === 'profile') {
        const author = label || root.querySelector('.feed__author')?.textContent?.trim() || '@今天也在河边发呆';
        const isHanshan = (root.dataset.demoMode || this._feedMode) === 'hanshan';
        sheet.innerHTML = `<button type="button" class="feed-mini-sheet__close">×</button><strong>${author}</strong><p>${isHanshan ? '主页 · 记录寒山寺钟声、枫桥夜泊和苏轼夜话。' : '主页 · 记录平江路水巷、摇橹船和姑苏茶点。'}</p><button type="button">关注</button>`;
      } else if (type === 'topbar') {
        sheet.innerHTML = `<button type="button" class="feed-mini-sheet__close">×</button><strong>${label}</strong><p>${label} 功能已应用，当前仍停留在一镜入姑苏演示流。</p>`;
      } else if (type === 'tabbar') {
        sheet.innerHTML = `<button type="button" class="feed-mini-sheet__close">×</button><strong>${label}</strong><p>${label} 页面已打开，稍后自动回到当前视频。</p>`;
      } else if (type === 'comment') {
        sheet.innerHTML = '<button type="button" class="feed-mini-sheet__close">×</button><strong>评论</strong><p>“这个入口好像真的在视频里认出了平江路。”</p><p>“想看寒山寺版本！”</p><button type="button">发送评论</button>';
      } else if (type === 'share') {
        sheet.innerHTML = '<button type="button" class="feed-mini-sheet__close">×</button><strong>转发给朋友</strong><p>已生成一句分享语：我刷到了一只会认苏州景点的小向导。</p><button type="button">转发到抖音</button>';
      } else {
        sheet.innerHTML = `<button type="button" class="feed-mini-sheet__close">×</button><strong>${label}</strong><p>正在查看同话题内容: 游船、苏州话挑战、平江路打卡。</p><button type="button">进入话题</button>`;
      }
      root.appendChild(sheet);
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet || e.target.closest('.feed-mini-sheet__close')) sheet.remove();
      });
      if (type === 'topbar' || type === 'tabbar') {
        setTimeout(() => { try { sheet.remove(); } catch (e) {} }, 1100);
      }
    },

    _setCameraPanel(html) {
      let panel = this.rootEl && this.rootEl.querySelector('.camera-panel');
      if (!panel && this.rootEl) {
        panel = document.createElement('div');
        panel.className = 'camera-panel';
        panel.hidden = true;
        this.rootEl.appendChild(panel);
      }
      if (!panel) return null;
      panel.innerHTML = html;
      panel.hidden = false;
      const closePanel = () => {
        panel.hidden = true;
        panel.innerHTML = '';
      };
      panel.querySelectorAll('[data-panel-close]').forEach((close) => {
        close.addEventListener('click', closePanel);
      });
      panel.addEventListener('click', (e) => {
        if (e.target === panel) {
          closePanel();
        }
      });
      return panel;
    },

    _showHistoryChat() {
      this._setCameraPanel(`
        <div class="camera-page camera-page--history">
          <button class="panel-close" type="button" data-panel-close>×</button>
          <div class="camera-page__eyebrow">了解平江路</div>
          <h2>一条河街, 看见姑苏八百年</h2>
          <p>平江路保留了苏州古城“水陆并行、河街相邻”的格局。河是生活的动线, 街是烟火的肌理, 桥把茶馆、老宅、评弹声和游船串在一起。</p>
          <div class="history-timeline">
            <div><strong>宋元肌理</strong><span>古城河巷保持着从宋元延续而来的空间尺度。</span></div>
            <div><strong>评弹茶馆</strong><span>吴侬软语和三弦琵琶, 让平江路有了可听见的记忆。</span></div>
            <div><strong>老字号日常</strong><span>糕团、酱肉、茶点, 把文旅体验落回“我真的来过”。</span></div>
          </div>
          <button class="panel-primary" type="button" data-panel-close>回到相机</button>
        </div>
      `);
    },

    _showSuzhouQuiz() {
      const quiz = [
        {
          phrase: '倷好呀',
          ask: '下面哪个才是真苏州话?',
          options: ['nǐ hǎo ya', 'nong hau ya', 'neh hau ya'],
          answer: 2,
          note: '“倷”是吴语里的“你”, 尾音更软, 不是上海话 nong。',
        },
        {
          phrase: '蛮好白相',
          ask: '哪一个字最有苏州话特征?',
          options: ['蛮: 拉长尾音', '白: 短促入声', '相: 鼻音最重'],
          answer: 1,
          note: '“白”保留入声, 要短促收住, 不能拖成普通话 bai。',
        },
        {
          phrase: '下趟来白相',
          ask: '这句话是什么语气?',
          options: ['哭腔送别', '温柔邀请', '客气疏离'],
          answer: 1,
          note: '苏州人送客讲得软, 像邀请老朋友下次再来。',
        },
      ];
      let idx = 0;
      let score = 0;
      const panel = this._setCameraPanel(`
        <div class="camera-page camera-page--quiz">
          <button class="panel-close" type="button" data-panel-close>×</button>
          <div class="quiz-yunniang" aria-hidden="true"></div>
          <div class="camera-page__eyebrow">苏州话挑战</div>
          <h2>芸娘出题, 听懂三句吴侬软语</h2>
          <div class="camera-quiz"></div>
        </div>
      `);
      const box = panel && panel.querySelector('.camera-quiz');
      if (!box) return;
      const render = () => {
        const q = quiz[idx];
        box.innerHTML = `
          <div class="camera-quiz__progress">${idx + 1} / ${quiz.length}</div>
          <div class="camera-quiz__phrase">${q.phrase}</div>
          <div class="camera-quiz__ask">${q.ask}</div>
          <div class="camera-quiz__options">
            ${q.options.map((opt, i) => `<button type="button" data-quiz-option="${i}">${opt}</button>`).join('')}
          </div>
          <div class="camera-quiz__feedback" hidden></div>
        `;
        box.querySelectorAll('[data-quiz-option]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const picked = Number(btn.getAttribute('data-quiz-option'));
            const right = picked === q.answer;
            if (right) score++;
            box.querySelectorAll('[data-quiz-option]').forEach((item, i) => {
              item.disabled = true;
              if (i === q.answer) item.classList.add('is-right');
              if (i === picked && !right) item.classList.add('is-wrong');
            });
            const feedback = box.querySelector('.camera-quiz__feedback');
            feedback.hidden = false;
            feedback.innerHTML = `
              <strong>${right ? '答对了' : '差一点'}</strong>
              <span>${q.note}</span>
              <button type="button">${idx === quiz.length - 1 ? '生成挑战结果' : '下一题'}</button>
            `;
            feedback.querySelector('button').addEventListener('click', () => {
              idx++;
              if (idx >= quiz.length) {
                box.innerHTML = `
                  <div class="camera-quiz__result">
                    <div>苏州话挑战完成</div>
                    <strong>${score} / ${quiz.length}</strong>
                    <p>${score === 3 ? '芸娘说: 客官怕不是平江路走丢的小囡?' : '芸娘说: 苏州话难得很, 能听出一句就是缘分。'}</p>
                    <div class="quiz-achievement">成就解锁: 姑苏听风人</div>
                    <button type="button" data-quiz-share>分享到抖音</button>
                    <button type="button" data-panel-close>返回</button>
                  </div>
                `;
                box.querySelector('[data-quiz-share]').addEventListener('click', () => this._showDouyinShareDialog(panel, '苏州话挑战结果已生成'));
                box.querySelector('[data-panel-close]').addEventListener('click', () => {
                  panel.hidden = true;
                  panel.innerHTML = '';
                });
              } else {
                render();
              }
            });
          });
        });
      };
      render();
    },

    _showPhotoMode() {
      const panel = this._setCameraPanel(`
        <div class="photo-mode-overlay">
          <button class="panel-close" type="button" data-panel-close>×</button>
          <div class="photo-mode-copy">和芸娘同框</div>
          <div class="photo-controls">
            <button type="button" data-photo-video>拍视频</button>
            <button type="button" data-photo-capture>拍一张</button>
          </div>
          <div class="photo-result" hidden>
            <strong>已生成: 我在平江路遇见芸娘</strong>
            <button type="button" data-photo-share>分享</button>
          </div>
        </div>
      `);
      if (!panel) return;
      panel.querySelector('[data-photo-video]').addEventListener('click', () => {
        const result = panel.querySelector('.photo-result');
        if (result) {
          result.hidden = false;
          result.querySelector('strong').textContent = '视频已生成: 跟芸娘在平江路合奏一段';
        }
      });
      panel.querySelector('[data-photo-capture]').addEventListener('click', () => {
        const flash = this.rootEl.querySelector('.camera-flash');
        if (flash) {
          flash.hidden = false;
          flash.classList.add('is-active');
          setTimeout(() => { flash.hidden = true; flash.classList.remove('is-active'); }, 380);
        }
        const result = panel.querySelector('.photo-result');
        if (result) result.hidden = false;
      });
      panel.querySelector('[data-photo-share]').addEventListener('click', () => this.toast('已打开抖音分享面板', 1300));
    },

    _showMemoryCard() {
      const code = 'AI-GUSU-' + String(Date.now()).slice(-5);
      const panel = this._setCameraPanel(`
        <div class="hanshan-card hanshan-card--memory pingjiang-card-modal">
          <button class="panel-close" type="button" data-panel-close>×</button>
          <div class="souvenir-card">
            <div class="souvenir-card__avatar">姑</div>
            <div class="souvenir-card__name">小成寻茶客</div>
            <div class="souvenir-card__code">${code}</div>
          </div>
          <div class="memory-actions">
            <button type="button" data-card-save>保存</button>
            <button type="button" data-card-share>分享</button>
          </div>
        </div>
      `);
      if (!panel) return;
      panel.querySelector('[data-card-save]').addEventListener('click', () => this.toast('纪念卡已保存', 1300));
      panel.querySelector('[data-card-share]').addEventListener('click', () => this._showDouyinShareDialog(panel, '电子纪念卡已带入发布器'));
    },

    _mountDouyinSearch(keyword, mode) {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root) return;
      this._pausePingjiangBgm(true);
      const isDeal = mode === 'deal';
      const items = isDeal
        ? [
            { title: '平江路评弹茶馆双人套餐', desc: '4.8分 · 2.3km · 已售1.2万', price: '¥128', cover: 'assets/images/search_deal_01.png' },
            { title: '河畔苏式点心下午茶', desc: '临河雅座 · 桂花乌龙 · 当日现做', price: '¥39.9', cover: 'assets/images/search_deal_02.png' },
            { title: '摇橹船夜游平江路', desc: '扫码即订 · 今日可用 · 灯影入梦', price: '¥68', cover: 'assets/images/search_deal_03.png' },
            { title: '老字号小吃路线', desc: '陆稿荐 · 采芝斋 · 黄天源', price: '¥29.9', cover: 'assets/images/search_deal_04.png' },
          ]
        : [
            { title: '三分钟走进平江路的晨雾', desc: '12.4w赞 · 粉墙黛瓦和橹声一起醒来', cover: 'assets/images/search_pingjiang_01.png' },
            { title: '苏州Citywalk别错过这条河街', desc: '8.7w赞 · 从巷口一路走到评弹茶馆', cover: 'assets/images/search_pingjiang_02.png' },
            { title: '平江路夜色到底有多浪漫', desc: '5.9w赞 · 灯影落在水面上', cover: 'assets/images/search_pingjiang_03.png' },
            { title: '本地人带你吃平江路', desc: '4.6w赞 · 糕团、茶点、酱肉都安排', cover: 'assets/images/search_pingjiang_04.png' },
          ];
      root.innerHTML = `
        <div class="douyin-search-page ${isDeal ? 'is-deal' : ''}">
          <div class="douyin-search-top">
            <button type="button" data-search-back>‹</button>
            <div class="douyin-search-box">${keyword}</div>
            <span>搜索</span>
          </div>
          <div class="douyin-search-tabs">
            <button class="${!isDeal ? 'is-active' : ''}">视频</button>
            <button>用户</button>
            <button>经验</button>
            <button class="${isDeal ? 'is-active' : ''}">团购</button>
          </div>
          <div class="douyin-search-list">
            ${items.map((item, i) => `
              <article class="douyin-search-item">
                <div class="douyin-search-thumb has-cover">
                  <img src="${item.cover}" alt="${item.title}">
                  <span>${i + 1}</span>
                </div>
                <div>
                  <strong>${item.title}</strong>
                  <p>${item.desc}</p>
                  ${isDeal ? `<em>${item.price}</em>` : '<small>#平江路 #苏州文旅 #一镜入姑苏</small>'}
                </div>
              </article>
            `).join('')}
          </div>
        </div>
      `;
      this.rootEl = root;
      this.shellEl = root;
      root.querySelector('[data-search-back]').addEventListener('click', () => this._returnToPingjiangTheme());
    },

    _openDouyinSearchWithTransition(keyword, mode) {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root) {
        this._mountDouyinSearch(keyword, mode);
        return;
      }
      const overlay = document.createElement('div');
      overlay.className = 'douyin-search-transition';
      overlay.innerHTML = `
        <div class="douyin-search-transition__bar">
          <span>${keyword}</span>
          <i>搜索</i>
        </div>
        <div class="douyin-search-transition__pulse"></div>
      `;
      root.appendChild(overlay);
      setTimeout(() => overlay.classList.add('is-fly'), 120);
      setTimeout(() => {
        overlay.remove();
        this._mountDouyinSearch(keyword, mode);
      }, 760);
    },

    _mountPhotoCapturePage() {
      const root = this.rootEl || document.getElementById('shell-root');
      if (!root) return;
      root.innerHTML = `
        <div class="photo-capture-page">
          <video class="camera-live photo-live" autoplay muted playsinline webkit-playsinline="true"></video>
          <div class="photo-fallback"></div>
          <button class="camera-back" type="button" data-photo-back aria-label="返回">‹</button>
          <img class="photo-yunniang-corner" src="assets/images/yuniang.gif" alt="芸娘">
          <button class="photo-native-hotspot photo-native-hotspot--photo is-active" type="button" data-photo-mode="photo" aria-label="照片"></button>
          <button class="photo-native-hotspot photo-native-hotspot--video" type="button" data-photo-mode="video" aria-label="视频"></button>
          <button class="photo-native-hotspot photo-native-hotspot--shutter" type="button" data-photo-shutter aria-label="拍摄"></button>
          <div class="photo-result-actions" hidden>
            <button type="button" data-photo-save>保存</button>
            <button type="button" data-photo-publish>发布到抖音</button>
          </div>
          <div class="camera-capture-preview" hidden></div>
          <div class="camera-flash" hidden></div>
        </div>
      `;
      this.rootEl = root;
      this.shellEl = root;
      this._cameraFacing = 'user';
      this._startCamera();
      let mode = 'photo';
      root.querySelector('[data-photo-back]').addEventListener('click', () => this._returnToPingjiangTheme());
      root.querySelectorAll('[data-photo-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          mode = btn.getAttribute('data-photo-mode') || 'photo';
          this._setCaptureMode(mode);
        });
      });
      root.querySelector('[data-photo-shutter]').addEventListener('click', () => {
        this._handlePhotoCapturePageShutter(mode);
      });
      const handleNativeControlTap = (event) => {
        if (event.target.closest('[data-photo-back], .camera-capture-preview')) return;
        const page = event.currentTarget;
        const rect = page.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const rx = x / rect.width;
        const ry = y / rect.height;
        if (ry > 0.82 && rx > 0.34 && rx < 0.66) {
          if (ry > 0.92) {
            const nextMode = rx < 0.5 ? 'photo' : 'video';
            mode = nextMode;
            this._setCaptureMode(nextMode);
            return;
          }
          this._handlePhotoCapturePageShutter(mode);
        }
      };
      root.querySelector('.photo-capture-page').addEventListener('click', handleNativeControlTap);
      root.querySelector('.photo-capture-page').addEventListener('pointerup', handleNativeControlTap);
      const result = root.querySelector('.photo-result-actions');
      if (result) result.hidden = true;
      this._setCaptureMode('photo');
    },

    _handlePhotoCapturePageShutter(mode) {
      const now = Date.now();
      if (this._lastPhotoShutterAt && now - this._lastPhotoShutterAt < 280) return;
      this._lastPhotoShutterAt = now;
      const root = this.rootEl;
      const yunniang = root && root.querySelector('.photo-yunniang-corner');
      if (yunniang) {
        yunniang.src = 'assets/images/yuniang.gif';
        yunniang.classList.remove('is-captured');
        yunniang.classList.toggle('is-recorded', mode === 'video');
      }
      this._handleCapture();
    },

    _showDouyinShareDialog(host, text) {
      const panel = host || this.rootEl || document.body;
      panel.querySelector('.douyin-share-sheet')?.remove();
      const share = document.createElement('div');
      share.className = 'douyin-share-sheet';
      share.innerHTML = `
        <button type="button" class="douyin-share-sheet__close" aria-label="关闭">×</button>
        <strong>分享到抖音</strong>
        <p>${text || '内容已生成'}，已自动带入 #一镜入姑苏 #平江路 话题。</p>
        <div class="douyin-share-sheet__grid">
          <button type="button">朋友</button>
          <button type="button">日常</button>
          <button type="button">私信</button>
          <button type="button">复制链接</button>
        </div>
        <div class="douyin-share-sheet__actions">
          <button type="button">保存草稿</button>
          <button type="button">发布</button>
        </div>
      `;
      panel.appendChild(share);
      share.addEventListener('click', (e) => {
        if (e.target === share || e.target.closest('.douyin-share-sheet__close')) share.remove();
        if (e.target && e.target.textContent === '发布') this.toast('发布成功', 1200);
      });
    },

    _mockVoiceAsk() {
      const yunniang = this.rootEl && this.rootEl.querySelector('.ar-yunniang__bubble');
      if (!yunniang) return;
      yunniang.textContent = '你问“这里为什么叫平江路?” 芸娘答: 因河成街, 因街成城, 平江路就是姑苏的生活纹理。';
      this.toast('已识别语音问题', 1300);
    },

    toast(message, duration) {
      if (window.App && window.App.toast) window.App.toast(message, duration || 1300);
    },

    // -----------------------------------------------------------------------
    // playFeed / pauseFeed
    // -----------------------------------------------------------------------
    playFeed(videoId) {
      if (!this.feedEl) return;
      const realVideo = this.rootEl && this.rootEl.querySelector('.feed__real-video');
      const id = videoId || 'VID-001';
      this.feedEl.dataset.videoId = id;
      if (this.videoLayerEl) this.videoLayerEl.dataset.videoId = id;
      // CSS placeholder 持续播放, 无需 video API
      if (!realVideo || realVideo.dataset.userPaused !== '1') this.feedEl.classList.add('is-playing');
      window.dispatchEvent(new CustomEvent('shell:feed-ready', { detail: { videoId } }));
    },
    pauseFeed() {
      if (!this.feedEl) return;
      this.feedEl.classList.remove('is-playing');
    },

    // -----------------------------------------------------------------------
    // 长按手势 (mouse + touch 双兼容)
    // -----------------------------------------------------------------------
    enableLongPress(thresholdMs) {
      if (this._longPressEnabled || !this.feedEl) return;
      const threshold = thresholdMs || PRESS_MS;
      const el = this.feedEl;

      const onDown = (e) => {
        // 忽略操作栏区域
        if (e.target && e.target.closest && e.target.closest('.feed-actions, .feed__actions, button')) return;

        const touch = (e.touches && e.touches[0]) || e;
        this._pressOrigin = { x: touch.clientX, y: touch.clientY, t: Date.now() };

        // 屏幕轻微变暗
        el.classList.add('is-pressing');
        const indicator = el.querySelector('.feed__press-indicator');
        if (indicator) {
          indicator.style.left = this._pressOrigin.x + 'px';
          indicator.style.top = this._pressOrigin.y + 'px';
        }

        window.dispatchEvent(new CustomEvent('shell:longpress-start', {
          detail: { x: this._pressOrigin.x, y: this._pressOrigin.y, t: this._pressOrigin.t },
        }));

        this._pressTimer = setTimeout(() => {
          this._pressTimer = null;
          el.classList.remove('is-pressing');
          if (this._pressOrigin) {
            window.dispatchEvent(new CustomEvent('shell:longpress-detected', {
              detail: { x: this._pressOrigin.x, y: this._pressOrigin.y, duration: threshold },
            }));
            this._pressOrigin = null;
          }
        }, threshold);
      };
      const onUp = () => {
        el.classList.remove('is-pressing');
        if (this._pressTimer) {
          clearTimeout(this._pressTimer);
          this._pressTimer = null;
          this._pressOrigin = null;
          window.dispatchEvent(new CustomEvent('shell:longpress-cancel', { detail: {} }));
        }
      };
      const onMove = (e) => {
        if (!this._pressOrigin) return;
        const t = (e.touches && e.touches[0]) || e;
        const dx = t.clientX - this._pressOrigin.x;
        const dy = t.clientY - this._pressOrigin.y;
        if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) onUp();
      };

      el.addEventListener('mousedown', onDown);
      el.addEventListener('touchstart', onDown, { passive: false });
      el.addEventListener('mouseup', onUp);
      el.addEventListener('touchend', onUp);
      el.addEventListener('touchcancel', onUp);
      el.addEventListener('mouseleave', onUp);
      el.addEventListener('mousemove', onMove);
      el.addEventListener('touchmove', onMove, { passive: false });
      el.addEventListener('contextmenu', (e) => e.preventDefault());

      this._longPressHandlers = { onDown, onUp, onMove };
      this._longPressEnabled = true;
    },

    disableLongPress() {
      if (!this._longPressEnabled || !this.feedEl) return;
      const el = this.feedEl;
      const h = this._longPressHandlers || {};
      if (h.onDown) {
        el.removeEventListener('mousedown', h.onDown);
        el.removeEventListener('touchstart', h.onDown);
      }
      if (h.onUp) {
        el.removeEventListener('mouseup', h.onUp);
        el.removeEventListener('touchend', h.onUp);
        el.removeEventListener('touchcancel', h.onUp);
        el.removeEventListener('mouseleave', h.onUp);
      }
      if (h.onMove) {
        el.removeEventListener('mousemove', h.onMove);
        el.removeEventListener('touchmove', h.onMove);
      }
      this._longPressEnabled = false;
      if (this._pressTimer) clearTimeout(this._pressTimer);
      this._pressTimer = null;
      this._pressOrigin = null;
    },

    // -----------------------------------------------------------------------
    // 双击红心爆裂
    // -----------------------------------------------------------------------
    _wireDoubleTap() {
      if (!this.feedEl) return;
      if (this._doubleTapWiredEl === this.feedEl) return;
      const onTap = (e) => {
        // 忽略操作栏
        if (e.target && e.target.closest && e.target.closest('button, .feed-actions, .feed__actions, .topbar, .tabbar, .feed-agent, .feed-agent-tip, .feed-mini-sheet')) return;

        const now = Date.now();
        const dt = now - this._lastTapTime;
        const touch = (e.changedTouches && e.changedTouches[0]) || e;

        if (dt < DOUBLE_TAP_MS && dt > 30) {
          if (this._singleTapTimer) clearTimeout(this._singleTapTimer);
          this._singleTapTimer = null;
          this._burstHeart(touch.clientX, touch.clientY);
          this._lastTapTime = 0;
        } else {
          this._lastTapTime = now;
          if (this._singleTapTimer) clearTimeout(this._singleTapTimer);
          this._singleTapTimer = setTimeout(() => {
            this._toggleFeedVideoPlayback();
            this._singleTapTimer = null;
          }, DOUBLE_TAP_MS + 30);
        }
      };
      // 用 click 简单点; touchend 也挂一份兼容移动端
      this.feedEl.addEventListener('click', onTap);
      this.feedEl.addEventListener('touchend', onTap);
      this._doubleTapWiredEl = this.feedEl;
    },

    _toggleFeedVideoPlayback() {
      const root = this.rootEl || document.getElementById('shell-root');
      const video = root && root.querySelector('.feed__real-video');
      if (!video || video.hidden || !video.src) return;
      if (video.paused) {
        video.dataset.userPaused = '0';
        video.play().catch(() => {});
        this.toast('视频继续播放', 700);
      } else {
        video.dataset.userPaused = '1';
        video.pause();
        this.toast('视频已暂停', 700);
      }
    },

    _burstHeart(x, y) {
      if (!this.feedEl) return;
      const rect = this.feedEl.getBoundingClientRect();
      const relX = x - rect.left;
      const relY = y - rect.top;
      const heart = document.createElement('div');
      heart.className = 'feed-burst-heart';
      heart.textContent = '❤';
      heart.style.left = relX + 'px';
      heart.style.top = relY + 'px';
      // 随机旋转
      const angle = (Math.random() * 30 - 15) | 0;
      heart.style.setProperty('--burst-rot', angle + 'deg');
      this.feedEl.appendChild(heart);
      setTimeout(() => { try { heart.remove(); } catch (e) {} }, 900);
    },

    // -----------------------------------------------------------------------
    // showInkRipple: 水墨晕染 1.5s
    // -----------------------------------------------------------------------
    showInkRipple(x, y) {
      if (this._inkRunning) return Promise.resolve();
      this._inkRunning = true;

      const host = this.feedEl || this.shellEl || document.body;
      const rect = host.getBoundingClientRect();
      const cx = (typeof x === 'number') ? x - rect.left : rect.width / 2;
      const cy = (typeof y === 'number') ? y - rect.top : rect.height / 2;

      const ripple = document.createElement('div');
      ripple.className = 'ink-ripple';
      ripple.style.left = cx + 'px';
      ripple.style.top = cy + 'px';
      host.appendChild(ripple);

      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          this._inkRunning = false;
          try { ripple.remove(); } catch (e) {}
          resolve();
        };
        ripple.addEventListener('animationend', finish, { once: true });
        // 兜底
        setTimeout(finish, 1700);
      });
    },

    // -----------------------------------------------------------------------
    // showLandmarkDrawer / hideLandmarkDrawer
    // -----------------------------------------------------------------------
    showLandmarkDrawer(landmarkId) {
      if (!this.drawerEl) return;
      const body = this.drawerEl.querySelector('.landmark-drawer__body');
      if (body) body.innerHTML = this._renderLandmarkBody(landmarkId || 'pingjianglu');
      this.drawerEl.hidden = false;
      // 下一帧加 class 触发动画
      requestAnimationFrame(() => {
        this.drawerEl.classList.add('is-open');
      });
      this._drawerOpen = true;

      // 绑定 CTA
      const cta = this.drawerEl.querySelector('[data-cta="enter-scene"]');
      if (cta) {
        cta.onclick = () => {
          window.dispatchEvent(new CustomEvent('shell:landmark-drawer-cta', {
            detail: { landmarkId: landmarkId || 'pingjianglu' },
          }));
        };
      }
      const closeBtn = this.drawerEl.querySelector('[data-cta="close"]');
      if (closeBtn) {
        closeBtn.onclick = () => {
          this.hideLandmarkDrawer();
          // 回到 FEED_BROWSING 由 App 监听 close 事件 (或直接调 App.transition)
          if (window.App && window.App.state === 'LANDMARK_CARD_SHOW') {
            window.App.transition('FEED_BROWSING');
          }
        };
      }
    },

    hideLandmarkDrawer() {
      if (!this.drawerEl) return;
      this.drawerEl.classList.remove('is-open');
      this._drawerOpen = false;
      setTimeout(() => {
        if (!this._drawerOpen && this.drawerEl) this.drawerEl.hidden = true;
      }, 360);
    },

    _renderLandmarkBody(id) {
      // MVP 只有平江路
      return `
        <div class="landmark-card">
          <div class="landmark-card__cover">
            <div class="landmark-card__cover-svg">
              <svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
                <path d="M0 90 Q140 -10 280 90 L280 90 L0 90 Z" fill="#2D3E50" opacity="0.75"/>
                <rect x="130" y="65" width="4" height="25" fill="#2D3E50"/>
                <rect x="146" y="65" width="4" height="25" fill="#2D3E50"/>
              </svg>
            </div>
            <div class="landmark-card__badge">平江路 · 国家级历史文化街区</div>
          </div>
          <div class="landmark-card__title">平江路</div>
          <div class="landmark-card__subtitle">姑苏城内最古老的水陆并行街巷</div>
          <div class="landmark-card__meta">
            <span class="landmark-card__chip">800 年河巷</span>
            <span class="landmark-card__chip">评弹</span>
            <span class="landmark-card__chip">老字号</span>
          </div>
          <p class="landmark-card__desc">
            沿河而生, 枕水而眠。芸娘正在等你, 教你三句苏州话, 弹半句评弹, 再去淘老字号。
          </p>
          <div class="landmark-card__actions">
            <button class="landmark-card__btn landmark-card__btn--ghost" data-cta="close">回去看视频</button>
            <button class="landmark-card__btn landmark-card__btn--primary" data-cta="enter-scene">和芸娘聊聊</button>
          </div>
        </div>
      `;
    },

    // -----------------------------------------------------------------------
    // 操作栏点击 → toast
    // -----------------------------------------------------------------------
    _handleActionTap(act, el) {
      if (act === 'comment') {
        this._showFeedMiniSheet('comment', '评论');
        return;
      }
      if (act === 'share') {
        this._showFeedMiniSheet('share', '分享');
        return;
      }
      if (act === 'avatar') {
        const author = (this.rootEl && this.rootEl.querySelector('.feed__author')?.textContent?.trim()) || '@今天也在河边发呆';
        this._showFeedMiniSheet('profile', author);
        return;
      }
      const msgs = { like: '已点赞', star: '已收藏', music: '评弹·声声慢' };
      let msg = msgs[act] || '已完成';
      if (act === 'like' && el) {
        const active = el.classList.toggle('is-liked');
        const num = el.querySelector('span:last-child');
        if (num) num.textContent = active ? '2.4w' : '2.3w';
        msg = active ? '已点赞' : '已取消点赞';
      }
      if (act === 'star' && el) {
        const active = el.classList.toggle('is-starred');
        const num = el.querySelector('span:last-child');
        if (num) num.textContent = active ? '1.2w' : '1.1w';
        msg = active ? '已收藏到姑苏灵感夹' : '已取消收藏';
      }
      if (window.App && window.App.toast) {
        window.App.toast(msg, 1500);
      } else {
        console.log('[shell action]', msg);
      }
    },

    // -----------------------------------------------------------------------
    // hide/show shell (进入场景时隐藏)
    // -----------------------------------------------------------------------
    hideShell() {
      if (this.shellEl) this.shellEl.style.display = 'none';
      this.disableLongPress();
    },
    showShell() {
      if (this.shellEl) this.shellEl.style.display = '';
    },

    _wireFeedActions(root) {
      const actions = root.querySelectorAll('.feed__action');
      const orderedActions = ['avatar', 'like', 'comment', 'star', 'share'];
      actions.forEach((el, idx) => {
        if (!el.dataset.action) el.dataset.action = orderedActions[idx] || 'action';
        el.onclick = (e) => {
          e.stopPropagation();
          this._handleActionTap(el.dataset.action, el);
        };
      });
      root.querySelector('.topbar__search')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showFeedMiniSheet('topbar', '搜索');
      });
      root.querySelector('.topbar__live')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showFeedMiniSheet('topbar', '开直播');
      });
      root.querySelectorAll('.topbar__tab').forEach((tab) => {
        tab.addEventListener('click', (e) => {
          e.stopPropagation();
          root.querySelectorAll('.topbar__tab').forEach((item) => item.classList.remove('topbar__tab--active'));
          tab.classList.add('topbar__tab--active');
          this._showFeedMiniSheet('topbar', tab.textContent.trim());
        });
      });
      root.querySelectorAll('.tabbar__item').forEach((tab) => {
        tab.addEventListener('click', (e) => {
          e.stopPropagation();
          root.querySelectorAll('.tabbar__item').forEach((item) => {
            item.classList.remove('tabbar__item--active');
            item.setAttribute('aria-selected', 'false');
          });
          tab.classList.add('tabbar__item--active');
          tab.setAttribute('aria-selected', 'true');
          const label = tab.getAttribute('aria-label') || tab.textContent.trim() || '发布';
          this._showFeedMiniSheet('tabbar', label);
        });
      });
    },
  };

  window.Shell = Shell;
})();
