/**
 * coding / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 — coding 플러그인
 * ────────────────────────────────────────────────────────────
 * 런타임규격 conform (buildflow cycle-2, cycle-3 upgrade).
 *
 * 의존 CDN (index.html에서 shell.js보다 먼저 로드):
 *   CodeMirror 5.x  — codemirror.min.js + codemirror.min.css + mode/python/python.min.js
 *   Pyodide ≥0.26   — mount() 시 lazy loadPyodide(); window._pyodide 싱글턴 캐시
 *
 * 등록 방식 (shell.js _registerPlugins 규칙):
 *   plugin_id = "coding"
 *   → globalKey = "_CODING_PLUGIN"   (camelCase 변환 결과와 direct 결과 동일)
 *   → window._CODING_PLUGIN = instance
 *   shell.js가 window._CODING_PLUGIN을 PLUGIN_REGISTRY['coding']에 삽입.
 *
 * 진도 localStorage 키: clf:coding:* (플러그인계약 §5 규칙)
 * file:// 더블클릭 동작 (fetch 금지, CDN 외 외부 통신 0).
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     Pyodide 싱글턴 관리
  ───────────────────────────────────────────── */
  var _pyodide = null;          // 로드 완료 인스턴스
  var _pyodideLoading = null;   // 진행 중인 Promise (중복 로드 방지)

  /**
   * Pyodide 1회 로드 보장.
   * CDN URL: https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js
   * index.html에서 스크립트 태그로 미리 포함하거나, 없으면 동적 inject.
   * @returns {Promise<Pyodide>}
   */
  function _ensurePyodide() {
    if (_pyodide) return Promise.resolve(_pyodide);
    if (_pyodideLoading) return _pyodideLoading;

    _pyodideLoading = (function () {
      function doLoad() {
        return loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' })
          .then(function (py) {
            _pyodide = py;
            window._pyodide = py; // 전역 캐시 (다른 스크립트 공유 가능)
            // _safe_modules: 케이스 간 오염 방지용 기준 모듈셋 저장
            py.runPython('import sys as _sys; _safe_modules = set(_sys.modules.keys())');
            return py;
          });
      }

      // loadPyodide 전역 함수 존재 여부 확인
      if (typeof loadPyodide === 'function') {
        return doLoad();
      }

      // 없으면 CDN 스크립트 동적 inject
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
        s.onload = function () { doLoad().then(resolve).catch(reject); };
        s.onerror = function () { reject(new Error('Pyodide CDN 로드 실패')); };
        document.head.appendChild(s);
      });
    })();

    return _pyodideLoading;
  }

  /* ─────────────────────────────────────────────
     Pyodide 1케이스 실행 (런타임규격 §3-2)
     stdin 주입 + stdout 캡처 + 5초 타임아웃
  ───────────────────────────────────────────── */
  /**
   * @param {string} code  사용자 코드
   * @param {string} stdin 테스트 케이스 input 문자열
   * @returns {Promise<{stdout:string, error:string|null}>}
   */
  function _runOneCase(code, stdin) {
    var py = _pyodide;

    // 케이스 간 전역 오염 방지: 사용자 정의 모듈 제거 (표준라이브러리 유지)
    try {
      py.runPython(
        'import sys as _sys\n' +
        '[_sys.modules.pop(k) for k in list(_sys.modules.keys()) if k not in _safe_modules]'
      );
    } catch (e) { /* 안전망: 실패해도 계속 */ }

    // stdin 주입 + stdout/stderr 리디렉션 래퍼 코드
    var wrapper =
      'import sys as _sys, io as _io\n' +
      '_sys.stdin  = _io.StringIO(_STDIN_STR)\n' +
      '_sys.stdout = _io.StringIO()\n' +
      '_sys.stderr = _io.StringIO()\n' +
      'try:\n' +
      '    exec(_USER_CODE)\n' +
      'except SystemExit:\n' +
      '    pass\n' +
      '_STDOUT_VAL = _sys.stdout.getvalue()\n' +
      '_STDERR_VAL = _sys.stderr.getvalue()\n';

    // 전역에 변수 주입 (globals.set)
    py.globals.set('_STDIN_STR', stdin);
    py.globals.set('_USER_CODE', code);

    var runPromise = py.runPythonAsync(wrapper).then(function () {
      var out = py.globals.get('_STDOUT_VAL') || '';
      return { stdout: out, error: null };
    }).catch(function (e) {
      // Python 예외: 첫 줄만 반환 (런타임규격 §3-2)
      var msg = String(e.message || e).split('\n')[0];
      return { stdout: '', error: msg };
    });

    var timeoutPromise = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, 5000);
    });

    return Promise.race([runPromise, timeoutPromise]).catch(function (e) {
      if (String(e.message).indexOf('timeout') !== -1) {
        return { stdout: '', error: 'timeout' };
      }
      return { stdout: '', error: String(e.message || e).split('\n')[0] };
    });
  }

  /* ─────────────────────────────────────────────
     채점 (런타임규격 §3-1, §3-3, §3-4)
     stdout-trim: trim(actual) === trim(expected)
     float tolerance: numeric 비교 허용 (1e-6)
  ───────────────────────────────────────────── */
  /**
   * @param {object} activity  ActivitySpec (code-problem)
   * @param {string} code      에디터 현재 코드
   * @returns {Promise<ScoreResult>}
   */
  function _grade(activity, code) {
    var testCases = activity.grading.test_cases;
    var total = testCases.length;
    var passed = 0;
    var firstFail = null;
    var errorMsg = null;

    // 순차 실행 (케이스 간 전역 상태 정리 포함)
    var chain = Promise.resolve();
    testCases.forEach(function (tc, idx) {
      chain = chain.then(function () {
        if (errorMsg === 'timeout') return; // 타임아웃 후 나머지 스킵
        return _runOneCase(code, tc.input).then(function (res) {
          if (res.error === 'timeout') {
            errorMsg = 'timeout';
            if (!firstFail) {
              firstFail = { input: tc.input, expected: tc.expected, actual: '' };
            }
            return;
          }
          if (res.error) {
            // 예외 발생 케이스
            if (!firstFail) {
              firstFail = { input: tc.input, expected: tc.expected, actual: res.stdout };
            }
            if (!errorMsg) errorMsg = res.error;
            return;
          }
          // float tolerance 비교
          var actualTrim = res.stdout.trim();
          var expectedTrim = tc.expected.trim();
          var ok = actualTrim === expectedTrim;
          if (!ok) {
            var af = parseFloat(actualTrim), ef = parseFloat(expectedTrim);
            if (!isNaN(af) && !isNaN(ef) && Math.abs(af - ef) < 1e-6) ok = true;
          }
          if (ok) {
            passed++;
          } else if (!firstFail) {
            firstFail = { input: tc.input, expected: tc.expected, actual: res.stdout };
          }
        });
      });
    });

    return chain.then(function () {
      var verdict = (passed === total && !errorMsg) ? 'correct' : 'incorrect';
      var feedback = {
        passed: passed,
        total: total,
        first_fail: firstFail
      };
      if (errorMsg) feedback.error = errorMsg;

      /** @type {ScoreResult} */
      return {
        verdict: verdict,
        score_raw: total > 0 ? passed / total : 0,
        grader_id: 'pyodide',
        feedback: feedback
      };
    });
  }

  /* ─────────────────────────────────────────────
     진도 localStorage 헬퍼 (키: clf:coding:progress)
  ───────────────────────────────────────────── */
  var PROGRESS_KEY = 'clf:coding:progress';

  function _loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _saveProgress(snap) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(snap)); } catch (e) {}
  }

  /* ─────────────────────────────────────────────
     플러그인 내부 상태
  ───────────────────────────────────────────── */
  var _state = {
    mounted:       false,
    host:          null,   // HTMLElement — #plugin-host
    ctx:           null,   // PluginContext
    activity:      null,   // 현재 ActivitySpec
    activityIndex: 0,      // 현재 활성 activity 인덱스
    editor:        null,   // CodeMirror 인스턴스
    progress:      null,   // PluginProgressSnapshot (메모리 캐시)
    restored:      false   // onProgressRestored 호출됐는지
  };

  /* ─────────────────────────────────────────────
     CodeMirror 에디터 생성 헬퍼
  ───────────────────────────────────────────── */
  /**
   * @param {HTMLElement} target  에디터를 삽입할 컨테이너
   * @param {string}      initialCode
   * @returns {CodeMirror.Editor|object} — CodeMirror 없으면 textarea fallback
   */
  function _createEditor(target, initialCode) {
    if (typeof CodeMirror === 'function') {
      var cm = CodeMirror(target, {
        value:        initialCode || '',
        mode:         'python',
        lineNumbers:  true,
        indentUnit:   4,
        tabSize:      4,
        indentWithTabs: false,
        lineWrapping: true,
        theme:        'default',
        autofocus:    true
      });
      return cm;
    }
    // CodeMirror CDN 미로드 fallback — textarea
    var ta = document.createElement('textarea');
    ta.value = initialCode || '';
    ta.style.cssText = 'width:100%;min-height:200px;font-family:monospace;font-size:14px;padding:8px;border:1px solid var(--line2,#ddd);border-radius:6px;resize:vertical;background:var(--surface,#fff);color:var(--ink,#111)';
    target.appendChild(ta);
    // CodeMirror 호환 미니 래퍼
    return {
      getValue: function () { return ta.value; },
      setValue: function (v) { ta.value = v; }
    };
  }

  /* ─────────────────────────────────────────────
     UI HTML 생성 헬퍼들
  ───────────────────────────────────────────── */

  /** 문제 영역 HTML */
  function _buildProblemHTML(activity) {
    var prompt    = (activity && activity.front && activity.front.prompt) || '(문제 없음)';
    var langLabel = (activity && activity.front && activity.front.language) || 'python';
    return [
      '<div class="coding-problem">',
      '  <div class="coding-lang-badge" style="display:inline-block;padding:2px 8px;border-radius:4px;background:var(--accent,#0550ae);color:#fff;font-size:0.75em;font-weight:700;margin-bottom:8px">' + _esc(langLabel.toUpperCase()) + '</div>',
      '  <div class="coding-prompt" style="white-space:pre-wrap;font-size:0.95em;line-height:1.6;color:var(--ink,#111)">' + _esc(prompt) + '</div>',
      '</div>'
    ].join('\n');
  }

  /** 테스트 케이스 패널 HTML */
  function _buildTestCasesHTML(activity) {
    var tcs = activity && activity.grading && activity.grading.test_cases;
    if (!tcs || !tcs.length) return '';
    var rows = tcs.map(function (tc, i) {
      var inputDisplay = _esc(tc.input).replace(/\n/g, '↵');
      var expectedDisplay = _esc(tc.expected).replace(/\n/g, '↵');
      return '<div style="margin-bottom:6px;padding:8px;background:var(--surface,#fff);border:1px solid var(--line2,#ddd);border-radius:4px;font-size:0.82em;font-family:monospace">' +
        '<span style="color:var(--ink3,#666)">케이스 ' + (i + 1) + '</span>&nbsp;&nbsp;' +
        '<span style="color:var(--ink3,#555)">입력:</span> <code style="background:var(--surface2,#f6f8fa);padding:1px 4px;border-radius:3px">' + inputDisplay + '</code>' +
        '&nbsp;&nbsp;<span style="color:var(--ink3,#555)">기대 출력:</span> <code style="background:var(--surface2,#f6f8fa);padding:1px 4px;border-radius:3px">' + expectedDisplay + '</code>' +
        '</div>';
    }).join('');
    return '<details style="margin-bottom:8px">' +
      '<summary style="cursor:pointer;font-size:0.85em;color:var(--ink3,#666);user-select:none;padding:4px 0">테스트 케이스 ' + tcs.length + '개 보기</summary>' +
      '<div style="margin-top:6px">' + rows + '</div>' +
      '</details>';
  }

  /** 영속 셸 HTML (nav + 편집기 뼈대, activities 배열 기반) */
  function _buildShellHTML(activities) {
    var navHtml = '';
    if (activities.length > 1) {
      var btnHtmls = activities.map(function (act, i) {
        return '<button type="button" class="act-nav-btn" data-act-idx="' + i + '" ' +
          'style="padding:5px 14px;border-radius:6px;border:1px solid var(--line2,#ddd);background:var(--surface,#fff);cursor:pointer;font-size:0.85em;color:var(--ink3,#666);transition:background 0.15s">' +
          _esc(act.activity_id || ('문제 ' + (i + 1))) +
          '</button>';
      }).join('\n');
      navHtml = [
        '<div class="act-nav" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--line2,#eee)">',
        btnHtmls,
        '<span class="act-count" style="margin-left:auto;font-size:0.8em;color:var(--ink3,#888)">1 / ' + activities.length + '</span>',
        '</div>'
      ].join('\n');
    }

    return [
      '<div class="coding-wrap">',

      /* activity nav */
      navHtml,

      /* 문제 영역 (동적) */
      '<div id="coding-problem-area" style="margin-bottom:10px"></div>',

      /* 테스트 케이스 패널 (동적) */
      '<div id="coding-testcases-wrap"></div>',

      /* Pyodide 로딩 표시 */
      '<div class="coding-pyodide-loading" style="font-size:0.85em;color:var(--ink3,#888);margin-bottom:8px">',
      '  ⏳ Python 런타임(Pyodide) 로드 중...',
      '</div>',

      /* 에디터 영역 (에디터 인스턴스 주입됨) */
      '<div class="coding-editor-wrap" style="margin-bottom:8px"></div>',

      /* 버튼 영역 */
      '<div class="coding-actions" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center">',
      '  <button type="button" class="coding-btn-run" disabled',
      '          style="padding:8px 18px;border-radius:6px;border:1px solid var(--line2,#ccc);background:var(--surface,#fff);cursor:pointer">',
      '    실행 <span style="font-size:0.75em;color:var(--ink3,#999)">(Ctrl+Enter)</span>',
      '  </button>',
      '  <button type="button" class="coding-btn-submit" disabled',
      '          style="padding:8px 22px;border-radius:6px;border:none;background:var(--accent,#0550ae);color:#fff;cursor:pointer;font-weight:600">',
      '    제출·채점 <span style="font-size:0.75em;opacity:0.85">(Shift+Enter)</span>',
      '  </button>',
      '  <button type="button" class="coding-btn-solution"',
      '          style="display:none;padding:8px 16px;border-radius:6px;border:1px solid var(--line2,#ccc);background:var(--surface2,#f6f8fa);cursor:pointer;font-size:0.88em;color:var(--ink3,#555)">',
      '    모범 답안 보기',
      '  </button>',
      '</div>',

      /* 실행 출력창 */
      '<pre class="coding-output"',
      '     style="background:var(--surface2,#f6f8fa);border:1px solid var(--line2,#ddd);border-radius:6px;padding:12px;min-height:48px;font-size:0.85em;white-space:pre-wrap;overflow-x:auto;color:var(--ink,#111)">',
      '</pre>',

      /* 채점 결과 */
      '<div class="coding-result" style="min-height:28px"></div>',

      '</div>'
    ].join('\n');
  }

  /* ─────────────────────────────────────────────
     _applyActivity — 문제 영역·에디터·nav 갱신
  ───────────────────────────────────────────── */
  function _applyActivity(container, activities, idx) {
    _state.activityIndex = idx;
    _state.activity = activities[idx] || null;
    var activity = _state.activity;

    // 문제 영역 갱신
    var problemEl = container.querySelector('#coding-problem-area');
    if (problemEl) problemEl.innerHTML = _buildProblemHTML(activity);

    // 테스트 케이스 패널 갱신
    var tcEl = container.querySelector('#coding-testcases-wrap');
    if (tcEl) tcEl.innerHTML = _buildTestCasesHTML(activity);

    // 에디터 코드 갱신 (진도에 저장된 코드 우선)
    if (_state.editor && activity) {
      var code = (activity.front && activity.front.starter_code) || '';
      var saved = _state.progress && _state.progress.activities && _state.progress.activities[activity.activity_id];
      if (saved && saved.plugin_extra && saved.plugin_extra.last_code) code = saved.plugin_extra.last_code;
      _state.editor.setValue(code);
    }

    // 출력·결과 초기화, solution 버튼 숨기기
    var outputEl = container.querySelector('.coding-output');
    var resultEl = container.querySelector('.coding-result');
    var solBtn   = container.querySelector('.coding-btn-solution');
    if (outputEl) outputEl.textContent = '';
    if (resultEl) resultEl.innerHTML = '';
    if (solBtn)   solBtn.style.display = 'none';

    // nav 버튼 활성 상태 + completion badge 갱신
    var actBtns = container.querySelectorAll('.act-nav-btn');
    for (var i = 0; i < actBtns.length; i++) {
      var btn = actBtns[i];
      var isActive = (i === idx);
      var act = activities[i];
      var saved2 = act && _state.progress && _state.progress.activities && _state.progress.activities[act.activity_id];
      var done = saved2 && saved2.last_verdict === 'correct';
      btn.style.background   = isActive ? 'var(--accent,#0550ae)' : 'var(--surface,#fff)';
      btn.style.color        = isActive ? '#fff' : (done ? 'var(--ok,#22863a)' : 'var(--ink3,#666)');
      btn.style.borderColor  = isActive ? 'var(--accent,#0550ae)' : (done ? 'var(--ok,#22863a)' : 'var(--line2,#ddd)');
      // completion badge
      var label = act ? (act.activity_id || ('문제 ' + (i + 1))) : ('문제 ' + (i + 1));
      btn.textContent = done ? label + ' ✓' : label;
      btn.title = done ? '완료 ✓' : '';
    }

    // 카운트 표시 갱신
    var countEl = container.querySelector('.act-count');
    if (countEl) countEl.textContent = (idx + 1) + ' / ' + activities.length;
  }

  /* ─────────────────────────────────────────────
     mount() — UI 주입 (런타임규격 §4-1)
  ───────────────────────────────────────────── */
  /**
   * @param {HTMLElement}   container  #plugin-host
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  function mount(container, ctx) {
    // 이미 마운트된 경우 먼저 정리
    if (_state.mounted) unmount();

    _state.host    = container;
    _state.ctx     = ctx;
    _state.mounted = true;

    // activities 목록 취득 (window.ACTIVITIES['coding'])
    var activities = (window.ACTIVITIES && window.ACTIVITIES['coding']) || [];

    // 초기 activityIndex: URL hash에서 activityId 매칭 시도
    var initIdx = 0;
    try {
      var hashParts = window.location.hash.split('/');
      var hashActId = hashParts[2] || '';
      if (hashActId) {
        for (var hi = 0; hi < activities.length; hi++) {
          if (activities[hi].activity_id === hashActId) { initIdx = hi; break; }
        }
      }
    } catch (e) { /* hash 파싱 실패 무시 */ }

    // 셸 HTML 주입
    container.innerHTML = _buildShellHTML(activities);

    var editorWrap = container.querySelector('.coding-editor-wrap');
    var outputEl   = container.querySelector('.coding-output');
    var runBtn     = container.querySelector('.coding-btn-run');
    var submitBtn  = container.querySelector('.coding-btn-submit');
    var loadingEl  = container.querySelector('.coding-pyodide-loading');
    var resultEl   = container.querySelector('.coding-result');
    var solBtn     = container.querySelector('.coding-btn-solution');

    // 에디터 1회 생성 (스위치 시 재사용)
    _state.editor = _createEditor(editorWrap, '');

    // activity 적용 (문제·테스트케이스·에디터코드 초기화)
    _applyActivity(container, activities, initIdx);

    // nav 버튼 이벤트 바인딩
    var actBtns = container.querySelectorAll('.act-nav-btn');
    for (var bi = 0; bi < actBtns.length; bi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var newIdx = parseInt(btn.getAttribute('data-act-idx'), 10);
          if (!isNaN(newIdx)) _applyActivity(container, activities, newIdx);
        });
      })(actBtns[bi]);
    }

    // Pyodide 백그라운드 프리로드
    if (loadingEl) loadingEl.removeAttribute('hidden');
    _ensurePyodide().then(function () {
      if (loadingEl) loadingEl.setAttribute('hidden', '');
      if (runBtn)    runBtn.disabled    = false;
      if (submitBtn) submitBtn.disabled = false;
    }).catch(function (e) {
      if (loadingEl) loadingEl.textContent = 'Pyodide 로드 실패: ' + e.message;
    });

    /* ── 키보드 단축키 (컨테이너 keydown) ── */
    container.addEventListener('keydown', function (e) {
      if (e.ctrlKey && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        var rb = container.querySelector('.coding-btn-run');
        if (rb && !rb.disabled) rb.click();
      } else if (e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        var sb = container.querySelector('.coding-btn-submit');
        if (sb && !sb.disabled) sb.click();
      }
    });

    /* ── Run 버튼: 제출 없이 실행만 (stdout 출력) ── */
    if (runBtn) {
      runBtn.disabled = true; // Pyodide 로드 전 비활성
      runBtn.addEventListener('click', function () {
        if (!_pyodide) {
          _showOutput(outputEl, '⏳ Pyodide 로드 중... 잠시 후 다시 시도하세요.');
          return;
        }
        var code = _state.editor.getValue();
        _showOutput(outputEl, '실행 중...');
        _runOneCase(code, '').then(function (res) {
          _showOutput(outputEl, res.error ? ('오류: ' + res.error) : (res.stdout || '(출력 없음)'));
        });
      });
    }

    /* ── Submit 버튼: 채점 실행 ── */
    if (submitBtn) {
      submitBtn.disabled = true; // Pyodide 로드 전 비활성
      submitBtn.addEventListener('click', function () {
        if (!_state.activity) {
          _showResult(resultEl, null, '문제가 로드되지 않았습니다.');
          return;
        }
        if (!_pyodide) {
          _showResult(resultEl, null, 'Pyodide 로드 중... 잠시 후 다시 시도하세요.');
          return;
        }
        var code = _state.editor.getValue();
        var activity = _state.activity;
        _showResult(resultEl, null, '채점 중...');
        // score() 호출
        score({ code: code }).then(function (result) {
          _showResult(resultEl, result, null);
          // solution 버튼: back에 내용이 있으면 표시
          if (solBtn && activity.back && (activity.back.solution || activity.back.explanation)) {
            solBtn.style.display = 'inline-block';
          }
          // 진도 자동 저장 (emit → shell이 getProgressSnapshot 호출)
          ctx.emit({ type: 'activity-completed', result: result });
          // nav badge 갱신 (verdict 반영)
          _applyActivityNavOnly(container, activities, _state.activityIndex);
        }).catch(function (e) {
          _showResult(resultEl, null, '채점 오류: ' + e.message);
        });
      });
    }

    /* ── Solution 버튼: 모범 답안·해설 표시 ── */
    if (solBtn) {
      solBtn.addEventListener('click', function () {
        var activity = _state.activity;
        if (!activity || !activity.back) return;
        var re = container.querySelector('.coding-result');
        var html = '<div style="margin-top:8px;padding:12px;background:var(--surface2,#f6f8fa);border-radius:6px;border:1px solid var(--line2,#ddd)">';
        if (activity.back.solution) {
          html += '<div style="font-size:0.82rem;color:var(--ink3,#666);margin-bottom:6px">모범 답안:</div>' +
            '<pre style="margin:0;padding:10px;background:#1e1e1e;color:#d4d4d4;border-radius:4px;font-size:0.85em;overflow-x:auto;white-space:pre-wrap">' +
            _esc(activity.back.solution) + '</pre>';
        }
        if (activity.back.explanation) {
          html += '<div style="margin-top:8px;font-size:0.87rem;color:var(--ink2,#444)"><strong>해설:</strong> ' +
            _esc(activity.back.explanation) + '</div>';
        }
        html += '</div>';
        if (re) re.innerHTML += html;
        solBtn.style.display = 'none';
      });
    }

    return Promise.resolve();
  }

  /**
   * nav 버튼 badge만 갱신 (submit 후 verdict 반영용, 에디터/문제 건드리지 않음)
   */
  function _applyActivityNavOnly(container, activities, idx) {
    var actBtns = container.querySelectorAll('.act-nav-btn');
    for (var i = 0; i < actBtns.length; i++) {
      var btn = actBtns[i];
      var isActive = (i === idx);
      var act = activities[i];
      var saved2 = act && _state.progress && _state.progress.activities && _state.progress.activities[act.activity_id];
      var done = saved2 && saved2.last_verdict === 'correct';
      btn.style.background   = isActive ? 'var(--accent,#0550ae)' : 'var(--surface,#fff)';
      btn.style.color        = isActive ? '#fff' : (done ? 'var(--ok,#22863a)' : 'var(--ink3,#666)');
      btn.style.borderColor  = isActive ? 'var(--accent,#0550ae)' : (done ? 'var(--ok,#22863a)' : 'var(--line2,#ddd)');
      var label = act ? (act.activity_id || ('문제 ' + (i + 1))) : ('문제 ' + (i + 1));
      btn.textContent = done ? label + ' ✓' : label;
      btn.title = done ? '완료 ✓' : '';
    }
  }

  /* ─────────────────────────────────────────────
     unmount()
  ───────────────────────────────────────────── */
  function unmount() {
    if (_state.host) _state.host.innerHTML = '';
    _state.mounted        = false;
    _state.host           = null;
    _state.ctx            = null;
    _state.editor         = null;
    _state.activity       = null;
    _state.activityIndex  = 0;
  }

  /* ─────────────────────────────────────────────
     score(userAnswer) — 채점 (플러그인계약 §3)
     런타임규격 §3-1~§3-4 conform
  ───────────────────────────────────────────── */
  /**
   * @param {{code: string}} userAnswer
   * @returns {Promise<ScoreResult>}
   */
  function score(userAnswer) {
    var code     = (userAnswer && userAnswer.code) || '';
    var activity = _state.activity;

    if (!activity) {
      return Promise.resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'pyodide',
        feedback:  { passed: 0, total: 0, first_fail: null, error: '문제 없음' }
      });
    }

    return _ensurePyodide().then(function () {
      return _grade(activity, code);
    }).then(function (result) {
      // 진도 캐시 업데이트 (emit은 mount의 submitBtn 핸들러가 처리)
      _updateProgress(activity.activity_id, code, result);
      return result;
    });
  }

  /* ─────────────────────────────────────────────
     getProgressSnapshot() (런타임규격 §4-3)
  ───────────────────────────────────────────── */
  /**
   * @returns {PluginProgressSnapshot}
   */
  function getProgressSnapshot() {
    if (!_state.progress) {
      _state.progress = {
        plugin_id:       'coding',
        schema_version:  1,
        activities:      {}
      };
    }
    return _state.progress;
  }

  /* ─────────────────────────────────────────────
     onProgressRestored(snapshot) (플러그인계약 §3)
  ───────────────────────────────────────────── */
  function onProgressRestored(snapshot) {
    if (!snapshot) return;
    _state.progress = snapshot;
    _state.restored = true;

    // 이미 마운트된 상태에서 복원 호출된 경우 에디터 코드 갱신
    if (_state.mounted && _state.editor && _state.activity) {
      var actId = _state.activity.activity_id;
      var saved = snapshot.activities && snapshot.activities[actId];
      if (saved && saved.plugin_extra && saved.plugin_extra.last_code) {
        _state.editor.setValue(saved.plugin_extra.last_code);
      }
    }
  }

  /* ─────────────────────────────────────────────
     getDashboardContrib() — 기본 집계 (선택 구현)
     플러그인계약 §4 DashboardContrib: null 반환시 셸 기본집계 사용
  ───────────────────────────────────────────── */
  function getDashboardContrib() {
    var snap = getProgressSnapshot();
    var acts = snap.activities || {};
    var actIds = Object.keys(acts);

    if (!actIds.length) return null;

    // by_area: activity tags 기준 집계
    var areaMap = {};
    actIds.forEach(function (id) {
      var a = acts[id];
      var activity = _findActivity(id);
      if (!activity) return;
      var key = activity.tags.area + '||' + activity.tags.subarea;
      if (!areaMap[key]) {
        areaMap[key] = {
          area:    activity.tags.area,
          subarea: activity.tags.subarea,
          correct: 0,
          total:   0
        };
      }
      areaMap[key].total++;
      if (a.last_verdict === 'correct') areaMap[key].correct++;
    });

    var byArea = Object.keys(areaMap).map(function (k) {
      var r = areaMap[k];
      return {
        area:           r.area,
        subarea:        r.subarea,
        retrieval_rate: r.total ? r.correct / r.total : null
      };
    });

    // weakness: retrieval_rate < 0.5 인 unit
    var weakness = [];
    actIds.forEach(function (id) {
      var a = acts[id];
      if (a.cold_attempts < 1) return;
      var activity = _findActivity(id);
      if (!activity) return;
      var rate = a.cold_attempts ? (a.cold_attempts - a.cold_correct) / a.cold_attempts : 0;
      if (rate > 0) {
        weakness.push({
          area:       activity.tags.area,
          subarea:    activity.tags.subarea,
          unit:       activity.tags.unit,
          wrong_rate: rate
        });
      }
    });
    weakness.sort(function (a, b) { return b.wrong_rate - a.wrong_rate; });

    // completion: mastery_rate = cold_correct / total activities per area
    var completion = byArea.map(function (r) {
      return {
        area:         r.area,
        subarea:      r.subarea,
        mastery_rate: r.retrieval_rate != null ? r.retrieval_rate : 0,
        box_dist:     { box1: 0, box2: 0, box3: 0 } // coding은 Leitner 없음
      };
    });

    return {
      plugin_id:    'coding',
      by_area:      byArea,
      weakness:     weakness,
      pass_path:    [],
      completion:   completion,
      extra_widgets: []
    };
  }

  /* ─────────────────────────────────────────────
     내부 헬퍼
  ───────────────────────────────────────────── */

  /** 진도 캐시 업데이트 */
  function _updateProgress(activityId, code, result) {
    var snap = getProgressSnapshot();
    if (!snap.activities[activityId]) {
      snap.activities[activityId] = {
        cold_attempts: 0,
        cold_correct:  0,
        last_verdict:  null,
        plugin_extra:  { last_code: '', passed: 0, total: 0 }
      };
    }
    var entry = snap.activities[activityId];
    entry.cold_attempts++;
    if (result.verdict === 'correct') entry.cold_correct++;
    entry.last_verdict = result.verdict;
    entry.plugin_extra = {
      last_code: code,
      passed:    result.feedback.passed,
      total:     result.feedback.total
    };
    _state.progress = snap;
    _saveProgress(snap);
  }

  /** window.ACTIVITIES['coding']에서 activityId 검색 */
  function _findActivity(activityId) {
    var list = (window.ACTIVITIES && window.ACTIVITIES['coding']) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].activity_id === activityId) return list[i];
    }
    return null;
  }

  /** 출력창 텍스트 갱신 */
  function _showOutput(el, text) {
    if (!el) return;
    el.textContent = text;
  }

  /** 채점 결과 렌더 */
  function _showResult(el, result, message) {
    if (!el) return;
    if (message) { el.innerHTML = '<span style="color:var(--ink3,#666)">' + _esc(message) + '</span>'; return; }
    if (!result) return;

    var verdictColor = result.verdict === 'correct' ? 'var(--ok,#22863a)' : 'var(--hot,#d73a49)';
    var verdictLabel = result.verdict === 'correct' ? '정답' : '오답';
    var fb = result.feedback;
    var html = '<div style="margin-top:8px">' +
      '<strong style="color:' + verdictColor + '">' + verdictLabel + '</strong>' +
      ' <span style="color:var(--ink3,#666);font-size:0.9em">(' + fb.passed + '/' + fb.total + ' 케이스 통과)</span>';

    if (fb.error) {
      html += '<div style="color:var(--hot,#d73a49);font-size:0.85em;margin-top:4px">오류: ' + _esc(fb.error) + '</div>';
    }
    if (fb.first_fail) {
      html += '<div style="font-size:0.85em;margin-top:6px;color:var(--ink3,#666)">' +
        '첫 실패 케이스 · 입력: <code>' + _esc(fb.first_fail.input) + '</code>' +
        ' / 기대: <code>' + _esc(fb.first_fail.expected.trim()) + '</code>' +
        ' / 실제: <code>' + _esc(fb.first_fail.actual.trim()) + '</code>' +
        '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  /** HTML 이스케이프 */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────
     PluginInstance 객체 조립
  ───────────────────────────────────────────── */
  var _instance = {
    mount:                mount,
    unmount:              unmount,
    score:                score,
    getProgressSnapshot:  getProgressSnapshot,
    onProgressRestored:   onProgressRestored,
    getDashboardContrib:  getDashboardContrib
  };

  /* ─────────────────────────────────────────────
     shell.js 등록 규칙 준수 (_registerPlugins 참조)
     plugin_id = "coding"
     globalKey  = "_CODING_PLUGIN"
     directKey  = "_CODING_PLUGIN"  (동일)
  ───────────────────────────────────────────── */
  window._CODING_PLUGIN = _instance;

})();
