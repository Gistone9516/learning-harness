/**
 * coding / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 — coding 플러그인
 * ────────────────────────────────────────────────────────────
 * 런타임규격 conform (buildflow cycle-2).
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
          var ok = res.stdout.trim() === tc.expected.trim();
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
    mounted:    false,
    host:       null,   // HTMLElement — #plugin-host
    ctx:        null,   // PluginContext
    activity:   null,   // 현재 ActivitySpec
    editor:     null,   // CodeMirror 인스턴스
    progress:   null,   // PluginProgressSnapshot (메모리 캐시)
    restored:   false   // onProgressRestored 호출됐는지
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

    _state.host = container;
    _state.ctx  = ctx;
    _state.mounted = true;

    // activities 목록 취득 (window.ACTIVITIES['coding'])
    var activities = (window.ACTIVITIES && window.ACTIVITIES['coding']) || [];
    // 활성 activity: 현재는 첫 번째 (추후 hash activityId 연동 가능)
    _state.activity = activities[0] || null;

    // HTML 골격 주입
    container.innerHTML = _buildHTML(_state.activity);

    var hostEl      = container;
    var editorWrap  = hostEl.querySelector('.coding-editor-wrap');
    var outputEl    = hostEl.querySelector('.coding-output');
    var runBtn      = hostEl.querySelector('.coding-btn-run');
    var submitBtn   = hostEl.querySelector('.coding-btn-submit');
    var loadingEl   = hostEl.querySelector('.coding-pyodide-loading');
    var resultEl    = hostEl.querySelector('.coding-result');

    // 에디터 생성
    var initialCode = (_state.activity && _state.activity.front.starter_code) || '';

    // 진도 복원 (onProgressRestored 이미 호출됐으면 last_code 적용)
    if (_state.restored && _state.progress) {
      var actId = _state.activity && _state.activity.activity_id;
      var saved = actId && _state.progress.activities && _state.progress.activities[actId];
      if (saved && saved.plugin_extra && saved.plugin_extra.last_code) {
        initialCode = saved.plugin_extra.last_code;
      }
    }

    _state.editor = _createEditor(editorWrap, initialCode);

    // Pyodide 백그라운드 프리로드 (mount 시작과 동시에)
    if (loadingEl) loadingEl.removeAttribute('hidden');
    _ensurePyodide().then(function () {
      if (loadingEl) loadingEl.setAttribute('hidden', '');
      if (runBtn)    runBtn.disabled    = false;
      if (submitBtn) submitBtn.disabled = false;
    }).catch(function (e) {
      if (loadingEl) loadingEl.textContent = 'Pyodide 로드 실패: ' + e.message;
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
        _showResult(resultEl, null, '채점 중...');
        // score() 호출
        score({ code: code }).then(function (result) {
          _showResult(resultEl, result, null);
          // 진도 자동 저장 (emit → shell이 getProgressSnapshot 호출)
          ctx.emit({ type: 'activity-completed', result: result });
        }).catch(function (e) {
          _showResult(resultEl, null, '채점 오류: ' + e.message);
        });
      });
    }

    return Promise.resolve();
  }

  /* ─────────────────────────────────────────────
     unmount()
  ───────────────────────────────────────────── */
  function unmount() {
    if (_state.host) _state.host.innerHTML = '';
    _state.mounted  = false;
    _state.host     = null;
    _state.ctx      = null;
    _state.editor   = null;
    _state.activity = null;
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
     UI HTML 생성 (런타임규격 §4-1)
  ───────────────────────────────────────────── */
  function _buildHTML(activity) {
    var prompt       = (activity && activity.front && activity.front.prompt) || '(문제 없음)';
    var langLabel    = (activity && activity.front && activity.front.language) || 'python';
    var actId        = (activity && activity.activity_id) || '';

    return [
      '<div class="coding-wrap" data-activity-id="' + _esc(actId) + '">',

      /* 문제 영역 */
      '<div class="coding-problem">',
      '  <div class="coding-lang-badge">' + _esc(langLabel.toUpperCase()) + '</div>',
      '  <div class="coding-prompt">' + _esc(prompt) + '</div>',
      '</div>',

      /* Pyodide 로딩 표시 */
      '<div class="coding-pyodide-loading" style="font-size:0.85em;color:var(--ink3,#888);margin-bottom:8px">',
      '  ⏳ Python 런타임(Pyodide) 로드 중...',
      '</div>',

      /* 에디터 영역 */
      '<div class="coding-editor-wrap" style="margin-bottom:8px"></div>',

      /* 버튼 영역 */
      '<div class="coding-actions" style="display:flex;gap:8px;margin-bottom:8px">',
      '  <button type="button" class="coding-btn-run"    disabled',
      '          style="padding:8px 18px;border-radius:6px;border:1px solid var(--line2,#ccc);background:var(--surface,#fff);cursor:pointer">',
      '    실행',
      '  </button>',
      '  <button type="button" class="coding-btn-submit" disabled',
      '          style="padding:8px 22px;border-radius:6px;border:none;background:var(--accent,#0550ae);color:#fff;cursor:pointer;font-weight:600">',
      '    제출·채점',
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
