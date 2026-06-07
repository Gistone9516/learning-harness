/**
 * coding / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 — coding 플러그인
 * ────────────────────────────────────────────────────────────
 * 런타임규격 conform (buildflow cycle-2, cycle-3 upgrade, cycle-4 mid).
 *
 * 의존 CDN (index.html에서 shell.js보다 먼저 로드):
 *   CodeMirror 5.x  — codemirror.min.js + codemirror.min.css + mode/python/python.min.js
 *   Pyodide ≥0.26   — mount() 시 lazy loadPyodide(); window._pyodide 싱글턴 캐시
 *
 * mid 기능 (cycle-4):
 *   - matplotlib 플롯 렌더링: agg 백엔드 + base64 PNG → <img> 출력
 *   - 문제 태그별 네비 필터: area/subarea 드롭다운
 *   - 풀이 시간 수집 (solve_ms): mount→score 경과 시간 기록·표시
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
     [mid] matplotlib agg 백엔드 지원: plot_b64 반환
  ───────────────────────────────────────────── */
  /**
   * @param {string} code  사용자 코드
   * @param {string} stdin 테스트 케이스 input 문자열
   * @param {boolean} [captureplot]  true이면 matplotlib figure를 base64 PNG로 캡처
   * @returns {Promise<{stdout:string, error:string|null, plot_b64:string|null}>}
   */
  function _runOneCase(code, stdin, captureplot) {
    var py = _pyodide;

    // 케이스 간 전역 오염 방지: 사용자 정의 모듈 제거 (표준라이브러리 유지)
    try {
      py.runPython(
        'import sys as _sys\n' +
        '[_sys.modules.pop(k) for k in list(_sys.modules.keys()) if k not in _safe_modules]'
      );
    } catch (e) { /* 안전망: 실패해도 계속 */ }

    // [mid] matplotlib agg 설정 코드 (matplotlib이 import되는 경우 agg 강제)
    var mplSetup = captureplot
      ? 'try:\n' +
        '    import matplotlib as _mpl\n' +
        '    _mpl.use("agg")\n' +
        'except Exception:\n' +
        '    pass\n'
      : '';

    // stdin 주입 + stdout/stderr 리디렉션 래퍼 코드
    var wrapper =
      mplSetup +
      'import sys as _sys, io as _io\n' +
      '_sys.stdin  = _io.StringIO(_STDIN_STR)\n' +
      '_sys.stdout = _io.StringIO()\n' +
      '_sys.stderr = _io.StringIO()\n' +
      '_PLOT_B64 = ""\n' +
      'try:\n' +
      '    exec(_USER_CODE)\n' +
      'except SystemExit:\n' +
      '    pass\n' +
      '_STDOUT_VAL = _sys.stdout.getvalue()\n' +
      '_STDERR_VAL = _sys.stderr.getvalue()\n';

    // [mid] matplotlib 플롯 캡처: exec 후 열린 figure를 base64 PNG로 저장
    var mplCapture = captureplot
      ? 'try:\n' +
        '    import matplotlib.pyplot as _plt, base64 as _b64, io as _bio\n' +
        '    _figs = _plt.get_fignums()\n' +
        '    if _figs:\n' +
        '        _buf = _bio.BytesIO()\n' +
        '        _plt.savefig(_buf, format="png", bbox_inches="tight", dpi=96)\n' +
        '        _buf.seek(0)\n' +
        '        _PLOT_B64 = _b64.b64encode(_buf.read()).decode("ascii")\n' +
        '        _plt.close("all")\n' +
        'except Exception:\n' +
        '    pass\n'
      : '';

    // 전역에 변수 주입 (globals.set)
    py.globals.set('_STDIN_STR', stdin);
    py.globals.set('_USER_CODE', code);

    var runPromise = py.runPythonAsync(wrapper + mplCapture).then(function () {
      var out   = py.globals.get('_STDOUT_VAL') || '';
      var pb64  = captureplot ? (py.globals.get('_PLOT_B64') || '') : '';
      return { stdout: out, error: null, plot_b64: pb64 || null };
    }).catch(function (e) {
      // Python 예외: 첫 줄만 반환 (런타임규격 §3-2)
      var msg = String(e.message || e).split('\n')[0];
      return { stdout: '', error: msg, plot_b64: null };
    });

    var timeoutPromise = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, 5000);
    });

    return Promise.race([runPromise, timeoutPromise]).catch(function (e) {
      if (String(e.message).indexOf('timeout') !== -1) {
        return { stdout: '', error: 'timeout', plot_b64: null };
      }
      return { stdout: '', error: String(e.message || e).split('\n')[0], plot_b64: null };
    });
  }

  /* ─────────────────────────────────────────────
     [mid] matplotlib 플롯 렌더링 헬퍼
     실행전용(Run) 버튼에서만 사용 — 채점 케이스에는 미적용
  ───────────────────────────────────────────── */
  /**
   * allowed_packages에 matplotlib이 포함된 activity인지 확인
   * @param {object} activity
   * @returns {boolean}
   */
  function _hasMplPackage(activity) {
    var pkgs = activity && activity.grading && activity.grading.allowed_packages;
    if (!Array.isArray(pkgs)) return false;
    return pkgs.some(function (p) { return p && p.toLowerCase().indexOf('matplotlib') !== -1; });
  }

  /* ─────────────────────────────────────────────
     비교 헬퍼 (런타임규격 §3-3)
     compare = "stdout-trim"       : trim 후 exact match
     compare = "stdout-float-tol"  : 숫자 토큰별 tolerance 비교
       tolerance: activity.grading.tolerance (기본 1e-6)
  ───────────────────────────────────────────── */
  /**
   * @param {string} actual
   * @param {string} expected
   * @param {string} compare      "stdout-trim" | "stdout-float-tol"
   * @param {number} [tolerance]  stdout-float-tol 전용, 기본 1e-6
   * @returns {boolean}
   */
  function _compare(actual, expected, compare, tolerance) {
    var a = actual.trim();
    var e = expected.trim();
    if (compare === 'stdout-float-tol') {
      var tol = (tolerance != null) ? tolerance : 1e-6;
      var aLines = a.split('\n');
      var eLines = e.split('\n');
      if (aLines.length !== eLines.length) return false;
      for (var li = 0; li < eLines.length; li++) {
        var aToks = aLines[li].trim().split(/\s+/);
        var eToks = eLines[li].trim().split(/\s+/);
        if (aToks.length !== eToks.length) return false;
        for (var ti = 0; ti < eToks.length; ti++) {
          var af2 = parseFloat(aToks[ti]);
          var ef2 = parseFloat(eToks[ti]);
          if (isNaN(af2) || isNaN(ef2)) {
            if (aToks[ti] !== eToks[ti]) return false;
          } else {
            if (Math.abs(af2 - ef2) > tol) return false;
          }
        }
      }
      return true;
    }
    // 기본: stdout-trim (exact match after trim)
    return a === e;
  }

  /* ─────────────────────────────────────────────
     채점 (런타임규격 §3-1, §3-3, §3-4)
     ScoreResult.feedback.cases[] — 전체 케이스 결과 배열
  ───────────────────────────────────────────── */
  /**
   * @param {object} activity  ActivitySpec (code-problem)
   * @param {string} code      에디터 현재 코드
   * @returns {Promise<ScoreResult>}
   */
  function _grade(activity, code) {
    var testCases = activity.grading.test_cases;
    var compare   = activity.grading.compare || 'stdout-trim';
    var tolerance = activity.grading.tolerance;
    var total = testCases.length;
    var passed = 0;
    var firstFail = null;
    var errorMsg = null;
    var cases = [];  // 전체 케이스 결과 배열 (feedback.cases[])

    // 순차 실행 (케이스 간 전역 상태 정리 포함)
    var chain = Promise.resolve();
    testCases.forEach(function (tc, idx) {
      chain = chain.then(function () {
        if (errorMsg === 'timeout') {
          // 타임아웃 후 나머지: skipped로 기록
          cases.push({ idx: idx, input: tc.input, expected: tc.expected, actual: '', pass: false, error: 'skipped' });
          return;
        }
        return _runOneCase(code, tc.input).then(function (res) {
          if (res.error === 'timeout') {
            errorMsg = 'timeout';
            if (!firstFail) {
              firstFail = { idx: idx, input: tc.input, expected: tc.expected, actual: '' };
            }
            cases.push({ idx: idx, input: tc.input, expected: tc.expected, actual: '', pass: false, error: 'timeout' });
            return;
          }
          if (res.error) {
            if (!firstFail) {
              firstFail = { idx: idx, input: tc.input, expected: tc.expected, actual: res.stdout };
            }
            if (!errorMsg) errorMsg = res.error;
            cases.push({ idx: idx, input: tc.input, expected: tc.expected, actual: res.stdout, pass: false, error: res.error });
            return;
          }
          var ok = _compare(res.stdout, tc.expected, compare, tolerance);
          if (ok) {
            passed++;
          } else if (!firstFail) {
            firstFail = { idx: idx, input: tc.input, expected: tc.expected, actual: res.stdout };
          }
          cases.push({ idx: idx, input: tc.input, expected: tc.expected, actual: res.stdout, pass: ok });
        });
      });
    });

    return chain.then(function () {
      var verdict = (passed === total && !errorMsg) ? 'correct' : 'incorrect';
      var feedback = {
        passed:     passed,
        total:      total,
        first_fail: firstFail,
        cases:      cases        // 전체 케이스 결과 배열
      };
      if (errorMsg) feedback.error = errorMsg;

      /** @type {ScoreResult} */
      return {
        verdict:   verdict,
        score_raw: total > 0 ? passed / total : 0,
        grader_id: 'pyodide',
        feedback:  feedback
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
    mounted:        false,
    host:           null,   // HTMLElement — #plugin-host
    ctx:            null,   // PluginContext
    activity:       null,   // 현재 ActivitySpec
    activityIndex:  0,      // 현재 활성 activity 인덱스
    editor:         null,   // CodeMirror 인스턴스
    progress:       null,   // PluginProgressSnapshot (메모리 캐시)
    restored:       false,  // onProgressRestored 호출됐는지
    mountTime:      0,      // [mid] 풀이 시간: mount() 호출 시각 (Date.now())
    filterArea:     '',     // [mid] 태그 필터: 현재 선택 area (''=전체)
    filterSubarea:  ''      // [mid] 태그 필터: 현재 선택 subarea (''=전체)
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

  /* ─────────────────────────────────────────────
     [mid] 태그 필터: activities에서 area/subarea 목록 수집
  ───────────────────────────────────────────── */
  function _collectTags(activities) {
    var areaSet = {}, subareaByArea = {};
    (activities || []).forEach(function (act) {
      var tags = act && act.tags;
      if (!tags) return;
      if (tags.area)    areaSet[tags.area] = true;
      if (tags.area && tags.subarea) {
        if (!subareaByArea[tags.area]) subareaByArea[tags.area] = {};
        subareaByArea[tags.area][tags.subarea] = true;
      }
    });
    return {
      areas:          Object.keys(areaSet).sort(),
      subareaByArea:  subareaByArea
    };
  }

  /** 영속 셸 HTML (nav + 태그 필터 + 편집기 뼈대, activities 배열 기반) */
  function _buildShellHTML(activities) {
    var navHtml = '';
    if (activities.length > 0) {
      var btnHtmls = activities.map(function (act, i) {
        return '<button type="button" class="act-nav-btn" data-act-idx="' + i + '" ' +
          'style="padding:5px 14px;border-radius:6px;border:1px solid var(--line2,#ddd);background:var(--surface,#fff);cursor:pointer;font-size:0.85em;color:var(--ink3,#666);transition:background 0.15s">' +
          _esc(act.activity_id || ('문제 ' + (i + 1))) +
          '</button>';
      }).join('\n');

      // [mid] 태그 필터 드롭다운 (activities 2개 이상일 때만 표시)
      var filterHtml = '';
      if (activities.length > 1) {
        var tags = _collectTags(activities);
        var areaOptions = '<option value="">전체 영역</option>' +
          tags.areas.map(function (a) { return '<option value="' + _esc(a) + '">' + _esc(a) + '</option>'; }).join('');
        filterHtml = [
          '<div class="act-tag-filter" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">',
          '  <select class="act-filter-area" style="padding:3px 8px;border-radius:5px;border:1px solid var(--line2,#ddd);background:var(--surface,#fff);font-size:0.82em;color:var(--ink3,#555);cursor:pointer">',
          '    ' + areaOptions,
          '  </select>',
          '  <select class="act-filter-subarea" style="padding:3px 8px;border-radius:5px;border:1px solid var(--line2,#ddd);background:var(--surface,#fff);font-size:0.82em;color:var(--ink3,#555);cursor:pointer">',
          '    <option value="">전체 세부</option>',
          '  </select>',
          '  <span class="act-filter-count" style="font-size:0.78em;color:var(--ink3,#999)"></span>',
          '</div>'
        ].join('\n');
      }

      navHtml = [
        '<div class="act-nav-wrap">',
        filterHtml,
        '<div class="act-nav" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--line2,#eee)">',
        btnHtmls,
        '<span class="act-count" style="margin-left:auto;font-size:0.8em;color:var(--ink3,#888)">1 / ' + activities.length + '</span>',
        '</div>',
        '</div>'
      ].join('\n');
    }

    return [
      '<div class="coding-wrap">',

      /* activity nav + 태그 필터 */
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
      /* [mid] 풀이 시간 표시 (제출 후 표시됨) */
      '  <span class="coding-solve-time" style="display:none;font-size:0.82em;color:var(--ink3,#888);margin-left:4px"></span>',
      '</div>',

      /* 실행 출력창 */
      '<pre class="coding-output"',
      '     style="background:var(--surface2,#f6f8fa);border:1px solid var(--line2,#ddd);border-radius:6px;padding:12px;min-height:48px;font-size:0.85em;white-space:pre-wrap;overflow-x:auto;color:var(--ink,#111)">',
      '</pre>',

      /* [mid] matplotlib 플롯 출력 영역 */
      '<div class="coding-plot-output" style="display:none;margin-top:6px;text-align:center"></div>',

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

    // [mid] 풀이 시간 타이머 리셋 (문제 전환 시 새 시작)
    _state.mountTime = Date.now();

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

    // 출력·결과·플롯 초기화, solution 버튼·시간표시 숨기기
    var outputEl  = container.querySelector('.coding-output');
    var resultEl  = container.querySelector('.coding-result');
    var solBtn    = container.querySelector('.coding-btn-solution');
    var plotEl    = container.querySelector('.coding-plot-output');
    var timeEl    = container.querySelector('.coding-solve-time');
    if (outputEl) outputEl.textContent = '';
    if (resultEl) resultEl.innerHTML = '';
    if (solBtn)   solBtn.style.display = 'none';
    if (plotEl)   { plotEl.innerHTML = ''; plotEl.style.display = 'none'; }
    if (timeEl)   timeEl.style.display = 'none';

    // nav 버튼 활성 상태 + completion badge 갱신 (필터 고려)
    _applyNavFilter(container, activities, idx);
  }

  /* ─────────────────────────────────────────────
     [mid] _applyNavFilter — 태그 필터 적용 후 nav 버튼 visibility 갱신
  ───────────────────────────────────────────── */
  function _applyNavFilter(container, activities, activeIdx) {
    var filterArea    = _state.filterArea    || '';
    var filterSubarea = _state.filterSubarea || '';

    var actBtns = container.querySelectorAll('.act-nav-btn');
    var visibleCount = 0;
    var firstVisibleIdx = -1;

    for (var i = 0; i < actBtns.length; i++) {
      var btn = actBtns[i];
      var isActive = (i === activeIdx);
      var act = activities[i];
      var saved2 = act && _state.progress && _state.progress.activities && _state.progress.activities[act && act.activity_id];
      var done = saved2 && saved2.last_verdict === 'correct';

      // 필터 매칭
      var tags = act && act.tags;
      var matchArea    = !filterArea    || (tags && tags.area    === filterArea);
      var matchSub     = !filterSubarea || (tags && tags.subarea === filterSubarea);
      var visible      = matchArea && matchSub;

      btn.style.display = visible ? '' : 'none';
      if (visible) {
        visibleCount++;
        if (firstVisibleIdx < 0) firstVisibleIdx = i;
      }

      btn.style.background   = isActive ? 'var(--accent,#0550ae)' : 'var(--surface,#fff)';
      btn.style.color        = isActive ? '#fff' : (done ? 'var(--ok,#22863a)' : 'var(--ink3,#666)');
      btn.style.borderColor  = isActive ? 'var(--accent,#0550ae)' : (done ? 'var(--ok,#22863a)' : 'var(--line2,#ddd)');
      var label = act ? (act.activity_id || ('문제 ' + (i + 1))) : ('문제 ' + (i + 1));
      btn.textContent = done ? label + ' ✓' : label;
      btn.title = done ? '완료 ✓' : '';
    }

    // 카운트·필터 카운트 갱신
    var countEl  = container.querySelector('.act-count');
    var fcountEl = container.querySelector('.act-filter-count');
    if (countEl) countEl.textContent = (activeIdx + 1) + ' / ' + activities.length;
    if (fcountEl) {
      fcountEl.textContent = (filterArea || filterSubarea)
        ? visibleCount + '개 표시'
        : '';
    }
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

    _state.host          = container;
    _state.ctx           = ctx;
    _state.mounted       = true;
    _state.mountTime     = Date.now();   // [mid] 풀이 시간 타이머 시작
    _state.filterArea    = '';           // [mid] 필터 리셋
    _state.filterSubarea = '';

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
    var plotEl     = container.querySelector('.coding-plot-output');    // [mid]
    var timeEl     = container.querySelector('.coding-solve-time');    // [mid]

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

    // [mid] 태그 필터 드롭다운 이벤트 바인딩
    var areaSelect    = container.querySelector('.act-filter-area');
    var subareaSelect = container.querySelector('.act-filter-subarea');
    if (areaSelect && subareaSelect) {
      var tagData = _collectTags(activities);

      areaSelect.addEventListener('change', function () {
        _state.filterArea    = areaSelect.value;
        _state.filterSubarea = '';
        // subarea 드롭다운 재구성
        var subs = _state.filterArea ? Object.keys((tagData.subareaByArea[_state.filterArea] || {})).sort() : [];
        subareaSelect.innerHTML = '<option value="">전체 세부</option>' +
          subs.map(function (s) { return '<option value="' + _esc(s) + '">' + _esc(s) + '</option>'; }).join('');
        subareaSelect.value = '';
        _applyNavFilter(container, activities, _state.activityIndex);
      });

      subareaSelect.addEventListener('change', function () {
        _state.filterSubarea = subareaSelect.value;
        _applyNavFilter(container, activities, _state.activityIndex);
      });
    }

    // Pyodide 백그라운드 프리로드 + allowed_packages 사전 설치
    if (loadingEl) loadingEl.removeAttribute('hidden');
    _ensurePyodide().then(function () {
      // micropip 화이트리스트: 현재 activity의 allowed_packages 수집
      // (모든 activity의 패키지 합집합 — 어느 문제로 이동해도 즉시 실행 가능)
      var pkgs = _collectAllowedPackages(activities);
      if (pkgs.length > 0) {
        return _installPackages(pkgs, loadingEl);
      }
    }).then(function () {
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

    /* ── Run 버튼: 제출 없이 실행만 (stdout + matplotlib 플롯 출력) ── */
    if (runBtn) {
      runBtn.disabled = true; // Pyodide 로드 전 비활성
      runBtn.addEventListener('click', function () {
        if (!_pyodide) {
          _showOutput(outputEl, '⏳ Pyodide 로드 중... 잠시 후 다시 시도하세요.');
          return;
        }
        var code = _state.editor.getValue();
        _showOutput(outputEl, '실행 중...');
        // [mid] matplotlib 패키지 설치된 activity이면 플롯 캡처 활성화
        var capturePlot = _hasMplPackage(_state.activity);
        if (plotEl) { plotEl.innerHTML = ''; plotEl.style.display = 'none'; }
        _runOneCase(code, '', capturePlot).then(function (res) {
          _showOutput(outputEl, res.error ? ('오류: ' + res.error) : (res.stdout || '(출력 없음)'));
          // [mid] 플롯이 캡처됐으면 img 태그로 표시
          if (plotEl && res.plot_b64) {
            plotEl.innerHTML = '<img src="data:image/png;base64,' + res.plot_b64 +
              '" alt="matplotlib 출력" style="max-width:100%;border-radius:6px;border:1px solid var(--line2,#ddd)">';
            plotEl.style.display = 'block';
          }
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
        // [mid] 풀이 시간 측정 시작 (이 버튼 클릭 시점 기준)
        var scoreStart = Date.now();
        _showResult(resultEl, null, '채점 중...');
        // score() 호출
        score({ code: code }).then(function (result) {
          // [mid] 풀이 시간 계산 및 표시 (mount 기준 경과)
          var solveMs = Date.now() - _state.mountTime;
          if (timeEl) {
            var sec = (solveMs / 1000).toFixed(1);
            timeEl.textContent = '풀이 시간: ' + sec + 's';
            timeEl.style.display = 'inline';
          }
          _showResult(resultEl, result, null);
          // solution 버튼: back에 내용이 있으면 표시
          if (solBtn && activity.back && (activity.back.solution || activity.back.explanation)) {
            solBtn.style.display = 'inline-block';
          }
          // 진도 자동 저장 (emit → shell이 getProgressSnapshot 호출)
          ctx.emit({ type: 'activity-completed', result: result });
          // nav badge 갱신 (verdict 반영)
          _applyNavFilter(container, activities, _state.activityIndex);
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

  // _applyActivityNavOnly: _applyNavFilter로 통합됨 (mid 필터 지원)
  // 하위 호환을 위해 alias로 유지
  function _applyActivityNavOnly(container, activities, idx) {
    _applyNavFilter(container, activities, idx);
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
    _state.mountTime      = 0;       // [mid]
    _state.filterArea     = '';      // [mid]
    _state.filterSubarea  = '';      // [mid]
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
        plugin_extra:  { last_code: '', passed: 0, total: 0, solve_ms: 0 }
      };
    }
    var entry = snap.activities[activityId];
    entry.cold_attempts++;
    if (result.verdict === 'correct') entry.cold_correct++;
    entry.last_verdict = result.verdict;
    // [mid] solve_ms: mount(또는 마지막 문제 전환) 이후 경과 ms 기록
    var solveMs = _state.mountTime ? (Date.now() - _state.mountTime) : 0;
    entry.plugin_extra = {
      last_code: code,
      passed:    result.feedback.passed,
      total:     result.feedback.total,
      solve_ms:  solveMs
    };
    _state.progress = snap;
    _saveProgress(snap);
  }

  /**
   * activities 배열 전체에서 allowed_packages 합집합 수집
   * @param {Array} activities
   * @returns {string[]}  중복 제거된 패키지명 배열
   */
  function _collectAllowedPackages(activities) {
    var seen = {};
    var result = [];
    (activities || []).forEach(function (act) {
      var pkgs = act && act.grading && act.grading.allowed_packages;
      if (Array.isArray(pkgs)) {
        pkgs.forEach(function (pkg) {
          if (pkg && !seen[pkg]) {
            seen[pkg] = true;
            result.push(pkg);
          }
        });
      }
    });
    return result;
  }

  /**
   * micropip.install()로 패키지 목록 사전 설치
   * Pyodide 로드 완료 후 호출 (window._pyodide 존재 전제)
   * @param {string[]} pkgs
   * @param {HTMLElement} [loadingEl]  진행 상태 표시용
   * @returns {Promise<void>}
   */
  function _installPackages(pkgs, loadingEl) {
    var py = _pyodide;
    if (!py || !pkgs || !pkgs.length) return Promise.resolve();
    if (loadingEl) loadingEl.textContent = '📦 패키지 설치 중: ' + pkgs.join(', ') + '...';
    // micropip는 Pyodide에 기본 포함 (0.26+)
    return py.loadPackagesFromImports('import micropip').then(function () {
      return py.runPythonAsync(
        'import micropip as _micropip\n' +
        'import asyncio as _asyncio\n' +
        'await _micropip.install(' + JSON.stringify(pkgs) + ')\n'
      );
    }).catch(function (e) {
      // 설치 실패: 경고만(채점 실패가 아님 — 사용자가 직접 install 코드 작성 가능)
      console.warn('[coding] micropip install 실패:', e.message || e);
    });
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

  /** 채점 결과 렌더 — 전체 케이스 결과표 포함 */
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

    // 전체 케이스 결과표 (feedback.cases[] 있을 때)
    if (fb.cases && fb.cases.length > 0) {
      html += '<div style="margin-top:10px;overflow-x:auto">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.82em;font-family:monospace">';
      html += '<thead><tr style="background:var(--surface2,#f6f8fa);color:var(--ink3,#555)">' +
        '<th style="padding:5px 8px;border:1px solid var(--line2,#ddd);text-align:center;font-weight:600">#</th>' +
        '<th style="padding:5px 8px;border:1px solid var(--line2,#ddd);text-align:left;font-weight:600">입력</th>' +
        '<th style="padding:5px 8px;border:1px solid var(--line2,#ddd);text-align:left;font-weight:600">기대 출력</th>' +
        '<th style="padding:5px 8px;border:1px solid var(--line2,#ddd);text-align:left;font-weight:600">실제 출력</th>' +
        '<th style="padding:5px 8px;border:1px solid var(--line2,#ddd);text-align:center;font-weight:600">결과</th>' +
        '</tr></thead><tbody>';
      fb.cases.forEach(function (c) {
        var rowColor = c.pass ? 'var(--ok-bg,#f0fff4)' : (c.error ? 'var(--warn-bg,#fff8f0)' : 'var(--hot-bg,#fff0f3)');
        var statusIcon = c.pass ? '<span style="color:var(--ok,#22863a);font-weight:700">✓</span>' :
          (c.error ? '<span style="color:var(--warn,#e36209);font-weight:700" title="' + _esc(c.error) + '">!</span>' :
            '<span style="color:var(--hot,#d73a49);font-weight:700">✗</span>');
        var inputDisp   = _esc(String(c.input)).replace(/\n/g, '↵').replace(/  /g, '&nbsp;&nbsp;');
        var expectedDisp = _esc(String(c.expected).trim()).replace(/\n/g, '↵');
        var actualDisp   = c.pass
          ? _esc(String(c.actual).trim()).replace(/\n/g, '↵')
          : '<span style="color:var(--hot,#d73a49)">' + _esc(String(c.actual).trim()).replace(/\n/g, '↵') + '</span>';
        html += '<tr style="background:' + rowColor + '">' +
          '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd);text-align:center;color:var(--ink3,#888)">' + c.idx + '</td>' +
          '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(String(c.input)) + '">' + inputDisp + '</td>' +
          '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd)">' + expectedDisp + '</td>' +
          '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd)">' + actualDisp + '</td>' +
          '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd);text-align:center">' + statusIcon + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    } else if (fb.first_fail) {
      // cases[] 없으면 first_fail fallback (하위 호환)
      html += '<div style="font-size:0.85em;margin-top:6px;color:var(--ink3,#666)">' +
        '첫 실패 케이스 · 입력: <code>' + _esc(fb.first_fail.input) + '</code>' +
        ' / 기대: <code>' + _esc(String(fb.first_fail.expected).trim()) + '</code>' +
        ' / 실제: <code>' + _esc(String(fb.first_fail.actual).trim()) + '</code>' +
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
