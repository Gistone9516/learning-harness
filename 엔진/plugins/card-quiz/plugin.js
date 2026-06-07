/**
 * card-quiz / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 + §9 card-quiz 재배치
 * ──────────────────────────────────────────────────────────
 * 철칙:
 *   - app.js(window.APP.*) / 엔진코어 수정 0
 *   - DOM 훅 전부 보존 (기존 index.html 인라인 script 로직 이전)
 *   - 데이터구동 유지 (MANIFEST / DECKS / SYNONYMS 전역)
 *   - file:// 더블클릭 동작
 * 등록: window.PLUGIN_REGISTRY['card-quiz'] = instance (shell.js가 호출)
 */
(function () {
  'use strict';

  /* ───────── 헬퍼 ───────── */
  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var TYPE_LABEL = { func: '함수', proc: '절차', recall_seq: '순서', cloze: '빈칸', judge: '판단' };

  /* ───────── 플러그인 상태 (마운트당 초기화) ───────── */
  var _state = {
    mounted: false,
    host: null,       // HTMLElement — plugin-host
    ctx: null,        // PluginContext
    session: null,
    progressStore: null,
    deck: null,
    synonyms: undefined,
    current: null,
    total: 0,
    done: 0,
    conceptTarget: null,
    leitnerCfg: undefined
  };

  /* ────────────────────────────────────────────────────
     §9: plugin.mount() = 기존 퀴즈 UI 마크업을 host에 주입
         + window.APP.init({subject, onCard, onEmpty, onError}) 호출
  ──────────────────────────────────────────────────── */
  function _buildHTML() {
    return [
      '<div class="quiz-wrap" id="quiz-active" role="region" aria-label="퀴즈 카드">',

      /* 세션 진행 */
      '<div data-quiz="progress" class="quiz-progress" aria-label="세션 진행">',
      '  <span id="progress-current" aria-live="polite">0 / 0</span>',
      '  <div class="progress-bar-track" role="progressbar"',
      '       aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" id="progress-track-el">',
      '    <div class="progress-bar-fill" id="progress-fill" style="width:0%"></div>',
      '  </div>',
      '</div>',

      /* 카드 무대 */
      '<div class="card-container" id="card-container">',
      '  <div data-quiz="card-front" class="card-front" id="card-front" role="region" aria-label="카드 앞면">',
      '    <span class="card-type-badge" id="card-type-badge"></span>',
      '    <p class="card-front__prompt" id="card-front-prompt"></p>',
      '    <a href="#" data-quiz="concept-link" class="concept-link" id="concept-link-btn" hidden aria-label="연결 개념서 섹션 보기">📖 개념서 보기</a>',
      '  </div>',
      '  <div data-quiz="card-back" class="card-back" id="card-back" hidden role="region" aria-label="카드 뒷면">',
      '    <div class="card-back__detail prose" id="card-back-detail"></div>',
      '    <div class="card-back__note" id="card-back-note"></div>',
      '  </div>',
      '</div>',

      /* 입력 영역 */
      '<div data-quiz="answer-input" data-grade-mode="exact" class="answer-area" id="input-exact" hidden>',
      '  <label class="answer-label" for="input-exact-field">정답 입력</label>',
      '  <input type="text" id="input-exact-field" autocomplete="off" autocorrect="off"',
      '         autocapitalize="off" spellcheck="false" placeholder="정답을 입력하세요" aria-label="정답 입력 (exact)" />',
      '</div>',

      '<div data-quiz="answer-input" data-grade-mode="keyword" class="answer-area" id="input-keyword" data-input-fallback="full" hidden>',
      '  <label class="answer-label" for="input-keyword-field">키워드 입력 (쉼표 또는 줄바꿈으로 구분)</label>',
      '  <textarea id="input-keyword-field" rows="3" placeholder="핵심 키워드를 입력하세요" aria-label="키워드 입력 (keyword)"></textarea>',
      '</div>',

      '<div data-quiz="answer-input" data-grade-mode="cloze" class="answer-area" id="input-cloze" hidden>',
      '  <span class="answer-label">빈칸 채우기</span>',
      '  <div class="cloze-text-wrap" id="cloze-render-area" aria-label="빈칸 채우기 영역"></div>',
      '</div>',

      '<div data-quiz="self-grade" class="self-grade" id="input-self" hidden role="group" aria-label="자가 채점 O X">',
      '  <button type="button" class="btn-verdict" data-self-verdict="o" aria-label="정답 (O)">',
      '    <span aria-hidden="true">○</span><span class="btn-verdict__label">맞았어요</span>',
      '  </button>',
      '  <button type="button" class="btn-verdict" data-self-verdict="x" aria-label="오답 (X)">',
      '    <span aria-hidden="true">✕</span><span class="btn-verdict__label">틀렸어요</span>',
      '  </button>',
      '</div>',

      /* 정답 확인 */
      '<button type="button" data-quiz="reveal" class="btn-reveal" id="btn-reveal" aria-label="정답 확인">정답 확인</button>',

      /* 피드백 */
      '<div id="feedback-area" class="answer-area" hidden aria-live="polite">',
      '  <div id="verdict-display" class="feedback-row"></div>',
      '  <div id="feedback-detail" class="text-muted"></div>',
      '</div>',

      /* 다음 / 넘기기 */
      '<div class="answer-area" id="nav-area" hidden style="display:flex;flex-direction:column;gap:var(--space-2);">',
      '  <button type="button" class="btn-next" id="btn-next" aria-label="다음 카드">다음 카드 →</button>',
      '  <button type="button" class="btn-skip" id="btn-skip-card" aria-label="이 카드 넘기기">넘기기</button>',
      '</div>',

      '</div>', /* /#quiz-active */

      /* 빈상태 #1 EMPTY_NO_DECK */
      '<div id="empty-no-deck" class="empty-state" hidden aria-live="polite">',
      '  <div class="empty-state__icon" aria-hidden="true">📂</div>',
      '  <h2 class="empty-state__title">학습할 덱이 없습니다</h2>',
      '  <p class="empty-state__desc">덱(.js) 파일을 생성한 후 다시 시작하세요.</p>',
      '  <button type="button" class="btn-settings-action" data-route-trigger="settings" aria-label="설정으로 이동">설정으로 이동</button>',
      '</div>',

      /* 빈상태 #3 EMPTY_ALL_FUTURE */
      '<div id="empty-all-future" class="empty-state" hidden aria-live="polite">',
      '  <div class="empty-state__icon" aria-hidden="true">🎉</div>',
      '  <h2 class="empty-state__title">오늘 due 없음</h2>',
      '  <p class="empty-state__desc">오늘 복습할 카드가 없습니다.<br />전체 복습을 원하면 아래 버튼을 누르세요.</p>',
      '  <button type="button" class="btn-force-review" data-action="force-review-all" aria-label="전체 복습 강제 소환">전체복습 시작</button>',
      '</div>',

      /* 스토리지 오류 */
      '<div id="storage-error-area" class="storage-error-banner" hidden aria-live="assertive">',
      '  <strong>진도 데이터 오류</strong>',
      '  <span id="storage-error-msg">로컬 저장소에 문제가 발생했습니다.</span>',
      '  <button type="button" class="btn-settings-action" data-route-trigger="settings" style="align-self:flex-start;">설정에서 백업/내보내기</button>',
      '</div>'
    ].join('\n');
  }

  /* ───────── UI 헬퍼 함수 ───────── */
  function renderMarkdown(el, mdText) {
    if (!mdText) { el.innerHTML = ''; return; }
    var html;
    try { html = (window.marked ? window.marked.parse(mdText) : mdText.replace(/</g, '&lt;')); }
    catch (e) { html = mdText.replace(/</g, '&lt;'); }
    el.innerHTML = html;
    qsa('table', el).forEach(function (t) {
      if (t.parentElement && t.parentElement.classList.contains('table-wrap')) return;
      var w = document.createElement('div'); w.className = 'table-wrap';
      t.parentNode.insertBefore(w, t); w.appendChild(t);
    });
    try {
      if (window.renderMathInElement) window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false
      });
    } catch (e) {}
  }

  function levelOf(card) {
    var w = (card.tags && typeof card.tags.weight === 'number') ? card.tags.weight : 5;
    return w >= 8 ? 3 : w >= 5 ? 2 : 1;
  }

  function updateProgressUI() {
    var el = $('progress-current');
    if (!el) return;
    el.textContent = _state.done + ' / ' + _state.total;
    var pct = _state.total ? Math.round(_state.done / _state.total * 100) : 0;
    var fill = $('progress-fill');
    var track = $('progress-track-el');
    if (fill) fill.style.width = pct + '%';
    if (track) track.setAttribute('aria-valuenow', String(pct));
  }

  function showEmpty(which) {
    var active = $('quiz-active');
    var noD = $('empty-no-deck');
    var allF = $('empty-all-future');
    if (active) active.style.display = 'none';
    if (noD) noD.setAttribute('hidden', '');
    if (allF) allF.setAttribute('hidden', '');
    if (which && $(which)) $(which).removeAttribute('hidden');
  }

  function showQuizActive() {
    var active = $('quiz-active');
    var noD = $('empty-no-deck');
    var allF = $('empty-all-future');
    if (active) active.style.display = '';
    if (noD) noD.setAttribute('hidden', '');
    if (allF) allF.setAttribute('hidden', '');
  }

  function showStorageError(msg) {
    var el = $('storage-error-area');
    var msgEl = $('storage-error-msg');
    if (msgEl) msgEl.textContent = msg || '로컬 저장소 오류';
    if (el) el.removeAttribute('hidden');
  }

  function showInputFor(card) {
    ['exact', 'keyword', 'cloze'].forEach(function (m) {
      var el = document.querySelector('[data-quiz="answer-input"][data-grade-mode="' + m + '"]');
      if (el) el.setAttribute('hidden', '');
    });
    var inputSelf = $('input-self');
    if (inputSelf) inputSelf.setAttribute('hidden', '');
    var mode = card.grade_mode;
    var btnReveal = $('btn-reveal');
    if (mode === 'self') {
      if (inputSelf) inputSelf.removeAttribute('hidden');
      if (btnReveal) btnReveal.textContent = '정답 보기';
    } else {
      if (btnReveal) btnReveal.textContent = '정답 확인';
      var el = document.querySelector('[data-quiz="answer-input"][data-grade-mode="' + mode + '"]');
      if (el) {
        el.removeAttribute('hidden');
        if (mode === 'exact') { var f = $('input-exact-field'); if (f) f.value = ''; }
        if (mode === 'keyword') { var kf = $('input-keyword-field'); if (kf) kf.value = ''; }
        if (mode === 'cloze') renderClozeInputs(card);
      } else {
        console.warn('[E_GRADE_MODE]', mode);
        if (inputSelf) inputSelf.removeAttribute('hidden');
      }
    }
  }

  function renderClozeInputs(card) {
    var area = $('cloze-render-area'); if (!area) return;
    area.innerHTML = '';
    var spec = card.answer_spec || {};
    var blanks = spec.blanks || [];
    var text = (card.front && card.front.text) || '';
    var parts = text.split(/\{\{\d+\}\}/);
    var n = 0;
    parts.forEach(function (seg, i) {
      area.appendChild(document.createTextNode(seg));
      if (i < parts.length - 1 && n < blanks.length) {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.setAttribute('data-blank-index', String(n));
        inp.setAttribute('aria-label', '빈칸 ' + (n + 1));
        area.appendChild(inp); n++;
      }
    });
    if (n === 0 && blanks.length) {
      area.appendChild(document.createTextNode(text + ' '));
      for (var b = 0; b < blanks.length; b++) {
        var inp2 = document.createElement('input'); inp2.type = 'text';
        inp2.setAttribute('data-blank-index', String(b));
        inp2.setAttribute('aria-label', '빈칸 ' + (b + 1));
        area.appendChild(inp2);
        if (b < blanks.length - 1) area.appendChild(document.createTextNode('  '));
      }
    }
  }

  function frontText(card) {
    var f = card.front || {};
    if (card.type === 'cloze') return '';
    return f.prompt || f.scenario || f.text || (Array.isArray(f.options) ? f.options.join(' / ') : '') || '(문항)';
  }

  function renderCard(card) {
    _state.current = card;
    if (!card) return;
    showQuizActive();

    var lv = levelOf(card);
    var badge = $('card-type-badge');
    if (badge) {
      badge.textContent = TYPE_LABEL[card.type] || card.type;
      badge.setAttribute('data-level', String(lv));
    }

    var prompt = $('card-front-prompt');
    if (prompt) prompt.textContent = frontText(card);

    var cl = $('concept-link-btn');
    if (cl) {
      if (card.links && card.links.concept_ref) {
        cl.removeAttribute('hidden');
        cl.onclick = function (e) {
          e.preventDefault();
          _state.conceptTarget = card.links.concept_ref;
          // 셸에 navigation-request 이벤트 emit (concept 화면으로 + 딥링크 ref 전달)
          if (_state.ctx && _state.ctx.emit) {
            _state.ctx.emit({ type: 'navigation-request', target: 'concept', conceptRef: card.links.concept_ref });
          }
        };
      } else {
        cl.setAttribute('hidden', '');
      }
    }

    var cardBack = $('card-back');
    var feedbackArea = $('feedback-area');
    var navArea = $('nav-area');
    var btnReveal = $('btn-reveal');

    if (cardBack) cardBack.setAttribute('hidden', '');
    if (feedbackArea) { feedbackArea.setAttribute('hidden', ''); feedbackArea.className = 'answer-area'; }
    if (navArea) navArea.setAttribute('hidden', '');
    if (btnReveal) btnReveal.removeAttribute('hidden');

    showInputFor(card);
    updateProgressUI();
  }

  function collectAnswer(card) {
    var mode = card.grade_mode;
    if (mode === 'exact') {
      var ef = $('input-exact-field'); return ef ? ef.value : '';
    }
    if (mode === 'keyword') {
      var kf = $('input-keyword-field'); return kf ? kf.value : '';
    }
    if (mode === 'cloze') {
      return qsa('#cloze-render-area input[data-blank-index]')
        .sort(function (a, b) { return +a.getAttribute('data-blank-index') - +b.getAttribute('data-blank-index'); })
        .map(function (i) { return i.value; });
    }
    return null;
  }

  function revealBack(card, verdict, scoreResult) {
    var cardBackDetail = $('card-back-detail');
    var cardBackNote = $('card-back-note');
    var cardBack = $('card-back');
    var feedbackArea = $('feedback-area');
    var verdictDisplay = $('verdict-display');
    var feedbackDetail = $('feedback-detail');
    var btnReveal = $('btn-reveal');
    var navArea = $('nav-area');

    if (cardBackDetail) renderMarkdown(cardBackDetail, (card.back && card.back.detail) || '');
    if (cardBackNote) cardBackNote.textContent = (card.back && card.back.note) || '';
    if (cardBack) cardBack.removeAttribute('hidden');

    if (feedbackArea) {
      feedbackArea.removeAttribute('hidden');
      feedbackArea.className = 'answer-area ' + (verdict === 'correct' ? 'correct' : 'incorrect');
    }
    if (verdictDisplay) verdictDisplay.textContent = verdict === 'correct' ? '✓ 정답입니다' : '✕ 다시 확인하세요';
    var detail = '';
    if (scoreResult && scoreResult.feedback && scoreResult.feedback.highlightMissed && scoreResult.feedback.highlightMissed.length) {
      detail = '놓친 부분: ' + scoreResult.feedback.highlightMissed.join(', ');
    }
    if (feedbackDetail) feedbackDetail.textContent = detail;

    if (btnReveal) btnReveal.setAttribute('hidden', '');
    if (navArea) navArea.removeAttribute('hidden');
  }

  function commitAttempt(card, verdict) {
    try {
      window.APP.processAttempt(card.card_id, verdict, _state.session, _state.progressStore, Date.now(), _state.leitnerCfg);
      // §9: getProgressSnapshot/onProgressRestored = 기존 loadProgress/saveProgress 래핑
      // activity-completed 이벤트 → 셸이 savePluginProgress 호출 (§5 진도버스)
      // 여기서는 엔진 saveProgress도 직접 호출 (기존 동작 보존 + 키 clf:comp1:progress 유지)
      window.APP.saveProgress(_state.progressStore);
    } catch (e) {
      if (e && e.name === 'StorageQuotaError') showStorageError(e.message);
      else console.error('[attempt]', e);
    }
    if (verdict === 'correct') {
      _state.done = Math.min(_state.total, _state.done + 1);
      updateProgressUI();
    }
    // 셸에 activity-completed 이벤트 emit (§5 진도버스)
    if (_state.ctx && _state.ctx.emit) {
      _state.ctx.emit({
        type: 'activity-completed',
        result: {
          verdict: verdict,
          score_raw: verdict === 'correct' ? 1 : 0,
          feedback: {},
          grader_id: 'engine'
        }
      });
    }
  }

  function advance() {
    var next;
    try {
      next = window.APP.getNextCard(_state.session, _state.deck.cards, _state.progressStore, Date.now());
    } catch (e) { console.error('[getNextCard]', e); next = null; }
    if (next) renderCard(next);
    else {
      // 세션 완료 → session-done emit (§9: onEmpty→emit session-done)
      if (_state.ctx && _state.ctx.emit) {
        _state.ctx.emit({ type: 'session-done' });
      }
      // UI 빈상태 표시
      var manifest = (window.MANIFEST && window.MANIFEST[(_state.ctx && _state.ctx.settings && _state.ctx.settings.subject) || 'comp1']) || null;
      var hasDeck = manifest && manifest.decks && manifest.decks.length;
      showEmpty(hasDeck ? 'empty-all-future' : 'empty-no-deck');
    }
  }

  /* ─────────────────────────────────────────────
     이벤트 바인딩 (마운트 시 등록, unmount 시 정리)
  ───────────────────────────────────────────── */
  var _listeners = [];
  function _on(el, ev, fn) {
    if (!el) return;
    el.addEventListener(ev, fn);
    _listeners.push({ el: el, ev: ev, fn: fn });
  }

  function _bindEvents() {
    // 정답 확인 버튼
    _on($('btn-reveal'), 'click', function () {
      var card = _state.current; if (!card) return;
      if (card.grade_mode === 'self') {
        renderMarkdown($('card-back-detail'), (card.back && card.back.detail) || '');
        var n = $('card-back-note'); if (n) n.textContent = (card.back && card.back.note) || '';
        var cb = $('card-back'); if (cb) cb.removeAttribute('hidden');
        var br = $('btn-reveal'); if (br) br.setAttribute('hidden', '');
        return;
      }
      var userAnswer = collectAnswer(card);
      var result;
      try {
        result = window.APP.score({ mode: card.grade_mode, userAnswer: userAnswer, answerSpec: card.answer_spec || {}, synonyms: _state.synonyms });
      } catch (e) { console.warn('[score]', e); result = { verdict: 'incorrect', feedback: { highlightMissed: [] } }; }
      revealBack(card, result.verdict, result);
      commitAttempt(card, result.verdict);
    });

    // self O·X
    qsa('[data-self-verdict]').forEach(function (btn) {
      _on(btn, 'click', function () {
        var card = _state.current; if (!card) return;
        var v = btn.getAttribute('data-self-verdict') === 'o' ? 'correct' : 'incorrect';
        revealBack(card, v, null);
        commitAttempt(card, v);
      });
    });

    // 다음 카드
    _on($('btn-next'), 'click', advance);

    // 넘기기
    _on($('btn-skip-card'), 'click', function () {
      var card = _state.current; if (!card) return;
      commitAttempt(card, 'skip');
      advance();
    });

    // 전체복습 강제소환
    qsa('[data-action="force-review-all"]').forEach(function (b) {
      _on(b, 'click', function () { _bootQuiz({ dDayMode: true }); });
    });

    // settings 라우트 트리거 (빈상태 버튼)
    qsa('[data-route-trigger="settings"]').forEach(function (b) {
      _on(b, 'click', function () {
        if (_state.ctx && _state.ctx.emit) {
          _state.ctx.emit({ type: 'navigation-request', target: 'settings' });
        }
      });
    });

    // 키보드 단축키
    _on(document, 'keydown', function (e) {
      // 입력 포커스 중이면 무시
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      var btnReveal = $('btn-reveal');
      var navArea = $('nav-area');
      var inputSelf = $('input-self');

      if (e.key === 'Enter') {
        // 정답 확인 버튼이 보일 때 → 클릭
        if (btnReveal && !btnReveal.hasAttribute('hidden')) {
          e.preventDefault();
          btnReveal.click();
        }
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        // 다음 카드 영역이 보일 때 → 다음 카드
        if (navArea && !navArea.hasAttribute('hidden')) {
          e.preventDefault();
          var btnNext = $('btn-next');
          if (btnNext) btnNext.click();
        }
      } else if (e.key === 'o' || e.key === 'O') {
        // 자가채점 영역이 보일 때 → 정답(O)
        if (inputSelf && !inputSelf.hasAttribute('hidden')) {
          var oBtn = document.querySelector('[data-self-verdict="o"]');
          if (oBtn) oBtn.click();
        }
      } else if (e.key === 'x' || e.key === 'X') {
        // 자가채점 영역이 보일 때 → 오답(X)
        if (inputSelf && !inputSelf.hasAttribute('hidden')) {
          var xBtn = document.querySelector('[data-self-verdict="x"]');
          if (xBtn) xBtn.click();
        }
      }
    });
  }

  function _unbindEvents() {
    _listeners.forEach(function (l) {
      if (l.el) l.el.removeEventListener(l.ev, l.fn);
    });
    _listeners.length = 0;
  }

  /* ─────────────────────────────────────────────
     APP.init 래퍼 (내부 부트)
  ───────────────────────────────────────────── */
  function _bootQuiz(extraOpts) {
    var subject = (_state.ctx && _state.ctx.settings && _state.ctx.settings.subject) || 'comp1';
    var dDayMode = !!(extraOpts && extraOpts.dDayMode);

    var result = window.APP.init({
      subject: subject,
      dDayMode: dDayMode,
      onCard: function (card, session, progressStore, synonyms) {
        _state.session = session;
        _state.progressStore = progressStore;
        _state.synonyms = synonyms;
        _state.total = (session.queue ? session.queue.length : 0) + (session.requeue ? session.requeue.length : 0) + 1;
        _state.done = 0;
        renderCard(card);
      },
      onEmpty: function () {
        var manifest = (window.MANIFEST && window.MANIFEST[subject]) || null;
        var hasDeck = manifest && manifest.decks && manifest.decks.length;
        showEmpty(hasDeck ? 'empty-all-future' : 'empty-no-deck');
        // session-done emit
        if (_state.ctx && _state.ctx.emit) {
          _state.ctx.emit({ type: 'session-done' });
        }
      },
      onError: function (err) {
        console.error('[card-quiz plugin boot]', err);
        if (err && (err.name === 'SchemaVersionError' || err.name === 'StorageQuotaError')) {
          showStorageError(err.message);
        } else {
          showEmpty('empty-no-deck');
        }
      }
    });

    if (result) {
      _state.session = result.session;
      _state.progressStore = result.progressStore;
      _state.deck = result.deck;
      _state.synonyms = result.synonyms;
      if (result.isEmpty) {
        var manifest2 = (window.MANIFEST && window.MANIFEST[subject]) || null;
        var hasDeck2 = manifest2 && manifest2.decks && manifest2.decks.length;
        showEmpty(hasDeck2 ? 'empty-all-future' : 'empty-no-deck');
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────
     PluginInstance 인터페이스 (플러그인계약 §3)
  ───────────────────────────────────────────────────────────── */
  var cardQuizPlugin = {

    /**
     * mount(container, ctx)
     * 기존 퀴즈 UI 마크업을 host에 주입 + APP.init 호출.
     */
    mount: function (container, ctx) {
      return new Promise(function (resolve, reject) {
        try {
          if (_state.mounted) cardQuizPlugin.unmount();

          _state.host = container;
          _state.ctx = ctx;
          _state.mounted = true;

          // UI 주입
          container.innerHTML = _buildHTML();

          // 이벤트 바인딩
          _bindEvents();

          // 진도 복원 (ctx.progressStore가 있으면 onProgressRestored 흐름)
          // 셸이 loadPluginProgress를 주입할 경우 ctx.progressStore로 전달
          // 여기서는 APP.init이 자체적으로 localStorage에서 로드하므로 추가 복원 불필요

          // APP.init 호출
          _bootQuiz({});

          resolve();
        } catch (e) {
          reject(e);
        }
      });
    },

    /**
     * unmount()
     * 이벤트 리스너 제거 + host 비우기.
     */
    unmount: function () {
      _unbindEvents();
      if (_state.host) _state.host.innerHTML = '';
      _state.mounted = false;
      _state.host = null;
      _state.ctx = null;
      _state.current = null;
      _state.session = null;
      _state.progressStore = null;
      _state.deck = null;
    },

    /**
     * score(userAnswer) — §3, scoring_mode=auto
     * window.APP.score() 위임.
     */
    score: function (userAnswer) {
      return Promise.resolve(window.APP.score(userAnswer));
    },

    /**
     * getProgressSnapshot() — §3
     * 기존 loadProgress/saveProgress 래핑.
     * 현재 메모리 progressStore 그대로 반환.
     */
    getProgressSnapshot: function () {
      var subject = (_state.ctx && _state.ctx.settings && _state.ctx.settings.subject) || 'comp1';
      var ps = _state.progressStore;
      if (!ps) {
        // progressStore 미초기화 시 localStorage에서 로드
        try {
          var manifest = window.MANIFEST && window.MANIFEST[subject];
          var deckIds = (manifest && manifest.decks) || [];
          var d0 = deckIds[0];
          var deckId = (typeof d0 === 'string') ? d0 : (d0 && d0.deck_id);
          if (deckId) ps = window.APP.loadProgress(deckId);
        } catch (e) {}
      }
      return {
        plugin_id: 'card-quiz',
        schema_version: 1,
        activities: ps ? ps.cards : {}
      };
    },

    /**
     * onProgressRestored(snapshot) — §3
     * 외부에서 진도 스냅샷을 복원할 때 호출됨.
     * (현재는 APP.init가 localStorage에서 직접 로드하므로 no-op에 가까움)
     */
    onProgressRestored: function (snapshot) {
      if (!snapshot || !snapshot.activities) return;
      if (_state.progressStore) {
        _state.progressStore.cards = snapshot.activities;
      }
    },

    /**
     * getDashboardContrib() — §3 선택구현
     * 기존 getDashboardData 래핑.
     */
    getDashboardContrib: function () {
      if (!_state.deck || !_state.progressStore) return null;
      try {
        var data = window.APP.getDashboardData(_state.deck, _state.progressStore, Date.now());
        return {
          plugin_id: 'card-quiz',
          by_area: data.by_area,
          weakness: data.weakness,
          pass_path: data.pass_path,
          completion: data.completion,
          extra_widgets: []
        };
      } catch (e) {
        console.error('[card-quiz getDashboardContrib]', e);
        return null;
      }
    }
  };

  /* ───────── 전역 등록 (shell.js가 PLUGIN_REGISTRY에 넣기 전 준비) ───────── */
  window._CARD_QUIZ_PLUGIN = cardQuizPlugin;

})();
