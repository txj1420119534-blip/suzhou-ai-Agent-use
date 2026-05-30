/* =========================================================================
 * main.js — 《一镜入姑苏》MVP 主入口 + 全局状态机
 * Builder 3 交付
 *
 * 职责:
 *   1. 启动入口: DOMContentLoaded → 字体 ready → Scene.init → App.start
 *   2. 全局状态机 (20 个状态, 严格 ALLOWED_TRANSITIONS 校验)
 *   3. CustomEvent 事件总线 (App.on / window.dispatchEvent)
 *   4. localStorage 持久化 (gusu.ticket.v1 / gusu.progress.v1 / gusu.flags.v1)
 *   5. 顶部时间动态填充 (每分钟刷新, 由 Shell 渲染状态栏 DOM, 这里只更新文本)
 *   6. 启动后: INTRO 钩子片头 (1.2s) → 船票滑入 → CTA → 信息流 → ...
 *   7. 全局 toast / 音频解锁 / 调试 hooks
 *
 * 重要约定:
 *   - 其他模块只 dispatch "我完事了" 事件, 由 App 监听后决定是否 transition
 *   - App.transition 同步 dispatch `app:state-change`, handler 内不要再 transition (用 queueMicrotask 推迟)
 *   - 校验失败仅 console.warn, 拒绝跳转, 不抛错
 * ========================================================================= */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. 状态枚举
  // ---------------------------------------------------------------------------
  const STATES = Object.freeze({
    IDLE: 'IDLE',
    INTRO_PLAYING: 'INTRO_PLAYING',
    TICKET_ISSUING: 'TICKET_ISSUING',
    TICKET_READY: 'TICKET_READY',
    FEED_BROWSING: 'FEED_BROWSING',
    LANDMARK_LONGPRESS: 'LANDMARK_LONGPRESS',
    LANDMARK_DETECTED: 'LANDMARK_DETECTED',
    LANDMARK_CARD_SHOW: 'LANDMARK_CARD_SHOW',
    SCENE_ENTERING: 'SCENE_ENTERING',
    SCENE_DIALOGUE_INTRO: 'SCENE_DIALOGUE_INTRO',
    STEP_SUZHOU: 'STEP_SUZHOU',
    STEP_SUZHOU_DONE: 'STEP_SUZHOU_DONE',
    STEP_PINGTAN: 'STEP_PINGTAN',
    STEP_PINGTAN_DONE: 'STEP_PINGTAN_DONE',
    STEP_SHOPS: 'STEP_SHOPS',
    STEP_SHOPS_DONE: 'STEP_SHOPS_DONE',
    CARD_GENERATING: 'CARD_GENERATING',
    TICKET_UPGRADING: 'TICKET_UPGRADING',
    SHARE_DISPLAY: 'SHARE_DISPLAY',
    SHARE_DONE: 'SHARE_DONE',
  });

  // 兼容用户简称 (内部映射到正式状态名, 仅 setState 入口用)
  const STATE_ALIASES = Object.freeze({
    INTRO: STATES.INTRO_PLAYING,
    TICKET_ISSUE: STATES.TICKET_ISSUING,
    FEED: STATES.FEED_BROWSING,
    LONGPRESS: STATES.LANDMARK_LONGPRESS,
    LANDMARK_CARD: STATES.LANDMARK_CARD_SHOW,
    SCENE_INTRO: STATES.SCENE_DIALOGUE_INTRO,
    CARD_GEN: STATES.CARD_GENERATING,
    SHARE: STATES.SHARE_DISPLAY,
  });

  // ---------------------------------------------------------------------------
  // 2. 合法跳转表
  // ---------------------------------------------------------------------------
  const ALLOWED_TRANSITIONS = Object.freeze({
    IDLE: ['INTRO_PLAYING', 'FEED_BROWSING'],
    INTRO_PLAYING: ['TICKET_ISSUING'],
    TICKET_ISSUING: ['TICKET_READY'],
    TICKET_READY: ['FEED_BROWSING'],
    FEED_BROWSING: ['LANDMARK_LONGPRESS'],
    LANDMARK_LONGPRESS: ['FEED_BROWSING', 'LANDMARK_DETECTED'],
    LANDMARK_DETECTED: ['LANDMARK_CARD_SHOW'],
    LANDMARK_CARD_SHOW: ['SCENE_ENTERING', 'FEED_BROWSING'],
    SCENE_ENTERING: ['SCENE_DIALOGUE_INTRO'],
    SCENE_DIALOGUE_INTRO: ['STEP_SUZHOU'],
    STEP_SUZHOU: ['STEP_SUZHOU_DONE'],
    STEP_SUZHOU_DONE: ['STEP_PINGTAN'],
    STEP_PINGTAN: ['STEP_PINGTAN_DONE'],
    STEP_PINGTAN_DONE: ['STEP_SHOPS'],
    STEP_SHOPS: ['STEP_SHOPS_DONE'],
    STEP_SHOPS_DONE: ['CARD_GENERATING'],
    CARD_GENERATING: ['TICKET_UPGRADING'],
    TICKET_UPGRADING: ['SHARE_DISPLAY'],
    SHARE_DISPLAY: ['SHARE_DONE'],
    SHARE_DONE: ['IDLE'],
  });

  // ---------------------------------------------------------------------------
  // 3. localStorage keys
  // ---------------------------------------------------------------------------
  const LS_KEYS = {
    progress: 'gusu.progress.v1',
    ticket: 'gusu.ticket.v1',
    flags: 'gusu.flags.v1',
  };

  // 关键持久化锚点 (只在这些状态后写盘)
  const PERSIST_ANCHORS = new Set([
    STATES.TICKET_READY,
    STATES.SCENE_DIALOGUE_INTRO,
    STATES.STEP_PINGTAN,
    STATES.STEP_SHOPS,
    STATES.SHARE_DISPLAY,
  ]);

  // ---------------------------------------------------------------------------
  // 4. Intro 模块 (1.2s 钩子片头, CSS 兜底)
  // ---------------------------------------------------------------------------
  const Intro = {
    el: null,
    play() {
      const root = document.getElementById('intro-layer');
      if (!root) {
        console.warn('[Intro] #intro-layer not found, skip');
        return Promise.resolve();
      }
      root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'intro-hook';
      wrap.innerHTML = `
        <div class="intro-hook__ink"></div>
        <div class="intro-hook__title">
          <div class="intro-hook__title-cn">一镜入姑苏</div>
          <div class="intro-hook__title-sub">· 平江路 ·</div>
        </div>
        <div class="intro-hook__veil"></div>
      `;
      root.appendChild(wrap);
      root.classList.add('is-active');
      this.el = wrap;

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          finish();
        }, 1200);
        const finish = () => {
          clearTimeout(timer);
          root.classList.remove('is-active');
          // 渐隐后下一帧移除
          requestAnimationFrame(() => {
            root.innerHTML = '';
            resolve();
          });
          window.dispatchEvent(new CustomEvent('intro:done', { detail: {} }));
        };
        // 如果以后接入真 VID-005, 这里挂 video.ended 即可
      });
    },
  };

  // ---------------------------------------------------------------------------
  // 5. App 主对象 (window.App)
  // ---------------------------------------------------------------------------
  const App = {
    STATES,
    state: STATES.IDLE,
    history: [],

    // -- 启动 -----------------------------------------------------------------
    async start() {
      // 字体 ready
      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      } catch (e) {
        // 老浏览器无 document.fonts, 忽略
      }

      // 状态栏时间
      this._mountStatusTime();

      // 恢复进度? MVP 简化: 仅恢复船票数据 (Ticket.load 已在 boot 中调), 进度跳转留 toast 提示
      const restored = this._restore();
      if (restored && restored.state && restored.state !== STATES.IDLE && restored.state !== STATES.SHARE_DONE) {
        // 不强制跳转, 仅提示 (调试可用 ?resume=1)
        const wantResume = new URLSearchParams(location.search).get('resume') === '1';
        if (wantResume) {
          this.toast('继续上次旅程...', 1500);
          // 直接强写 state, 不走 transition (避免一连串校验失败)
          this.state = restored.state;
          window.dispatchEvent(new CustomEvent('app:state-change', {
            detail: { from: STATES.IDLE, to: this.state, payload: { resumed: true }, timestamp: Date.now() },
          }));
          return;
        }
      }

      // 正常流程: 开屏即进入抖音信息流
      this.transition(STATES.FEED_BROWSING);
    },

    // -- 状态切换 -------------------------------------------------------------
    transition(target, payload) {
      // 兼容别名
      if (STATE_ALIASES[target]) target = STATE_ALIASES[target];

      const from = this.state;
      const allowed = ALLOWED_TRANSITIONS[from] || [];
      if (!allowed.includes(target)) {
        console.warn(`[App] illegal transition ${from} -> ${target}, ignored.`);
        return false;
      }
      this.state = target;
      this.history.push({ from, to: target, t: Date.now() });
      if (this.history.length > 64) this.history.shift();

      // 同步派发状态变更
      window.dispatchEvent(new CustomEvent('app:state-change', {
        detail: { from, to: target, payload: payload || {}, timestamp: Date.now() },
      }));

      // 持久化 (仅锚点)
      if (PERSIST_ANCHORS.has(target)) {
        this._save();
      }
      return true;
    },

    // 用户简写 API (题面要求)
    setState(name) {
      const target = STATE_ALIASES[name] || name;
      return this.transition(target);
    },
    getState() {
      return this.state;
    },

    isState(name) {
      const target = STATE_ALIASES[name] || name;
      return this.state === target;
    },

    // 监听某个状态进入 (语法糖)
    on(stateName, handler) {
      const target = STATE_ALIASES[stateName] || stateName;
      window.addEventListener('app:state-change', (e) => {
        if (e.detail && e.detail.to === target) {
          try { handler(e.detail.payload); } catch (err) { console.error('[App.on]', err); }
        }
      });
    },

    // 重置
    reset() {
      try {
        localStorage.removeItem(LS_KEYS.progress);
        localStorage.removeItem(LS_KEYS.ticket);
      } catch (e) {}
      this.state = STATES.IDLE;
      this.history = [];
      window.dispatchEvent(new CustomEvent('app:reset', { detail: {} }));
      // 重启
      requestAnimationFrame(() => this.start());
    },

    // 全局 toast
    toast(msg, duration = 2000) {
      const root = document.getElementById('toast-root');
      if (!root) {
        console.log('[toast]', msg);
        return;
      }
      const item = document.createElement('div');
      item.className = 'toast-item';
      item.textContent = msg;
      root.appendChild(item);
      // 入场
      requestAnimationFrame(() => item.classList.add('is-show'));
      setTimeout(() => {
        item.classList.remove('is-show');
        setTimeout(() => item.remove(), 350);
      }, duration);
    },

    // -- 内部 -----------------------------------------------------------------
    _save() {
      try {
        const data = {
          state: this.state,
          scores: (window.Scene && window.Scene.scores) || { suzhou: 0, pingtan: 0, shops: 0 },
          collectedShops: (window.Scene && window.Scene.collectedShops) || [],
          timestamp: Date.now(),
        };
        localStorage.setItem(LS_KEYS.progress, JSON.stringify(data));
      } catch (e) {
        console.warn('[App._save] failed', e);
      }
    },
    _restore() {
      try {
        const raw = localStorage.getItem(LS_KEYS.progress);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        try { localStorage.removeItem(LS_KEYS.progress); } catch (_) {}
        return null;
      }
    },

    _statusTimer: null,
    _mountStatusTime() {
      const update = () => {
        const els = document.querySelectorAll('[data-status-time]');
        if (!els.length) return;
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const txt = `${hh}:${mm}`;
        els.forEach((el) => { el.textContent = txt; });
      };
      update();
      // 每 30s 校准一次, 避免错过整分
      if (this._statusTimer) clearInterval(this._statusTimer);
      this._statusTimer = setInterval(update, 30 * 1000);
    },
  };

  window.App = App;

  // ---------------------------------------------------------------------------
  // 6. 事件 → 状态 路由 (App 监听各模块"完事"事件, 决定下一步)
  // ---------------------------------------------------------------------------
  function wireRouter() {
    // INTRO 完成 → TICKET_ISSUING
    window.addEventListener('intro:done', () => {
      if (App.state === STATES.INTRO_PLAYING) {
        App.transition(STATES.TICKET_ISSUING);
      }
    });

    // 监听 TICKET_ISSUING 进入: 调 Ticket.create + render + slideIn
    App.on(STATES.TICKET_ISSUING, async () => {
      try {
        if (!window.Ticket) {
          console.warn('[Router] Ticket module missing');
          return;
        }
        // 已存在数据 (恢复态) 不重复 create
        if (!window.Ticket.data) {
          window.Ticket.create();
        }
        window.Ticket.render();
        await window.Ticket.slideIn();
        // 派发 ticket:ready, 由下面 listener 推进
        window.dispatchEvent(new CustomEvent('ticket:ready', {
          detail: { ...window.Ticket.data },
        }));
      } catch (e) {
        console.error('[Router/TICKET_ISSUING]', e);
      }
    });

    // ticket:ready → TICKET_READY
    window.addEventListener('ticket:ready', () => {
      if (App.state === STATES.TICKET_ISSUING) {
        App.transition(STATES.TICKET_READY);
        App.transition(STATES.FEED_BROWSING);
      }
    });

    // ticket CTA → FEED_BROWSING
    window.addEventListener('ticket:cta-clicked', () => {
      if (App.state === STATES.TICKET_READY) {
        unlockAudio();
        App.transition(STATES.FEED_BROWSING);
      }
    });

    // FEED_BROWSING 进入 → Shell.mount + playFeed
    App.on(STATES.FEED_BROWSING, () => {
      queueMicrotask(() => {
        if (!window.Shell) return;
        window.Shell.mount();
        window.Shell.playFeed('VID-001');
        window.Shell.enableLongPress(500);
      });
    });

    // 长按触发 → LANDMARK_LONGPRESS (中间态)
    window.addEventListener('shell:longpress-start', () => {
      if (App.state === STATES.FEED_BROWSING) {
        App.transition(STATES.LANDMARK_LONGPRESS);
      }
    });

    // 长按取消 → 回到 FEED_BROWSING
    window.addEventListener('shell:longpress-cancel', () => {
      if (App.state === STATES.LANDMARK_LONGPRESS) {
        App.transition(STATES.FEED_BROWSING);
      }
    });

    // 长按成立 → LANDMARK_DETECTED, 触发水墨晕染
    window.addEventListener('shell:longpress-detected', async (e) => {
      if (App.state !== STATES.LANDMARK_LONGPRESS) return;
      const { x = window.innerWidth / 2, y = window.innerHeight / 2 } = (e.detail || {});
      App.transition(STATES.LANDMARK_DETECTED);
      if (window.Shell && window.Shell.showInkRipple) {
        await window.Shell.showInkRipple(x, y);
      } else {
        await new Promise((r) => setTimeout(r, 1500));
      }
      App.transition(STATES.LANDMARK_CARD_SHOW);
    });

    // LANDMARK_CARD_SHOW 进入 → 显示地标抽屉
    App.on(STATES.LANDMARK_CARD_SHOW, () => {
      queueMicrotask(() => {
        if (window.Shell && window.Shell.showLandmarkDrawer) {
          window.Shell.showLandmarkDrawer('pingjianglu');
        }
      });
    });

    // 抽屉 CTA → SCENE_ENTERING
    window.addEventListener('shell:landmark-drawer-cta', () => {
      if (App.state === STATES.LANDMARK_CARD_SHOW) {
        if (window.Shell && window.Shell.hideLandmarkDrawer) window.Shell.hideLandmarkDrawer();
        if (window.Shell && window.Shell.hideShell) window.Shell.hideShell();
        App.transition(STATES.SCENE_ENTERING);
      }
    });

    // SCENE_ENTERING 进入 → Scene.enter
    App.on(STATES.SCENE_ENTERING, async () => {
      if (!window.Scene) return;
      try {
        await window.Scene.enter();
        window.dispatchEvent(new CustomEvent('scene:enter-done', { detail: {} }));
      } catch (e) {
        console.error('[Router/SCENE_ENTERING]', e);
      }
    });

    // scene:enter-done → SCENE_DIALOGUE_INTRO
    window.addEventListener('scene:enter-done', () => {
      if (App.state === STATES.SCENE_ENTERING) {
        App.transition(STATES.SCENE_DIALOGUE_INTRO);
      }
    });

    // 三步进入分发: SCENE_DIALOGUE_INTRO 之后由 Scene 内部决定何时 → STEP_SUZHOU
    // step-complete → 对应 *_DONE 并 stamp
    window.addEventListener('scene:step-complete', async (e) => {
      const { step } = e.detail || {};
      if (!step) return;

      if (step === 'suzhou' && App.state === STATES.STEP_SUZHOU) {
        if (window.Ticket && window.Ticket.stamp) await window.Ticket.stamp('suzhou');
        App.transition(STATES.STEP_SUZHOU_DONE);
        // 1.2s 自动 → STEP_PINGTAN
        setTimeout(() => {
          if (App.state === STATES.STEP_SUZHOU_DONE) App.transition(STATES.STEP_PINGTAN);
        }, 1200);
      } else if (step === 'pingtan' && App.state === STATES.STEP_PINGTAN) {
        if (window.Ticket && window.Ticket.stamp) await window.Ticket.stamp('pingtan');
        App.transition(STATES.STEP_PINGTAN_DONE);
        setTimeout(() => {
          if (App.state === STATES.STEP_PINGTAN_DONE) App.transition(STATES.STEP_SHOPS);
        }, 1200);
      } else if (step === 'shops' && App.state === STATES.STEP_SHOPS) {
        if (window.Ticket && window.Ticket.stamp) await window.Ticket.stamp('shops');
        App.transition(STATES.STEP_SHOPS_DONE);
        setTimeout(() => {
          if (App.state === STATES.STEP_SHOPS_DONE) App.transition(STATES.CARD_GENERATING);
        }, 800);
      }
    });

    // CARD_GENERATING 进入 → ShareCard.generate
    App.on(STATES.CARD_GENERATING, async () => {
      if (!window.ShareCard) return;
      try {
        const userData = {
          passengerName: window.Ticket && window.Ticket.data ? window.Ticket.data.passengerName : '客',
          boatNo: window.Ticket && window.Ticket.data ? window.Ticket.data.boatNo : '姑苏号',
          stamps: window.Ticket && window.Ticket.data ? window.Ticket.data.stamps : [],
          scores: window.Scene ? window.Scene.scores : {},
          collectedShops: window.Scene ? window.Scene.collectedShops : [],
          timestamp: Date.now(),
        };
        await window.ShareCard.generate(userData);
      } catch (e) {
        console.error('[Router/CARD_GENERATING]', e);
      }
    });

    // sharecard:ready → TICKET_UPGRADING
    window.addEventListener('sharecard:ready', () => {
      if (App.state === STATES.CARD_GENERATING) {
        App.transition(STATES.TICKET_UPGRADING);
      }
    });

    // TICKET_UPGRADING 进入 → Ticket.upgrade
    App.on(STATES.TICKET_UPGRADING, async () => {
      if (window.Ticket && window.Ticket.upgrade) {
        await window.Ticket.upgrade();
      }
      App.transition(STATES.SHARE_DISPLAY);
    });

    // share:douyin-jump → SHARE_DONE
    window.addEventListener('share:douyin-jump', () => {
      if (App.state === STATES.SHARE_DISPLAY) {
        App.transition(STATES.SHARE_DONE);
      }
    });

    // 重置
    window.addEventListener('app:reset', () => {
      // 给状态栏时间重新挂
      App._mountStatusTime();
    });
  }

  // ---------------------------------------------------------------------------
  // 7. 音频解锁 (iOS Safari / Chrome autoplay policy)
  // ---------------------------------------------------------------------------
  let _audioUnlocked = false;
  function unlockAudio() {
    if (_audioUnlocked) return;
    _audioUnlocked = true;
    try {
      const dummy = new Audio();
      dummy.muted = true;
      const p = dummy.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
    try {
      const raw = localStorage.getItem(LS_KEYS.flags);
      const flags = raw ? JSON.parse(raw) : {};
      flags.audioUnlocked = true;
      localStorage.setItem(LS_KEYS.flags, JSON.stringify(flags));
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // 8. 调试 hooks (window.__DEBUG)
  // ---------------------------------------------------------------------------
  window.__DEBUG = {
    jumpTo(state) {
      const target = STATE_ALIASES[state] || state;
      console.log(`[DEBUG] force jump ${App.state} -> ${target}`);
      App.state = target;
      window.dispatchEvent(new CustomEvent('app:state-change', {
        detail: { from: 'DEBUG', to: target, payload: { forced: true }, timestamp: Date.now() },
      }));
    },
    dumpState() {
      return {
        state: App.state,
        history: App.history.slice(-10),
        ticket: window.Ticket ? window.Ticket.data : null,
        scene: window.Scene ? { step: window.Scene.currentStep, scores: window.Scene.scores, shops: window.Scene.collectedShops } : null,
      };
    },
    clear() {
      try {
        localStorage.removeItem(LS_KEYS.progress);
        localStorage.removeItem(LS_KEYS.ticket);
        localStorage.removeItem(LS_KEYS.flags);
      } catch (e) {}
      console.log('[DEBUG] localStorage cleared');
    },
    states: STATES,
  };

  // ---------------------------------------------------------------------------
  // 9. 启动入口
  // ---------------------------------------------------------------------------
  function boot() {
    // 装路由
    wireRouter();

    // 启动序列: 字体 → Scene.init (异步 fetch 3 JSON) → Ticket.load → App.start → Intro.play
    (async () => {
      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      } catch (e) {}

      try {
        if (window.Scene && typeof window.Scene.init === 'function') {
          await window.Scene.init();
        }
      } catch (e) {
        console.warn('[boot] Scene.init failed (will fallback)', e);
      }

      try {
        if (window.Ticket && typeof window.Ticket.load === 'function') {
          window.Ticket.load();
        }
      } catch (e) {}

      // INTRO 直接由 App.start → transition(INTRO_PLAYING) 派发 state-change,
      // 这里再挂一个 listener 触发 Intro.play
      App.on(STATES.INTRO_PLAYING, () => {
        // 一次性解锁尝试 (静音 dummy, 不需要用户手势也可以试)
        // 真正的解锁要等到 CTA 点击, 但这里先试一次
        Intro.play();
      });

      // 启动
      App.start();
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
