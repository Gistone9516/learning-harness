/**
 * robot-arm / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 — robot-arm 플러그인
 * ────────────────────────────────────────────────────────────
 * SoT: 규격/robot/런타임규격.md (2026-06-09)
 *
 * 범위(MVP): FK(정기구학) 슬라이더 실습만. 경로계획/IK = 파킹.
 * 도구: three.js(MIT, CDN 0.160.0) + 순수 JS 삼각함수 FK.
 *       물리엔진(cannon-es) 불요. WASM/worker/iframe 금지.
 *
 * 런타임 UI:
 *   - 관절각 슬라이더 N개 → 실시간 three.js 2D 암 렌더
 *   - 끝점(end-effector) 좌표 레이블
 *   - 목표점 마커 + 허용 반경 시각화
 *   - "제출·채점" 버튼
 *   - 결과: 진단형 피드백 (이진 pass/fail 금지, 런타임규격 §3-3)
 *
 * 등록 방식 (shell.js _registerPlugins 규칙):
 *   plugin_id = "robot-arm"
 *   → globalKey = "_ROBOT_ARM_PLUGIN"
 *   → window._ROBOT_ARM_PLUGIN = instance
 *
 * 진도 localStorage 키: clf:robot-arm:progress (플러그인계약 §5)
 * file:// 더블클릭 동작 (fetch 금지, CDN three.js만).
 *
 * practice-runner 의존:
 *   window.createPracticeRunner (실습러너계약 §3) — robot-arm보다 먼저 로드 필수.
 *   실습러너계약 §4 mount 표준 패턴 준수.
 *
 * 기계검증 (런타임규격 §8):
 *   V7  2링크(L1=100,L2=80), angles=[0,0] → FK 끝점 = (180, 0)
 *   V8  2링크(L1=100,L2=80), angles=[π/2, 0] → FK 끝점 ≈ (0, 180)
 *   V9  FK 공식 오차 < 1e-9
 *   V10 distance ≤ tolerance → verdict='correct', score_raw=1.0
 *   V11 distance > tolerance → verdict='incorrect', feedback.hint 비어있지 않음
 *   V12 관절한계 위반 → feedback.joint_violation 존재
 *   V13 관절한계 준수 → feedback.joint_violation 없음
 *   V14 score() throw 없음 — null/빈배열/NaN 모두 graceful
 *   V15 getProgressSnapshot().schema_version === 1
 *   V17 dispose() 2회 → throw 없음
 *   V20 score_raw ∈ [0, 1]
 */
(function () {
  'use strict';

  var PLUGIN_ID     = 'robot-arm';
  var PROGRESS_KEY  = 'clf:robot-arm:progress';

  /* ─────────────────────────────────────────────
     FK 순방향 계산 (런타임규격 §3-2)
     평면 2D, Z축 고정.
     기준 좌표계: 베이스(joint 0) = 원점 (0, 0).
     Y축 양의 방향 = 화면 위쪽.
     각도 단위: 라디안.
  ───────────────────────────────────────────── */
  /**
   * @param {Array<{length:number}>} links
   * @param {number[]} angles  — 라디안 배열
   * @returns {{x:number, y:number}}
   */
  function fkPlanar(links, angles) {
    var x = 0, y = 0, cumAngle = 0;
    for (var i = 0; i < links.length; i++) {
      cumAngle += (angles[i] || 0);
      x += links[i].length * Math.cos(cumAngle);
      y += links[i].length * Math.sin(cumAngle);
    }
    return { x: x, y: y };
  }

  /* ─────────────────────────────────────────────
     hint 생성 (런타임규격 §3-4)
     방향 정보(위/아래/왼쪽/오른쪽) 반드시 포함.
  ───────────────────────────────────────────── */
  function buildHint(distance, dx, dy, tolerance) {
    if (distance <= tolerance) {
      return '목표에 도달했습니다!';
    }
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);
    var thresh = tolerance * 0.3;

    // 주된 방향(절댓값 큰 쪽) 우선
    if (absDx <= thresh && absDy <= thresh) {
      return '거의 도달했습니다. 미세 조정이 필요합니다.';
    }
    if (absDx >= absDy) {
      if (dx < -thresh) return '끝점이 목표보다 x축 왼쪽에 있습니다.';
      if (dx >  thresh) return '끝점이 목표보다 x축 오른쪽에 있습니다.';
    }
    if (dy < -thresh) return '끝점이 목표보다 y축 아래에 있습니다.';
    if (dy >  thresh) return '끝점이 목표보다 y축 위에 있습니다.';
    // fallback: dx 기준
    return dx < 0
      ? '끝점이 목표보다 x축 왼쪽에 있습니다.'
      : '끝점이 목표보다 x축 오른쪽에 있습니다.';
  }

  /* ─────────────────────────────────────────────
     FK 채점 순수 함수 (런타임규격 §3-1 ~ §3-6)
     throw 금지 — 모든 오류 graceful 처리.
  ───────────────────────────────────────────── */
  /**
   * @param {object}   activity  ActivitySpec (robot-fk)
   * @param {number[]} rawAngles 관절각 배열 (라디안)
   * @returns {ScoreResult}
   */
  function scoreFK(activity, rawAngles) {
    var front    = (activity && activity.front) || {};
    var links    = Array.isArray(front.links) ? front.links : [];
    var target   = front.target || { x: 0, y: 0 };
    var tol      = (typeof front.tolerance === 'number' && front.tolerance > 0)
                     ? front.tolerance : 1;
    var limits   = Array.isArray(front.joint_limits) ? front.joint_limits : [];
    var n        = links.length;

    // ── 입력 방어 (런타임규격 §4-2) ──
    var angles;
    var inputWarning = '';
    if (!rawAngles || !Array.isArray(rawAngles)) {
      angles = new Array(n).fill(0);
      inputWarning = '입력이 없어 전 관절 0으로 대체했습니다. ';
    } else {
      angles = rawAngles.slice(0, n);
      while (angles.length < n) angles.push(0);
      if (rawAngles.length < n) {
        inputWarning = '입력 배열 길이 부족(' + rawAngles.length + '<' + n + '). 부족분 0 채움. ';
      }
      // NaN 요소 → 0 대체
      for (var i = 0; i < angles.length; i++) {
        if (typeof angles[i] !== 'number' || isNaN(angles[i])) {
          angles[i] = 0;
          inputWarning += '관절 ' + i + '번 각도 NaN → 0 대체. ';
        }
      }
    }

    // ── 관절한계 위반 검사 ──
    var violations = [];
    for (var j = 0; j < n; j++) {
      var lim = limits[j];
      if (!lim) continue;
      if (angles[j] < lim[0] || angles[j] > lim[1]) {
        violations.push({
          joint: j,
          angle: angles[j],
          min:   lim[0],
          max:   lim[1]
        });
      }
    }

    // ── FK 계산 ──
    var ee = fkPlanar(links, angles);

    // ── 유클리드 거리 ──
    var dx       = ee.x - target.x;
    var dy       = ee.y - target.y;
    var distance = Math.sqrt(dx * dx + dy * dy);

    // ── verdict / score_raw (런타임규격 §3-5, §3-6) ──
    var verdict;
    if (distance <= tol) {
      verdict = 'correct';
    } else {
      verdict = 'incorrect';
    }

    var maxDist = links.reduce(function (s, lk) { return s + lk.length; }, 0);
    var scoreRaw;
    if (verdict === 'correct') {
      scoreRaw = 1.0;
    } else if (maxDist > 0 && !isNaN(maxDist)) {
      scoreRaw = Math.max(0, 1 - distance / maxDist);
    } else {
      scoreRaw = 0;
    }
    // 범위 클램프 [0, 1]
    if (scoreRaw > 1) scoreRaw = 1;
    if (scoreRaw < 0) scoreRaw = 0;

    // ── hint 생성 ──
    var hint = buildHint(distance, dx, dy, tol);
    if (inputWarning) {
      hint = inputWarning + hint;
    }

    // ── feedback 조립 (런타임규격 §3-3) ──
    var feedback = {
      end_effector: [ee.x, ee.y],
      target:       [target.x, target.y],
      distance:     distance,
      dx:           dx,
      dy:           dy,
      hint:         hint
    };

    // joint_violation: 위반 있을 때만 필드 추가 (없으면 생략 — V13)
    if (violations.length > 0) {
      var msgs = violations.map(function (v) {
        return '관절 ' + v.joint + '번(현재 ' + v.angle.toFixed(4) + 'rad)이 ' +
          (v.angle < v.min
            ? '최소 한계(' + v.min.toFixed(4) + 'rad)보다 작습니다.'
            : '최대 한계(' + v.max.toFixed(4) + 'rad)를 초과했습니다.');
      });
      feedback.joint_violation = msgs.join(' / ');
    }

    return {
      verdict:   verdict,
      score_raw: scoreRaw,
      grader_id: 'engine',
      feedback:  feedback
    };
  }

  /* ─────────────────────────────────────────────
     진도 localStorage 헬퍼
     __CLF__.loadPersist / savePersist 위임 (플러그인계약 §5)
  ───────────────────────────────────────────── */
  function _loadProgress() {
    if (window.__CLF__ && window.__CLF__.loadPersist) {
      return window.__CLF__.loadPersist(PROGRESS_KEY);
    }
    // fallback: localStorage 직접 접근 (테스트 환경)
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _saveProgress(snap) {
    if (window.__CLF__ && window.__CLF__.savePersist) {
      window.__CLF__.savePersist(PROGRESS_KEY, snap);
      return;
    }
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(snap));
    } catch (e) { /* 저장 실패 무시 */ }
  }

  /* ─────────────────────────────────────────────
     HTML 이스케이프
  ───────────────────────────────────────────── */
  function _esc(s) {
    if (window.__CLF__ && window.__CLF__.esc) return window.__CLF__.esc(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────
     플러그인 내부 상태
  ───────────────────────────────────────────── */
  var _state = {
    mounted:   false,
    host:      null,   // HTMLElement — #plugin-host
    ctx:       null,   // PluginContext
    activity:  null,   // 현재 ActivitySpec
    runner:    null,   // PracticeRunnerInstance (practice-runner.js)
    angles:    [],     // 현재 슬라이더 값(라디안 배열)
    progress:  null,   // PluginProgressSnapshot (메모리 캐시)
    scoreInFlight: false
  };

  /* ─────────────────────────────────────────────
     three.js 씬 세팅 (spec._setupScene 훅)
     실습러너계약 §6: practice-runner 단독 소유.
     이 함수는 practice-runner의 loadActivity에서 호출됨.
  ───────────────────────────────────────────── */
  function _buildScene(runnerCtx, spec) {
    var T = (typeof THREE !== 'undefined') ? THREE :
            (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
    if (!T) {
      console.error('[robot-arm] THREE를 찾을 수 없음. three.js 0.160.0 CDN 로드 확인.');
      return;
    }

    var front    = spec.front;
    var links    = front.links;       // [{length}, ...]
    var target   = front.target;     // {x, y}
    var tol      = front.tolerance;
    var limits   = front.joint_limits;
    var n        = links.length;

    // 씬에 OrthographicCamera 설정 (런타임규격 §5-3)
    var container = runnerCtx.container;
    var w = container.clientWidth  || 400;
    var h = container.clientHeight || 300;
    var hw = w / 2, hh = h / 2;
    var cam = new T.OrthographicCamera(-hw, hw, hh, -hh, -100, 100);
    cam.position.set(0, 0, 10);
    runnerCtx.setCamera(cam);

    var scene = runnerCtx.scene;
    scene.background = new T.Color(0xf4f1ea);

    // ── 씬 요소 (런타임규격 §5-1) ──

    // 베이스 원
    var baseMesh = new T.Mesh(
      new T.CircleGeometry(6, 24),
      new T.MeshBasicMaterial({ color: 0x444444 })
    );
    scene.add(baseMesh);

    // 링크 메시 배열 (피벗 = 왼쪽 끝)
    var linkMeshes = [];
    for (var i = 0; i < n; i++) {
      var len = links[i].length;
      // BoxGeometry: 길이×8×1, 피벗을 왼쪽 끝으로 shift하기 위해 그룹 사용
      var geo  = new T.BoxGeometry(len, 8, 1);
      // 오른쪽 기준으로 pivot 이동: x offset = len/2
      geo.translate(len / 2, 0, 0);
      var mat  = new T.MeshBasicMaterial({ color: 0x6a9eb5 });
      var mesh = new T.Mesh(geo, mat);
      scene.add(mesh);
      linkMeshes.push(mesh);
    }

    // 관절 원 배열 (관절 0..n-1 위치)
    var jointMeshes = [];
    for (var ji = 0; ji < n; ji++) {
      var jm = new T.Mesh(
        new T.CircleGeometry(5, 20),
        new T.MeshBasicMaterial({ color: 0x888888 })
      );
      scene.add(jm);
      jointMeshes.push(jm);
    }

    // 끝점 마커 (초록)
    var eeMesh = new T.Mesh(
      new T.CircleGeometry(5, 20),
      new T.MeshBasicMaterial({ color: 0x1f6b4a })
    );
    eeMesh.position.z = 0.1;
    scene.add(eeMesh);

    // 목표 마커 (빨강, 런타임규격 §5-1)
    var targetMesh = new T.Mesh(
      new T.CircleGeometry(7, 24),
      new T.MeshBasicMaterial({ color: 0xa8301f, transparent: true, opacity: 0.85 })
    );
    targetMesh.position.set(target.x, target.y, 0.05);
    scene.add(targetMesh);

    // 허용 반경 시각화 (반투명 원)
    var tolMesh = new T.Mesh(
      new T.CircleGeometry(tol, 36),
      new T.MeshBasicMaterial({ color: 0xa8301f, transparent: true, opacity: 0.12 })
    );
    tolMesh.position.set(target.x, target.y, 0.04);
    scene.add(tolMesh);

    // ── 씬 업데이트 함수 (FK → 메시 갱신) ──
    function updateScene(angles) {
      var cumAngle = 0;
      var px = 0, py = 0;
      for (var k = 0; k < n; k++) {
        cumAngle += (angles[k] || 0);
        // 관절 k의 위치 = 이전 누적 끝점
        if (jointMeshes[k]) {
          jointMeshes[k].position.set(px, py, 0.2);
        }
        // 링크 k: 위치=(px,py), 회전=cumAngle
        if (linkMeshes[k]) {
          linkMeshes[k].position.set(px, py, 0);
          linkMeshes[k].rotation.z = cumAngle;
        }
        // 다음 관절 위치 = 현재 관절 + 링크 벡터
        px += links[k].length * Math.cos(cumAngle);
        py += links[k].length * Math.sin(cumAngle);
      }
      // 끝점 마커
      eeMesh.position.set(px, py, 0.3);
    }

    // 초기 씬 렌더
    updateScene(_state.angles);

    // practice-runner에 setDispose 등록 (씬 리소스 추가 정리 불필요 — renderer가 traverse처리)
    runnerCtx.setDispose(function () { /* no-op; renderer.dispose()가 처리 */ });

    // setUserAnswer: 슬라이더 변경 시마다 호출 (getUserAnswer()용)
    // 슬라이더 이벤트에서 직접 호출
    _state._updateScene = updateScene;
    _state._runnerCtx   = runnerCtx;
  }

  /* ─────────────────────────────────────────────
     슬라이더 UI 생성 헬퍼
  ───────────────────────────────────────────── */
  function _buildSliderUI(container, activity, runnerCtx) {
    var front  = activity.front;
    var links  = front.links;
    var limits = front.joint_limits;
    var n      = links.length;

    // 슬라이더 래퍼 div (캔버스 아래)
    var wrap = document.createElement('div');
    wrap.className = 'robot-arm-controls';
    wrap.style.cssText = [
      'padding:12px 0 8px;',
      'background:var(--surface,#fbfaf6);',
      'font-size:0.9em;',
      'font-family:var(--font-sans,sans-serif);'
    ].join('');

    // 끝점 레이블
    var eeLabel = document.createElement('div');
    eeLabel.className = 'robot-arm-ee-label';
    eeLabel.style.cssText = [
      'margin-bottom:8px;',
      'font-size:0.88em;',
      'color:var(--ink2,#555);',
      'font-family:monospace;'
    ].join('');
    eeLabel.textContent = '끝점: (0.0, 0.0)';
    wrap.appendChild(eeLabel);

    // 슬라이더 행 목록
    var sliderEls = [];
    for (var i = 0; i < n; i++) {
      var lim = limits[i] || [-Math.PI / 2, Math.PI / 2];
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

      var lbl = document.createElement('label');
      lbl.style.cssText = 'min-width:60px;font-size:0.85em;color:var(--ink3,#666);';
      lbl.textContent = '관절 ' + (i + 1) + ':';

      var slider = document.createElement('input');
      slider.type  = 'range';
      slider.min   = String(lim[0]);
      slider.max   = String(lim[1]);
      slider.step  = '0.01';
      slider.value = String(_state.angles[i] || 0);
      slider.style.cssText = 'flex:1;accent-color:var(--brand,#1f6b4a);';
      slider.setAttribute('aria-label', '관절 ' + (i + 1) + ' 각도 슬라이더');

      var valLbl = document.createElement('span');
      valLbl.style.cssText = 'min-width:52px;text-align:right;font-family:monospace;font-size:0.82em;color:var(--ink3,#666);';
      valLbl.textContent = (parseFloat(slider.value)).toFixed(2) + ' rad';

      sliderEls.push({ slider: slider, valLbl: valLbl, idx: i });

      row.appendChild(lbl);
      row.appendChild(slider);
      row.appendChild(valLbl);
      wrap.appendChild(row);
    }

    // 버튼 행
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;';

    var submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = '제출·채점';
    submitBtn.className = 'robot-arm-submit-btn';
    submitBtn.style.cssText = [
      'padding:8px 22px;',
      'border-radius:var(--r,10px);',
      'border:none;',
      'background:var(--brand,#1f6b4a);',
      'color:#fff;',
      'cursor:pointer;',
      'font-weight:600;',
      'font-size:0.93em;'
    ].join('');

    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = '초기화';
    resetBtn.style.cssText = [
      'padding:8px 16px;',
      'border-radius:var(--r,10px);',
      'border:1px solid var(--line2,#cfc7b4);',
      'background:var(--surface,#fbfaf6);',
      'cursor:pointer;',
      'font-size:0.88em;',
      'color:var(--ink3,#7a7168);'
    ].join('');

    btnRow.appendChild(submitBtn);
    btnRow.appendChild(resetBtn);
    wrap.appendChild(btnRow);

    // 결과 영역
    var resultEl = document.createElement('div');
    resultEl.className = 'robot-arm-result';
    resultEl.style.cssText = 'min-height:24px;margin-top:8px;';
    wrap.appendChild(resultEl);

    container.appendChild(wrap);

    // ── FK 업데이트 함수 ──
    function updateFK() {
      var angles = sliderEls.map(function (s) { return parseFloat(s.slider.value); });
      _state.angles = angles;
      runnerCtx.setUserAnswer(angles);

      var ee = fkPlanar(activity.front.links, angles);
      eeLabel.textContent = '끝점: (' + ee.x.toFixed(1) + ', ' + ee.y.toFixed(1) + ')';

      if (_state._updateScene) {
        _state._updateScene(angles);
      }
      // 이벤트 드리븐 렌더 (런타임규격 §5-2: requestAnimationFrame 불필요)
      // practice-runner의 루프가 처리하므로 추가 render() 호출 불필요
    }

    // 슬라이더 이벤트 바인딩
    sliderEls.forEach(function (s) {
      s.slider.addEventListener('input', function () {
        s.valLbl.textContent = parseFloat(s.slider.value).toFixed(2) + ' rad';
        updateFK();
      });
    });

    // 초기 FK 업데이트 (진도 복원값 또는 0)
    updateFK();

    // 초기화 버튼
    resetBtn.addEventListener('click', function () {
      sliderEls.forEach(function (s) {
        s.slider.value = '0';
        s.valLbl.textContent = '0.00 rad';
      });
      updateFK();
      resultEl.innerHTML = '';
    });

    // 제출 버튼 이벤트 → score() 호출
    submitBtn.addEventListener('click', function () {
      if (_state.scoreInFlight) return;
      _state.scoreInFlight = true;
      submitBtn.disabled = true;
      resultEl.innerHTML = '<span style="color:var(--ink3,#888)">채점 중...</span>';

      var answer = sliderEls.map(function (s) { return parseFloat(s.slider.value); });

      score(answer).then(function (result) {
        _showResult(resultEl, result, activity);
        // 실습러너계약 §7: score() 완료 후 emit
        if (_state.ctx) {
          _state.ctx.emit({ type: 'activity-completed', result: result });
        }
      }).catch(function (e) {
        resultEl.innerHTML = '<span style="color:var(--hot,#a8301f)">채점 오류: ' +
          _esc(String(e && e.message || e)) + '</span>';
      }).then(function () {
        _state.scoreInFlight = false;
        submitBtn.disabled = false;
      });
    });

    return { sliderEls: sliderEls, eeLabel: eeLabel, resultEl: resultEl, updateFK: updateFK };
  }

  /* ─────────────────────────────────────────────
     결과 렌더 (진단형 피드백, 이진 금지)
  ───────────────────────────────────────────── */
  function _showResult(el, result, activity) {
    if (!el || !result) return;
    var fb = result.feedback;
    var isCorrect = result.verdict === 'correct';
    var color = isCorrect ? 'var(--brand,#1f6b4a)' : 'var(--hot,#a8301f)';
    var label = isCorrect ? '정답 — 목표 도달!' : '오답';

    var html = '<div style="margin-top:6px;padding:10px 12px;border-radius:8px;' +
      'background:' + (isCorrect ? 'var(--brand-bg,#e4efe7)' : 'var(--hot-bg,#f9e7e2)') + ';' +
      'border:1px solid ' + (isCorrect ? 'var(--brand,#1f6b4a)' : 'var(--hot,#a8301f)') + '">';

    html += '<div><strong style="color:' + color + '">' + label + '</strong>';
    html += ' <span style="font-size:0.82em;color:var(--ink3,#666);font-family:monospace">' +
      '(거리: ' + fb.distance.toFixed(2) + ' / 허용: ' + _esc(String(activity.front.tolerance)) + ')</span></div>';

    // 진단 정보
    html += '<div style="margin-top:6px;font-size:0.86em;font-family:monospace;color:var(--ink2,#444)">' +
      '끝점: (' + fb.end_effector[0].toFixed(2) + ', ' + fb.end_effector[1].toFixed(2) + ')' +
      ' &nbsp;|&nbsp; 목표: (' + fb.target[0].toFixed(2) + ', ' + fb.target[1].toFixed(2) + ')' +
      ' &nbsp;|&nbsp; Δx=' + fb.dx.toFixed(2) + ', Δy=' + fb.dy.toFixed(2) +
      '</div>';

    // hint
    html += '<div style="margin-top:5px;font-size:0.9em;color:var(--ink2,#333)">' +
      _esc(fb.hint) + '</div>';

    // 관절한계 위반
    if (fb.joint_violation) {
      html += '<div style="margin-top:5px;font-size:0.82em;color:var(--warn,#9a5a09);' +
        'background:var(--warn-bg,#f8edd7);border-radius:4px;padding:4px 8px">' +
        '⚠ ' + _esc(fb.joint_violation) + '</div>';
    }

    // 해설 (back.why) — 정답 시만 표시
    if (isCorrect && activity.back && activity.back.why) {
      html += '<div style="margin-top:8px;font-size:0.85em;color:var(--ink3,#555);' +
        'border-top:1px solid rgba(0,0,0,0.08);padding-top:6px">' +
        '<strong>학습 포인트:</strong> ' + _esc(activity.back.why) + '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  }

  /* ─────────────────────────────────────────────
     진도 캐시 업데이트
  ───────────────────────────────────────────── */
  function _updateProgress(activityId, angles, result, distance) {
    var snap = _state.progress || _loadProgress() || {
      plugin_id:      PLUGIN_ID,
      schema_version: 1,
      activities:     {}
    };
    if (!snap.activities[activityId]) {
      snap.activities[activityId] = {
        cold_attempts:  0,
        cold_correct:   0,
        last_verdict:   null,
        plugin_extra:   { last_angles: [], last_distance: Infinity, best_distance: Infinity }
      };
    }
    var entry = snap.activities[activityId];
    var priorVerdict = entry.last_verdict;
    if (priorVerdict !== 'correct') {
      entry.cold_attempts++;
      if (result.verdict === 'correct') entry.cold_correct++;
    }
    entry.last_verdict = result.verdict;
    var prevBest = entry.plugin_extra.best_distance;
    if (typeof prevBest !== 'number' || isNaN(prevBest)) prevBest = Infinity;
    entry.plugin_extra = {
      last_angles:   angles || [],
      last_distance: distance,
      best_distance: Math.min(prevBest, distance)
    };
    _state.progress = snap;
    _saveProgress(snap);
  }

  /* ─────────────────────────────────────────────
     mount() — UI 주입 (런타임규격 §4-1, 실습러너계약 §4)
  ───────────────────────────────────────────── */
  /**
   * @param {HTMLElement}   container  #plugin-host
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  function mount(container, ctx) {
    if (_state.mounted) unmount();

    _state.host     = container;
    _state.ctx      = ctx;
    _state.mounted  = true;
    _state.angles   = [];
    _state.progress = _loadProgress() || {
      plugin_id:      PLUGIN_ID,
      schema_version: 1,
      activities:     {}
    };

    // activities 취득
    var activities = (window.ACTIVITIES && window.ACTIVITIES[PLUGIN_ID]) || [];
    var activity   = activities[0] || null;
    _state.activity = activity;

    if (!activity) {
      container.innerHTML =
        '<div style="padding:20px;color:var(--ink3,#888)">robot-arm: ActivitySpec 없음. ' +
        'window.ACTIVITIES["robot-arm"]를 먼저 등록하세요.</div>';
      return Promise.resolve();
    }

    // 진도에서 이전 angles 복원
    var savedEntry = _state.progress.activities[activity.activity_id];
    if (savedEntry && savedEntry.plugin_extra && Array.isArray(savedEntry.plugin_extra.last_angles)) {
      _state.angles = savedEntry.plugin_extra.last_angles.slice();
    } else {
      _state.angles = new Array(activity.front.links.length).fill(0);
    }

    // ── 캔버스 컨테이너 (위쪽 60%) ──
    container.innerHTML = '';
    container.style.display    = 'flex';
    container.style.flexDirection = 'column';

    var canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:0 0 280px;min-height:240px;position:relative;';
    container.appendChild(canvasWrap);

    var controlWrap = document.createElement('div');
    controlWrap.style.cssText = 'flex:1 1 auto;padding:0 4px;';
    container.appendChild(controlWrap);

    // ── practice-runner 생성 (실습러너계약 §4) ──
    _state.runner = window.createPracticeRunner({
      container: canvasWrap,
      onScore: function (result) {
        // 진도 캐시 업데이트는 submitBtn 핸들러에서 처리
      },
      onActivityComplete: function (result) {
        if (_state.ctx) {
          _state.ctx.emit({ type: 'activity-completed', result: result });
        }
      }
    });

    // spec에 _setupScene 훅 주입 (practice-runner의 loadActivity가 호출)
    var specWithHook = Object.assign({}, activity, {
      _setupScene: function (runnerCtx) {
        _buildScene(runnerCtx, activity);
      }
    });

    _state.runner.loadActivity(specWithHook);

    // ── 슬라이더 UI 생성 ──
    var ui = _buildSliderUI(controlWrap, activity, _state.runner);
    _state._ui = ui;

    return Promise.resolve();
  }

  /* ─────────────────────────────────────────────
     unmount() (실습러너계약 §5)
  ───────────────────────────────────────────── */
  function unmount() {
    if (_state.runner) {
      _state.runner.dispose();
      _state.runner = null;
    }
    if (_state.host) {
      _state.host.innerHTML = '';
      _state.host.style.display = '';
      _state.host.style.flexDirection = '';
      _state.host = null;
    }
    _state.mounted        = false;
    _state.ctx            = null;
    _state.activity       = null;
    _state.angles         = [];
    _state._ui            = null;
    _state._updateScene   = null;
    _state._runnerCtx     = null;
    _state.scoreInFlight  = false;
    _state.progress       = null;
  }

  /* ─────────────────────────────────────────────
     score(userAnswer) — 채점 (플러그인계약 §3, 런타임규격 §4-2)
     userAnswer: number[] | any (관절각 배열, 라디안)
     throw 금지 — graceful. Promise 반환.
  ───────────────────────────────────────────── */
  /**
   * @param {number[]} userAnswer
   * @returns {Promise<ScoreResult>}
   */
  function score(userAnswer) {
    try {
      var activity = _state.activity;
      if (!activity) {
        return Promise.resolve({
          verdict:   'incorrect',
          score_raw: 0,
          grader_id: 'engine',
          feedback:  {
            end_effector: [0, 0],
            target:       [0, 0],
            distance:     0,
            dx:           0,
            dy:           0,
            hint:         '문제가 로드되지 않았습니다.'
          }
        });
      }

      var rawAngles = Array.isArray(userAnswer) ? userAnswer
        : (userAnswer && Array.isArray(userAnswer.angles) ? userAnswer.angles : null);

      var result = scoreFK(activity, rawAngles);

      // 진도 캐시 업데이트
      var angles = Array.isArray(rawAngles) ? rawAngles : new Array(activity.front.links.length).fill(0);
      _updateProgress(activity.activity_id, angles, result, result.feedback.distance);

      return Promise.resolve(result);
    } catch (e) {
      // 최후 안전망 — throw 금지
      return Promise.resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  {
          end_effector: [0, 0],
          target:       [0, 0],
          distance:     0,
          dx:           0,
          dy:           0,
          hint:         '채점 중 오류 발생: ' + String(e && e.message || e)
        }
      });
    }
  }

  /* ─────────────────────────────────────────────
     getProgressSnapshot() (런타임규격 §4-3)
  ───────────────────────────────────────────── */
  function getProgressSnapshot() {
    if (!_state.progress) {
      _state.progress = _loadProgress() || {
        plugin_id:      PLUGIN_ID,
        schema_version: 1,
        activities:     {}
      };
    }
    return _state.progress;
  }

  /* ─────────────────────────────────────────────
     onProgressRestored(snapshot) (런타임규격 §4-4)
  ───────────────────────────────────────────── */
  function onProgressRestored(snapshot) {
    if (!snapshot) return;
    _state.progress = snapshot;

    // 이미 마운트된 상태에서 복원 시 슬라이더 즉시 갱신
    if (_state.mounted && _state.activity && _state._ui) {
      var actId = _state.activity.activity_id;
      var saved = snapshot.activities && snapshot.activities[actId];
      if (saved && saved.plugin_extra && Array.isArray(saved.plugin_extra.last_angles)) {
        var restored = saved.plugin_extra.last_angles;
        var ui = _state._ui;
        ui.sliderEls.forEach(function (s, idx) {
          if (typeof restored[idx] === 'number' && !isNaN(restored[idx])) {
            s.slider.value = String(restored[idx]);
            s.valLbl.textContent = restored[idx].toFixed(2) + ' rad';
          }
        });
        _state.angles = restored.slice();
        ui.updateFK();
      }
    }
  }

  /* ─────────────────────────────────────────────
     getDashboardContrib() — 선택 구현 (미구현 시 셸 기본집계)
  ───────────────────────────────────────────── */
  function getDashboardContrib() {
    return null; // 셸 기본집계(cold_correct/cold_attempts) 사용
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
     shell.js 등록 규칙 준수
     plugin_id = "robot-arm" → globalKey = "_ROBOT_ARM_PLUGIN"
  ───────────────────────────────────────────── */
  window._ROBOT_ARM_PLUGIN = _instance;

  /* ─────────────────────────────────────────────
     테스트 전용 export 가드 (Node.js 환경 한정)
     브라우저에서는 typeof module === 'undefined' → 실행 안 됨.
  ───────────────────────────────────────────── */
  if (typeof module !== 'undefined' && module.exports) {
    global._ROBOT_ARM_TEST_EXPORTS = {
      fkPlanar:   fkPlanar,
      buildHint:  buildHint,
      scoreFK:    scoreFK,
      pluginScore: score
    };
  }

})();
