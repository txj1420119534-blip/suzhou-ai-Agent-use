/**
 * share-card.js — 《一镜入姑苏》姑苏修学卡分享模块
 * 暴露 window.ShareCard = { generate, show, download, exportPNG, copyText, simulateDouyinJump, animate6Frames }
 *
 * 监听 'scene:all-complete' / 'scene:all-done' → 6 帧 CSS 动画生成卡片
 * html2canvas 截图 1080×1920 → 桌面 a.download / 移动端长按保存模态
 */
(function (global) {
  'use strict';

  // 抖音文案模板
  const CAPTION_TEMPLATE =
    '今天我从平江路坐船入姑苏 🛶\n' +
    '芸娘教我说苏州话, 评弹合奏一段《声声慢》, 还淘到了陆稿荐的酱方肉~\n' +
    '# 一镜入姑苏 # 平江路 # 文化展演\n' +
    '@{passengerName} 你的姑苏修学卡 → ';

  // 6 帧时序 (ms) —— 每帧 ~600ms, 共 3.6s
  const FRAME_DURATION = 600;
  const TOTAL_FRAMES = 6;

  // 防重入
  let _isGenerating = false;
  let _isExporting = false;

  const ShareCard = {
    // ---------- 数据 ----------
    userData: null,
    cardEl: null,
    rootEl: null,
    CAPTION_TEMPLATE: CAPTION_TEMPLATE,

    // ---------- 工具 ----------
    _getRoot: function () {
      if (!this.rootEl) {
        this.rootEl = document.getElementById('share-root');
      }
      return this.rootEl;
    },

    _genCardNo: function () {
      // 卡号: GS + YYMMDD + 4 位随机
      const d = new Date();
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      return 'GS' + yy + mm + dd + rnd;
    },

    _computeDiadu: function (scores) {
      // 嗲度评分: 三步分数加权 → 1-10 整数
      if (!scores) return 9;
      const s = (scores.suzhou || 0) * 0.4
              + (scores.pingtan || 0) * 0.4
              + (scores.shops || 0) * 0.2;
      const v = Math.max(7, Math.min(10, Math.round(s || 9)));
      return v;
    },

    _resolveShops: function (collectedShops) {
      // collectedShops 可能是 id 数组 或对象数组
      if (!collectedShops || !collectedShops.length) return [];
      const meta = {
        lugaojian:   { name: '陆稿荐',   icon: '🥩', sig: '酱方肉' },
        caizhizhai:  { name: '采芝斋',   icon: '🍬', sig: '粽子糖' },
        fuxihuiguan: { name: '伏羲会馆', icon: '🍵', sig: '评弹半场' }
      };
      const byName = Object.keys(meta).reduce(function (acc, id) {
        acc[meta[id].name] = Object.assign({ id: id }, meta[id]);
        return acc;
      }, {});
      return collectedShops.map(function (s) {
        if (typeof s === 'string') return Object.assign({ id: s }, meta[s] || byName[s] || { name: s, icon: '🏮', sig: '—' });
        return Object.assign({ id: s.id || '' }, meta[s.id] || {}, s);
      });
    },

    // ---------- 入口: generate ----------
    /**
     * @param {Object} userData { passengerName, boatNo, stamps, scores, collectedShops, timestamp }
     * @returns {Promise<void>}
     */
    generate: async function (userData) {
      if (_isGenerating) {
        console.warn('[ShareCard] generate() already running');
        return;
      }
      _isGenerating = true;

      try {
        // 兜底 userData
        userData = userData || {};
        const data = {
          passengerName: userData.passengerName || '沈客',
          boatNo: userData.boatNo || '姑苏号·087',
          stamps: userData.stamps || ['suzhou', 'pingtan', 'shops'],
          scores: userData.scores || { suzhou: 9, pingtan: 8, shops: 9 },
          collectedShops: userData.collectedShops || [],
          timestamp: userData.timestamp || Date.now(),
          cardNo: userData.cardNo || this._genCardNo()
        };
        data.diadu = this._computeDiadu(data.scores);
        data.shopsResolved = this._resolveShops(data.collectedShops);
        this.userData = data;

        // 显示容器
        const root = this._getRoot();
        if (!root) {
          console.error('[ShareCard] #share-root not found');
          return;
        }
        root.hidden = false;
        root.removeAttribute('hidden');

        // 注入 DOM
        root.innerHTML = this._renderHTML(data);
        this.cardEl = root.querySelector('.share-card');

        // 等字体 ready (+ 500ms 兜底)
        await this._waitFontsReady();

        // 6 帧动画
        await this.animate6Frames();

        // 派发 ready
        window.dispatchEvent(new CustomEvent('sharecard:ready', { detail: { cardNo: data.cardNo } }));

        // 显示操作按钮区
        const actions = root.querySelector('.share-actions');
        if (actions) actions.classList.add('is-visible');

      } catch (err) {
        console.error('[ShareCard] generate error:', err);
      } finally {
        _isGenerating = false;
      }
    },

    // ---------- show / hide ----------
    show: function () {
      const root = this._getRoot();
      if (root) {
        root.hidden = false;
        root.removeAttribute('hidden');
      }
    },

    hide: function () {
      const root = this._getRoot();
      if (root) root.hidden = true;
    },

    // ---------- 6 帧动画编排 ----------
    animate6Frames: async function () {
      if (!this.cardEl) return;
      for (let i = 1; i <= TOTAL_FRAMES; i++) {
        this.cardEl.setAttribute('data-frame', String(i));
        window.dispatchEvent(new CustomEvent('sharecard:frame-done', { detail: { frameIdx: i } }));
        if (i < TOTAL_FRAMES) {
          await new Promise(function (r) { setTimeout(r, FRAME_DURATION); });
        }
      }
      // 末帧再等一拍, 确保 paint 完成
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    },

    // ---------- 字体 ready ----------
    _waitFontsReady: async function () {
      try {
        if (document.fonts && document.fonts.ready) {
          await Promise.race([
            document.fonts.ready,
            new Promise(function (r) { setTimeout(r, 1500); })
          ]);
        }
      } catch (e) { /* ignore */ }
      // 500ms 兜底, 让浏览器再喘口气
      await new Promise(function (r) { setTimeout(r, 500); });
    },

    // ---------- 导出 PNG ----------
    exportPNG: async function () {
      if (_isExporting) return null;
      if (!this.cardEl) {
        console.warn('[ShareCard] no cardEl to export');
        return null;
      }
      if (typeof html2canvas !== 'function') {
        console.error('[ShareCard] html2canvas not loaded');
        this._toast('截图库未加载');
        return null;
      }

      _isExporting = true;
      try {
        await this._waitFontsReady();
        await new Promise(function (r) { requestAnimationFrame(r); });

        const el = this.cardEl;
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: null,
          logging: false,
          windowWidth: el.scrollWidth,
          windowHeight: el.scrollHeight
        });

        const dataURL = canvas.toDataURL('image/png');

        // 移动端: 长按保存模态; 桌面: a.download
        if (this._isMobile()) {
          this._showSaveModal(dataURL);
        } else {
          const a = document.createElement('a');
          a.href = dataURL;
          a.download = '姑苏修学卡-' + (this.userData && this.userData.cardNo || Date.now()) + '.png';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }

        window.dispatchEvent(new CustomEvent('sharecard:exported', { detail: { dataURL: dataURL } }));
        this._toast('修学卡已生成');
        return dataURL;
      } catch (err) {
        console.error('[ShareCard] exportPNG error:', err);
        this._toast('导出失败, 请重试');
        return null;
      } finally {
        _isExporting = false;
      }
    },

    // download() 别名 (对外友好)
    download: async function () {
      return await this.exportPNG();
    },

    // ---------- 复制文案 ----------
    copyText: async function () {
      const name = (this.userData && this.userData.passengerName) || '客官';
      const text = CAPTION_TEMPLATE.replace('{passengerName}', name);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          // 兜底: textarea + execCommand
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        this._toast('文案已复制');
        return true;
      } catch (e) {
        console.warn('[ShareCard] copyText failed', e);
        this._toast('复制失败, 请手动选择');
        return false;
      }
    },

    // ---------- 模拟跳转抖音 ----------
    simulateDouyinJump: function () {
      this._toast('正在跳转抖音...', 1500);
      // 复制文案 (双保险)
      this.copyText().catch(function () {});
      // 尝试调起 (失败也无所谓)
      try {
        const w = window.open('snssdk1128://', '_blank');
        if (w) setTimeout(function () { try { w.close(); } catch (e) {} }, 500);
      } catch (e) { /* ignore */ }

      window.dispatchEvent(new CustomEvent('share:douyin-jump', { detail: {} }));

      // 1.5s 后切到 SHARE_DONE
      setTimeout(function () {
        if (global.App && typeof global.App.transition === 'function') {
          global.App.transition('SHARE_DONE');
        }
      }, 1500);
    },

    // ---------- 移动端长按保存模态 ----------
    _showSaveModal: function (dataURL) {
      // 已存在的先移除
      const old = document.getElementById('save-modal');
      if (old) old.remove();

      const modal = document.createElement('div');
      modal.id = 'save-modal';
      modal.className = 'save-modal';
      modal.innerHTML =
        '<div class="save-modal__mask"></div>' +
        '<div class="save-modal__inner">' +
          '<div class="save-modal__title">长按图片保存到相册</div>' +
          '<img class="save-modal__img" alt="姑苏修学卡" src="' + dataURL + '">' +
          '<button class="save-modal__close" type="button">关闭</button>' +
        '</div>';

      // 内联兜底样式 (避免 share-card.css 还未覆盖)
      const style = document.createElement('style');
      style.textContent =
        '.save-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;}' +
        '.save-modal__mask{position:absolute;inset:0;background:rgba(0,0,0,0.78);}' +
        '.save-modal__inner{position:relative;max-width:90%;max-height:88%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;}' +
        '.save-modal__title{color:#F5F1E8;font-family:\'Noto Serif SC\',\'Songti SC\',\'宋体\',serif;font-size:14px;letter-spacing:2px;}' +
        '.save-modal__img{max-width:100%;max-height:70vh;border-radius:8px;box-shadow:0 12px 36px rgba(0,0,0,0.45);}' +
        '.save-modal__close{background:#B8302E;color:#F5F1E8;border:none;border-radius:20px;padding:8px 24px;font-size:13px;font-family:inherit;}';
      modal.appendChild(style);

      document.body.appendChild(modal);
      modal.querySelector('.save-modal__close').addEventListener('click', function () { modal.remove(); });
      modal.querySelector('.save-modal__mask').addEventListener('click', function () { modal.remove(); });
    },

    // ---------- 移动端判断 ----------
    _isMobile: function () {
      return /Android|iPhone|iPad|iPod|Mobile|Silk|BlackBerry|Opera Mini/i.test(navigator.userAgent);
    },

    // ---------- toast ----------
    _toast: function (msg, duration) {
      duration = duration || 1800;
      if (global.App && typeof global.App.toast === 'function') {
        global.App.toast(msg, duration);
        return;
      }
      // 兜底 inline toast
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText =
        'position:fixed;left:50%;top:14%;transform:translateX(-50%);' +
        'background:rgba(45,62,80,0.92);color:#F5F1E8;padding:10px 18px;border-radius:20px;' +
        'font-family:\'Noto Serif SC\',\'Songti SC\',\'宋体\',serif;font-size:13px;z-index:10000;' +
        'box-shadow:0 6px 18px rgba(0,0,0,0.3);opacity:0;transition:opacity 240ms ease;';
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.style.opacity = '1'; });
      setTimeout(function () {
        t.style.opacity = '0';
        setTimeout(function () { t.remove(); }, 280);
      }, duration);
    },

    // ---------- DOM 渲染 ----------
    _renderHTML: function (d) {
      const dateStr = new Date(d.timestamp).toLocaleDateString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit'
      });

      // 印章行
      const stampNames = { suzhou: '苏白', pingtan: '评弹', shops: '探宝' };
      const stampsHTML = (d.stamps || []).map(function (s) {
        return '<span class="sc-stamp" data-stamp="' + s + '">' + (stampNames[s] || s) + '</span>';
      }).join('');

      // 评分块
      const scoreBlock =
        '<div class="sc-score">' +
          '<div class="sc-score__label">嗲度评分</div>' +
          '<div class="sc-score__value">' + d.diadu + '<span class="sc-score__max">/10</span></div>' +
          '<div class="sc-score__detail">苏白 ' + (d.scores.suzhou || 0) + ' · 评弹 ' + (d.scores.pingtan || 0) + ' · 探宝 ' + (d.scores.shops || 0) + '</div>' +
        '</div>';

      // 老字号收藏
      const shopsHTML = d.shopsResolved.length
        ? d.shopsResolved.map(function (s) {
            return '<div class="sc-shop">' +
                     '<span class="sc-shop__icon">' + (s.icon || '🏮') + '</span>' +
                     '<span class="sc-shop__name">' + (s.name || '') + '</span>' +
                     '<span class="sc-shop__sig">· ' + (s.sig || '') + '</span>' +
                   '</div>';
          }).join('')
        : '<div class="sc-shop sc-shop--empty">—— 未收藏 ——</div>';

      // 二维码占位 (SVG 棋盘格 + 文字)
      const qrPlaceholder =
        '<div class="sc-qr">' +
          '<div class="sc-qr__grid"></div>' +
          '<div class="sc-qr__hint">扫码继续<br>姑苏之旅</div>' +
        '</div>';

      // 6 个 layer
      return '' +
        '<div class="share-card" data-frame="0">' +

          // layer 1: 底纹宣纸 + 角花
          '<div class="share-card__layer" data-layer="1">' +
            '<div class="sc-bg"></div>' +
            '<div class="sc-corner sc-corner--tl"></div>' +
            '<div class="sc-corner sc-corner--tr"></div>' +
            '<div class="sc-corner sc-corner--bl"></div>' +
            '<div class="sc-corner sc-corner--br"></div>' +
          '</div>' +

          // layer 2: 边框花纹
          '<div class="share-card__layer" data-layer="2">' +
            '<div class="sc-border-frame"></div>' +
          '</div>' +

          // layer 3: 标题
          '<div class="share-card__layer" data-layer="3">' +
            '<div class="sc-header">' +
              '<div class="sc-header__crown">姑苏修学卡</div>' +
              '<div class="sc-header__sub">一镜入姑苏 · 平江路结业</div>' +
              '<div class="sc-header__line"></div>' +
              '<div class="sc-header__boat">' + d.boatNo + ' · ' + d.passengerName + '</div>' +
            '</div>' +
          '</div>' +

          // layer 4: 嗲度评分 + 印章
          '<div class="share-card__layer" data-layer="4">' +
            scoreBlock +
            '<div class="sc-stamps">' + stampsHTML + '</div>' +
          '</div>' +

          // layer 5: 评弹波形装饰 + 收藏老字号
          '<div class="share-card__layer" data-layer="5">' +
            '<div class="sc-waveform">' +
              '<div class="sc-waveform__label">评弹合奏波形</div>' +
              '<svg class="sc-waveform__svg" viewBox="0 0 200 36" preserveAspectRatio="none">' +
                (function () {
                  let bars = '';
                  for (let i = 0; i < 40; i++) {
                    const h = 6 + Math.abs(Math.sin(i * 0.6 + d.diadu) * 24);
                    const y = (36 - h) / 2;
                    bars += '<rect x="' + (i * 5 + 1) + '" y="' + y + '" width="3" height="' + h + '" rx="1.2" fill="#B8302E" opacity="' + (0.55 + (i % 5) * 0.08) + '"/>';
                  }
                  return bars;
                })() +
              '</svg>' +
            '</div>' +
            '<div class="sc-shops">' +
              '<div class="sc-shops__label">收藏老字号</div>' +
              shopsHTML +
            '</div>' +
          '</div>' +

          // layer 6: 二维码 + 卡号 + 日期
          '<div class="share-card__layer" data-layer="6">' +
            '<div class="sc-footer">' +
              qrPlaceholder +
              '<div class="sc-meta">' +
                '<div class="sc-meta__row">卡号 ' + d.cardNo + '</div>' +
                '<div class="sc-meta__row">' + dateStr + ' · 平江路</div>' +
                '<div class="sc-meta__seal">姑苏文旅 钤</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

        '</div>' +

        // 操作按钮区 (动画完成后才显示)
        '<div class="share-actions">' +
          '<button type="button" class="share-actions__btn share-actions__btn--secondary" data-action="download">保存 PNG</button>' +
          '<button type="button" class="share-actions__btn share-actions__btn--primary" data-action="douyin">一键发抖音</button>' +
        '</div>';
    },

    // ---------- 事件绑定 ----------
    _bindActions: function () {
      const root = this._getRoot();
      if (!root) return;
      const self = this;
      root.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const act = btn.getAttribute('data-action');
        if (act === 'download') self.exportPNG();
        else if (act === 'douyin') self.simulateDouyinJump();
      });
    },

    // ---------- 初始化监听 ----------
    _init: function () {
      const self = this;
      this._bindActions();

      // 监听 scene 全部完成事件 (兼容两种命名)
      const onAllDone = function (e) {
        const detail = (e && e.detail) || {};
        const ticketData = (global.Ticket && global.Ticket.data) || {};
        const userData = {
          passengerName: ticketData.passengerName,
          boatNo: ticketData.boatNo,
          stamps: ticketData.stamps,
          scores: detail.scores,
          collectedShops: detail.collectedShops,
          timestamp: Date.now()
        };
        // 由 App 状态机驱动 generate; 这里只在没有 App 时兜底
        if (!global.App || !global.App.state) {
          self.generate(userData);
        }
      };
      window.addEventListener('scene:all-complete', onAllDone);
      window.addEventListener('scene:all-done', onAllDone);

      // 监听状态机: 进入 CARD_GENERATING → 触发 generate
      window.addEventListener('app:state-change', function (e) {
        if (global.App && global.App.STATES) {
          return;
        }
        const detail = (e && e.detail) || {};
        if (detail.to === 'CARD_GENERATING') {
          const ticketData = (global.Ticket && global.Ticket.data) || {};
          const payload = detail.payload || {};
          const userData = Object.assign({
            passengerName: ticketData.passengerName,
            boatNo: ticketData.boatNo,
            stamps: ticketData.stamps,
            timestamp: Date.now()
          }, payload);
          // 从 Scene 模块取分数 (若可用)
          if (global.Scene) {
            userData.scores = userData.scores || global.Scene.scores;
            userData.collectedShops = userData.collectedShops || global.Scene.collectedShops;
          }
          self.generate(userData).then(function () {
            // 动画完成后自动 transition → TICKET_UPGRADING
            if (global.App && typeof global.App.transition === 'function') {
              global.App.transition('TICKET_UPGRADING');
            }
          });
        }
      });
    }
  };

  // 暴露
  global.ShareCard = ShareCard;

  // DOM ready 后初始化监听
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { ShareCard._init(); });
  } else {
    ShareCard._init();
  }

})(window);
