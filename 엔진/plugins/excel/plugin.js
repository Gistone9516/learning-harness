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
 * mid 구현 (buildflow cycle-4):
 *   - 진도 셀 스냅샷: _updateProgress에서 getSnapshot() 저장, onProgressRestored에서 createWorkbook 재주입
 *   - 약점 영역 재도전 필터: 네비게이션 배지 난이도 아이콘 + '약점만 보기' 필터 버튼
 *
 * 파킹/skip:
 *   - 수식 동치 채점(formula-equivalence): PySheetGrader 백엔드 필요
 *   - 서식·조건부서식 채점: C4 계약 대기 + Facade API 미확정 → skip
 *   - Univer 고급함수 커버리지 미검증
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
    mounted:        false,
    host:           null,   // HTMLElement — #plugin-host
    ctx:            null,   // PluginContext
    activity:       null,   // 현재 ActivitySpec (sheet-task)
    univerAPI:      null,   // Univer Facade API 인스턴스
    progress:       null,   // PluginProgressSnapshot (메모리 캐시)
    restored:       false,  // onProgressRestored 호출됐는지
    pendingSnapshot: null,  // onProgressRestored가 mount 전에 호출됐을 때 보관
    activityIndex:  0,      // 현재 활동 인덱스
    univerContainer: null,  // Univer 컨테이너 ref (dispose용)
    weaknessOnly:   false,  // mid: 약점 영역만 보기 필터 상태
    scoreInFlight:  false   // 채점 중 중복 클릭 방어
  };

  /* ─────────────────────────────────────────────
     Univer CDN UMD 전역 확인 헬퍼
  ───────────────────────────────────────────── */
  function _checkUniver() {
    return (
      typeof UniverPresets !== 'undefined' &&
      typeof UniverCore !== 'undefined' &&
      typeof UniverPresetSheetsCore !== 'undefined' &&
      typeof UniverPresets.createUniver === 'function'  // API 형태 검증 추가
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
     createWorkbook 공통 헬퍼 — API 버전 분기 중복 제거
     두 호출 지점(_mountUniver, onProgressRestored)에서 공유
  ───────────────────────────────────────────── */
  function _createWorkbook(univerAPI, data) {
    if (typeof univerAPI.createWorkbook === 'function') {
      univerAPI.createWorkbook(data);
    } else if (typeof univerAPI.createUniverSheet === 'function') {
      univerAPI.createUniverSheet(data);
    } else {
      console.warn('[excel] univerAPI.createWorkbook / createUniverSheet 없음');
      throw new Error('Univer 워크북 생성 API 없음');
    }
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
    _createWorkbook(univerAPI, workbookData);

    return { univerAPI: univerAPI };
  }

  /* ─────────────────────────────────────────────
     compareValue — 런타임규격 §4-2 + float 허용오차
     grading.tolerance (절대 오차) 또는 compare='value-tol' 지원
  ───────────────────────────────────────────── */
  /**
   * @param {*}               actual
   * @param {string|number}   expected
   * @param {number}          [tolerance=0]  절대 허용오차 (grading.tolerance)
   * @returns {boolean}
   */
  function _compareValue(actual, expected, tolerance) {
    var eps = (typeof tolerance === 'number' && tolerance >= 0) ? tolerance : 0;
    // 1. 둘 다 number → epsilon 허용 numeric 비교
    if (typeof expected === 'number' && typeof actual === 'number') {
      return Math.abs(actual - expected) <= eps;
    }
    // 2. expected number, actual string(수식결과가 문자열로 왔을 때) → 숫자 파싱 후 epsilon 비교
    if (typeof expected === 'number' && typeof actual === 'string') {
      var parsed = Number(actual.trim());
      if (!isNaN(parsed)) return Math.abs(parsed - expected) <= eps;
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

    var expected  = activity.grading.expected;
    // 런타임규격 §2-1: grading.expected minItems:1 — 빈 배열은 spec 위반, incorrect로 처리
    if (!expected || expected.length === 0) {
      return {
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  { passed: 0, total: 0, first_fail: null, cell_results: [] }
      };
    }
    var tolerance = (activity.grading && typeof activity.grading.tolerance === 'number')
      ? activity.grading.tolerance : 0;
    var total    = expected.length;
    var passed   = 0;
    var firstFail = null;
    var cellResults = [];  // 다중셀 결과표용

    expected.forEach(function (entry) {
      var fRange    = fWorksheet.getRange(entry.cell);
      var actualVal = fRange ? fRange.getValue() : null;
      var ok        = _compareValue(actualVal, entry.value, tolerance);
      if (ok) {
        passed++;
      } else if (!firstFail) {
        firstFail = {
          cell:     entry.cell,
          expected: entry.value,
          actual:   actualVal
        };
      }
      cellResults.push({ cell: entry.cell, expected: entry.value, actual: actualVal, ok: ok });
    });

    return {
      verdict:   (passed === total) ? 'correct' : 'incorrect',
      score_raw: total > 0 ? passed / total : 0,
      grader_id: 'engine',
      feedback:  {
        passed:      passed,
        total:       total,
        first_fail:  firstFail,
        cell_results: cellResults  // 다중셀 결과표용 전체 배열
      }
    };
  }

  /* ─────────────────────────────────────────────
     scoreAfterCalc — 수식 계산 완료 대기 후 채점 (런타임규격 §4-3)
  ───────────────────────────────────────────── */
  /**
   * @param {object} activity
   * @param {object} univerAPI
   * @returns {Promise<ScoreResult>}  타임아웃 시 verdict='timeout' ScoreResult 반환
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

      // 5초 타임아웃 방어 — state===3 미발화 시 "수식 계산 실패" 안내 반환
      setTimeout(function () {
        if (!settled) {
          settled = true;
          resolve({
            verdict:   'timeout',
            score_raw: 0,
            grader_id: 'engine',
            feedback:  {
              passed:      0,
              total:       (activity.grading && activity.grading.expected)
                             ? activity.grading.expected.length : 0,
              first_fail:  null,
              cell_results: [],
              timeout:     true   // _showResult 타임아웃 분기용 플래그
            }
          });
        }
      }, 5000);
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

  /**
   * 채점 결과 렌더 — 다중셀 결과표 + 해설 패널 토글 포함
   * @param {HTMLElement}  el        .excel-result 영역
   * @param {ScoreResult|null} result
   * @param {string|null}  message   단순 메시지 표시용
   * @param {object|null}  back      ActivitySpec.back (solution/explanation)
   */
  function _showResult(el, result, message, back) {
    if (!el) return;

    // 단순 메시지 (채점 중... / 오류)
    if (message) {
      el.innerHTML = '<span style="color:var(--ink3,#666)">' + _esc(message) + '</span>';
      return;
    }
    if (!result) return;

    var fb = result.feedback || {};

    // ── 타임아웃 분기 ──
    if (result.verdict === 'timeout' || fb.timeout) {
      el.innerHTML =
        '<div style="margin-top:8px;padding:10px 14px;border-radius:7px;' +
        'background:#fff8e1;border:1px solid #ffe082;color:#7a5800;font-size:0.88em">' +
        '⚠️ 수식 계산 실패 — 수식을 확인하거나 페이지를 새로고침하세요.' +
        '</div>';
      return;
    }

    var isCorrect    = result.verdict === 'correct';
    var verdictColor = isCorrect ? 'var(--brand,#1f6b4a)' : 'var(--hot,#a8301f)';
    var verdictLabel = isCorrect ? '✓ 정답' : '✗ 오답';
    var passed       = fb.passed != null ? fb.passed : 0;
    var total        = fb.total  != null ? fb.total  : 0;

    // ── 판정 헤더 ──
    var html = '<div style="margin-top:8px">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">';
    html += '<strong style="font-size:1em;color:' + verdictColor + '">' + verdictLabel + '</strong>';

    // score_raw 진척바 (다중셀일 때 의미있음)
    if (total > 1) {
      var pct = total > 0 ? Math.round((passed / total) * 100) : 0;
      html += '<span style="font-size:0.85em;color:var(--ink3,#666)">' + passed + '/' + total + ' 셀 일치</span>';
      html += '<div style="flex:1;max-width:140px;height:6px;background:var(--line2,#eee);border-radius:4px;overflow:hidden">';
      html += '<div style="width:' + pct + '%;height:100%;background:' + verdictColor + ';transition:width 0.3s"></div>';
      html += '</div>';
    } else {
      html += '<span style="font-size:0.85em;color:var(--ink3,#666)">(' + passed + '/' + total + ' 셀 일치)</span>';
    }
    html += '</div>';

    // ── 다중셀 결과표 (셀 3개 이상이거나 오답 있을 때 항상 표시) ──
    var cellResults = fb.cell_results || [];
    if (cellResults.length > 0) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.82em;margin-bottom:8px">';
      html += '<thead><tr style="background:var(--surface2,#f2eee5)">';
      html += '<th style="padding:4px 8px;text-align:left;border:1px solid var(--line2,#ddd)">셀</th>';
      html += '<th style="padding:4px 8px;text-align:left;border:1px solid var(--line2,#ddd)">기대값</th>';
      html += '<th style="padding:4px 8px;text-align:left;border:1px solid var(--line2,#ddd)">입력값</th>';
      html += '<th style="padding:4px 8px;text-align:center;border:1px solid var(--line2,#ddd)">결과</th>';
      html += '</tr></thead><tbody>';
      cellResults.forEach(function (cr) {
        var rowBg = cr.ok ? 'var(--brand-bg,#e4efe7)' : 'var(--hot-bg,#f9e7e2)';
        var icon  = cr.ok ? '<span style="color:var(--brand,#1f6b4a)">✓</span>' : '<span style="color:var(--hot,#a8301f)">✗</span>';
        html += '<tr style="background:' + rowBg + '">';
        html += '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd)"><code>' + _esc(cr.cell) + '</code></td>';
        html += '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd)"><code>' + _esc(String(cr.expected)) + '</code></td>';
        html += '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd)"><code>' + _esc(String(cr.actual != null ? cr.actual : '(빈 셀)')) + '</code></td>';
        html += '<td style="padding:4px 8px;border:1px solid var(--line2,#ddd);text-align:center">' + icon + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    // ── 해설 패널 (back.solution / back.explanation) ──
    if (back && (back.solution || back.explanation)) {
      var panelId = 'excel-explanation-' + Date.now();
      // 오답일 때 해설 자동 펼침 → 인출 실패 직후 즉시 피드백 제공
      var panelOpen = !isCorrect;
      html += '<div style="margin-top:8px">';
      // 토글 버튼
      html += '<button type="button" class="excel-btn-explanation" data-panel="' + panelId + '"' +
        ' style="font-size:0.82em;padding:5px 12px;border-radius:5px;border:1px solid var(--line2,#ccc);' +
        'background:var(--surface2,#f2eee5);cursor:pointer;color:var(--ink2,#444)">' +
        (panelOpen ? '해설 닫기 ▾' : '해설 보기 ▸') + '</button>';
      // 해설 패널 (오답 시 초기 펼침)
      html += '<div id="' + panelId + '" style="display:' + (panelOpen ? 'block' : 'none') + ';margin-top:8px;padding:12px 14px;' +
        'border:1px solid var(--line2,#ddd);border-radius:7px;background:#fafbff;font-size:0.87em;line-height:1.7">';
      if (back.solution) {
        html += '<div style="margin-bottom:8px">';
        html += '<span style="font-weight:600;color:var(--brand,#1f6b4a);font-size:0.9em">모범 수식</span>';
        html += '<pre style="margin:4px 0 0;padding:8px 10px;background:var(--surface2,#f2eee5);' +
          'border-radius:5px;white-space:pre-wrap;word-break:break-all;font-size:0.95em">' +
          _esc(back.solution) + '</pre>';
        html += '</div>';
      }
      if (back.explanation) {
        html += '<div>';
        html += '<span style="font-weight:600;color:var(--ink2,#444);font-size:0.9em">풀이 설명</span>';
        html += '<div style="margin-top:4px;color:var(--ink2,#555);white-space:pre-wrap">' +
          _esc(back.explanation) + '</div>';
        html += '</div>';
      }
      html += '</div>';  // 해설 패널 닫기
      html += '</div>';  // 래퍼 닫기
    }

    html += '</div>';
    el.innerHTML = html;

    // 해설 토글 이벤트 바인딩
    var toggleBtn = el.querySelector('.excel-btn-explanation');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var panelEl = document.getElementById(toggleBtn.getAttribute('data-panel'));
        if (!panelEl) return;
        var hidden = panelEl.style.display === 'none';
        panelEl.style.display = hidden ? 'block' : 'none';
        toggleBtn.textContent  = hidden ? '해설 닫기 ▾' : '해설 보기 ▸';
      });
    }
  }

  /* ─────────────────────────────────────────────
     weight → 난이도 아이콘 매핑 (mid: 약점 영역 재도전 필터)
     weight 1-3: easy(●), 4-6: medium(◆), 7-10: hard(★)
  ───────────────────────────────────────────── */
  function _diffIcon(weight) {
    if (!weight || weight <= 3) return { icon: '●', label: '쉬움', color: 'var(--brand,#1f6b4a)' };
    if (weight <= 6)             return { icon: '◆', label: '중간', color: 'var(--warn,#9a5a09)' };
    return                               { icon: '★', label: '어려움', color: 'var(--hot,#a8301f)' };
  }

  /* ─────────────────────────────────────────────
     약점 unit 집합 계산 (getDashboardContrib.weakness 재활용)
  ───────────────────────────────────────────── */
  function _weaknessUnits() {
    var contrib = getDashboardContrib();
    if (!contrib || !contrib.weakness || !contrib.weakness.length) return null;
    var units = {};
    contrib.weakness.forEach(function (w) { units[w.unit] = true; });
    return units;
  }

  /* ─────────────────────────────────────────────
     Activity 네비게이션 바 HTML 생성
     mid: 각 버튼에 난이도 아이콘 추가
          weakness 데이터 있을 때 '약점만 보기' 필터 버튼 추가
  ───────────────────────────────────────────── */
  /**
   * @param {Array}   activities
   * @param {number}  currentIdx
   * @param {boolean} weaknessOnly  약점 필터 ON 여부
   * @returns {string}
   */
  function _buildNavHTML(activities, currentIdx, weaknessOnly) {
    if (!activities || activities.length <= 1) return '';
    var weakUnits = _weaknessUnits();
    var hasWeakness = weakUnits && Object.keys(weakUnits).length > 0;

    var html = '<div class="act-nav" style="display:flex;align-items:center;gap:6px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line2,#eee);flex-wrap:wrap">';
    html += '<span style="font-size:0.8rem;color:var(--ink3,#888);font-weight:500;margin-right:2px">문제</span>';
    for (var i = 0; i < activities.length; i++) {
      var act = activities[i];
      var diff = _diffIcon(act && act.weight);
      var isWeak = weakUnits && act && act.tags && weakUnits[act.tags.unit];
      // 약점 필터 ON 이고 약점 아닌 활동은 흐리게 표시
      var dimStyle = (weaknessOnly && !isWeak) ? 'opacity:0.35;' : '';
      html += '<button type="button" class="act-nav-btn" data-act-idx="' + i + '"' +
        ' title="' + (i + 1) + '번 문제 · 난이도: ' + diff.label + (isWeak ? ' · 약점 영역' : '') + '"' +
        ' style="' + dimStyle + 'min-width:34px;height:34px;border-radius:var(--r,10px);border:1.5px solid var(--line2,#cfc7b4);background:var(--surface,#fbfaf6);cursor:pointer;font-size:var(--fs-sm,12.5px);font-weight:500">' +
        (i + 1) +
        '</button>';
    }
    // 약점 필터 버튼 (weakness 데이터 있을 때만)
    if (hasWeakness) {
      var filterBg = weaknessOnly ? 'var(--hot,#a8301f)' : 'var(--surface,#fbfaf6)';
      var filterColor = weaknessOnly ? '#fff' : 'var(--hot,#a8301f)';
      html += '<button type="button" class="act-weakness-filter" ' +
        'style="margin-left:6px;padding:4px 10px;border-radius:var(--r,10px);border:1.5px solid var(--hot,#a8301f);' +
        'background:' + filterBg + ';color:' + filterColor + ';font-size:var(--fs-xs,11px);cursor:pointer;font-weight:500">' +
        (weaknessOnly ? '전체 보기' : '약점만 보기') + '</button>';
    }
    html += '<span class="act-count" style="margin-left:auto;font-size:0.8rem;color:var(--ink3,#888)">' + (currentIdx + 1) + ' / ' + activities.length + '</span>';
    html += '</div>';
    return html;
  }

  /* ─────────────────────────────────────────────
     네비게이션 배지 업데이트 (진도·활성 상태 반영 + 난이도 아이콘)
  ───────────────────────────────────────────── */
  /**
   * @param {HTMLElement} container
   * @param {Array}       activities
   * @param {number}      currentIdx
   */
  function _updateNavBadges(container, activities, currentIdx) {
    var weakUnits = _weaknessUnits();
    var btns = container.querySelectorAll('.act-nav-btn');
    for (var i = 0; i < btns.length; i++) {
      var isActive = i === currentIdx;
      var act = activities[i];
      var saved = act && _state.progress && _state.progress.activities && _state.progress.activities[act.activity_id];
      var done = saved && saved.last_verdict === 'correct';
      var isWeak = weakUnits && act && act.tags && weakUnits[act.tags.unit];
      var diff = _diffIcon(act && act.weight);
      btns[i].style.background   = isActive ? 'var(--brand,#1f6b4a)' : 'var(--surface,#fbfaf6)';
      btns[i].style.color        = isActive ? '#fff' : (done ? 'var(--brand-deep,#124e35)' : 'var(--ink3,#7a7168)');
      btns[i].style.borderColor  = isActive ? 'var(--brand,#1f6b4a)' : (done ? 'var(--brand,#1f6b4a)' : (isWeak ? 'var(--hot,#a8301f)' : 'var(--line2,#cfc7b4)'));
      btns[i].title = (done ? '완료 ✓ · ' : '') + '난이도: ' + diff.label + (isWeak ? ' · 약점 영역' : '');
    }
    var countEl = container.querySelector('.act-count');
    if (countEl) countEl.textContent = (currentIdx + 1) + ' / ' + activities.length;
  }

  /* ─────────────────────────────────────────────
     활동 전환 — Univer dispose 후 새 활동으로 리마운트
  ───────────────────────────────────────────── */
  /**
   * @param {HTMLElement}   container
   * @param {object}        ctx
   * @param {Array}         activities
   * @param {number}        idx
   * @param {boolean}       [keepResult=false]  true이면 채점 결과 영역 유지 (Reset 버튼용)
   */
  function _switchExcelActivity(container, ctx, activities, idx, keepResult) {
    _state.activityIndex = idx;
    _state.activity = activities[idx] || null;
    var activity = _state.activity;

    // 기존 Univer dispose
    if (_state.univerAPI) {
      try { if (typeof _state.univerAPI.dispose === 'function') _state.univerAPI.dispose(); } catch (e) {}
      _state.univerAPI = null;
    }

    // 문제 지문 업데이트
    var promptEl = container.querySelector('.excel-prompt');
    if (promptEl && activity) promptEl.textContent = (activity.front && activity.front.prompt) || '';

    // 채점 결과 초기화 — keepResult=true(Reset 버튼)이면 피드백 보존
    var resultEl = container.querySelector('.excel-result');
    if (resultEl && !keepResult) resultEl.innerHTML = '';

    // activity-id 속성 갱신
    var wrap = container.querySelector('.excel-wrap');
    if (wrap && activity) wrap.setAttribute('data-activity-id', activity.activity_id);

    // Univer 리마운트
    var univerContainer = container.querySelector('.excel-univer-container');
    if (univerContainer && activity) {
      univerContainer.innerHTML = ''; // 기존 캔버스 제거
      if (_checkUniver()) {
        var initialGrid = (activity.front && activity.front.initial_grid) || [['']];
        try {
          var result = _mountUniver(univerContainer, initialGrid);
          _state.univerAPI = result.univerAPI;
        } catch (e) {
          univerContainer.textContent = 'Univer 초기화 실패: ' + e.message;
        }
      }
    }

    // 네비게이션 배지 갱신
    _updateNavBadges(container, activities, idx);
  }

  // _bindWeaknessFilter 제거 — mount()의 이벤트 위임 단일 리스너로 통합
  // (nav DOM 재생성 후에도 container 레벨 click 리스너가 처리함)

  /* ─────────────────────────────────────────────
     UI HTML 생성
  ───────────────────────────────────────────── */
  /**
   * @param {object} activity
   * @param {Array}  activities
   * @param {number} currentIdx
   * @returns {string}
   */
  function _buildHTML(activity, activities, currentIdx) {
    var prompt = (activity && activity.front && activity.front.prompt) || '(문제 없음)';
    var actId  = (activity && activity.activity_id) || '';
    var navHtml = _buildNavHTML(activities, currentIdx, _state.weaknessOnly);
    var diff = _diffIcon(activity && activity.weight);

    return [
      '<div class="excel-wrap" data-activity-id="' + _esc(actId) + '">',

      /* 활동 네비게이션 바 */
      navHtml,

      /* 문제 지문 */
      '<div class="excel-problem" style="' +
        'background:var(--surface2,#f2eee5);' +
        'border:1px solid var(--line2,#cfc7b4);' +
        'border-radius:var(--r,10px);padding:14px 16px;margin-bottom:12px">',
      '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">',
      '    <div class="excel-badge plugin-badge">EXCEL 실습</div>',
      '    <span style="font-size:0.75em;color:' + diff.color + ';font-weight:500">' + _esc(diff.label) + '</span>',
      '  </div>',
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
      '          style="padding:8px 22px;border-radius:var(--r,10px);border:none;' +
        'background:var(--brand,#1f6b4a);color:#fff;cursor:pointer;font-weight:600">',
      '    채점',
      '  </button>',
      '  <button type="button" class="excel-btn-reset"',
      '          style="padding:8px 16px;border-radius:var(--r,10px);border:1px solid var(--line2,#cfc7b4);background:var(--surface,#fbfaf6);cursor:pointer;font-size:var(--fs-sm,12.5px);color:var(--ink3,#7a7168)">',
      '    초기화',
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

    // 해시에서 초기 인덱스 취득 (#.../excel/N 형태 지원)
    var initIdx = 0;
    try {
      var hashParts = window.location.hash.split('/');
      var hashNum = parseInt(hashParts[2], 10);
      if (!isNaN(hashNum) && hashNum >= 0 && hashNum < activities.length) {
        initIdx = hashNum;
      }
    } catch (e) {}

    _state.activityIndex = initIdx;
    _state.activity = activities[initIdx] || null;

    // HTML 골격 주입
    container.innerHTML = _buildHTML(_state.activity, activities, initIdx);

    // Univer CDN 로드 여부 확인
    if (!_checkUniver()) {
      var errEl = container.querySelector('.excel-univer-container');
      if (errEl) {
        errEl.style.cssText = 'padding:20px;color:var(--hot,#a8301f);background:var(--surface2,#f2eee5)';
        errEl.textContent =
          'Univer CDN 미로드. index.html에서 @univerjs/presets · @univerjs/preset-sheets-core 스크립트를 shell.js 앞에 추가하세요.';
      }
      return Promise.resolve();
    }

    // Univer 스프레드시트 마운트
    var activity    = _state.activity;
    var initialGrid = (activity && activity.front && activity.front.initial_grid) || [['']];
    var univerContainer = container.querySelector('.excel-univer-container');
    _state.univerContainer = univerContainer;

    try {
      var result = _mountUniver(univerContainer, initialGrid);
      _state.univerAPI = result.univerAPI;
    } catch (e) {
      console.error('[excel] Univer 마운트 실패:', e);
      if (univerContainer) {
        univerContainer.style.cssText = 'padding:20px;color:var(--hot,#a8301f)';
        univerContainer.textContent = 'Univer 초기화 실패: ' + e.message;
      }
      return Promise.resolve();
    }

    // Submit(채점) 버튼 바인딩
    var submitBtn = container.querySelector('.excel-btn-submit');
    var resultEl  = container.querySelector('.excel-result');

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        // 채점 중 중복 클릭 방어
        if (_state.scoreInFlight) return;
        if (!_state.activity) {
          _showResult(resultEl, null, '문제가 로드되지 않았습니다.');
          return;
        }
        if (!_state.univerAPI) {
          _showResult(resultEl, null, 'Univer 초기화 실패 — 페이지를 새로고침하세요.');
          return;
        }
        _state.scoreInFlight = true;
        submitBtn.disabled = true;
        _showResult(resultEl, null, '채점 중...', null);
        score().then(function (scoreResult) {
          var back = (_state.activity && _state.activity.back) || null;
          _showResult(resultEl, scoreResult, null, back);
          ctx.emit({ type: 'activity-completed', result: scoreResult });
          // 채점 후 네비게이션 배지 갱신 (정답 시 배지 반영)
          _updateNavBadges(container, activities, _state.activityIndex);
        }).catch(function (e) {
          _showResult(resultEl, null, '채점 오류: ' + e.message);
        }).then(function () {
          _state.scoreInFlight = false;
          submitBtn.disabled = false;
        });
      });
    }

    // Reset(초기화) 버튼 — 시트만 초기화, 채점 결과는 유지 (학습 피드백 분석 보호)
    var resetBtn = container.querySelector('.excel-btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        _switchExcelActivity(container, ctx, activities, _state.activityIndex, true /* keepResult */);
      });
    }

    // 이벤트 위임 — nav 영역 단일 리스너 (nav-btn + weakness-filter 모두 처리)
    // DOM 재생성 후에도 container 레벨 리스너 하나로 영구 동작
    container.addEventListener('click', function (e) {
      var navBtn = e.target.closest && e.target.closest('.act-nav-btn');
      if (navBtn) {
        var newIdx = parseInt(navBtn.getAttribute('data-act-idx'), 10);
        if (!isNaN(newIdx) && newIdx !== _state.activityIndex) {
          _switchExcelActivity(container, ctx, activities, newIdx);
        }
        return;
      }
      var filterBtn = e.target.closest && e.target.closest('.act-weakness-filter');
      if (filterBtn) {
        _state.weaknessOnly = !_state.weaknessOnly;
        // nav 영역만 교체 (Univer·결과 건드리지 않음)
        var navEl = container.querySelector('.act-nav');
        if (navEl) {
          var tempDiv = document.createElement('div');
          tempDiv.innerHTML = _buildNavHTML(activities, _state.activityIndex, _state.weaknessOnly);
          var newNav = tempDiv.firstChild;
          navEl.parentNode.replaceChild(newNav, navEl);
        }
        _updateNavBadges(container, activities, _state.activityIndex);
      }
    });

    // 초기 배지 상태 반영
    _updateNavBadges(container, activities, initIdx);

    // 진도 복원 지연 플러시 (onProgressRestored가 mount 전에 호출된 경우)
    _flushPendingRestore();

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

    _state.mounted         = false;
    _state.host            = null;
    _state.ctx             = null;
    _state.activity        = null;
    _state.activityIndex   = 0;
    _state.univerContainer = null;
    _state.weaknessOnly    = false;
    _state.scoreInFlight   = false;
    _state.progress        = null;   // 재마운트 시 오염 방지 — 진도는 localStorage 재로드
    _state.restored        = false;
    _state.pendingSnapshot = null;
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
      // timeout은 사용자 시도가 아니므로 진도 갱신 건너뜀 (런타임규격 §5-3 last_verdict 계약 준수)
      if (result.verdict !== 'timeout') {
        _updateProgress(activity.activity_id, result);
      }
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
     mid: 셀 스냅샷 복원 (cell_snapshot → createWorkbook 재주입)
  ───────────────────────────────────────────── */
  function onProgressRestored(snapshot) {
    if (!snapshot) return;
    _state.progress = snapshot;
    _state.restored = true;

    // univerAPI가 아직 null이면 지연 큐에 보관 → mount() 완료 후 _flushPendingRestore()에서 처리
    if (!_state.univerAPI) {
      _state.pendingSnapshot = snapshot;
      return;
    }
    _applySnapshotRestore(snapshot);
  }

  /** 셀 스냅샷 실제 재주입 (univerAPI 준비됐을 때만 호출) */
  function _applySnapshotRestore(snapshot) {
    var activityId = _state.activity && _state.activity.activity_id;
    if (!activityId) return;
    var entry = snapshot.activities && snapshot.activities[activityId];
    if (!entry) return;
    var savedSnapshot = entry.plugin_extra && entry.plugin_extra.cell_snapshot;
    if (!savedSnapshot) return;

    // createWorkbook으로 스냅샷 재주입 (getSnapshot() 반환값을 그대로 전달)
    try {
      _createWorkbook(_state.univerAPI, savedSnapshot);
    } catch (e) {
      // createWorkbook이 스냅샷 형태를 거부할 경우 무시 (graceful fallback)
      console.warn('[excel] onProgressRestored: createWorkbook 재주입 실패', e);
    }
  }

  /** mount() 완료 직후 호출 — onProgressRestored가 먼저 도착했을 때 플러시 */
  function _flushPendingRestore() {
    if (_state.pendingSnapshot && _state.univerAPI) {
      var snap = _state.pendingSnapshot;
      _state.pendingSnapshot = null;
      _applySnapshotRestore(snap);
    }
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
      if (!activity || !activity.tags || !activity.tags.area) return;
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
      if (!activity || !activity.tags || !activity.tags.area) return;
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

  /** 진도 캐시 업데이트 (mid: 셀 스냅샷 저장 포함) */
  function _updateProgress(activityId, result) {
    // feedback 없거나 passed/total 없으면 안전하게 0으로 폴백
    var fb = (result && result.feedback) || {};
    var snap = getProgressSnapshot();
    if (!snap.activities[activityId]) {
      snap.activities[activityId] = {
        cold_attempts: 0,
        cold_correct:  0,
        last_verdict:  null,
        plugin_extra:  { last_score: { passed: 0, total: 0 }, cell_snapshot: null }
      };
    }
    var entry = snap.activities[activityId];
    entry.cold_attempts++;
    if (result.verdict === 'correct') entry.cold_correct++;
    // last_verdict는 'correct' | 'incorrect' | null 만 허용 (런타임규격 §5-3)
    entry.last_verdict = (result.verdict === 'correct' || result.verdict === 'incorrect')
      ? result.verdict : null;

    // mid: 셀 스냅샷 저장 — getSnapshot() API가 존재할 때만 시도
    var cellSnapshot = null;
    try {
      if (_state.univerAPI) {
        var wb = _state.univerAPI.getActiveWorkbook();
        if (wb && typeof wb.getSnapshot === 'function') {
          cellSnapshot = wb.getSnapshot();
        }
      }
    } catch (e) {
      // getSnapshot() 미지원 버전 — 무시, cellSnapshot = null
    }

    entry.plugin_extra = {
      last_score: {
        passed: fb.passed != null ? fb.passed : 0,
        total:  fb.total  != null ? fb.total  : 0
      },
      cell_snapshot: cellSnapshot  // mid: 셀 스냅샷 (getSnapshot 지원 시)
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
  if (typeof window !== 'undefined') {
    window._EXCEL_PLUGIN = _instance;
  }

  /* ─────────────────────────────────────────────
     Node.js 테스트 전용 exports (브라우저 동작 불변)
     순수 채점 함수만 노출. DOM/Univer 의존 없음.
  ───────────────────────────────────────────── */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      _compareValue:   _compareValue,
      _runScore:       _runScore,
      _gridToCellData: _gridToCellData
    };
  }

})();
