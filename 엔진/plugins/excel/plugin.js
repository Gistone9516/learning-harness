/**
 * excel / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 — excel 플러그인
 * ────────────────────────────────────────────────────────────
 * 런타임규격 conform (buildflow cycle-2 sheet-task).
 *
 * 의존 CDN (index.html에서 shell.js보다 먼저 로드):
 *   react@18.3.1, react-dom@18.3.1, rxjs (UMD)
 *   @univerjs/presets              → UniverPresets
 *   @univerjs/preset-sheets-core   → UniverPresetSheetsCore
 *   locales/en-US                  → UniverPresetSheetsCoreEnUS
 *   @univerjs/preset-sheets-core/lib/index.css
 *
 * 등록 방식 (shell.js _registerPlugins 규칙):
 *   plugin_id = "excel"
 *   → globalKey = "_EXCEL_PLUGIN"   (camelCase 변환 결과와 direct 결과 동일)
 *   → window._EXCEL_PLUGIN = instance
 *   shell.js가 window._EXCEL_PLUGIN을 PLUGIN_REGISTRY['excel']에 삽입.
 *
 * 진도 localStorage 키: clf:excel:progress (플러그인계약 §5 규칙)
 * progress schema key (shell 진도버스): clf:excel:*
 * file:// 더블클릭 동작 (fetch 금지, CDN 외 외부 통신 0).
 *
 * ActivitySpec type = "sheet-task" (런타임규격 §2)
 * 채점: compare="value" 정적 셀값 비교 (MVP, 런타임규격 §4)
 *
 * 파킹(v2):
 *   - 수식 동치 채점(formula-equivalence): PySheetGrader 백엔드 필요
 *   - 서식·조건부서식 채점: Facade 서식 API 별도 구현 필요
 *   - Univer 고급함수 커버리지 미검증
 *   - 진도 셀 스냅샷 복원: getSnapshot() → createWorkbook() 재주입 흐름
 *   - 한국어 로케일: ko-KR UMD 제공 여부 미확인, v1은 en-US 고정
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     진도 localStorage 헬퍼 (키: clf:excel:progress)
  ───────────────────────────────────────────── */
  var PROGRESS_KEY = 'clf:excel:progress';

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
    activity:   null,   // 현재 ActivitySpec (sheet-task)
    univerAPI:  null,   // Univer Facade API 인스턴스
    progress:   null,   // PluginProgressSnapshot (메모리 캐시)
    restored:   false   // onProgressRestored 호출됐는지
  };

  /* ─────────────────────────────────────────────
     Univer CDN UMD 전역 확인 헬퍼
  ───────────────────────────────────────────── */
  function _checkUniver() {
    return (
      typeof UniverPresets !== 'undefined' &&
      typeof UniverCore !== 'undefined' &&
      typeof UniverPresetSheetsCore !== 'undefined'
    );
  }

  /* ─────────────────────────────────────────────
     initial_grid → IWorkbookData cellData 변환
     런타임규격 §3-2
  ───────────────────────────────────────────── */
  /**
   * @param {Array<Array<string|number>>} initialGrid
   * @returns {object}  IWorkbookData 호환 cellData (row→col→{v,t})
   */
  function _gridToCellData(initialGrid) {
    var cellData = {};
    initialGrid.forEach(function (row, rowIdx) {
      cellData[rowIdx] = {};
      row.forEach(function (val, colIdx) {
        if (val !== '' && val !== null && val !== undefined) {
          cellData[rowIdx][colIdx] = typeof val === 'number'
            ? { v: val, t: 2 }   // t:2 = number
            : { v: val, t: 1 };  // t:1 = string
        }
      });
    });
    return cellData;
  }

  /* ─────────────────────────────────────────────
     Univer 인스턴스 생성·마운트 (런타임규격 §3-2)
  ───────────────────────────────────────────── */
  /**
   * @param {HTMLElement}              container
   * @param {Array<Array<string|number>>} initialGrid
   * @returns {{ univerAPI: object }}
   */
  function _mountUniver(container, initialGrid) {
    var createUniver         = UniverPresets.createUniver;
    var LocaleType           = UniverCore.LocaleType;
    var mergeLocales         = UniverCore.mergeLocales || UniverCore.merge;
    var UniverSheetsCorePreset = UniverPresetSheetsCore.UniverSheetsCorePreset;

    var localeData = {};
    // locales 전역명: UniverPresetSheetsCoreEnUS (런타임규격 §3-1 확인)
    if (typeof UniverPresetSheetsCoreEnUS !== 'undefined') {
      localeData[LocaleType.EN_US] = mergeLocales(UniverPresetSheetsCoreEnUS);
    }

    var result = createUniver({
      locale:  LocaleType.EN_US,
      locales: localeData,
      presets: [
        UniverSheetsCorePreset({ container: container })
      ]
    });

    var univerAPI = result.univerAPI;

    // initial_grid 주입
    var cellData = _gridToCellData(initialGrid);
    var rowCount    = Math.max(initialGrid.length + 10, 20);
    var colCount    = Math.max((initialGrid[0] ? initialGrid[0].length : 0) + 5, 10);

    var workbookData = {
      id:         'sheet-task-wb',
      name:       '실습 시트',
      sheetOrder: ['sheet1'],
      sheets: {
        sheet1: {
          id:          'sheet1',
          name:        'Sheet1',
          rowCount:    rowCount,
          columnCount: colCount,
          cellData:    cellData
        }
      }
    };

    // createWorkbook (Facade API 공식) — 일부 버전은 createUniverSheet 별칭
    if (typeof univerAPI.createWorkbook === 'function') {
      univerAPI.createWorkbook(workbookData);
    } else if (typeof univerAPI.createUniverSheet === 'function') {
      univerAPI.createUniverSheet(workbookData);
    } else {
      console.warn('[excel] univerAPI.createWorkbook / createUniverSheet 없음');
    }

    return { univerAPI: univerAPI };
  }

  /* ─────────────────────────────────────────────
     compareValue — 런타임규격 §4-2
  ───────────────────────────────────────────── */
  /**
   * @param {*}               actual
   * @param {string|number}   expected
   * @returns {boolean}
   */
  function _compareValue(actual, expected) {
    // 1. 둘 다 number → numeric 비교
    if (typeof expected === 'number' && typeof actual === 'number') {
      return actual === expected;
    }
    // 2. expected number, actual string(수식결과가 문자열로 왔을 때) → 숫자 파싱 시도
    if (typeof expected === 'number' && typeof actual === 'string') {
      var parsed = Number(actual.trim());
      if (!isNaN(parsed)) return parsed === expected;
    }
    // 3. 그 외 → String 변환 후 trim 비교
    return String(actual).trim() === String(expected).trim();
  }

  /* ─────────────────────────────────────────────
     runScore — 동기 채점 실행 (런타임규격 §4-1)
  ───────────────────────────────────────────── */
  /**
   * @param {object} activity   ActivitySpec (sheet-task)
   * @param {object} univerAPI  Facade API
   * @returns {ScoreResult}
   */
  function _runScore(activity, univerAPI) {
    var fWorkbook  = univerAPI.getActiveWorkbook();
    var fWorksheet = fWorkbook ? fWorkbook.getActiveSheet() : null;

    if (!fWorksheet) {
      return {
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  { passed: 0, total: 0, first_fail: { cell: '?', expected: '?', actual: null } }
      };
    }

    var expected = activity.grading.expected;
    var total    = expected.length;
    var passed   = 0;
    var firstFail = null;

    expected.forEach(function (entry) {
      var fRange    = fWorksheet.getRange(entry.cell);
      var actualVal = fRange ? fRange.getValue() : null;
      var ok        = _compareValue(actualVal, entry.value);
      if (ok) {
        passed++;
      } else if (!firstFail) {
        firstFail = {
          cell:     entry.cell,
          expected: entry.value,
          actual:   actualVal
        };
      }
    });

    return {
      verdict:   (passed === total) ? 'correct' : 'incorrect',
      score_raw: total > 0 ? passed / total : 0,
      grader_id: 'engine',
      feedback:  {
        passed:     passed,
        total:      total,
        first_fail: firstFail
      }
    };
  }

  /* ─────────────────────────────────────────────
     scoreAfterCalc — 수식 계산 완료 대기 후 채점 (런타임규격 §4-3)
  ───────────────────────────────────────────── */
  /**
   * @param {object} activity
   * @param {object} univerAPI
   * @returns {Promise<ScoreResult>}
   */
  function _scoreAfterCalc(activity, univerAPI) {
    return new Promise(function (resolve) {
      var formulaEngine = null;
      try {
        formulaEngine = univerAPI.getFormula ? univerAPI.getFormula() : null;
      } catch (e) { formulaEngine = null; }

      if (!formulaEngine) {
        // 수식 엔진 없음(혹은 수식 없는 과제) → 즉시 채점
        resolve(_runScore(activity, univerAPI));
        return;
      }

      var settled = false;
      try {
        formulaEngine.calculationEnd(function (state) {
          // state === 3 → 계산 완료 (Univer 내부 상태코드, 런타임규격 §4-3)
          if (!settled && state === 3) {
            settled = true;
            resolve(_runScore(activity, univerAPI));
          }
        });
      } catch (e) {
        // calculationEnd API 없거나 실패 → fallback 즉시 채점
        resolve(_runScore(activity, univerAPI));
        return;
      }

      // 안전망: 3초 후에도 state===3 콜백 미수신이면 즉시 채점
      setTimeout(function () {
        if (!settled) {
          settled = true;
          resolve(_runScore(activity, univerAPI));
        }
      }, 3000);
    });
  }

  /* ─────────────────────────────────────────────
     채점 결과 렌더 헬퍼
  ───────────────────────────────────────────── */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _showResult(el, result, message) {
    if (!el) return;
    if (message) {
      el.innerHTML = '<span style="color:var(--ink3,#666)">' + _esc(message) + '</span>';
      return;
    }
    if (!result) return;

    var verdictColor = result.verdict === 'correct'
      ? 'var(--ok,#22863a)'
      : 'var(--hot,#d73a49)';
    var verdictLabel = result.verdict === 'correct' ? '정답' : '오답';
    var fb = result.feedback;

    var html = '<div style="margin-top:8px">' +
      '<strong style="color:' + verdictColor + '">' + verdictLabel + '</strong>' +
      ' <span style="color:var(--ink3,#666);font-size:0.9em">(' +
        fb.passed + '/' + fb.total + ' 셀 일치)</span>';

    if (fb.first_fail) {
      html += '<div style="font-size:0.85em;margin-top:6px;color:var(--ink3,#666)">' +
        '첫 불일치 · 셀: <code>' + _esc(fb.first_fail.cell) + '</code>' +
        ' / 기대: <code>' + _esc(String(fb.first_fail.expected)) + '</code>' +
        ' / 실제: <code>' + _esc(String(fb.first_fail.actual)) + '</code>' +
        '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  /* ─────────────────────────────────────────────
     UI HTML 생성
  ───────────────────────────────────────────── */
  function _buildHTML(activity) {
    var prompt = (activity && activity.front && activity.front.prompt) || '(문제 없음)';
    var actId  = (activity && activity.activity_id) || '';

    return [
      '<div class="excel-wrap" data-activity-id="' + _esc(actId) + '">',

      /* 문제 지문 */
      '<div class="excel-problem" style="' +
        'background:var(--surface2,#f6f8fa);' +
        'border:1px solid var(--line2,#ddd);' +
        'border-radius:8px;padding:14px 16px;margin-bottom:12px">',
      '  <div class="excel-badge" style="' +
        'display:inline-block;font-size:0.75em;font-weight:600;' +
        'color:var(--accent,#0550ae);background:var(--accent-bg,#e8f0fe);' +
        'padding:2px 8px;border-radius:12px;margin-bottom:6px">EXCEL 실습</div>',
      '  <div class="excel-prompt" style="font-size:0.95em;line-height:1.6;white-space:pre-wrap">' +
        _esc(prompt) + '</div>',
      '</div>',

      /* Univer 스프레드시트 컨테이너 */
      '<div class="excel-univer-container" id="univer-host-' + _esc(actId) + '" style="' +
        'width:100%;height:480px;border:1px solid var(--line2,#ddd);' +
        'border-radius:6px;overflow:hidden;margin-bottom:10px">',
      '</div>',

      /* 버튼 영역 */
      '<div class="excel-actions" style="display:flex;gap:8px;margin-bottom:8px">',
      '  <button type="button" class="excel-btn-submit"',
      '          style="padding:8px 22px;border-radius:6px;border:none;' +
        'background:var(--accent,#0550ae);color:#fff;cursor:pointer;font-weight:600">',
      '    채점',
      '  </button>',
      '</div>',

      /* 채점 결과 */
      '<div class="excel-result" style="min-height:28px"></div>',

      '</div>'
    ].join('\n');
  }

  /* ─────────────────────────────────────────────
     mount(container, ctx) — 런타임규격 §5-1
  ───────────────────────────────────────────── */
  /**
   * @param {HTMLElement}   container  #plugin-host
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  function mount(container, ctx) {
    if (_state.mounted) unmount();

    _state.host    = container;
    _state.ctx     = ctx;
    _state.mounted = true;

    // activities 취득 (window.ACTIVITIES['excel'])
    var activities = (window.ACTIVITIES && window.ACTIVITIES['excel']) || [];
    _state.activity = activities[0] || null;

    // HTML 골격 주입
    container.innerHTML = _buildHTML(_state.activity);

    // Univer CDN 로드 여부 확인
    if (!_checkUniver()) {
      var errEl = container.querySelector('.excel-univer-container');
      if (errEl) {
        errEl.style.cssText = 'padding:20px;color:var(--hot,#d73a49);background:var(--surface2,#f6f8fa)';
        errEl.textContent =
          'Univer CDN 미로드. index.html에서 @univerjs/presets · @univerjs/preset-sheets-core 스크립트를 shell.js 앞에 추가하세요.';
      }
      return Promise.resolve();
    }

    // Univer 스프레드시트 마운트
    var activity    = _state.activity;
    var initialGrid = (activity && activity.front && activity.front.initial_grid) || [['']];
    var univerContainer = container.querySelector('.excel-univer-container');

    try {
      var result = _mountUniver(univerContainer, initialGrid);
      _state.univerAPI = result.univerAPI;
    } catch (e) {
      console.error('[excel] Univer 마운트 실패:', e);
      if (univerContainer) {
        univerContainer.style.cssText = 'padding:20px;color:var(--hot,#d73a49)';
        univerContainer.textContent = 'Univer 초기화 실패: ' + e.message;
      }
      return Promise.resolve();
    }

    // Submit(채점) 버튼 바인딩
    var submitBtn = container.querySelector('.excel-btn-submit');
    var resultEl  = container.querySelector('.excel-result');

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        if (!_state.activity) {
          _showResult(resultEl, null, '문제가 로드되지 않았습니다.');
          return;
        }
        if (!_state.univerAPI) {
          _showResult(resultEl, null, 'Univer 초기화 실패 — 페이지를 새로고침하세요.');
          return;
        }
        _showResult(resultEl, null, '채점 중...');
        score().then(function (result) {
          _showResult(resultEl, result, null);
          ctx.emit({ type: 'activity-completed', result: result });
        }).catch(function (e) {
          _showResult(resultEl, null, '채점 오류: ' + e.message);
        });
      });
    }

    return Promise.resolve();
  }

  /* ─────────────────────────────────────────────
     unmount() — 런타임규격 §5-4
  ───────────────────────────────────────────── */
  function unmount() {
    // Univer 인스턴스 dispose
    if (_state.univerAPI) {
      try {
        if (typeof _state.univerAPI.dispose === 'function') {
          _state.univerAPI.dispose();
        }
      } catch (e) {}
      _state.univerAPI = null;
    }

    if (_state.host) _state.host.innerHTML = '';

    _state.mounted   = false;
    _state.host      = null;
    _state.ctx       = null;
    _state.activity  = null;
  }

  /* ─────────────────────────────────────────────
     score(userAnswer) — 런타임규격 §5-2
     userAnswer: void (Univer 내부 상태에서 읽음)
  ───────────────────────────────────────────── */
  /**
   * @returns {Promise<ScoreResult>}
   */
  function score() {
    var activity  = _state.activity;
    var univerAPI = _state.univerAPI;

    if (!activity) {
      return Promise.resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  { passed: 0, total: 0, first_fail: null }
      });
    }

    if (!univerAPI) {
      return Promise.resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  { passed: 0, total: 0, first_fail: null }
      });
    }

    return _scoreAfterCalc(activity, univerAPI).then(function (result) {
      _updateProgress(activity.activity_id, result);
      return result;
    });
  }

  /* ─────────────────────────────────────────────
     getProgressSnapshot() — 런타임규격 §5-3
  ───────────────────────────────────────────── */
  /**
   * @returns {PluginProgressSnapshot}
   */
  function getProgressSnapshot() {
    if (!_state.progress) {
      _state.progress = {
        plugin_id:      'excel',
        schema_version: 1,
        activities:     {}
      };
    }
    return _state.progress;
  }

  /* ─────────────────────────────────────────────
     onProgressRestored(snapshot) — 플러그인계약 §3
  ───────────────────────────────────────────── */
  function onProgressRestored(snapshot) {
    if (!snapshot) return;
    _state.progress = snapshot;
    _state.restored = true;
    // v2 파킹: 셀 스냅샷 복원(getSnapshot→createWorkbook 재주입)은 v2에서 구현
  }

  /* ─────────────────────────────────────────────
     getDashboardContrib() — 선택 구현 (플러그인계약 §3)
     null 반환 시 셸 기본집계 사용
  ───────────────────────────────────────────── */
  function getDashboardContrib() {
    var snap   = getProgressSnapshot();
    var acts   = snap.activities || {};
    var actIds = Object.keys(acts);

    if (!actIds.length) return null;

    // by_area: activity tags 기준 집계
    var areaMap = {};
    actIds.forEach(function (id) {
      var a        = acts[id];
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

    // weakness: 오답 기록 있는 unit
    var weakness = [];
    actIds.forEach(function (id) {
      var a = acts[id];
      if (!a.cold_attempts) return;
      var activity = _findActivity(id);
      if (!activity) return;
      var rate = (a.cold_attempts - a.cold_correct) / a.cold_attempts;
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

    // completion
    var completion = byArea.map(function (r) {
      return {
        area:         r.area,
        subarea:      r.subarea,
        mastery_rate: r.retrieval_rate != null ? r.retrieval_rate : 0,
        box_dist:     { box1: 0, box2: 0, box3: 0 }  // excel은 Leitner 없음
      };
    });

    return {
      plugin_id:     'excel',
      by_area:       byArea,
      weakness:      weakness,
      pass_path:     [],
      completion:    completion,
      extra_widgets: []
    };
  }

  /* ─────────────────────────────────────────────
     내부 헬퍼
  ───────────────────────────────────────────── */

  /** 진도 캐시 업데이트 */
  function _updateProgress(activityId, result) {
    var snap = getProgressSnapshot();
    if (!snap.activities[activityId]) {
      snap.activities[activityId] = {
        cold_attempts: 0,
        cold_correct:  0,
        last_verdict:  null,
        plugin_extra:  { last_score: { passed: 0, total: 0 } }
      };
    }
    var entry = snap.activities[activityId];
    entry.cold_attempts++;
    if (result.verdict === 'correct') entry.cold_correct++;
    entry.last_verdict = result.verdict;
    entry.plugin_extra = {
      last_score: {
        passed: result.feedback.passed,
        total:  result.feedback.total
      }
      // v2 파킹: 셀 스냅샷(univerAPI.getActiveWorkbook().getSnapshot())
    };
    _state.progress = snap;
    _saveProgress(snap);
  }

  /** window.ACTIVITIES['excel']에서 activityId 검색 */
  function _findActivity(activityId) {
    var list = (window.ACTIVITIES && window.ACTIVITIES['excel']) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].activity_id === activityId) return list[i];
    }
    return null;
  }

  /* ─────────────────────────────────────────────
     PluginInstance 객체 조립
  ───────────────────────────────────────────── */
  var _instance = {
    mount:               mount,
    unmount:             unmount,
    score:               score,
    getProgressSnapshot: getProgressSnapshot,
    onProgressRestored:  onProgressRestored,
    getDashboardContrib: getDashboardContrib
  };

  /* ─────────────────────────────────────────────
     shell.js 등록 규칙 준수 (_registerPlugins 참조)
     plugin_id = "excel"
     globalKey  = "_EXCEL_PLUGIN"
     directKey  = "_EXCEL_PLUGIN"  (동일)
  ───────────────────────────────────────────── */
  window._EXCEL_PLUGIN = _instance;

})();
