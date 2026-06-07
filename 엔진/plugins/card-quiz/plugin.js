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
    leitnerCfg: undefined,
    // mid: 단원 필터
    unitFilter: null,   // null = 전체, string[] = 선택 unit 목록
    // BUG-1/BUG-2: 세션 완료 요약 + retry 목록
    sessionStats: {
      totalAttempted: 0,
      correctCount: 0,
      incorrectCards: []  // [{card_id, prompt}]
    },
    retryList: null,    // BUG-2: string[] | null — 다음 세션에서만 출제할 card_id 목록
    // mid: 일시정지 카드 목록 (localStorage 키: clf:plugin_extra:disabled_cards:<subject>)
    disabledCards: null,  // Set<card_id>, 로드 후 초기화
    // self 모드: btn-reveal 후 O/X 클릭 전까지 다음 카드 이동 막는 플래그
    _selfPendingVerdict: false
  };

  function _disabledCardsKey() {
    var subject = (_state.ctx && _state.ctx.settings && _state.ctx.settings.subject) || 'comp1';
    return 'clf:plugin_extra:disabled_cards:' + subject;
  }

  function _loadDisabledCards() {
    try {
      var raw = localStorage.getItem(_disabledCardsKey());
      _state.disabledCards = raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      _state.disabledCards = new Set();
    }
  }

  function _saveDisabledCards() {
    try {
      localStorage.setItem(_disabledCardsKey(), JSON.stringify(Array.from(_state.disabledCards)));
    } catch (e) { /* quota 실패 무시 */ }
  }

  function _isCardDisabled(card_id) {
    return _state.disabledCards && _state.disabledCards.has(card_id);
  }

  /* BUG-2: retry 세션 시작 — wrongIds를 _state.retryList에 저장 후 _bootQuiz 호출 */
  function startRetrySession(wrongIds) {
    if (!Array.isArray(wrongIds) || !wrongIds.length) return;
    _state.retryList = wrongIds.slice();
    _bootQuiz({});
  }

  /* ────────────────────────────────────────────────────
     §9: plugin.mount() = 기존 퀴즈 UI 마크업을 host에 주입
         + window.APP.init({subject, onCard, onEmpty, onError}) 호출
  ──────────────────────────────────────────────────── */
  function _buildHTML() {
    return [
      /* 단원 집중 필터 패널 */
      '<div id="unit-filter-panel" style="margin-bottom:10px;padding:8px 12px;background:var(--brand-bg,#e4efe7);border-radius:var(--r,10px);font-size:var(--fs-sm,12.5px);display:none;" aria-label="단원 필터">',
      '  <strong style="display:block;margin-bottom:6px;">단원 필터 <span id="unit-filter-active-badge" style="display:none;color:var(--brand-deep,#124e35);font-size:0.9em;">(적용 중)</span></strong>',
      '  <div id="unit-filter-checkboxes" style="display:flex;flex-wrap:wrap;gap:6px;"></div>',
      '  <div style="margin-top:6px;display:flex;gap:6px;">',
      '    <button type="button" id="btn-unit-filter-all" class="btn-quiz-aux">전체 선택</button>',
      '    <button type="button" id="btn-unit-filter-none" class="btn-quiz-aux">전체 해제</button>',
      '    <button type="button" id="btn-unit-filter-apply" style="padding:2px 10px;border:1px solid var(--brand,#1f6b4a);border-radius:var(--r,10px);background:var(--brand,#1f6b4a);color:#fff;cursor:pointer;font-size:var(--fs-sm,12.5px);">적용</button>',
      '  </div>',
      '</div>',

      '<div class="quiz-wrap" id="quiz-active" role="region" aria-label="퀴즈 카드">',

      /* 세션 진행 + D-day 토글 */
      '<div data-quiz="progress" class="quiz-progress" aria-label="세션 진행" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">',
      '  <span id="progress-current" aria-live="polite">0 / 0</span>',
      '  <div class="progress-bar-track" role="progressbar"',
      '       aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" id="progress-track-el" style="flex:1;min-width:80px;">',
      '    <div class="progress-bar-fill" id="progress-fill" style="width:0%"></div>',
      '  </div>',
      '  <button type="button" id="btn-dday-toggle" class="btn-dday-toggle" aria-pressed="false" aria-label="D-day 모드 토글">D-day OFF</button>',
      '  <button type="button" id="btn-unit-filter-toggle" class="btn-quiz-aux" aria-expanded="false" aria-label="단원 필터 토글">단원 필터</button>',
      '</div>',

      /* 카드 무대 */
      '<div class="card-container" id="card-container">',
      '  <div data-quiz="card-front" class="card-front" id="card-front" role="region" aria-label="카드 앞면">',
      '    <span class="card-type-badge" id="card-type-badge"></span>',
      '    <p class="card-front__prompt" id="card-front-prompt"></p>',
      '    <!-- 힌트 토글 (front.hint) -->',
      '    <div id="hint-area" hidden style="margin-top:8px;">',
      '      <button type="button" id="btn-hint-toggle" class="btn-quiz-aux" aria-expanded="false">힌트 보기</button>',
      '      <div id="hint-text" hidden style="margin-top:6px;padding:6px 10px;background:var(--warn-bg,#f8edd7);border-left:3px solid var(--warn-line,#e6c587);font-size:var(--fs-sm,12.5px);border-radius:var(--r,10px);"></div>',
      '    </div>',
      '    <!-- judge 객관식 선택지 -->',
      '    <div id="options-area" hidden style="margin-top:10px;" role="radiogroup" aria-label="선택지"></div>',
      '    <button type="button" data-quiz="concept-link" class="concept-link" id="concept-link-btn" hidden aria-label="연결 개념서 섹션 보기"><span aria-hidden="true">📖</span> 개념서 보기</button>',
      '  </div>',
      '  <div data-quiz="card-back" class="card-back" id="card-back" hidden role="region" aria-label="카드 뒷면">',
      '    <div class="card-back__detail prose" id="card-back-detail"></div>',
      '    <div class="card-back__note" id="card-back-note"></div>',
      '    <!-- back.why 근거 -->',
      '    <div id="back-why-area" hidden style="margin-top:8px;padding:8px 12px;background:var(--blue-bg,#e6eef8);border-left:3px solid var(--blue,#1d4f86);font-size:var(--fs-sm,12.5px);border-radius:var(--r,10px);">',
      '      <strong style="font-size:var(--fs-xs,11px);color:var(--blue,#1d4f86);">정답 근거</strong>',
      '      <div id="back-why-text" style="margin-top:4px;"></div>',
      '    </div>',
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

      /* recall_seq 전용 입력 영역 */
      '<div id="input-recall-seq" class="answer-area" hidden>',
      '  <label class="answer-label">단계를 순서대로 입력하세요 (한 줄에 하나씩)</label>',
      '  <div id="recall-seq-inputs" style="display:flex;flex-direction:column;gap:4px;"></div>',
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
      '  <button type="button" id="btn-pause-card" class="btn-pause-card" aria-label="이 카드 일시정지">이 카드 보류</button>',
      '</div>',

      /* 진도 내보내기/가져오기 입력 (숨김 — 이벤트 바인딩용, UI는 설정 화면에 위임) */
      '<input type="file" id="input-progress-import" accept=".json" style="display:none;" aria-hidden="true" />',

      '</div>', /* /#quiz-active */

      /* 세션 완료 요약 위젯 */
      '<div id="session-summary" hidden style="margin-top:12px;padding:12px 14px;background:var(--surface2,#f2eee5);border-radius:var(--r,10px);font-size:var(--fs-sm,12.5px);" aria-live="polite">',
      '  <strong style="font-size:var(--fs-md,14px);">세션 완료</strong>',
      '  <div id="session-summary-stats" style="margin-top:6px;color:var(--ink2s,#5a554a);"></div>',
      '  <div id="session-summary-incorrect" style="margin-top:8px;"></div>',
      '</div>',

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
    if (which === null) {
      // null = quiz-active 복구
      if (active) active.style.display = '';
    } else {
      if (active) active.style.display = 'none';
    }
    if (noD) noD.setAttribute('hidden', '');
    if (allF) allF.setAttribute('hidden', '');
    if (which && $(which)) $(which).removeAttribute('hidden');
  }

  function showQuizActive() { showEmpty(null); }

  function showStorageError(msg) {
    var el = $('storage-error-area');
    var msgEl = $('storage-error-msg');
    if (msgEl) msgEl.textContent = msg || '로컬 저장소 오류';
    if (el) el.removeAttribute('hidden');
    // quota 오류 시 설정 화면에서 백업 가능 — 배너 내 링크 버튼으로 안내
  }

  function _showIOMsg(msg) {
    var el = $('progress-io-msg');
    if (el) {
      el.textContent = msg;
      setTimeout(function () { if (el) el.textContent = ''; }, 3000);
    }
  }

  function renderRecallSeqInputs(card) {
    var area = $('recall-seq-inputs'); if (!area) return;
    area.innerHTML = '';
    var spec = card.answer_spec || {};
    var seq = spec.sequence || [];
    var count = seq.length || 3; // sequence 없으면 3칸 기본
    for (var i = 0; i < count; i++) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;';
      var label = document.createElement('span');
      label.textContent = (i + 1) + '.';
      label.style.cssText = 'min-width:20px;color:var(--ink3);font-size:var(--fs-sm);';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.setAttribute('data-seq-index', String(i));
      inp.setAttribute('aria-label', '단계 ' + (i + 1));
      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('spellcheck', 'false');
      inp.style.cssText = 'flex:1;padding:4px 8px;border:1px solid var(--line2);border-radius:var(--r);';
      inp.placeholder = '단계 ' + (i + 1);
      row.appendChild(label);
      row.appendChild(inp);
      area.appendChild(row);
    }
  }

  function renderJudgeOptions(card) {
    var area = $('options-area'); if (!area) return;
    area.innerHTML = '';
    var opts = (card.front && Array.isArray(card.front.options)) ? card.front.options : [];
    if (!opts.length) { area.setAttribute('hidden', ''); return; }
    area.removeAttribute('hidden');
    // 선택지 버튼 렌더
    opts.forEach(function (optText, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.setAttribute('data-option-idx', String(idx));
      btn.setAttribute('data-option-text', optText);
      btn.textContent = optText;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 12px;margin-bottom:4px;border:1px solid var(--line2,#cfc7b4);border-radius:var(--r,10px);background:var(--surface,#fbfaf6);cursor:pointer;font-size:var(--fs-md,14px);';
      btn.addEventListener('mouseover', function () { if (btn.getAttribute('aria-checked') !== 'true') btn.style.background = 'var(--brand-bg,#e4efe7)'; });
      btn.addEventListener('mouseout', function () {
        if (btn.getAttribute('aria-checked') !== 'true') btn.style.background = 'var(--surface,#fbfaf6)';
      });
      btn.addEventListener('click', function () {
        // 다른 버튼 선택 해제
        qsa('[data-option-idx]', area).forEach(function (b) {
          b.removeAttribute('data-selected');
          b.setAttribute('aria-checked', 'false');
          b.style.background = 'var(--surface,#fbfaf6)';
          b.style.border = '1px solid var(--line2,#cfc7b4)';
        });
        btn.setAttribute('data-selected', '1');
        btn.setAttribute('aria-checked', 'true');
        btn.style.background = 'var(--brand-bg,#e4efe7)';
        btn.style.border = '1px solid var(--brand,#1f6b4a)';
        // exact input에 선택된 텍스트 동기화 (collectAnswer가 읽음)
        var ef = $('input-exact-field');
        if (ef) ef.value = optText;
      });
      area.appendChild(btn);
    });
  }

  function showInputFor(card) {
    ['exact', 'keyword', 'cloze'].forEach(function (m) {
      var el = document.querySelector('[data-quiz="answer-input"][data-grade-mode="' + m + '"]');
      if (el) el.setAttribute('hidden', '');
    });
    var inputSelf = $('input-self');
    var inputRecallSeq = $('input-recall-seq');
    var optionsArea = $('options-area');
    if (inputSelf) inputSelf.setAttribute('hidden', '');
    if (inputRecallSeq) inputRecallSeq.setAttribute('hidden', '');
    if (optionsArea) optionsArea.setAttribute('hidden', '');
    var mode = card.grade_mode;
    var btnReveal = $('btn-reveal');

    // recall_seq/exact 조합: 전용 멀티입력 UI 사용
    if (card.type === 'recall_seq' && mode === 'exact') {
      var recallEl = $('input-recall-seq');
      if (recallEl) {
        recallEl.removeAttribute('hidden');
        renderRecallSeqInputs(card);
      }
      if (btnReveal) btnReveal.textContent = '정답 확인';
      return;
    }

    if (mode === 'self') {
      if (inputSelf) inputSelf.removeAttribute('hidden');
      if (btnReveal) btnReveal.textContent = '정답 보기';
    } else {
      if (btnReveal) btnReveal.textContent = '정답 확인';
      var el = document.querySelector('[data-quiz="answer-input"][data-grade-mode="' + mode + '"]');
      if (el) {
        el.removeAttribute('hidden');
        if (mode === 'exact') {
          var f = $('input-exact-field'); if (f) f.value = '';
          // judge 객관식: options 버튼 렌더
          if (card.type === 'judge' && card.front && Array.isArray(card.front.options) && card.front.options.length) {
            renderJudgeOptions(card);
            // judge options 있으면 text input 숨기고 options만 보임
            if (f) f.parentElement && f.parentElement.setAttribute('hidden', '');
            // 단, input-exact 컨테이너 자체를 숨기고 options-area만 노출
            el.setAttribute('hidden', '');
            if (optionsArea) optionsArea.removeAttribute('hidden');
          }
        }
        if (mode === 'keyword') { var kf = $('input-keyword-field'); if (kf) kf.value = ''; }
        if (mode === 'cloze') renderClozeInputs(card);
      } else {
        console.warn('[E_GRADE_MODE]', mode);
        // 알 수 없는 mode → self 폴백: 버튼 텍스트도 '정답 보기'로 설정
        if (inputSelf) inputSelf.removeAttribute('hidden');
        if (btnReveal) btnReveal.textContent = '정답 보기';
      }
    }
  }

  function renderClozeInputs(card) {
    var area = $('cloze-render-area'); if (!area) return;
    area.innerHTML = '';
    var spec = card.answer_spec || {};
    var blanks = spec.blanks || [];
    var text = (card.front && card.front.text) || '';
    // 규격 §2.4 마커 = {{숫자}} (0-base) 또는 generate.py가 {{정답|별칭}} 형태로 저장할 수도 있음
    // → {{…}} 내 임의 텍스트를 모두 매칭해 빈칸 분리
    var parts = text.split(/\{\{[^}]+\}\}/);
    var n = 0;
    function _makeClozeInput(idx) {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.setAttribute('data-blank-index', String(idx));
      inp.setAttribute('aria-label', '빈칸 ' + (idx + 1));
      // F-06/cloze 단서: 고정 width로 길이단서 중립화
      inp.style.cssText = 'width:8em;max-width:18em;';
      return inp;
    }
    parts.forEach(function (seg, i) {
      area.appendChild(document.createTextNode(seg));
      if (i < parts.length - 1 && n < blanks.length) {
        area.appendChild(_makeClozeInput(n)); n++;
      }
    });
    if (n === 0 && blanks.length) {
      area.appendChild(document.createTextNode(text + ' '));
      for (var b = 0; b < blanks.length; b++) {
        area.appendChild(_makeClozeInput(b));
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
        cl.onclick = function () {
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

    // 힌트 초기화 (카드 전환 시 숨김 상태로 리셋)
    var hintArea = $('hint-area');
    var hintText = $('hint-text');
    var btnHintToggle = $('btn-hint-toggle');
    var hint = card.front && card.front.hint;
    if (hint) {
      if (hintArea) hintArea.removeAttribute('hidden');
      if (hintText) { hintText.textContent = hint; hintText.setAttribute('hidden', ''); }
      if (btnHintToggle) { btnHintToggle.textContent = '힌트 보기'; btnHintToggle.setAttribute('aria-expanded', 'false'); }
    } else {
      if (hintArea) hintArea.setAttribute('hidden', '');
    }

    // back.why 초기화
    var backWhyArea = $('back-why-area');
    if (backWhyArea) backWhyArea.setAttribute('hidden', '');

    // mid: 보류 버튼 리셋
    var btnPause = $('btn-pause-card');
    if (btnPause) {
      btnPause.textContent = '이 카드 보류';
      btnPause.disabled = false;
      // 이미 보류된 카드면 표시
      if (_state.disabledCards && _state.disabledCards.has(card.card_id)) {
        btnPause.textContent = '보류됨';
        btnPause.disabled = true;
      }
    }

    showInputFor(card);
    updateProgressUI();
  }

  function collectAnswer(card) {
    var mode = card.grade_mode;

    // recall_seq/exact: 멀티입력 칸에서 string[] 수집
    if (card.type === 'recall_seq' && mode === 'exact') {
      return qsa('#recall-seq-inputs input[data-seq-index]')
        .sort(function (a, b) { return +a.getAttribute('data-seq-index') - +b.getAttribute('data-seq-index'); })
        .map(function (i) { return i.value; });
    }

    if (mode === 'exact') {
      // judge 객관식: options-area에서 선택된 텍스트 반환
      var selectedOpt = document.querySelector('#options-area [data-option-idx][data-selected]');
      if (selectedOpt) return selectedOpt.getAttribute('data-option-text') || '';
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
    // back.why 렌더 (judge 정답근거)
    var backWhyArea = $('back-why-area');
    var backWhyText = $('back-why-text');
    var why = card.back && card.back.why;
    if (why) {
      if (backWhyText) backWhyText.textContent = why;
      if (backWhyArea) backWhyArea.removeAttribute('hidden');
    } else {
      if (backWhyArea) backWhyArea.setAttribute('hidden', '');
    }
    if (cardBack) cardBack.removeAttribute('hidden');

    if (feedbackArea) {
      feedbackArea.removeAttribute('hidden');
      feedbackArea.className = 'answer-area ' + (verdict === 'correct' ? 'correct' : 'incorrect');
    }
    if (verdictDisplay) verdictDisplay.textContent = verdict === 'correct' ? '✓ 정답입니다' : '✕ 다시 확인하세요';
    var detail = '';
    if (verdict === 'incorrect') {
      var spec = card.answer_spec || {};
      if (card.grade_mode === 'cloze') {
        // cloze 오답: missed 인덱스를 "빈칸 N번" 형식으로 표시
        if (scoreResult && scoreResult.missed && scoreResult.missed.length) {
          detail = '오답 빈칸: ' + scoreResult.missed.map(function (idx) { return (parseInt(idx, 10) + 1) + '번'; }).join(', ');
        }
      } else {
        // exact 복수정답 피드백: answer_spec.accepted[] 표시 (mid)
        var accepted = Array.isArray(spec.accepted) ? spec.accepted : [];
        if (accepted.length > 0) {
          detail = '정답 표기: ' + accepted.join(' / ');
        }
        // keyword: 놓친 키워드 문자열만 (인덱스 아님)
        if (!detail && scoreResult && scoreResult.feedback && scoreResult.feedback.highlightMissed && scoreResult.feedback.highlightMissed.length) {
          detail = '놓친 부분: ' + scoreResult.feedback.highlightMissed.join(', ');
        }
      }
    }
    if (feedbackDetail) feedbackDetail.textContent = detail;

    if (btnReveal) btnReveal.setAttribute('hidden', '');
    if (navArea) navArea.removeAttribute('hidden');
  }

  function commitAttempt(card, verdict) {
    // cold 여부: processAttempt 호출 전에 캡처 (이후 seen_card_ids에 추가됨)
    var isCold = !(_state.session && _state.session.seen_card_ids && _state.session.seen_card_ids.has(card.card_id));
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
    // mid: 세션 완료 요약 통계 누적 — cold 첫 시도만 집계
    if (isCold && (verdict === 'correct' || verdict === 'incorrect')) {
      if (verdict === 'correct') {
        _state.sessionStats.correctCount++;
      } else {
        // incorrect: incorrectCards 목록에 추가 (중복 방지)
        var alreadyIn = _state.sessionStats.incorrectCards.some(function (ic) { return ic.card_id === card.card_id; });
        if (!alreadyIn) {
          var prompt = (card.front && (card.front.prompt || card.front.scenario || card.front.text)) || card.card_id;
          _state.sessionStats.incorrectCards.push({ card_id: card.card_id, prompt: prompt });
        }
      }
      _state.sessionStats.totalAttempted++;
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
      _emitSessionDone();
      // UI 빈상태 표시
      var manifest = (window.MANIFEST && window.MANIFEST[(_state.ctx && _state.ctx.settings && _state.ctx.settings.subject) || 'comp1']) || null;
      var hasDeck = manifest && manifest.decks && manifest.decks.length;
      showEmpty(hasDeck ? 'empty-all-future' : 'empty-no-deck');
    }
  }

  /* BUG-1: session-done 페이로드 emit (셸이 단일 소스로 요약 렌더) */
  function _emitSessionDone() {
    var stats = _state.sessionStats;
    var wrongIds = stats.incorrectCards.map(function (ic) { return ic.card_id; });
    if (_state.ctx && _state.ctx.emit) {
      _state.ctx.emit({
        type: 'session-done',
        total: stats.totalAttempted,
        correct: stats.correctCount,
        wrong: wrongIds
      });
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
        // back.why 렌더 (self 모드에도)
        var bwa = $('back-why-area'), bwt = $('back-why-text'), why = card.back && card.back.why;
        if (why) { if (bwt) bwt.textContent = why; if (bwa) bwa.removeAttribute('hidden'); }
        else { if (bwa) bwa.setAttribute('hidden', ''); }
        var cb = $('card-back'); if (cb) cb.removeAttribute('hidden');
        var br = $('btn-reveal'); if (br) br.setAttribute('hidden', '');
        // self: O/X 클릭 대기 상태로 전환 (nav-area는 O/X 클릭 후에만 열림)
        _state._selfPendingVerdict = true;
        var inputSelf = $('input-self'); if (inputSelf) inputSelf.removeAttribute('hidden');
        return;
      }
      // judge 객관식: 미선택 시 안내
      if (card.type === 'judge' && card.front && Array.isArray(card.front.options) && card.front.options.length) {
        var selectedOpt = document.querySelector('#options-area [data-option-idx][data-selected]');
        if (!selectedOpt) {
          var feedbackEl = $('feedback-detail');
          if (feedbackEl) {
            feedbackEl.textContent = '선택지를 선택해 주세요';
            var fa = $('feedback-area');
            if (fa) fa.removeAttribute('hidden');
          }
          return;
        }
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
        _state._selfPendingVerdict = false;
        // O/X 버튼 숨기기 (중복 클릭 방지)
        var inputSelf = $('input-self'); if (inputSelf) inputSelf.setAttribute('hidden', '');
        // revealBack이 feedbackArea/verdictDisplay/navArea 처리
        revealBack(card, v, null);
        commitAttempt(card, v);
      });
    });

    // 다음 카드
    _on($('btn-next'), 'click', function () {
      // self 모드에서 O/X 없이 다음 카드로 넘어가는 경로 차단
      if (_state._selfPendingVerdict) return;
      advance();
    });

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

    // ── 힌트 토글 ──
    _on($('btn-hint-toggle'), 'click', function () {
      var hintText = $('hint-text');
      var btn = $('btn-hint-toggle');
      if (!hintText) return;
      var isHidden = hintText.hasAttribute('hidden');
      if (isHidden) {
        hintText.removeAttribute('hidden');
        if (btn) { btn.textContent = '힌트 숨기기'; btn.setAttribute('aria-expanded', 'true'); }
      } else {
        hintText.setAttribute('hidden', '');
        if (btn) { btn.textContent = '힌트 보기'; btn.setAttribute('aria-expanded', 'false'); }
      }
    });

    // ── 단원 필터 토글 ──
    _on($('btn-unit-filter-toggle'), 'click', function () {
      var panel = $('unit-filter-panel');
      if (!panel) return;
      var isOpen = panel.style.display !== 'none';
      if (isOpen) {
        panel.style.display = 'none';
        var btn = $('btn-unit-filter-toggle');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      } else {
        _buildUnitFilterUI(true);
        var btn2 = $('btn-unit-filter-toggle');
        if (btn2) btn2.setAttribute('aria-expanded', 'true');
      }
    });

    // 단원 필터: 전체 선택
    _on($('btn-unit-filter-all'), 'click', function () {
      qsa('#unit-filter-checkboxes input[type=checkbox]').forEach(function (cb) { cb.checked = true; });
    });

    // 단원 필터: 전체 해제
    _on($('btn-unit-filter-none'), 'click', function () {
      qsa('#unit-filter-checkboxes input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
    });

    // 단원 필터: 적용
    _on($('btn-unit-filter-apply'), 'click', function () {
      var checked = qsa('#unit-filter-checkboxes input[type=checkbox]:checked').map(function (cb) { return cb.value; });
      var allCbs = qsa('#unit-filter-checkboxes input[type=checkbox]');
      _state.unitFilter = (checked.length === allCbs.length) ? null : checked;
      // badge 표시
      var badge = $('unit-filter-active-badge');
      if (badge) badge.style.display = (_state.unitFilter ? '' : 'none');
      // 패널 닫기
      var panel = $('unit-filter-panel');
      if (panel) panel.style.display = 'none';
      var tBtn = $('btn-unit-filter-toggle');
      if (tBtn) tBtn.setAttribute('aria-expanded', 'false');
      // 재시작
      _bootQuiz({ dDayMode: _state.session && _state.session.dDayMode });
    });

    // ── 카드 일시정지 (보류) ──
    _on($('btn-pause-card'), 'click', function () {
      var card = _state.current; if (!card) return;
      if (!_state.disabledCards) _loadDisabledCards();
      _state.disabledCards.add(card.card_id);
      _saveDisabledCards();
      // 버튼 시각 피드백
      var btn = $('btn-pause-card');
      if (btn) { btn.textContent = '보류됨'; btn.disabled = true; }
      // 다음 카드로
      advance();
    });

    // ── D-day 토글 ──
    _on($('btn-dday-toggle'), 'click', function () {
      var btn = $('btn-dday-toggle');
      var isOn = btn && btn.getAttribute('aria-pressed') === 'true';
      if (isOn) {
        if (btn) { btn.textContent = 'D-day OFF'; btn.setAttribute('aria-pressed', 'false'); }
        _bootQuiz({ dDayMode: false });
      } else {
        if (btn) { btn.textContent = 'D-day ON'; btn.setAttribute('aria-pressed', 'true'); }
        _bootQuiz({ dDayMode: true });
      }
    });

    // ── 진도 가져오기 ──
    _on($('input-progress-import'), 'change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var parsed = JSON.parse(ev.target.result);
          if (!parsed || typeof parsed !== 'object' || !parsed.deck_namespace) {
            _showIOMsg('올바른 진도 파일이 아닙니다');
            return;
          }
          if (typeof parsed.schema_version === 'number' && parsed.schema_version > 1) {
            _showIOMsg('파일 버전이 현재 앱보다 높습니다');
            return;
          }
          window.APP.saveProgress(parsed);
          _showIOMsg('가져오기 완료 — 다시 시작합니다');
          setTimeout(function () { _bootQuiz({}); }, 800);
        } catch (err) {
          _showIOMsg('파일 읽기 오류: ' + err.message);
          console.error('[progress-import]', err);
        }
        e.target.value = '';
      };
      reader.onerror = function () { _showIOMsg('파일 읽기 실패'); };
      reader.readAsText(file, 'utf-8');
    });

    // 키보드 단축키
    _on(document, 'keydown', function (e) {
      // 입력/버튼 포커스 중이면 무시 (BUTTON: Space가 버튼 click + 단축키 이중발화 방지)
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return;

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

    // mid: 세션 완료 요약 통계 리셋 + 이전 요약 숨김
    _state.sessionStats = { totalAttempted: 0, correctCount: 0, incorrectCards: [] };
    var prevSummary = $('session-summary'); if (prevSummary) prevSummary.setAttribute('hidden', '');

    // mid: 일시정지 카드 목록 로드
    _loadDisabledCards();

    // mid: 단원 필터 또는 일시정지 카드 적용 여부 확인
    var hasUnitFilter = _state.unitFilter && _state.unitFilter.length > 0;
    var hasDisabledCards = _state.disabledCards && _state.disabledCards.size > 0;
    // BUG-2: retryList → 항상 custom boot 경로 사용 (필터만 retryList)
    var hasRetryList = _state.retryList && _state.retryList.length > 0;
    var needsCustomBoot = hasUnitFilter || hasDisabledCards || hasRetryList;

    if (!needsCustomBoot) {
      // 기본 경로: APP.init 사용
      var result = window.APP.init({
        subject: subject,
        dDayMode: dDayMode,
        onCard: function (card, session, progressStore, synonyms) {
          // session/progressStore/synonyms는 result 블록에서 확정 기입 — 여기선 total/done/render만
          _state.total = (session.queue ? session.queue.length : 0) + (session.requeue ? session.requeue.length : 0) + 1;
          _state.done = 0;
          renderCard(card);
        },
        onEmpty: function () {
          var manifest = (window.MANIFEST && window.MANIFEST[subject]) || null;
          var hasDeck = manifest && manifest.decks && manifest.decks.length;
          _emitSessionDone();
          showEmpty(hasDeck ? 'empty-all-future' : 'empty-no-deck');
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
        // mid: 단원 필터 UI 빌드 (덱 로드 완료 후)
        var cbArea = $('unit-filter-checkboxes');
        if (cbArea && !cbArea.children.length) _buildUnitFilterUI();
        if (result.isEmpty) {
          var manifest2 = (window.MANIFEST && window.MANIFEST[subject]) || null;
          var hasDeck2 = manifest2 && manifest2.decks && manifest2.decks.length;
          showEmpty(hasDeck2 ? 'empty-all-future' : 'empty-no-deck');
        }
      }
    } else {
      // mid: 단원 필터 / 일시정지 카드 경로 — window.__CLF__ API 직접 사용
      try {
        var manifest3 = window.APP.getManifest(subject);
        var deckIds3 = Array.isArray(manifest3.decks) ? manifest3.decks : [];
        if (!deckIds3.length) { showEmpty('empty-no-deck'); return; }
        var d0 = deckIds3[0];
        var deckId3 = (typeof d0 === 'string') ? d0 : (d0 && d0.deck_id);
        var deck3 = window.__CLF__.loadDeck(deckId3);
        var progressStore3 = window.__CLF__.loadProgress(deckId3);
        // 단원 필터 + 일시정지 카드 + retry 필터 적용
        var retrySet = hasRetryList ? _state.retryList : null;
        var filteredCards = deck3.cards.filter(function (c) {
          if (c.enabled === false) return false;
          if (_isCardDisabled(c.card_id)) return false;
          if (hasUnitFilter && _state.unitFilter.indexOf(c.unit) === -1) return false;
          if (retrySet && retrySet.indexOf(c.card_id) === -1) return false;
          return true;
        });
        // BUG-2: retryList 소비 — 이번 세션에만 적용
        _state.retryList = null;
        if (!filteredCards.length) { showEmpty('empty-all-future'); return; }
        // 필터된 덱으로 buildQueue 호출
        var queue3 = window.__CLF__.buildQueue(filteredCards, progressStore3.cards, Date.now(), {
          dDayMode: dDayMode,
          deckNamespace: deckId3
        });
        var session3 = { deckNamespace: deckId3, seen_card_ids: new Set(), queue: queue3, requeue: [], dDayMode: dDayMode, currentCardId: null };
        _state.session = session3;
        _state.progressStore = progressStore3;
        // filteredDeck으로 getNextCard 사용 (단원 필터 적용 시에도 원본 deck 유지 for UI)
        _state.deck = { namespace: deckId3, cards: filteredCards, _fullDeck: deck3 };
        _state.synonyms = (window.SYNONYMS && window.SYNONYMS[subject]) || undefined;
        // mid: 단원 필터 UI 빌드 (체크 상태 반영, 패널은 열지 않음)
        _buildUnitFilterUI(false);
        if (!queue3.length) { showEmpty('empty-all-future'); return; }
        _state.total = queue3.length;
        _state.done = 0;
        var firstCard3 = window.__CLF__.getNextCard(session3, filteredCards, progressStore3, Date.now());
        if (firstCard3) renderCard(firstCard3);
        else showEmpty('empty-all-future');
      } catch (e3) {
        console.error('[card-quiz unit-filter boot]', e3);
        showEmpty('empty-no-deck');
      }
    }
  }

  /* ─────────────────────────────────────────────
     단원 필터 UI 헬퍼
  ───────────────────────────────────────────── */
  // openPanel=true이면 패널을 열고, false/생략이면 체크박스만 갱신 (패널 표시 상태 유지)
  function _buildUnitFilterUI(openPanel) {
    var panel = $('unit-filter-panel'); if (!panel) return;
    // 항상 전체 덱 기준으로 단원 목록 수집 (_fullDeck = 필터 경로에서 원본 덱 보존)
    var deck = (_state.deck && _state.deck._fullDeck) ? { cards: _state.deck._fullDeck.cards } : _state.deck;
    if (!deck || !deck.cards || !deck.cards.length) return;
    // 단원 목록 수집
    var units = [];
    deck.cards.forEach(function (c) {
      if (c.unit && units.indexOf(c.unit) === -1) units.push(c.unit);
    });
    units.sort();
    var cbArea = $('unit-filter-checkboxes'); if (!cbArea) return;
    cbArea.innerHTML = '';
    units.forEach(function (u) {
      var label = document.createElement('label');
      label.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border:1px solid #ccc;border-radius:12px;background:#fff;cursor:pointer;white-space:nowrap;font-size:0.9em;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = u;
      cb.checked = !_state.unitFilter || _state.unitFilter.indexOf(u) !== -1;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(u));
      cbArea.appendChild(label);
    });
    // openPanel 명시 시에만 패널 표시 (UI 빌드와 패널 오픈 분리)
    if (openPanel) panel.style.display = '';
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
      // subject 전환 시 오염 방지: disabledCards/unitFilter/sessionStats/retryList/self플래그 초기화
      _state.disabledCards = null;
      _state.unitFilter = null;
      _state.retryList = null;
      _state.sessionStats = { totalAttempted: 0, correctCount: 0, incorrectCards: [] };
      _state._selfPendingVerdict = false;
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
        // F-13 robust: progressStore 미초기화 시 localStorage에서 로드 — SchemaVersionError 차단
        try {
          var manifest = window.MANIFEST && window.MANIFEST[subject];
          var deckIds = (manifest && manifest.decks) || [];
          var d0 = deckIds[0];
          var deckId = (typeof d0 === 'string') ? d0 : (d0 && d0.deck_id);
          if (deckId) ps = window.APP.loadProgress(deckId);
        } catch (e) {
          // SchemaVersionError 등 전파 차단 — ps는 null 유지
          console.warn('[getProgressSnapshot] loadProgress 실패:', e && e.name);
        }
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
        // BUG-3: 단원 필터 활성 시 _state.deck._fullDeck 우선 사용 (부분통계 방지)
        var deckForDashboard = (_state.deck._fullDeck) ? _state.deck._fullDeck : _state.deck;
        var data = window.APP.getDashboardData(deckForDashboard, _state.progressStore, Date.now());
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
    },

    /**
     * startRetrySession(wrongIds) — BUG-2
     * 셸이 session-done.wrong 목록으로 retry 세션을 시작할 때 호출.
     * @param {string[]} wrongIds — 오답 card_id 배열
     */
    startRetrySession: startRetrySession
  };

  /* ───────── 전역 등록 (shell.js가 PLUGIN_REGISTRY에 넣기 전 준비) ───────── */
  window._CARD_QUIZ_PLUGIN = cardQuizPlugin;

})();
