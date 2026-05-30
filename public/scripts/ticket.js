/**
 * ticket.js — AI 船票引擎
 * 暴露 window.Ticket
 * 依赖: window.App (main.js 提供, 但本模块可独立运行)
 */
(function () {
  'use strict';

  // ============ 常量池 ============
  const STORAGE_KEY = 'gusu_ticket';
  const STORAGE_KEY_V1 = 'gusu.ticket.v1';

  // 8 角色
  const ROLES = ['书生客', '画舫客', '听评客', '寻茶客', '问香客', '采莲客', '观桥客', '裁云客'];
  // 8 元素
  const ELEMENTS = ['烟雨', '柳浪', '荷风', '桂月', '秋霜', '梅雪', '春溪', '夜灯'];
  // 9 品级
  const TIERS = ['初入', '小成', '渐悟', '通达', '雅致', '风流', '上乘', '大成', '空灵'];
  // 8 特长
  const SPECIALTIES = ['工书法', '善评弹', '擅烹饪', '通茶道', '识古玩', '吟诗赋', '解箫笛', '辨香品'];

  // 苏州姓氏池 (用于乘客名)
  const SURNAMES = ['沈', '陆', '吴', '苏', '顾', '钱', '范', '潘', '彭', '徐'];

  // 寄语池 (AI 失败时兜底)
  const WISHES = [
    '愿君平江一梦, 不负姑苏好春光。',
    '橹声欸乃出红尘, 此身已是江南人。',
    '小桥流水人家事, 都付与一盏新茶。',
    '三里平江三里画, 一寸光阴一寸金。',
    '听罢评弹再上船, 半生烟雨半生闲。',
    '青砖黛瓦藏旧事, 唯有客心向晚晴。',
    '若问姑苏何处好, 桂花未落已飘香。',
    '此票虽小, 可载半城烟雨; 此程虽短, 已醉一世清欢。'
  ];

  // 完成全部 4 站的专属寄语 (升级金边版)
  const GOLDEN_WISH = '三章既毕, 嗲度满分; 此票永久有效, 凭票可入平江任一茶肆。';

  // 站点中文名映射
  const STATION_LABELS = {
    'suzhou': '苏州话',
    'pingtan': '评弹',
    'shops': '老字号',
    'pingjianglu-suzhou': '苏州话',
    'pingjianglu-pingtan': '评弹',
    'pingjianglu-shops': '老字号',
    '平江路-suzhou': '苏州话',
    '平江路-pingtan': '评弹',
    '平江路-shops': '老字号'
  };

  // ============ 私有工具 ============
  function rand(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rand(arr.length)]; }
  function pad(n, w) { return String(n).padStart(w, '0'); }

  function genBoatNo() {
    // MMDD-XXXX 格式
    const d = new Date();
    const mmdd = pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
    const xxxx = pad(rand(10000), 4);
    return `姑苏号·${mmdd}-${xxxx}`;
  }

  function genPassengerName() {
    return pick(SURNAMES) + '客';
  }

  function genIdentity() {
    return {
      role: pick(ROLES),
      element: pick(ELEMENTS),
      tier: pick(TIERS),
      specialty: pick(SPECIALTIES)
    };
  }

  function pickWish() {
    return pick(WISHES);
  }

  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function toast(msg) {
    if (window.App && typeof window.App.toast === 'function') {
      window.App.toast(msg);
      return;
    }
    // 兜底 toast
    const root = document.getElementById('toast-root') || document.body;
    const el = document.createElement('div');
    el.className = 'gusu-toast';
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;top:30%;transform:translateX(-50%);background:rgba(45,62,80,0.92);color:#F5F1E8;padding:10px 18px;border-radius:6px;font-family:"Noto Serif SC","Songti SC","宋体",serif;font-size:14px;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,0.3);opacity:0;transition:opacity 240ms;';
    root.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 280);
    }, 1600);
  }

  // ============ DOM 构建 ============
  function buildTicketDOM() {
    const data = Ticket.data;
    if (!data) return null;
    const id = data.identity || {};
    const container = document.createElement('div');
    container.className = 'ai-ticket';
    if (data.golden) container.classList.add('is-golden');
    container.setAttribute('role', 'button');
    container.setAttribute('aria-label', 'AI船票');
    container.innerHTML = `
      <div class="ai-ticket__title">AI 船票</div>
      <div class="ai-ticket__boatno">${escapeHtml(data.boatNo)}</div>
      <div class="ai-ticket__passenger">${escapeHtml(data.passengerName)} · ${escapeHtml(id.tier || '')}${escapeHtml(id.role || '')}</div>
      <div class="ai-ticket__identity" style="font-size:10px;color:var(--c-misty,#4A6670);margin-top:2px;">
        ${escapeHtml(id.element || '')} · ${escapeHtml(id.specialty || '')}
      </div>
      <div class="ai-ticket__stamps" aria-label="盖章"></div>
      <div class="ai-ticket__wish">${escapeHtml(data.wish || '')}</div>
      <button class="ai-ticket__cta" type="button" style="margin-top:8px;width:100%;background:var(--c-cinnabar,#B8302E);color:var(--c-paper,#F5F1E8);border:none;padding:6px 8px;border-radius:4px;font-family:inherit;font-size:12px;cursor:pointer;${data.ctaShown ? '' : 'display:none;'}">打开相机扫描</button>
    `;
    return container;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderStamps() {
    const container = document.querySelector('.ai-ticket__stamps');
    if (!container) return;
    container.innerHTML = '';
    (Ticket.data.stamps || []).forEach((s) => {
      const label = STATION_LABELS[s] || s;
      const stamp = document.createElement('div');
      stamp.className = 'stamp';
      stamp.title = label;
      stamp.textContent = label.slice(0, 1);
      container.appendChild(stamp);
    });
  }

  // ============ 右上角"叮"图标 ============
  function flashDing(label) {
    const root = document.getElementById('ticket-root') || document.body;
    const ding = document.createElement('div');
    ding.className = 'ticket-ding';
    ding.textContent = '叮·' + (label || '');
    ding.style.cssText = `
      position: fixed; top: 8px; right: 150px;
      background: var(--c-cinnabar, #B8302E); color: var(--c-paper, #F5F1E8);
      padding: 4px 10px; border-radius: 12px;
      font-family: 'Noto Serif SC', 'Songti SC', serif;
      font-size: 11px; font-weight: 700;
      box-shadow: 0 2px 8px rgba(184,48,46,0.4);
      z-index: 200; opacity: 0;
      transform: translateY(-4px) scale(0.8);
      transition: all 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
    `;
    root.appendChild(ding);
    requestAnimationFrame(() => {
      ding.style.opacity = '1';
      ding.style.transform = 'translateY(0) scale(1)';
    });
    setTimeout(() => {
      ding.style.opacity = '0';
      ding.style.transform = 'translateY(-8px) scale(0.9)';
      setTimeout(() => ding.remove(), 320);
    }, 1100);
  }

  // ============ Ticket 主对象 ============
  const Ticket = {
    data: null,
    _container: null,
    _isStamping: false,

    // 创建船票数据
    create() {
      // 已存在则不覆盖
      if (this.data && this.data.boatNo) return this.data;
      const identity = genIdentity();
      this.data = {
        boatNo: genBoatNo(),
        passengerName: genPassengerName(),
        issueTime: new Date().toISOString(),
        stamps: [],
        golden: false,
        wish: pickWish(),
        identity: identity,
        ctaShown: false
      };
      this.save();
      return { boatNo: this.data.boatNo, passengerName: this.data.passengerName, issueTime: this.data.issueTime };
    },

    // 渲染 (挂到 #ticket-root)
    render(containerEl) {
      if (!this.data) this.create();
      const root = containerEl || document.getElementById('ticket-root') || document.body;
      // 清掉旧的
      root.querySelectorAll('.ai-ticket').forEach((n) => n.remove());
      const dom = buildTicketDOM();
      if (!dom) return;
      root.appendChild(dom);
      this._container = dom;
      renderStamps();
      // CTA 点击
      const cta = dom.querySelector('.ai-ticket__cta');
      if (cta) {
        cta.addEventListener('click', (e) => {
          e.stopPropagation();
          cta.style.display = 'none';
          if (this.data) {
            this.data.ctaShown = false;
            this.save();
          }
          this.hide();
          dispatch('ticket:cta-clicked', {});
        });
      }
      // 整卡点击 → show modal (展开大图)
      dom.addEventListener('click', () => {
        // 留作未来扩展, 这里只是简单提示
        // this.showModal();
      });
    },

    // slideIn 动画 (TICKET_ISSUING → TICKET_READY)
    slideIn() {
      return new Promise((resolve) => {
        if (!this._container) this.render();
        const dom = this._container;
        if (!dom) { resolve(); return; }
        // 显示 CTA
        const cta = dom.querySelector('.ai-ticket__cta');
        if (cta) cta.style.display = 'block';
        if (this.data) this.data.ctaShown = true;

        dom.classList.add('is-slid-in');
        let done = false;
        const onEnd = () => {
          if (done) return;
          done = true;
          dom.removeEventListener('animationend', onEnd);
          dispatch('ticket:ready', {
            boatNo: this.data.boatNo,
            passengerName: this.data.passengerName,
            issueTime: this.data.issueTime
          });
          resolve();
        };
        dom.addEventListener('animationend', onEnd);
        // 兜底 fallback
        setTimeout(onEnd, 1000);
      });
    },

    // show/hide 整体 modal
    show() {
      if (!this._container) this.render();
      if (this._container) this._container.style.display = '';
    },
    hide() {
      if (this._container) this._container.style.display = 'none';
    },

    // 盖章
    stamp(stationName) {
      return new Promise((resolve) => {
        if (this._isStamping) { resolve(); return; }
        if (!this.data) this.create();
        // 去重
        const stamps = this.data.stamps = this.data.stamps || [];
        if (stamps.indexOf(stationName) >= 0) {
          resolve();
          return;
        }
        this._isStamping = true;

        // 简化 step 名
        const short = stationName.replace(/^平江路-/, '').replace(/^pingjianglu-/, '');
        stamps.push(short);
        this.save();

        if (!this._container) this.render();
        renderStamps();

        const label = STATION_LABELS[short] || short;
        flashDing(label);

        // TODO: integrate SFX-stamp.mp3 音效
        // const sfx = new Audio('assets/audio/SFX-stamp.mp3');
        // sfx.play().catch(()=>{});

        // 等盖章动画 (800ms)
        setTimeout(() => {
          this._isStamping = false;
          dispatch('ticket:stamped', {
            stepName: short,
            totalStamps: stamps.length
          });
          resolve();
        }, 800);
      });
    },

    // 金边升级
    upgrade() {
      return new Promise((resolve) => {
        if (!this.data) this.create();
        this.data.golden = true;
        this.data.wish = GOLDEN_WISH;
        this.save();

        if (!this._container) this.render();
        if (this._container) {
          this._container.classList.add('is-golden');
          const wishEl = this._container.querySelector('.ai-ticket__wish');
          if (wishEl) wishEl.textContent = GOLDEN_WISH;
        }
        toast('船票已升级 · 金边版');
        setTimeout(() => {
          dispatch('ticket:upgraded', { wish: GOLDEN_WISH });
          resolve();
        }, 1000);
      });
    },

    updateWish(newWish) {
      if (!this.data) return;
      this.data.wish = newWish;
      this.save();
      if (this._container) {
        const wishEl = this._container.querySelector('.ai-ticket__wish');
        if (wishEl) wishEl.textContent = newWish;
      }
    },

    // 导出 1080×600 PNG
    export() {
      return new Promise(async (resolve, reject) => {
        if (typeof html2canvas !== 'function') {
          toast('html2canvas 未加载, 无法导出');
          reject(new Error('html2canvas missing'));
          return;
        }
        if (!this._container) this.render();
        try {
          // 字体 ready 再截图
          if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
          }
          // 构建一个 1080×600 横版临时容器
          const tmp = document.createElement('div');
          tmp.style.cssText = `
            position: fixed; left: -9999px; top: 0;
            width: 1080px; height: 600px;
            background: linear-gradient(135deg, #F5E6C8 0%, #F5F1E8 100%);
            border: 6px solid ${this.data.golden ? '#B8860B' : 'rgba(45,62,80,0.4)'};
            border-radius: 16px;
            padding: 48px 60px;
            font-family: 'Noto Serif SC', 'Songti SC', '宋体', serif;
            color: #2D3E50;
            box-sizing: border-box;
            display: flex; flex-direction: column; justify-content: space-between;
          `;
          const id = this.data.identity || {};
          tmp.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <div style="font-size:18px;letter-spacing:6px;color:#4A6670;">AI 船票 · 姑苏号</div>
                <div style="font-size:54px;font-weight:900;margin-top:8px;">${escapeHtml(this.data.boatNo)}</div>
                <div style="font-size:24px;color:#B8302E;margin-top:14px;">${escapeHtml(this.data.passengerName)} · ${escapeHtml(id.tier || '')}${escapeHtml(id.role || '')}</div>
                <div style="font-size:18px;color:#4A6670;margin-top:8px;">${escapeHtml(id.element || '')} · ${escapeHtml(id.specialty || '')}</div>
              </div>
              <div style="text-align:right;font-size:14px;color:#4A6670;">
                <div>发票时间</div>
                <div style="margin-top:4px;font-weight:700;color:#2D3E50;">${escapeHtml(new Date(this.data.issueTime).toLocaleString('zh-CN'))}</div>
              </div>
            </div>
            <div style="display:flex;gap:12px;margin:20px 0;">
              ${(this.data.stamps || []).map((s) => {
                const label = STATION_LABELS[s] || s;
                return `<div style="width:64px;height:64px;border-radius:8px;background:#B8302E;color:#F5F1E8;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(184,48,46,0.3);">${escapeHtml(label.slice(0,1))}</div>`;
              }).join('')}
            </div>
            <div style="border-top:1px dashed rgba(45,62,80,0.3);padding-top:16px;font-size:22px;line-height:1.6;color:#2D3E50;">
              ${escapeHtml(this.data.wish)}
            </div>
          `;
          document.body.appendChild(tmp);
          await new Promise((r) => requestAnimationFrame(r));
          const canvas = await html2canvas(tmp, {
            scale: 1,
            useCORS: true,
            backgroundColor: null,
            logging: false,
            width: 1080,
            height: 600
          });
          document.body.removeChild(tmp);
          const dataURL = canvas.toDataURL('image/png');
          // 触发下载
          const a = document.createElement('a');
          a.href = dataURL;
          a.download = `姑苏船票-${Date.now()}.png`;
          a.click();
          dispatch('ticket:exported', { dataURL });
          resolve(dataURL);
        } catch (err) {
          console.error('[Ticket.export] failed', err);
          toast('船票导出失败');
          reject(err);
        }
      });
    },

    // ============ 持久化 ============
    save() {
      try {
        const payload = JSON.stringify(this.data);
        localStorage.setItem(STORAGE_KEY, payload);
        localStorage.setItem(STORAGE_KEY_V1, payload);
      } catch (e) {
        console.warn('[Ticket.save] localStorage write failed', e);
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY_V1);
        if (!raw) return false;
        const obj = JSON.parse(raw);
        if (!obj || !obj.boatNo) return false;
        this.data = obj;
        return true;
      } catch (e) {
        console.warn('[Ticket.load] parse failed, clearing', e);
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(STORAGE_KEY_V1);
        } catch (_) {}
        return false;
      }
    },

    clear() {
      this.data = null;
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY_V1);
      } catch (_) {}
      if (this._container) {
        this._container.remove();
        this._container = null;
      }
    }
  };

  // ============ 监听 app:state-change (自动响应) ============
  window.addEventListener('app:state-change', (e) => {
    const { to } = (e && e.detail) || {};
    if (window.App && window.App.STATES) {
      return;
    }
    if (to === 'TICKET_ISSUING') {
      Ticket.create();
      Ticket.render();
      // 推迟一帧再 slideIn, 让 DOM 先 paint
      requestAnimationFrame(() => Ticket.slideIn());
    } else if (to === 'TICKET_UPGRADING') {
      Ticket.upgrade();
    } else if (to === 'IDLE') {
      Ticket.clear();
    }
  });

  // 监听场景每步完成 → 直接盖章 (按 module_interfaces 矩阵约定)
  window.addEventListener('scene:step-complete', (e) => {
    if (window.App && window.App.STATES) return;
    const detail = (e && e.detail) || {};
    const step = detail.step;
    if (step) {
      Ticket.stamp('平江路-' + step);
    }
  });

  // 监听 app:reset
  window.addEventListener('app:reset', () => Ticket.clear());

  // 暴露
  window.Ticket = Ticket;
})();
