/**
 * nlp-study / plugin.js
 * 자연어처리 학습 플러그인 — 단일 화면, 상단 탭 = 단계.
 *   읽기(reading): marked로 교재식 노트 렌더.
 *   시험(exam): 좌 CodeMirror(편집) + 초기화, 우 문제목록·모범답안 토글(자가확인). 입력 localStorage 저장.
 * 콘텐츠: window.ACTIVITIES['nlp-study'] = [{kind:'reading',id,title,md} | {kind:'exam',id,title,starter_code,questions:[{no,q,answer}]}]
 * 등록: window._NLP_STUDY_PLUGIN. PluginInstance(플러그인계약 §3). scoring_mode=self.
 */
(function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var _state = { ctx: null, container: null, mounted: false, editor: null, curId: null, activities: [], saveTimer: null };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function _subject() { return (_state.ctx && _state.ctx.settings && _state.ctx.settings.subject) || 'nlp'; }
  function _lsKey(actId) { return 'clf:nlp-study:' + _subject() + ':' + actId; }

  function _md(text) {
    if (!text) return '';
    try { return window.marked ? window.marked.parse(text) : _esc(text); }
    catch (e) { return _esc(text); }
  }
  function _typeset(el) {
    try { if (window.renderMathInElement) window.renderMathInElement(el, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false
    }); } catch (e) {}
  }

  // CodeMirror 생성(편집 가능). 없으면 textarea 폴백. (coding 플러그인 패턴)
  function _createEditor(target, code) {
    if (typeof window.CodeMirror === 'function') {
      return window.CodeMirror(target, {
        value: code || '', mode: 'python', lineNumbers: true,
        indentUnit: 4, tabSize: 4, lineWrapping: true, theme: 'default'
      });
    }
    var ta = document.createElement('textarea');
    ta.value = code || '';
    ta.style.cssText = 'width:100%;min-height:60vh;font-family:IBM Plex Mono,monospace;font-size:13px;padding:10px;border:1px solid var(--line,#ddd);border-radius:8px;';
    target.appendChild(ta);
    return {
      getValue: function () { return ta.value; },
      setValue: function (v) { ta.value = v; },
      on: function (ev, fn) { if (ev === 'change') ta.addEventListener('input', fn); },
      _ta: ta
    };
  }

  function _destroyEditor() {
    if (!_state.editor) return;
    try {
      if (_state.editor._ta && _state.editor._ta.parentNode) _state.editor._ta.parentNode.removeChild(_state.editor._ta);
      else if (_state.editor.getWrapperElement) {
        var w = _state.editor.getWrapperElement();
        if (w && w.parentNode) w.parentNode.removeChild(w);
      }
    } catch (e) {}
    _state.editor = null;
  }

  function _STYLE() {
    return '<style id="nlp-study-style">' +
      '.nlp-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:10px 4px;border-bottom:1px solid var(--line,#e7e1d6);margin-bottom:14px}' +
      '.nlp-tab{padding:8px 14px;border:1px solid var(--line,#e7e1d6);background:var(--card,#fcfaf5);border-radius:999px;cursor:pointer;font-size:14px;color:var(--ink,#3a3631)}' +
      '.nlp-tab.active{background:var(--accent,#7c8a72);color:#fff;border-color:var(--accent,#7c8a72)}' +
      '.nlp-read{max-width:760px;margin:0 auto;line-height:1.85;font-size:16px;color:var(--ink,#3a3631);padding:8px 12px 90px}' +
      '.nlp-read>h1{font-size:27px;font-weight:700;margin:6px 0 22px;line-height:1.3}' +
      '.nlp-read h2{font-size:21px;font-weight:700;margin:40px 0 12px;padding:0 0 8px;border-bottom:2px solid var(--accent-soft,#e9ede3)}' +
      '.nlp-read h3{font-size:17px;font-weight:600;margin:24px 0 8px;color:var(--accent,#5e6b54)}' +
      '.nlp-read p{margin:11px 0}.nlp-read ul,.nlp-read ol{margin:11px 0;padding-left:22px}.nlp-read li{margin:5px 0}.nlp-read strong{color:#2b2925}' +
      '.nlp-read pre{background:#2e2b27;color:#f3efe6;padding:13px 15px;border-radius:10px;overflow-x:auto;font-size:13px;line-height:1.55;margin:14px 0}' +
      '.nlp-read :not(pre)>code{font-family:IBM Plex Mono,monospace;background:var(--accent-soft,#eef0ea);padding:1px 6px;border-radius:5px;font-size:.9em}' +
      '.nlp-read table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}.nlp-read th,.nlp-read td{border:1px solid var(--line,#e0dacb);padding:7px 11px;text-align:left}.nlp-read th{background:var(--accent-soft,#eef0ea)}' +
      '.nlp-read figure.nlp-fig{margin:24px auto;text-align:center;background:#fff;border:1px solid var(--line,#e7e1d6);border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(80,72,60,.06)}' +
      '.nlp-read figure.nlp-fig svg,.nlp-read figure.nlp-fig img{max-width:100%;height:auto;border-radius:6px}' +
      '.nlp-read figcaption{margin-top:10px;font-size:13px;color:var(--muted,#8c857a)}' +
      '.nlp-read .cbox{margin:14px 0;padding:12px 15px;border-radius:10px;font-size:14.5px;line-height:1.7;border-left:4px solid}' +
      '.nlp-read .cbox-def{background:#eef2f8;border-color:#5b7aa8}.nlp-read .cbox-key{background:#eaf1e6;border-color:#6f8a5c}' +
      '.nlp-read .cbox-warn{background:#faf0db;border-color:#d8a73e}.nlp-read .cbox-ex{background:#f3eef6;border-color:#8a6fa0}' +
      '.nlp-read blockquote{margin:14px 0;padding:10px 16px;border-left:4px solid var(--accent,#7c8a72);background:var(--accent-soft,#eef0ea);border-radius:8px;color:#4a463f}' +
      '.nlp-read a{color:#4a6da0;text-decoration:none;border-bottom:1px solid #cdd8ea}.nlp-read a:hover{border-bottom-color:#4a6da0}' +
      '.nlp-read .explore{display:inline-block;margin:4px 6px 4px 0;padding:6px 12px;background:#eef2f8;border:1px solid #cdd8ea;border-radius:999px;font-size:13px;color:#3a5a8a;border-bottom:1px solid #cdd8ea}' +
      '.nlp-exam-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}' +
      '.nlp-exam-toolbar h3{margin:0;font-size:17px}' +
      '.nlp-btn{padding:7px 13px;border:1px solid var(--line,#d9d2c5);background:var(--card,#fcfaf5);border-radius:9px;cursor:pointer;font-size:13px}' +
      '.nlp-btn:hover{border-color:var(--accent,#7c8a72)}' +
      '.nlp-exam-cols{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start}' +
      '.nlp-exam-code .CodeMirror{height:auto;min-height:62vh;border:1px solid var(--line,#ddd);border-radius:10px;font-size:13px}' +
      '.nlp-exam-q{max-height:74vh;overflow-y:auto;padding-right:4px}' +
      '.nlp-q{border:1px solid var(--line,#e7e1d6);border-radius:10px;padding:10px 12px;margin-bottom:10px;background:var(--card,#fcfaf5)}' +
      '.nlp-q-no{font-size:12px;color:var(--accent,#7c8a72);font-weight:600}' +
      '.nlp-q-text{margin:4px 0 8px;font-size:14px;line-height:1.6;white-space:pre-wrap}' +
      '.nlp-q-ans{margin-top:8px;padding:10px 12px;background:var(--accent-soft,#e9ede3);border-radius:8px;font-size:13.5px;line-height:1.65}' +
      '.nlp-q-ans pre{background:#2e2b27;color:#f3efe6;padding:8px 10px;border-radius:6px;overflow-x:auto}' +
      '@media(max-width:820px){.nlp-exam-cols{grid-template-columns:1fr}}' +
      '</style>';
  }

  function _byId(id) { return _state.activities.filter(function (a) { return a.id === id; })[0] || null; }

  function _setActive(id) {
    _state.curId = id;
    var host = _state.container;
    if (!host) return;
    // 탭 active 갱신
    var tabs = host.querySelectorAll('.nlp-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-act') === id);
    _renderBody(_byId(id));
  }

  function _renderBody(act) {
    var body = _state.container.querySelector('#nlp-body');
    if (!body) return;
    _destroyEditor();
    if (_state.saveTimer) { clearTimeout(_state.saveTimer); _state.saveTimer = null; }
    if (!act) { body.innerHTML = '<p class="text-muted">내용이 없습니다.</p>'; return; }
    if (act.kind === 'reading') _renderReading(body, act);
    else if (act.kind === 'exam') _renderExam(body, act);
    else body.innerHTML = '<p class="text-muted">알 수 없는 항목.</p>';
  }

  function _renderReading(body, act) {
    body.innerHTML = '<div class="nlp-read"></div>';
    var el = body.querySelector('.nlp-read');
    el.innerHTML = _md(act.md);
    _typeset(el);
    body.scrollTop = 0;
  }

  function _renderExam(body, act) {
    body.innerHTML =
      '<div class="nlp-exam">' +
      '  <div class="nlp-exam-toolbar"><h3>' + _esc(act.title || '실전') + '</h3>' +
      '    <button type="button" class="nlp-btn" id="nlp-reset">↺ 초기화</button></div>' +
      '  <div class="nlp-exam-cols">' +
      '    <div class="nlp-exam-code" id="nlp-code"></div>' +
      '    <div class="nlp-exam-q" id="nlp-qlist"></div>' +
      '  </div>' +
      '</div>';

    var saved = null;
    try { saved = localStorage.getItem(_lsKey(act.id)); } catch (e) {}
    var initial = (saved != null) ? saved : (act.starter_code || '');
    _state.editor = _createEditor(body.querySelector('#nlp-code'), initial);

    // 편집 내용 저장(디바운스)
    var save = function () {
      if (_state.saveTimer) clearTimeout(_state.saveTimer);
      _state.saveTimer = setTimeout(function () {
        try { localStorage.setItem(_lsKey(act.id), _state.editor.getValue()); } catch (e) {}
      }, 400);
    };
    if (_state.editor.on) _state.editor.on('change', save);

    // 초기화: 스타터 복원 + 저장삭제 + 답 토글 닫기
    var resetBtn = body.querySelector('#nlp-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (!window.confirm('작성한 답이 모두 지워지고 처음 코드로 돌아갑니다. 계속할까요?')) return;
      _state.editor.setValue(act.starter_code || '');
      try { localStorage.removeItem(_lsKey(act.id)); } catch (e) {}
      var opened = body.querySelectorAll('.nlp-q-ans');
      for (var k = 0; k < opened.length; k++) opened[k].parentNode.removeChild(opened[k]);
      var btns = body.querySelectorAll('.nlp-q .nlp-btn');
      for (var b = 0; b < btns.length; b++) btns[b].textContent = '정답 보기';
    });

    // 우측 문제 목록 + 모범답안 토글
    var qlist = body.querySelector('#nlp-qlist');
    var qs = act.questions || [];
    var html = '';
    for (var i = 0; i < qs.length; i++) {
      html += '<div class="nlp-q" data-qi="' + i + '">' +
        '<div class="nlp-q-no">문제 ' + _esc(qs[i].no != null ? qs[i].no : (i + 1)) + '</div>' +
        '<div class="nlp-q-text">' + _esc(qs[i].q || '') + '</div>' +
        '<button type="button" class="nlp-btn nlp-q-toggle">정답 보기</button>' +
        '</div>';
    }
    qlist.innerHTML = html || '<p class="text-muted">문제가 없습니다.</p>';

    qlist.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.nlp-q-toggle') : null;
      if (!btn) return;
      var card = btn.parentNode;
      var qi = parseInt(card.getAttribute('data-qi'), 10);
      var existing = card.querySelector('.nlp-q-ans');
      if (existing) { existing.parentNode.removeChild(existing); btn.textContent = '정답 보기'; return; }
      var ans = document.createElement('div');
      ans.className = 'nlp-q-ans';
      ans.innerHTML = _md((qs[qi] && qs[qi].answer) || '(모범답안 없음)');
      _typeset(ans);
      card.appendChild(ans);
      btn.textContent = '정답 숨기기';
    });
  }

  /* ── PluginInstance ── */
  function mount(container, ctx) {
    _state.ctx = ctx;
    _state.container = container;
    _state.mounted = true;
    _state.activities = (window.ACTIVITIES && window.ACTIVITIES['nlp-study']) || [];

    var tabs = '';
    for (var i = 0; i < _state.activities.length; i++) {
      var a = _state.activities[i];
      tabs += '<button type="button" class="nlp-tab" data-act="' + _esc(a.id) + '">' + _esc(a.title || a.id) + '</button>';
    }
    container.innerHTML = _STYLE() +
      '<div class="nlp-study">' +
      '  <div class="nlp-tabs">' + (tabs || '<span class="text-muted">콘텐츠 없음</span>') + '</div>' +
      '  <div id="nlp-body"></div>' +
      '</div>';

    var tabEls = container.querySelectorAll('.nlp-tab');
    for (var t = 0; t < tabEls.length; t++) {
      tabEls[t].addEventListener('click', function () { _setActive(this.getAttribute('data-act')); });
    }

    // 초기 선택: hash의 activityId 우선, 없으면 첫 항목
    var initId = null;
    try { var parts = window.location.hash.split('/'); if (parts[2]) initId = decodeURIComponent(parts[2]); } catch (e) {}
    if (!initId || !_byId(initId)) initId = _state.activities.length ? _state.activities[0].id : null;
    if (initId) _setActive(initId);

    return Promise.resolve();
  }

  function unmount() {
    _destroyEditor();
    if (_state.saveTimer) { clearTimeout(_state.saveTimer); _state.saveTimer = null; }
    if (_state.container) _state.container.innerHTML = '';
    _state.mounted = false;
    _state.curId = null;
  }

  function score() { return Promise.resolve({ verdict: 'self', score_raw: null, feedback: '', grader_id: 'nlp-study/self' }); }
  function getProgressSnapshot() { return { plugin_id: 'nlp-study', schema_version: SCHEMA_VERSION, activities: {} }; }
  function onProgressRestored() {}
  function getDashboardContrib() { return { by_area: {}, weakness: [], completion: {}, extra_widgets: [] }; }

  var _instance = {
    mount: mount, unmount: unmount, score: score,
    getProgressSnapshot: getProgressSnapshot, onProgressRestored: onProgressRestored,
    getDashboardContrib: getDashboardContrib
  };
  window._NLP_STUDY_PLUGIN = _instance;
})();
