/**
 * scene-pingjianglu.js — 平江路·文化展演场景引擎
 * 暴露 window.Scene
 * 依赖: window.App (状态机), window.Ticket (盖章)
 */
(function () {
  'use strict';

  // ============ 静态兜底数据 (fetch 失败时用) ============
  const FALLBACK_CHARACTERS = {
    characters: [
      {
        id: 'yunniang', name: '芸娘', title: '平江路引路人',
        portrait: 'assets/images/yunniang-portrait.png',
        portraitFallback: 'character-portrait',
        persona: '温婉, 善解人意, 苏州本地',
        openingLines: [
          '客官, 一路船过来辛苦了~ 我是芸娘, 平江路就在脚下了。',
          '今儿带你做三桩事: 学三句苏州话, 跟我弹半句评弹, 再去淘淘老字号。可好?'
        ],
        fallbackPool: ['客官稍歇, 平江路的雨还没停呢, 我们再坐坐。'],
        voiceTone: '苏州软语'
      },
      {
        id: 'shenfu', name: '沈复', title: '《浮生六记》游伴',
        portrait: 'assets/images/shenfu-portrait.png',
        portraitFallback: 'character-portrait',
        persona: '书生',
        openingLines: ['芸, 这位客官也是来访平江的?'],
        fallbackPool: ['客官随意。'],
        voiceTone: '苏白书卷气'
      }
    ]
  };

  const FALLBACK_DIALOGUES = {
    suzhouLines: [
      { id: 'su-1', chinese: '倷好呀, 客人', pinyin: 'nei2 hao3 ya, ke4 nin2', mandarinHint: '你好呀, 客人', audio: '', mockScoreRange: [7, 9] },
      { id: 'su-2', chinese: '覅客气, 吃过饭朆', pinyin: 'fiao4 ke4 qi3, qie6 gu2 ve3 fen3', mandarinHint: '不要客气, 吃过饭没', audio: '', mockScoreRange: [6, 9] },
      { id: 'su-3', chinese: '嗲来兮! 蛮灵格', pinyin: 'dia1 le2 xi1, mei2 lin2 ge3', mandarinHint: '好极了! 真棒', audio: '', mockScoreRange: [8, 10] }
    ],
    suzhouQuiz: [
      {
        id: 'quiz-1', order: 1, phrase: '倷好呀',
        translation: '「你好呀」',
        translationDetail: '见面打招呼用的, 比普通话「你好」更软更糯。',
        options: [
          { id: 'A', label: 'nǐ hǎo ya', subtitle: '(普通话直读)', type: 'mandarin' },
          { id: 'B', label: 'nong hau ya', subtitle: '(「你」读 nong)', type: 'shanghai' },
          { id: 'C', label: 'neh hau ya', subtitle: '(声母 n + 糯尾音)', type: 'suzhou' }
        ],
        correct: 'C',
        explanation: '苏州话用「倷」不用「你」, 声母是 **n**, 不是上海话的 **nong**。',
        culturalNote: '「倷」字在吴语区只有苏州、无锡、常州一带还在日常用。'
      },
      {
        id: 'quiz-2', order: 2, phrase: '蛮好白相',
        translation: '「太好玩了 / 真有意思」',
        translationDetail: '「白相」就是「玩耍」, 苏州小囡从小听到大的词。',
        options: [
          { id: 'A', label: '蛮 (拉长尾音)', subtitle: '声调最长', type: 'wrong' },
          { id: 'B', label: '白 (短促爆破 baq!)', subtitle: '入声字 / 口腔急闭', type: 'suzhou' },
          { id: 'C', label: '相 (软糯收尾)', subtitle: '鼻音最重', type: 'wrong' }
        ],
        correct: 'B',
        explanation: '「白」是 **入声字** — 苏州话保留了唐宋古音的入声, 不能拖成 bai。',
        culturalNote: '普通话已没有入声, 但苏州话、广东话、闽南话都保留了。'
      },
      {
        id: 'quiz-3', order: 3, phrase: '再会, 下趟来白相',
        translation: '「再见, 下次再来玩」',
        translationDetail: '苏州人送客的标准句, 一出口就老苏州味儿。',
        options: [
          { id: 'A', label: '哭腔送别', subtitle: '依依不舍带哭音', type: 'wrong' },
          { id: 'B', label: '温柔期待回头客', subtitle: '笑着说, 像招呼老朋友', type: 'suzhou' },
          { id: 'C', label: '客气疏离', subtitle: '礼节性带距离感', type: 'wrong' }
        ],
        correct: 'B',
        explanation: '苏州人送客 **从不哭腔, 也不疏离**。是「温温柔柔笑着说再见」的语气。',
        culturalNote: '苏州话天生「人情软」, 一句「下趟来白相」就是邀请。'
      }
    ],
    suzhouQuizResults: {
      '3': { title: '苏州话一品品鉴师', subtitle: '天生苏州耳!', comment: '全对! 客官怕不是平江路走丢的小囡?', badge: '✦ 一品大师 ✦' },
      '2': { title: '苏州话二品行家', subtitle: '差一句, 蛮灵格!', comment: '两题对路, 客官蛮有姑苏天分的。', badge: '✦ 二品行家 ✦' },
      '1': { title: '苏州话三品入门', subtitle: '听出一句, 算开了眼。', comment: '客官头一回, 听出一句就算入门了。', badge: '✦ 三品入门 ✦' },
      '0': { title: '姑苏新客', subtitle: '没关系, 来日方长。', comment: '客官别急, 苏州话本就难。', badge: '✦ 初遇姑苏 ✦' }
    },
    pingtanLyrics: {
      title: '声声慢·半阕', composer: '苏州弹词调',
      halfVerse: '寻寻觅觅, 冷冷清清',
      pinyin: 'xin2 xin2 mi2 mi2, lan3 lan3 qin1 qin1',
      audio: '', durationSec: 6
    },
    fallbackPool: ['听不清也无妨, 多听几遍就熟了。'],
    introBubbles: [
      { char: 'yunniang', text: '客官, 一路船过来辛苦了~ 我是芸娘, 平江路就在脚下了。' },
      { char: 'yunniang', text: '今儿带你做三桩事: 学三句苏州话, 跟我弹半句评弹, 再去淘淘老字号。可好?' }
    ]
  };

  const FALLBACK_SHOPS = {
    shops: [
      { id: 'lugaojian', name: '陆稿荐', foundedYear: 1663, category: 'food', iconEmoji: '🥩', color: '#B8302E', address: '平江路 32 号', signature: '酱方肉', story: '三百六十年老字号, 一块酱方肉, 慢火六小时。', coupon: '凭此卡可换一片试吃酱方' },
      { id: 'caizhizhai', name: '采芝斋', foundedYear: 1870, category: 'sweet', iconEmoji: '🍬', color: '#B8860B', address: '观前街 91 号', signature: '粽子糖', story: '光绪年间起家, 苏州人嫁女儿压箱底的甜。', coupon: '扫码送粽子糖一颗' },
      { id: 'fuxihuiguan', name: '伏羲会馆', foundedYear: 1958, category: 'tea-house', iconEmoji: '🍵', color: '#4A6670', address: '平江路 254 号', signature: '评弹下午场', story: '评弹老书场, 每天下午两点半开书。', coupon: '凭此卡免一壶碧螺春' }
    ]
  };

  // ============ 工具 ============
  function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function fetchJSON(url, fallback) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.warn(`[Scene] fetch ${url} failed, using fallback`, e);
      return fallback;
    }
  }

  function getRoot() {
    return document.getElementById('scene-root');
  }

  // ============ Scene 主对象 ============
  const Scene = {
    characters: null,
    dialogues: null,
    shops: null,
    currentStep: null,
    scores: { suzhou: 0, pingtan: 0, shops: 0 },
    collectedShops: [],
    _initialized: false,
    _inited: false,
    _introBubbleIdx: 0,

    // ============ 生命周期 ============
    async init() {
      if (this._inited) return;
      const [chars, dlg, shops] = await Promise.all([
        fetchJSON('./data/characters.json', FALLBACK_CHARACTERS),
        fetchJSON('./data/dialogues.json', FALLBACK_DIALOGUES),
        fetchJSON('./data/shops.json', FALLBACK_SHOPS)
      ]);
      this.characters = chars;
      this.dialogues = this._normalizeDialogues(dlg);
      this.shops = shops;
      this._inited = true;
    },

    // 适配真实 dialogues.json (yuniang_intro / suzhou_3_phrases / pingtan_lyrics)
    // 兼容 fallback 内的契约 schema (introBubbles / suzhouLines / pingtanLyrics)
    _normalizeDialogues(d) {
      if (!d) return FALLBACK_DIALOGUES;

      // introBubbles
      if (!Array.isArray(d.introBubbles)) {
        if (Array.isArray(d.yuniang_intro)) {
          d.introBubbles = d.yuniang_intro.map((t) => ({ char: 'yunniang', text: t }));
        } else {
          d.introBubbles = FALLBACK_DIALOGUES.introBubbles;
        }
      }

      // suzhouQuiz (新版: 听辨挑战)
      if (!Array.isArray(d.suzhouQuiz)) {
        if (Array.isArray(d.suzhou_3_quiz)) {
          d.suzhouQuiz = d.suzhou_3_quiz;
        }
      }
      // suzhouQuizResults (按对题数 0-3 映射称号)
      if (!d.suzhouQuizResults && d.suzhou_quiz_results) {
        d.suzhouQuizResults = d.suzhou_quiz_results;
      }
      // 旧 suzhouLines 兼容 (fallback 用)
      if (!Array.isArray(d.suzhouLines)) {
        if (Array.isArray(d.suzhou_3_phrases)) {
          d.suzhouLines = d.suzhou_3_phrases.map((l) => ({
            id: l.id, chinese: l.chinese, pinyin: l.pinyin,
            mandarinHint: l.mandarinHint || l.mandarin || l.tip || '',
            audio: l.audio || '', mockScoreRange: l.mockScoreRange || [7, 9]
          }));
        } else {
          d.suzhouLines = FALLBACK_DIALOGUES.suzhouLines;
        }
      }

      // pingtanLyrics
      if (!d.pingtanLyrics) {
        if (d.pingtan_lyrics) {
          const p = d.pingtan_lyrics;
          d.pingtanLyrics = {
            title: p.title || '声声慢·半阕',
            composer: p.composer || '苏州弹词调',
            halfVerse: p.halfVerse || p.user_second_half_expected || '',
            pinyin: p.pinyin || '',
            audio: p.audio || '',
            durationSec: p.durationSec || 6
          };
        } else {
          d.pingtanLyrics = FALLBACK_DIALOGUES.pingtanLyrics;
        }
      }

      // fallbackPool
      if (!Array.isArray(d.fallbackPool)) {
        d.fallbackPool = d.yuniang_fallback_pool || FALLBACK_DIALOGUES.fallbackPool;
      }

      return d;
    },

    async enter() {
      if (!this._inited) await this.init();
      const root = getRoot();
      if (!root) {
        console.warn('[Scene.enter] #scene-root not found');
        return;
      }
      root.hidden = false;
      root.removeAttribute('hidden');
      // 隐藏壳子
      if (window.Shell && typeof window.Shell.hideShell === 'function') {
        window.Shell.hideShell();
      }
      // 渲染场景骨架
      root.innerHTML = `
        <div class="scene-pingjianglu">
          <div class="scene-bg"></div>
          <div class="boat-rowing"><span>⛵</span></div>
          <div class="scene-stage">
            <div class="scene-characters">
              <div class="character-portrait" data-char="yunniang" data-pose="default">芸</div>
            </div>
            <div class="scene-dialogue-area"></div>
            <div class="scene-step-area"></div>
          </div>
        </div>
      `;
      // 入场动画 1.8s
      await sleep(1800);
      dispatch('scene:enter-done', {});
    },

    exit() {
      const root = getRoot();
      if (root) {
        root.hidden = true;
        root.setAttribute('hidden', '');
        root.innerHTML = '';
      }
      if (window.Shell && typeof window.Shell.showShell === 'function') {
        window.Shell.showShell();
      }
    },

    nextStep() {
      const order = ['suzhou', 'pingtan', 'shops'];
      const idx = order.indexOf(this.currentStep);
      const next = order[idx + 1];
      if (next) this.startStep(next);
    },

    // ============ 角色 ============
    showCharacter(charId, pose) {
      const root = getRoot();
      if (!root) return;
      const stage = root.querySelector('.scene-characters');
      if (!stage) return;
      let el = stage.querySelector(`.character-portrait[data-char="${charId}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'character-portrait';
        el.setAttribute('data-char', charId);
        stage.appendChild(el);
      }
      el.setAttribute('data-pose', pose || 'default');
      el.style.display = '';
    },

    hideCharacter(charId) {
      const root = getRoot();
      if (!root) return;
      const el = root.querySelector(`.character-portrait[data-char="${charId}"]`);
      if (el) el.style.display = 'none';
    },

    // ============ 对话气泡 ============
    showDialogue(text, charId, opts) {
      return new Promise((resolve) => {
        const root = getRoot();
        if (!root) { resolve(); return; }
        const area = root.querySelector('.scene-dialogue-area');
        if (!area) { resolve(); return; }
        const bubble = document.createElement('div');
        bubble.className = 'dialogue-bubble';
        bubble.setAttribute('data-char', charId || '');
        bubble.textContent = text;
        area.appendChild(bubble);

        dispatch('scene:dialogue-shown', { dialogueId: text.slice(0, 8), charId });

        const auto = opts && opts.auto;
        const duration = (opts && opts.duration) || 1800;

        if (auto) {
          setTimeout(() => resolve(), duration);
        } else {
          // 点击气泡或场景继续
          const onClick = () => {
            bubble.removeEventListener('click', onClick);
            root.removeEventListener('click', onClick);
            resolve();
          };
          bubble.addEventListener('click', onClick);
          // 整个对话区也能点
          setTimeout(() => {
            area.addEventListener('click', onClick, { once: true });
          }, 60);
        }
      });
    },

    clearDialogues() {
      const root = getRoot();
      if (!root) return;
      const area = root.querySelector('.scene-dialogue-area');
      if (area) area.innerHTML = '';
    },

    // ============ 开场对话 (SCENE_DIALOGUE_INTRO) ============
    async playIntroBubbles() {
      const bubbles = (this.dialogues && this.dialogues.introBubbles) || [];
      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        await this.showDialogue(b.text, b.char, { auto: false });
      }
      this.clearDialogues();
      // 触发 STEP_SUZHOU
      if (window.App && typeof window.App.transition === 'function') {
        window.App.transition('STEP_SUZHOU');
      } else {
        this.startStep('suzhou');
      }
    },

    // ============ 三步入口 ============
    startStep(stepName) {
      this.currentStep = stepName;
      dispatch('scene:step-start', { step: stepName });
      this.clearDialogues();
      const root = getRoot();
      const stepArea = root && root.querySelector('.scene-step-area');
      if (stepArea) stepArea.innerHTML = '';
      if (stepName === 'suzhou') return this._runSuzhou();
      if (stepName === 'pingtan') return this._runPingtan();
      if (stepName === 'shops') return this._runShops();
    },

    completeStep(stepName, scoreOrPayload) {
      const detail = { step: stepName, score: 0, payload: {} };
      if (typeof scoreOrPayload === 'number') {
        detail.score = scoreOrPayload;
        this.scores[stepName] = scoreOrPayload;
      } else if (scoreOrPayload && typeof scoreOrPayload === 'object') {
        detail.payload = scoreOrPayload;
        if (typeof scoreOrPayload.score === 'number') {
          detail.score = scoreOrPayload.score;
          this.scores[stepName] = scoreOrPayload.score;
        }
        if (Array.isArray(scoreOrPayload.collected)) {
          detail.collected = scoreOrPayload.collected;
        }
      }
      dispatch('scene:step-complete', detail);

      // 老字号是最后一步, 全部完成
      if (stepName === 'shops') {
        queueMicrotask(() => {
          dispatch('scene:all-complete', {
            scores: this.scores,
            collectedShops: this.collectedShops
          });
          dispatch('scene:all-done', {
            scores: this.scores,
            collectedShops: this.collectedShops
          });
        });
      }
    },

    // ============ 第 1 步: 苏州话听辨挑战 (新版) ============
    async _runSuzhou() {
      const root = getRoot();
      const stepArea = root && root.querySelector('.scene-step-area');
      if (!stepArea) return;

      const quiz = (this.dialogues && this.dialogues.suzhouQuiz) || FALLBACK_DIALOGUES.suzhouQuiz;
      const results = (this.dialogues && this.dialogues.suzhouQuizResults) || FALLBACK_DIALOGUES.suzhouQuizResults;
      let currentIdx = 0;
      let correctCount = 0;
      const answers = []; // { qid, picked, correct, isRight }

      // 渲染挑战外层
      stepArea.innerHTML = `
        <div class="step-suzhou-quiz">
          <div class="step-title">第一桩 · 苏州话听辨挑战</div>
          <div class="step-hint">你能听出真苏州话吗? 三题见真章。</div>
          <div class="quiz-progress" aria-label="进度">
            <span class="quiz-dot is-current"></span>
            <span class="quiz-dot"></span>
            <span class="quiz-dot"></span>
          </div>
          <div class="quiz-board"></div>
          <div class="quiz-result" hidden></div>
        </div>
      `;
      const board = stepArea.querySelector('.quiz-board');
      const progressDots = stepArea.querySelectorAll('.quiz-dot');

      const renderQuestion = (q) => {
        board.innerHTML = `
          <div class="quiz-question" data-qid="${escapeHtml(q.id)}">
            <div class="quiz-question__order">第 ${q.order} 题 / 共 3 题</div>
            <div class="quiz-question__phrase">${escapeHtml(q.phrase)}</div>
            <div class="quiz-question__translation">
              <div class="quiz-translation__main">${escapeHtml(q.translation)}</div>
              <div class="quiz-translation__detail">${escapeHtml(q.translationDetail || '')}</div>
            </div>
            <div class="quiz-question__ask">下面哪个才是真苏州话?</div>
            <div class="quiz-options"></div>
            <div class="quiz-feedback" hidden></div>
          </div>
        `;
        const opts = board.querySelector('.quiz-options');
        q.options.forEach((opt) => {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'quiz-option';
          el.setAttribute('data-id', opt.id);
          el.innerHTML = `
            <span class="quiz-option__id">${escapeHtml(opt.id)}</span>
            <span class="quiz-option__body">
              <span class="quiz-option__label">${escapeHtml(opt.label)}</span>
              <span class="quiz-option__subtitle">${escapeHtml(opt.subtitle || '')}</span>
            </span>
          `;
          opts.appendChild(el);
        });
      };

      const renderFeedback = (q, picked, isRight) => {
        const feedback = board.querySelector('.quiz-feedback');
        if (!feedback) return;
        // markdown-lite: **xxx** → <strong>xxx</strong>
        const renderInline = (s) => escapeHtml(s || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        feedback.hidden = false;
        feedback.innerHTML = `
          <div class="quiz-feedback__head ${isRight ? 'is-right' : 'is-wrong'}">
            ${isRight ? '✓ 答对了' : '✗ 不对, 答案是 ' + escapeHtml(q.correct)}
          </div>
          <div class="quiz-feedback__explanation">${renderInline(q.explanation)}</div>
          <div class="quiz-feedback__culture">
            <span class="quiz-feedback__culture-label">芸娘补一句</span>
            <span class="quiz-feedback__culture-text">${renderInline(q.culturalNote || '')}</span>
          </div>
          <button type="button" class="quiz-next-btn">${currentIdx >= quiz.length - 1 ? '看看我是几品 →' : '下一题 →'}</button>
        `;
      };

      const handleAnswer = (picked) => {
        const q = quiz[currentIdx];
        const isRight = picked === q.correct;
        if (isRight) correctCount++;
        answers.push({ qid: q.id, picked, correct: q.correct, isRight });

        // 标记选项状态
        board.querySelectorAll('.quiz-option').forEach((el) => {
          const id = el.getAttribute('data-id');
          el.disabled = true;
          if (id === q.correct) el.classList.add('is-correct');
          if (id === picked && !isRight) el.classList.add('is-wrong');
        });

        dispatch('scene:quiz-answered', {
          qid: q.id, picked, correct: q.correct, isRight
        });

        renderFeedback(q, picked, isRight);
      };

      const showResult = () => {
        const resultEl = stepArea.querySelector('.quiz-result');
        const result = results[String(correctCount)] || results['0'];
        if (!resultEl) return;
        // 隐藏题板, 展示结果
        board.style.display = 'none';
        resultEl.hidden = false;
        resultEl.innerHTML = `
          <div class="quiz-result__badge">${escapeHtml(result.badge || '')}</div>
          <div class="quiz-result__title">${escapeHtml(result.title || '')}</div>
          <div class="quiz-result__subtitle">${escapeHtml(result.subtitle || '')}</div>
          <div class="quiz-result__score">答对 ${correctCount}/${quiz.length} 题</div>
          <div class="quiz-result__comment">${escapeHtml(result.comment || '')}</div>
        `;
        resultEl.classList.add('is-pop');
      };

      const goNext = async () => {
        currentIdx++;
        if (currentIdx >= quiz.length) {
          // 全部答完
          showResult();
          dispatch('scene:line-recorded', {
            stage: 'suzhou-quiz-done',
            correctCount, total: quiz.length
          });
          await sleep(1800);
          // 评分按对题数 (0-3) 映射到 0-10 嗲度评分: 3=10, 2=8, 1=6, 0=4
          const scoreMap = { '3': 10, '2': 8, '1': 6, '0': 4 };
          const finalScore = scoreMap[String(correctCount)] || 4;
          this.completeStep('suzhou', finalScore);
        } else {
          // 进入下一题
          progressDots.forEach((d, i) => {
            d.classList.toggle('is-current', i === currentIdx);
            d.classList.toggle('is-done', i < currentIdx);
          });
          renderQuestion(quiz[currentIdx]);
        }
      };

      // 事件代理: 选项点击 + "下一题"按钮
      board.addEventListener('click', (e) => {
        const optBtn = e.target.closest('.quiz-option');
        const nextBtn = e.target.closest('.quiz-next-btn');
        if (optBtn && !optBtn.disabled) {
          handleAnswer(optBtn.getAttribute('data-id'));
        } else if (nextBtn) {
          goNext();
        }
      });

      // 渲染第 1 题
      renderQuestion(quiz[0]);
    },

    // ============ 第 2 步: 评弹半句跟唱 ============
    async _runPingtan() {
      const root = getRoot();
      const stepArea = root && root.querySelector('.scene-step-area');
      if (!stepArea) return;
      const lyrics = (this.dialogues && this.dialogues.pingtanLyrics) || FALLBACK_DIALOGUES.pingtanLyrics;
      const duration = (lyrics.durationSec || 6) * 1000;

      // pose 改为 singing
      this.showCharacter('yunniang', 'singing');

      stepArea.innerHTML = `
        <div class="step-pingtan">
          <div class="step-title">第二桩 · 评弹半句跟唱</div>
          <div class="pingtan-lyrics">
            <div class="pingtan-lyrics__title">《${escapeHtml(lyrics.title)}》</div>
            <div class="pingtan-lyrics__verse">${escapeHtml(lyrics.halfVerse)}</div>
            <div class="pingtan-lyrics__pinyin">${escapeHtml(lyrics.pinyin)}</div>
          </div>
          <button type="button" class="btn-mic">🎤 按住跟唱</button>
          <div class="pingtan-progress" hidden>
            <div class="pingtan-progress__bar"><div class="pingtan-progress__fill"></div></div>
            <div class="pingtan-progress__label">录音中...</div>
          </div>
          <div class="pingtan-wave" hidden></div>
        </div>
      `;

      const micBtn = stepArea.querySelector('.btn-mic');
      const progress = stepArea.querySelector('.pingtan-progress');
      const fillEl = stepArea.querySelector('.pingtan-progress__fill');
      const waveEl = stepArea.querySelector('.pingtan-wave');

      micBtn.addEventListener('click', async () => {
        if (micBtn.disabled) return;
        micBtn.disabled = true;
        micBtn.textContent = '🎤 录音中...';
        dispatch('scene:pingtan-start', {});
        // TODO: integrate getUserMedia for real mic input; MVP 只 mock 6s 进度条

        progress.hidden = false;
        const startTs = Date.now();
        const mockDuration = 3000; // 题目说 3s, 也兼容 6s, 取 3s
        const tick = () => {
          const pct = Math.min(100, ((Date.now() - startTs) / mockDuration) * 100);
          if (fillEl) fillEl.style.width = pct + '%';
          if (pct < 100) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        await sleep(mockDuration);

        // 渲染波形 SVG
        progress.hidden = true;
        waveEl.hidden = false;
        const waveData = renderWaveform(waveEl);
        const score = randInt(7, 10);
        dispatch('scene:pingtan-end', { score, waveData });

        // 显示评分
        const scoreLabel = document.createElement('div');
        scoreLabel.className = 'pingtan-score';
        scoreLabel.innerHTML = `<span>合奏完成 · 共鸣度 ${score}/10</span>`;
        waveEl.parentNode.appendChild(scoreLabel);

        await sleep(1200);
        this.completeStep('pingtan', score);
      });
    },

    // ============ 第 3 步: 老字号探宝 ============
    async _runShops() {
      const root = getRoot();
      const stepArea = root && root.querySelector('.scene-step-area');
      if (!stepArea) return;
      const shopList = (this.shops && this.shops.shops) || [];
      this.collectedShops = [];

      stepArea.innerHTML = `
        <div class="step-shops">
          <div class="step-title">第三桩 · 老字号探宝</div>
          <div class="step-hint">左右滑动看 3 家老字号, 点 ♡ 收藏。全部收藏即解锁修学卡。</div>
          <div class="shop-cards" tabindex="0"></div>
          <div class="shop-progress">已收藏 <span class="shop-progress__count">0</span> / ${shopList.length}</div>
          <button type="button" class="btn-shops-done" disabled>完成探宝</button>
        </div>
      `;
      const cardWrap = stepArea.querySelector('.shop-cards');
      const countEl = stepArea.querySelector('.shop-progress__count');
      const doneBtn = stepArea.querySelector('.btn-shops-done');

      shopList.forEach((shop) => {
        const card = document.createElement('div');
        card.className = 'shop-card';
        card.setAttribute('data-shop', shop.id);
        card.style.setProperty('--shop-color', shop.color);
        card.innerHTML = `
          <div class="shop-card__icon"></div>
          <div class="shop-card__name">${escapeHtml(shop.name)}</div>
          <div class="shop-card__meta">${escapeHtml(String(shop.foundedYear))}年 · ${escapeHtml(shop.signature)}</div>
          <div class="shop-card__address">${escapeHtml(shop.address)}</div>
          <div class="shop-card__story">${escapeHtml(shop.story)}</div>
          <div class="shop-card__coupon">🎁 ${escapeHtml(shop.coupon)}</div>
          <button type="button" class="shop-card__heart" aria-label="收藏" data-id="${shop.id}">♡</button>
        `;
        cardWrap.appendChild(card);
      });

      // 横滑 (touch + 鼠标拖)
      enableHorizontalDrag(cardWrap);

      cardWrap.addEventListener('click', (e) => {
        const heart = e.target.closest('.shop-card__heart');
        if (!heart) return;
        const shopId = heart.dataset.id;
        const shop = shopList.find((s) => s.id === shopId);
        const card = heart.closest('.shop-card');
        if (heart.classList.contains('is-collected')) {
          // 取消收藏
          heart.classList.remove('is-collected');
          heart.textContent = '♡';
          card.classList.remove('is-collected');
          this.collectedShops = this.collectedShops.filter((n) => n !== (shop ? shop.name : shopId));
          dispatch('scene:shop-uncollected', { shopId });
        } else {
          heart.classList.add('is-collected');
          heart.textContent = '♥';
          card.classList.add('is-collected');
          if (shop && this.collectedShops.indexOf(shop.name) < 0) {
            this.collectedShops.push(shop.name);
          }
          dispatch('scene:shop-collected', { shopId });
        }
        countEl.textContent = String(this.collectedShops.length);
        // 至少 1 张就可以完成 (题目要 3 张, 但允许 1 张完成更人性化; 按题目走 3 张)
        const needAll = this.collectedShops.length >= shopList.length;
        doneBtn.disabled = !needAll;
        if (needAll) {
          doneBtn.classList.add('is-ready');
          doneBtn.textContent = '完成探宝 →';
        }
      });

      doneBtn.addEventListener('click', async () => {
        if (doneBtn.disabled) return;
        doneBtn.disabled = true;
        doneBtn.textContent = '✓ 已完成';
        await sleep(400);
        this.completeStep('shops', {
          score: this.collectedShops.length * 3,
          collected: this.collectedShops.slice()
        });
      });
    }
  };

  // ============ 工具: 横滑拖动 ============
  function enableHorizontalDrag(el) {
    let isDown = false, startX = 0, scrollLeft = 0;
    const onDown = (e) => {
      isDown = true;
      el.classList.add('is-dragging');
      const t = e.touches ? e.touches[0] : e;
      startX = t.pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    };
    const onMove = (e) => {
      if (!isDown) return;
      const t = e.touches ? e.touches[0] : e;
      const x = t.pageX - el.offsetLeft;
      const walk = (x - startX);
      el.scrollLeft = scrollLeft - walk;
    };
    const onUp = () => {
      isDown = false;
      el.classList.remove('is-dragging');
    };
    el.addEventListener('mousedown', onDown);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseup', onUp);
    el.addEventListener('mouseleave', onUp);
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onUp);
  }

  // ============ 工具: 波形 SVG 渲染 ============
  function renderWaveform(container) {
    const bars = 40;
    const heights = [];
    let svg = '<svg viewBox="0 0 200 60" preserveAspectRatio="none" style="width:100%;height:60px;">';
    for (let i = 0; i < bars; i++) {
      const h = randInt(8, 56);
      heights.push(h);
      const x = (i / bars) * 200;
      const y = (60 - h) / 2;
      svg += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(200 / bars - 1).toFixed(2)}" height="${h}" rx="1.5" fill="#B8302E" opacity="${(0.5 + Math.random() * 0.5).toFixed(2)}">
        <animate attributeName="height" values="${h};${randInt(8, 56)};${h}" dur="${(0.6 + Math.random() * 0.8).toFixed(2)}s" repeatCount="indefinite" />
      </rect>`;
    }
    svg += '</svg>';
    container.innerHTML = svg;
    return heights;
  }

  // ============ 事件监听 ============
  // 监听 'landmark:enter' (题目要求) — 进入场景
  window.addEventListener('landmark:enter', async () => {
    if (!Scene._inited) await Scene.init();
    await Scene.enter();
    // 入场后顺势播开场气泡 (如果 App 状态机没接管, 自己走)
    if (!window.App || !window.App.STATES) {
      await Scene.playIntroBubbles();
    }
  });

  // 监听 app:state-change (主路径)
  window.addEventListener('app:state-change', async (e) => {
    const { to } = (e && e.detail) || {};
    if (to === 'SCENE_DIALOGUE_INTRO') {
      await Scene.playIntroBubbles();
    } else if (to === 'STEP_SUZHOU') {
      Scene.startStep('suzhou');
    } else if (to === 'STEP_PINGTAN') {
      Scene.startStep('pingtan');
    } else if (to === 'STEP_SHOPS') {
      Scene.startStep('shops');
    } else if (to === 'IDLE') {
      Scene.exit();
      Scene.scores = { suzhou: 0, pingtan: 0, shops: 0 };
      Scene.collectedShops = [];
      Scene.currentStep = null;
    }
  });

  window.addEventListener('app:reset', () => {
    Scene.exit();
    Scene.scores = { suzhou: 0, pingtan: 0, shops: 0 };
    Scene.collectedShops = [];
    Scene.currentStep = null;
  });

  // 暴露
  window.Scene = Scene;
})();
