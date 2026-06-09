/**
 * cad-print / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 — cad-print 플러그인
 * ────────────────────────────────────────────────────────────
 * SoT:
 *   - 규격/cad-print/런타임규격.md (2026-06-09)
 *   - 규격/_shared/실습러너계약.md
 *   - 규격/플러그인계약.md
 *
 * 의존 CDN (study.html에서 shell.js보다 먼저 로드):
 *   @jscad/modeling UMD  → window.jscadModeling  (UMD 번들)
 *     https://unpkg.com/@jscad/modeling@2/dist/jscad-modeling.min.js
 *   three.js 0.160.0 ESModule (importmap/module — 1회만, robot-arm 공유)
 *     https://unpkg.com/three@0.160.0/build/three.module.js
 *   practice-runner.js (_shared) → window.createPracticeRunner
 *
 * 채점 흐름 (런타임규격 §3):
 *   사용자 JSCAD 코드 → new Function 실행 → geometry
 *   → is_manifold(measureVolume) → measureVolume / measureBoundingBox
 *   → 오차 계산 → ScoreResult (진단형 feedback)
 *
 * file:// 안전: fetch 없음. CDN script 태그만. WASM/worker/iframe 금지.
 *
 * 등록 방식 (shell.js _registerPlugins 규칙):
 *   plugin_id = "cad-print"
 *   globalKey  = "_CAD_PRINT_PLUGIN"
 *   → window._CAD_PRINT_PLUGIN = instance
 *
 * 진도 localStorage 키: clf:cad-print:progress
 */
(function () {
  'use strict';

  var PLUGIN_ID    = 'cad-print';
  var PROGRESS_KEY = 'clf:cad-print:progress';

  /* ─────────────────────────────────────────────
     JSCAD 헬퍼 — window.jscadModeling 접근자
  ───────────────────────────────────────────── */
  function _jscad() {
    var j = (typeof jscadModeling !== 'undefined') ? jscadModeling :
            (typeof window !== 'undefined' && window.jscadModeling) ? window.jscadModeling : null;
    if (!j) {
      throw new Error(
        '[cad-print] jscadModeling를 찾을 수 없음. ' +
        'study.html에서 @jscad/modeling UMD CDN을 먼저 로드하세요.'
      );
    }
    return j;
  }

  /* ─────────────────────────────────────────────
     require 심(shim) — new Function 실행 시 주입
     런타임규격 §3-3 require 심 규칙 conform
  ───────────────────────────────────────────── */
  function _makeRequireShim() {
    return function requireShim(id) {
      var j = _jscad();
      // 서브경로 지원: '@jscad/modeling' or '@jscad/modeling'.primitives 등
      if (id === '@jscad/modeling') return j;
      // '@jscad/modeling/src/xxx' 형태는 unpkg UMD 번들에서 최상위 네임스페이스로 매핑
      if (id && id.indexOf('@jscad/modeling') === 0) {
        var subpath = id.replace('@jscad/modeling', '').replace(/^[./]+/, '');
        if (!subpath) return j;
        var parts = subpath.split('/');
        var cur = j;
        for (var i = 0; i < parts.length; i++) {
          if (cur && parts[i]) cur = cur[parts[i]];
        }
        return cur || j;
      }
      throw new Error('[cad-print] 모듈 미지원: ' + id);
    };
  }

  /* ─────────────────────────────────────────────
     JSCAD 코드 실행 (런타임규격 §3-3)
     타임아웃: 3초 (Promise.race)
  ───────────────────────────────────────────── */
  function _jscadRun(userCode) {
    try {
      var requireShim = _makeRequireShim();
      /* 'use strict' 추가 — 전역 오염 최소화 */
      var wrappedCode = '"use strict";\n' + userCode;
      var fn = new Function('require', 'module', 'exports', wrappedCode);
      var moduleObj = { exports: {} };
      fn(requireShim, moduleObj, moduleObj.exports);
      var main = (moduleObj.exports && moduleObj.exports.main) || moduleObj.exports;
      if (typeof main !== 'function') {
        return { ok: false, error: 'main 함수를 찾을 수 없습니다. module.exports = { main } 형태로 내보내세요.' };
      }
      var geometry = main();
      return { ok: true, geometry: geometry };
    } catch (e) {
      return { ok: false, error: String(e.message || e).split('\n')[0] };
    }
  }

  /* ─────────────────────────────────────────────
     매니폴드 검사 (런타임규격 §3-4)
     measureVolume NaN / ≤0 → 비매니폴드
  ───────────────────────────────────────────── */
  function _isManifold(geometry) {
    try {
      if (!geometry) return false;
      var j = _jscad();
      var vol = j.measurements.measureVolume(geometry);
      if (vol === null || vol === undefined) return false;
      if (isNaN(vol) || vol <= 0) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ─────────────────────────────────────────────
     score_raw 계산 (런타임규격 §3-6)
     manifold=false → 0
     vol_pass XOR bbox_pass → 0.5
     전체 통과 → 1
  ───────────────────────────────────────────── */
  function _calcScoreRaw(manifold, volPass, bboxPass) {
    if (!manifold) return 0;
    if (volPass && bboxPass) return 1;
    if (volPass || bboxPass) return 0.5;
    return 0;
  }

  /* ─────────────────────────────────────────────
     hint 진단 메시지 (런타임규격 §3-8, Hattie 피드백)
  ───────────────────────────────────────────── */
  function _diagnoseHint(volErrPct, volTarget, volUser, volPass, bboxDiff, bboxPass, grading) {
    if (volPass && bboxPass) {
      return '목표 형상과 일치합니다.';
    }
    if (!volPass) {
      var diff = volUser - volTarget;
      if (diff > 0) {
        return '부피가 목표보다 ' + volErrPct.toFixed(1) + '% 큼 (사용자: ' + volUser.toFixed(2) + ', 목표: ' + volTarget.toFixed(2) + ')';
      } else {
        return '부피가 목표보다 ' + volErrPct.toFixed(1) + '% 작음 (사용자: ' + volUser.toFixed(2) + ', 목표: ' + volTarget.toFixed(2) + ')';
      }
    }
    // 부피 통과, bbox 실패
    var axes = ['x', 'y', 'z'];
    var failAxes = [];
    for (var i = 0; i < 3; i++) {
      if (bboxDiff[i] > grading.bbox_tolerance) {
        failAxes.push(axes[i] + '축 ' + bboxDiff[i].toFixed(1) + 'mm 차이');
      }
    }
    if (failAxes.length > 0) {
      return '부피는 맞으나 ' + failAxes.join(', ');
    }
    return '바운딩박스 오차 초과';
  }

  /* ─────────────────────────────────────────────
     JSCAD geometry → THREE.BufferGeometry 변환
     런타임규격 §6 변환 규칙 conform
     geom3.toPolygons → vertices + indices
  ───────────────────────────────────────────── */
  function _jscadToThreeGeometry(geometry) {
    try {
      var T = (typeof THREE !== 'undefined') ? THREE :
              (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
      if (!T) return null;

      var j = _jscad();
      // JSCAD geom3 → polygons
      var polygons = j.geometries.geom3.toPolygons(geometry);
      if (!polygons || polygons.length === 0) return null;

      var positions = [];
      var normals   = [];
      var indices   = [];
      var vertexCount = 0;

      for (var pi = 0; pi < polygons.length; pi++) {
        var poly = polygons[pi];
        var verts = poly.vertices;
        if (!verts || verts.length < 3) continue;

        // 법선: 첫 두 엣지의 외적
        var v0 = verts[0], v1 = verts[1], v2 = verts[2];
        var ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
        var bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
        var nx = ay * bz - az * by;
        var ny = az * bx - ax * bz;
        var nz = ax * by - ay * bx;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; }

        // 폴리곤 삼각분할 (fan triangulation)
        var baseIdx = vertexCount;
        for (var vi = 0; vi < verts.length; vi++) {
          positions.push(verts[vi][0], verts[vi][1], verts[vi][2]);
          normals.push(nx, ny, nz);
          vertexCount++;
        }
        for (var ti = 1; ti < verts.length - 1; ti++) {
          indices.push(baseIdx, baseIdx + ti, baseIdx + ti + 1);
        }
      }

      var bufGeom = new T.BufferGeometry();
      bufGeom.setAttribute('position', new T.BufferAttribute(new Float32Array(positions), 3));
      bufGeom.setAttribute('normal',   new T.BufferAttribute(new Float32Array(normals),   3));
      bufGeom.setIndex(indices);
      return bufGeom;

    } catch (e) {
      console.warn('[cad-print] jscad→THREE 변환 오류:', e);
      return null;
    }
  }

  /* ─────────────────────────────────────────────
     3D 씬 구성: activity spec._setupScene 훅 구현
     practice-runner의 loadActivity(spec)에서 호출됨
  ───────────────────────────────────────────── */
  function _buildSetupScene(state) {
    return function setupScene(runnerCtx) {
      var T = (typeof THREE !== 'undefined') ? THREE :
              (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
      if (!T) return;

      var scene    = runnerCtx.scene;
      var renderer = runnerCtx.renderer;

      // 카메라: 45도 원근 카메라, 위에서 약간 기울여 배치
      var cam = new T.PerspectiveCamera(45, 1, 0.1, 10000);
      cam.position.set(40, 40, 60);
      cam.lookAt(0, 0, 0);
      runnerCtx.setCamera(cam);

      // 그리드 헬퍼 (바닥 격자)
      var grid = new T.GridHelper(100, 20, 0xccbbaa, 0xddcebb);
      scene.add(grid);

      // 씬 배경색 (밝은 크림)
      scene.background = new T.Color(0xf7f4ee);

      // 현재 geometry mesh 참조 보관
      var meshRef = { mesh: null };
      state._sceneMeshRef = meshRef;
      state._runnerCtx    = runnerCtx;

      // dispose 콜백 등록
      runnerCtx.setDispose(function () {
        if (meshRef.mesh) {
          try { meshRef.mesh.geometry.dispose(); } catch (e) {}
          try { meshRef.mesh.material.dispose(); } catch (e) {}
          scene.remove(meshRef.mesh);
          meshRef.mesh = null;
        }
      });

      // 렌더러 배경을 씬 배경으로
      if (renderer) renderer.setClearColor(0xf7f4ee, 1);
    };
  }

  /* ─────────────────────────────────────────────
     3D 미리보기: geometry를 씬에 추가
     "실행 미리보기" 버튼 클릭 시 호출 (코드 타이핑 시 자동 갱신 금지)
  ───────────────────────────────────────────── */
  function _updatePreview(state, geometry) {
    try {
      var T = (typeof THREE !== 'undefined') ? THREE :
              (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
      if (!T || !state._runnerCtx) return;

      var scene    = state._runnerCtx.scene;
      var meshRef  = state._sceneMeshRef;

      // 이전 mesh 제거
      if (meshRef && meshRef.mesh) {
        try { meshRef.mesh.geometry.dispose(); } catch (e) {}
        try { meshRef.mesh.material.dispose(); } catch (e) {}
        scene.remove(meshRef.mesh);
        meshRef.mesh = null;
      }

      if (!geometry) return;

      var bufGeom = _jscadToThreeGeometry(geometry);
      if (!bufGeom) return;

      var mat  = new T.MeshNormalMaterial({ side: T.DoubleSide });
      var mesh = new T.Mesh(bufGeom, mat);
      scene.add(mesh);
      if (meshRef) meshRef.mesh = mesh;

      // 카메라 자동 프레이밍
      bufGeom.computeBoundingSphere();
      var sphere = bufGeom.boundingSphere;
      if (sphere && state._runnerCtx.setCamera) {
        var cam = new T.PerspectiveCamera(45, 1, 0.1, 10000);
        var dist = sphere.radius * 3;
        cam.position.set(
          sphere.center.x + dist,
          sphere.center.y + dist * 0.8,
          sphere.center.z + dist
        );
        cam.lookAt(sphere.center);
        state._runnerCtx.setCamera(cam);
      }
    } catch (e) {
      console.warn('[cad-print] 미리보기 업데이트 오류:', e);
    }
  }

  /* ─────────────────────────────────────────────
     진도 localStorage 헬퍼
     __CLF__.loadPersist / savePersist 위임 (coding 플러그인 패턴)
  ───────────────────────────────────────────── */
  function _loadProgress() {
    try {
      if (window.__CLF__ && window.__CLF__.loadPersist) {
        return window.__CLF__.loadPersist(PROGRESS_KEY);
      }
      // fallback: 직접 localStorage
      var raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _saveProgress(snap) {
    try {
      if (window.__CLF__ && window.__CLF__.savePersist) {
        window.__CLF__.savePersist(PROGRESS_KEY, snap);
      } else {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(snap));
      }
    } catch (e) { /* 저장 실패 무시 */ }
  }

  /* ─────────────────────────────────────────────
     플러그인 내부 상태
  ───────────────────────────────────────────── */
  var _state = {
    mounted:       false,
    host:          null,   // HTMLElement — #plugin-host
    ctx:           null,   // PluginContext
    runner:        null,   // PracticeRunnerInstance
    activity:      null,   // 현재 ActivitySpec
    activityIndex: 0,
    editor:        null,   // textarea 또는 CodeMirror-compat 객체
    progress:      null,   // PluginProgressSnapshot (메모리 캐시)
    scoreInFlight: false,  // 채점 중복 방지
    _sceneMeshRef: null,   // { mesh: THREE.Mesh | null }
    _runnerCtx:    null    // practice-runner setupScene 훅의 runnerCtx
  };

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
     UI HTML 생성
  ───────────────────────────────────────────── */
  function _buildShellHTML(activities) {
    var navBtns = activities.map(function (act, i) {
      return '<button type="button" class="cad-nav-btn" data-act-idx="' + i + '" ' +
        'style="padding:5px 14px;border-radius:var(--r,10px);border:1px solid var(--line2,#cfc7b4);background:var(--surface,#fbfaf6);cursor:pointer;font-size:var(--fs-sm,12.5px);color:var(--ink3,#7a7168);transition:background 0.15s">' +
        _esc(act.activity_id || ('실습 ' + (i + 1))) +
        '</button>';
    }).join('\n');

    var navHtml = activities.length > 0 ? [
      '<div class="cad-nav" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--line2,#eee)">',
      navBtns,
      '<span class="cad-count" style="margin-left:auto;font-size:0.8em;color:var(--ink3,#888)">1 / ' + activities.length + '</span>',
      '</div>'
    ].join('\n') : '';

    return [
      '<div class="cad-wrap" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;height:100%;min-height:500px">',

      /* ── 왼쪽: 문제 + 에디터 + 버튼 ── */
      '<div class="cad-left" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto">',

      navHtml,

      /* 문제 패널 */
      '<div id="cad-problem-area" style="padding:12px;background:var(--surface2,#f2eee5);border-radius:8px;border:1px solid var(--line2,#ddd)"></div>',

      /* 힌트 패널 */
      '<div id="cad-hints-area" style="padding:10px 12px;background:var(--surface,#fbfaf6);border-radius:8px;border:1px solid var(--line2,#ddd);font-size:0.85em;color:var(--ink3,#666)"></div>',

      /* 에디터 영역 */
      '<div class="cad-editor-wrap" style="flex:1;min-height:180px;border:1px solid var(--line2,#cfc7b4);border-radius:8px;overflow:hidden"></div>',

      /* 버튼 */
      '<div class="cad-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">',
      '  <button type="button" class="cad-btn-preview"',
      '    style="padding:8px 18px;border-radius:var(--r,10px);border:1px solid var(--line2,#cfc7b4);background:var(--surface,#fbfaf6);cursor:pointer;font-size:var(--fs-sm,12.5px)">',
      '    실행 미리보기',
      '  </button>',
      '  <button type="button" class="cad-btn-submit"',
      '    style="padding:8px 22px;border-radius:var(--r,10px);border:none;background:var(--brand,#1f6b4a);color:#fff;cursor:pointer;font-weight:600">',
      '    제출·채점',
      '  </button>',
      '  <button type="button" class="cad-btn-solution"',
      '    style="display:none;padding:8px 16px;border-radius:var(--r,10px);border:1px solid var(--line2,#cfc7b4);background:var(--surface2,#f2eee5);cursor:pointer;font-size:var(--fs-sm,12.5px);color:var(--ink3,#7a7168)">',
      '    정답 코드 보기',
      '  </button>',
      '</div>',

      /* 채점 결과 */
      '<div class="cad-result" style="min-height:28px"></div>',

      /* 정답 코드 영역 */
      '<div class="cad-solution-area"></div>',

      '</div>', /* cad-left */

      /* ── 오른쪽: 3D 미리보기 캔버스 ── */
      '<div class="cad-right" style="position:relative;background:var(--surface,#f7f4ee);border-radius:8px;border:1px solid var(--line2,#ddd);overflow:hidden;min-height:300px">',
      '  <div class="cad-canvas-container" style="width:100%;height:100%;min-height:300px"></div>',
      '  <div class="cad-preview-label" style="position:absolute;top:8px;left:10px;font-size:0.75em;color:var(--ink3,#888);pointer-events:none">3D 미리보기</div>',
      '</div>',

      '</div>' /* cad-wrap */
    ].join('\n');
  }

  function _buildProblemHTML(activity) {
    if (!activity) return '<span style="color:var(--ink3,#999)">(문제 없음)</span>';
    var f = activity.front || {};
    var html = '';
    html += '<div style="font-size:0.82em;font-weight:700;color:var(--brand,#1f6b4a);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em">CAD 모델링 실습</div>';
    html += '<div style="white-space:pre-wrap;font-size:0.93em;line-height:1.6;color:var(--ink,#111);margin-bottom:8px">' + _esc(f.prompt || '') + '</div>';
    if (f.target_spec) {
      html += '<div style="font-size:0.83em;color:var(--ink2,#555);background:var(--surface,#fbfaf6);border-radius:6px;padding:6px 10px;border-left:3px solid var(--brand,#1f6b4a)">' +
        '<strong>목표:</strong> ' + _esc(f.target_spec) + '</div>';
    }
    return html;
  }

  function _buildHintsHTML(activity) {
    if (!activity) return '';
    var hints = (activity.front && activity.front.hints) || [];
    if (hints.length === 0) return '';
    var items = hints.map(function (h) {
      return '<li style="margin-bottom:4px">' + _esc(h) + '</li>';
    }).join('');
    return '<strong style="color:var(--ink2,#555)">힌트</strong><ul style="margin:6px 0 0 16px;padding:0">' + items + '</ul>';
  }

  /* ─────────────────────────────────────────────
     에디터 생성 (textarea fallback, CodeMirror 선택적)
  ───────────────────────────────────────────── */
  function _createEditor(target, initialCode) {
    if (typeof CodeMirror === 'function') {
      try {
        var cm = CodeMirror(target, {
          value:       initialCode || '',
          mode:        'javascript',
          lineNumbers: true,
          indentUnit:  2,
          tabSize:     2,
          lineWrapping: true,
          theme:       'default',
          autofocus:   true
        });
        return cm;
      } catch (e) { /* CodeMirror 실패 시 fallback */ }
    }
    // textarea fallback
    var ta = document.createElement('textarea');
    ta.value = initialCode || '';
    ta.style.cssText = 'width:100%;height:100%;min-height:180px;font-family:monospace;font-size:13px;padding:10px;border:none;outline:none;resize:none;background:var(--surface,#fff);color:var(--ink,#111)';
    ta.setAttribute('spellcheck', 'false');
    target.appendChild(ta);
    return {
      getValue: function () { return ta.value; },
      setValue: function (v) { ta.value = v; }
    };
  }

  /* ─────────────────────────────────────────────
     activity 전환
  ───────────────────────────────────────────── */
  function _applyActivity(container, activities, idx) {
    _state.activityIndex = idx;
    _state.activity = activities[idx] || null;
    var activity = _state.activity;

    // 문제·힌트 갱신
    var problemEl = container.querySelector('#cad-problem-area');
    if (problemEl) problemEl.innerHTML = _buildProblemHTML(activity);

    var hintsEl = container.querySelector('#cad-hints-area');
    if (hintsEl) hintsEl.innerHTML = _buildHintsHTML(activity);

    // 에디터 코드 갱신 (진도 저장 코드 우선)
    if (_state.editor && activity) {
      var code = (activity.front && activity.front.starter_code) || '';
      var saved = _state.progress && _state.progress.activities && _state.progress.activities[activity.activity_id];
      if (saved && saved.plugin_extra && saved.plugin_extra.last_code) {
        code = saved.plugin_extra.last_code;
      }
      _state.editor.setValue(code);
    }

    // 결과·솔루션 초기화
    var resultEl  = container.querySelector('.cad-result');
    var solBtn    = container.querySelector('.cad-btn-solution');
    var solArea   = container.querySelector('.cad-solution-area');
    if (resultEl) resultEl.innerHTML = '';
    if (solBtn)   solBtn.style.display = 'none';
    if (solArea)  solArea.innerHTML = '';

    // nav 버튼 활성 상태 갱신
    _applyNavState(container, activities, idx);

    // practice-runner에 activity 로드 (3D 씬 초기화)
    if (_state.runner) {
      var specWithHook = Object.assign({}, activity || {}, {
        _setupScene: _buildSetupScene(_state)
      });
      _state.runner.loadActivity(specWithHook);
    }
  }

  function _applyNavState(container, activities, activeIdx) {
    var btns = container.querySelectorAll('.cad-nav-btn');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var isActive = (i === activeIdx);
      var act = activities[i];
      var saved = act && _state.progress && _state.progress.activities && _state.progress.activities[act.activity_id];
      var done = saved && saved.last_verdict === 'correct';
      btn.style.background  = isActive ? 'var(--brand,#1f6b4a)' : 'var(--surface,#fbfaf6)';
      btn.style.color       = isActive ? '#fff' : (done ? 'var(--brand-deep,#124e35)' : 'var(--ink3,#7a7168)');
      btn.style.borderColor = isActive ? 'var(--brand,#1f6b4a)' : (done ? 'var(--brand,#1f6b4a)' : 'var(--line2,#cfc7b4)');
      var label = act ? (act.activity_id || ('실습 ' + (i + 1))) : ('실습 ' + (i + 1));
      btn.textContent = done ? label + ' ✓' : label;
    }
    var countEl = container.querySelector('.cad-count');
    if (countEl) countEl.textContent = (activeIdx + 1) + ' / ' + activities.length;
  }

  /* ─────────────────────────────────────────────
     채점 결과 렌더
  ───────────────────────────────────────────── */
  function _showResult(el, result, message) {
    if (!el) return;
    if (message) {
      el.innerHTML = '<span style="color:var(--ink3,#666);font-size:0.9em">' + _esc(message) + '</span>';
      return;
    }
    if (!result) return;

    var fb = result.feedback;
    var verdictColor = result.verdict === 'correct' ? 'var(--brand,#1f6b4a)' : 'var(--hot,#a8301f)';
    var verdictLabel = result.verdict === 'correct' ? '정답' : '오답';

    var html = '<div style="margin-top:8px;padding:10px 12px;border-radius:8px;border:1px solid ' +
      (result.verdict === 'correct' ? 'var(--brand,#1f6b4a)' : 'var(--line2,#ddd)') +
      ';background:' + (result.verdict === 'correct' ? 'var(--brand-bg,#e4efe7)' : 'var(--surface2,#f2eee5)') + '">';

    html += '<strong style="color:' + verdictColor + '">' + verdictLabel + '</strong>';
    html += ' <span style="font-size:0.85em;color:var(--ink3,#666)">(score_raw: ' + (fb.score_raw !== undefined ? fb.score_raw : result.score_raw) + ')</span>';

    // hint (진단 메시지)
    if (fb && fb.hint) {
      html += '<div style="margin-top:6px;font-size:0.88em;color:var(--ink2,#444)">' + _esc(fb.hint) + '</div>';
    }

    // 상세 수치 (error 없을 때)
    if (fb && !fb.error && fb.volume_user !== undefined) {
      html += '<div style="margin-top:8px;font-size:0.82em;color:var(--ink3,#666);display:grid;grid-template-columns:repeat(2,auto);gap:2px 16px">';
      html += '<span>부피(사용자):</span><span>' + (isNaN(fb.volume_user) ? 'NaN(비매니폴드)' : fb.volume_user.toFixed(2) + ' mm³') + '</span>';
      html += '<span>부피(목표):</span><span>' + fb.volume_target.toFixed(2) + ' mm³</span>';
      html += '<span>부피 오차:</span><span>' + (isFinite(fb.volume_err_pct) ? fb.volume_err_pct.toFixed(1) + '%' : '∞') + '</span>';
      if (Array.isArray(fb.bbox_diff)) {
        html += '<span>bbox 차이(x,y,z):</span><span>' + fb.bbox_diff.map(function (d) { return isFinite(d) ? d.toFixed(2) : '∞'; }).join(', ') + ' mm</span>';
      }
      html += '<span>매니폴드:</span><span>' + (fb.manifold ? '✓ 닫힌 솔리드' : '✗ 비매니폴드') + '</span>';
      html += '</div>';
    }

    // 실행 오류
    if (fb && fb.error) {
      html += '<div style="margin-top:6px;font-size:0.85em;color:var(--hot,#a8301f)">오류: ' + _esc(fb.error) + '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  }

  /* ─────────────────────────────────────────────
     진도 캐시 업데이트 (coding 플러그인 패턴)
  ───────────────────────────────────────────── */
  function _updateProgress(activityId, code, result) {
    var snap = getProgressSnapshot();
    if (!snap.activities[activityId]) {
      snap.activities[activityId] = {
        cold_attempts: 0,
        cold_correct:  0,
        last_verdict:  null,
        plugin_extra:  { last_code: '', last_score_raw: 0, manifold_ok: false }
      };
    }
    var entry = snap.activities[activityId];
    var priorVerdict = entry.last_verdict;
    if (priorVerdict !== 'correct') {
      entry.cold_attempts++;
      if (result.verdict === 'correct') entry.cold_correct++;
    }
    entry.last_verdict = result.verdict;
    entry.plugin_extra = {
      last_code:      code,
      last_score_raw: result.score_raw,
      manifold_ok:    !!(result.feedback && result.feedback.manifold)
    };
    _state.progress = snap;
    _saveProgress(snap);
  }

  /* ─────────────────────────────────────────────
     채점 핵심 로직 (런타임규격 §3-2 채점 절차)
     throw/crash 절대 금지 — 모든 예외 내부 처리
     @param {string}     userCode   사용자 JSCAD 코드
     @param {object}     grading    back.grading 객체
     @returns {Promise<ScoreResult>}
  ───────────────────────────────────────────── */
  function _gradeCode(userCode, grading) {
    return new Promise(function (resolve) {

      // [1] 코드 실행 (3초 타임아웃)
      var TIMEOUT_SENTINEL = {};
      var timeoutId = null;

      var runPromise = new Promise(function (resolveRun) {
        try {
          var runResult = _jscadRun(userCode);
          resolveRun(runResult);
        } catch (e) {
          resolveRun({ ok: false, error: String(e.message || e).split('\n')[0] });
        }
      });

      var timeoutPromise = new Promise(function (_, reject) {
        timeoutId = setTimeout(function () { reject(TIMEOUT_SENTINEL); }, 3000);
      });

      Promise.race([runPromise, timeoutPromise]).then(function (runResult) {
        if (timeoutId) clearTimeout(timeoutId);
        _finishGrading(runResult, grading, resolve);
      }).catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err === TIMEOUT_SENTINEL) {
          resolve({
            verdict:   'incorrect',
            score_raw: 0,
            grader_id: 'jscad',
            feedback:  {
              volume_user:    NaN,
              volume_target:  grading.volume_target,
              volume_err_pct: Infinity,
              bbox_diff:      [Infinity, Infinity, Infinity],
              manifold:       false,
              hint:           '코드 실행 시간 초과(3초) — 무한 루프 가능'
            }
          });
        } else {
          resolve({
            verdict:   'incorrect',
            score_raw: 0,
            grader_id: 'jscad',
            feedback:  {
              volume_user:    NaN,
              volume_target:  grading.volume_target,
              volume_err_pct: Infinity,
              bbox_diff:      [Infinity, Infinity, Infinity],
              manifold:       false,
              error:          String(err && (err.message || err) || '알 수 없는 오류').split('\n')[0],
              hint:           '코드 실행 오류'
            }
          });
        }
      });
    });
  }

  function _finishGrading(runResult, grading, resolve) {
    try {
      // 실행 오류
      if (!runResult.ok) {
        resolve({
          verdict:   'incorrect',
          score_raw: 0,
          grader_id: 'jscad',
          feedback:  {
            volume_user:    NaN,
            volume_target:  grading.volume_target,
            volume_err_pct: Infinity,
            bbox_diff:      [Infinity, Infinity, Infinity],
            manifold:       false,
            error:          runResult.error,
            hint:           '코드 실행 오류: ' + runResult.error
          }
        });
        return;
      }

      var geometry = runResult.geometry;

      // [2] 매니폴드 검사
      var manifold = _isManifold(geometry);
      if (!manifold) {
        resolve({
          verdict:   'incorrect',
          score_raw: 0,
          grader_id: 'jscad',
          feedback:  {
            volume_user:    NaN,
            volume_target:  grading.volume_target,
            volume_err_pct: Infinity,
            bbox_diff:      [Infinity, Infinity, Infinity],
            manifold:       false,
            hint:           '닫힌 솔리드 아님(매니폴드 깨짐) — CSG 불리언 연산 후 열린 면 확인'
          }
        });
        return;
      }

      // [3] 측정
      var j = _jscad();
      var volUser = NaN;
      var bbox = null;
      try {
        volUser = j.measurements.measureVolume(geometry);
        bbox    = j.measurements.measureBoundingBox(geometry);
      } catch (e) {
        resolve({
          verdict:   'incorrect',
          score_raw: 0,
          grader_id: 'jscad',
          feedback:  {
            volume_user:    NaN,
            volume_target:  grading.volume_target,
            volume_err_pct: Infinity,
            bbox_diff:      [Infinity, Infinity, Infinity],
            manifold:       false,
            error:          String(e.message || e).split('\n')[0],
            hint:           '측정 중 오류: ' + String(e.message || e).split('\n')[0]
          }
        });
        return;
      }

      // bbox 치수: [[minX,minY,minZ],[maxX,maxY,maxZ]]
      var bboxUser = { x: 0, y: 0, z: 0 };
      if (bbox && bbox[0] && bbox[1]) {
        bboxUser.x = Math.abs(bbox[1][0] - bbox[0][0]);
        bboxUser.y = Math.abs(bbox[1][1] - bbox[0][1]);
        bboxUser.z = Math.abs(bbox[1][2] - bbox[0][2]);
      }

      var volTarget  = grading.volume_target;
      var bboxTarget = grading.bbox_target;

      // [4] 오차 계산
      var volErrPct = Math.abs(volUser - volTarget) / volTarget * 100;
      var bboxDiff = [
        Math.abs(bboxUser.x - bboxTarget.x),
        Math.abs(bboxUser.y - bboxTarget.y),
        Math.abs(bboxUser.z - bboxTarget.z)
      ];

      // [5] 판정
      var volPass  = volErrPct  <= grading.volume_tolerance_pct;
      var bboxPass = bboxDiff[0] <= grading.bbox_tolerance &&
                     bboxDiff[1] <= grading.bbox_tolerance &&
                     bboxDiff[2] <= grading.bbox_tolerance;
      var verdict  = (manifold && volPass && bboxPass) ? 'correct' : 'incorrect';
      var scoreRaw = _calcScoreRaw(manifold, volPass, bboxPass);

      // [6] feedback 조립
      var hint = _diagnoseHint(volErrPct, volTarget, volUser, volPass, bboxDiff, bboxPass, grading);

      resolve({
        verdict:   verdict,
        score_raw: scoreRaw,
        grader_id: 'jscad',
        feedback:  {
          volume_user:    volUser,
          volume_target:  volTarget,
          volume_err_pct: volErrPct,
          bbox_diff:      bboxDiff,
          manifold:       true,
          hint:           hint,
          score_raw:      scoreRaw
        }
      });

      // 미리보기도 채점 성공 시 갱신 (geometry 재활용)
      _updatePreview(_state, geometry);

    } catch (e) {
      // 안전망: 절대 throw 금지
      resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'jscad',
        feedback:  {
          volume_user:    NaN,
          volume_target:  grading ? grading.volume_target : 0,
          volume_err_pct: Infinity,
          bbox_diff:      [Infinity, Infinity, Infinity],
          manifold:       false,
          error:          String(e.message || e).split('\n')[0],
          hint:           '채점 중 예기치 않은 오류'
        }
      });
    }
  }

  /* ─────────────────────────────────────────────
     PluginInstance: mount()
  ───────────────────────────────────────────── */
  function mount(container, ctx) {
    if (_state.mounted) unmount();

    _state.host    = container;
    _state.ctx     = ctx;
    _state.mounted = true;

    var activities = (window.ACTIVITIES && window.ACTIVITIES[PLUGIN_ID]) || [];

    // 진도 로드
    _state.progress = _loadProgress() || {
      plugin_id:      PLUGIN_ID,
      schema_version: 1,
      activities:     {}
    };

    // 셸 HTML 주입
    container.innerHTML = _buildShellHTML(activities);

    // 에디터 생성
    var editorWrap = container.querySelector('.cad-editor-wrap');
    if (editorWrap) {
      _state.editor = _createEditor(editorWrap, '');
    }

    // practice-runner 생성 (실습러너계약 §4 표준 패턴)
    if (typeof window.createPracticeRunner === 'function') {
      var canvasContainer = container.querySelector('.cad-canvas-container');
      if (canvasContainer) {
        _state.runner = window.createPracticeRunner({
          container: canvasContainer,
          onScore: function (result) {
            // 진도 캐시는 score() 내부에서 처리
          },
          onActivityComplete: function (result) {
            ctx.emit({ type: 'activity-completed', result: result });
          }
        });
      }
    }

    // 첫 activity 적용
    _applyActivity(container, activities, 0);

    // nav 버튼 이벤트
    var navBtns = container.querySelectorAll('.cad-nav-btn');
    for (var bi = 0; bi < navBtns.length; bi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var newIdx = parseInt(btn.getAttribute('data-act-idx'), 10);
          if (!isNaN(newIdx)) _applyActivity(container, activities, newIdx);
        });
      })(navBtns[bi]);
    }

    // "실행 미리보기" 버튼 (코드 실행 → 3D 렌더 갱신, 채점 없음)
    var previewBtn = container.querySelector('.cad-btn-preview');
    if (previewBtn) {
      previewBtn.addEventListener('click', function () {
        if (!_state.editor) return;
        var code = _state.editor.getValue();
        previewBtn.disabled = true;
        previewBtn.textContent = '실행 중...';
        setTimeout(function () {
          try {
            var runResult = _jscadRun(code);
            if (runResult.ok) {
              _updatePreview(_state, runResult.geometry);
              var resultEl = container.querySelector('.cad-result');
              if (resultEl) {
                resultEl.innerHTML = '<span style="color:var(--ink3,#666);font-size:0.88em">미리보기 업데이트 완료. 채점하려면 "제출·채점"을 누르세요.</span>';
              }
            } else {
              var resultEl2 = container.querySelector('.cad-result');
              if (resultEl2) _showResult(resultEl2, null, '실행 오류: ' + runResult.error);
            }
          } catch (e) {
            var resultEl3 = container.querySelector('.cad-result');
            if (resultEl3) _showResult(resultEl3, null, '실행 오류: ' + (e.message || e));
          }
          previewBtn.disabled = false;
          previewBtn.textContent = '실행 미리보기';
        }, 0);
      });
    }

    // "제출·채점" 버튼
    var submitBtn = container.querySelector('.cad-btn-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        if (_state.scoreInFlight) return;
        if (!_state.activity) {
          _showResult(container.querySelector('.cad-result'), null, '문제가 로드되지 않았습니다.');
          return;
        }
        var code = _state.editor ? _state.editor.getValue() : '';
        var submittedIdx = _state.activityIndex;
        _state.scoreInFlight = true;
        submitBtn.disabled = true;
        _showResult(container.querySelector('.cad-result'), null, '채점 중...');

        score(code).then(function (result) {
          if (_state.activityIndex !== submittedIdx) return;
          var resultEl = container.querySelector('.cad-result');
          _showResult(resultEl, result, null);

          // solution 버튼 노출 정책 (coding 플러그인 패턴)
          var solBtn = container.querySelector('.cad-btn-solution');
          var activity = _state.activity;
          if (solBtn && activity && activity.back) {
            var savedEntry = _state.progress && _state.progress.activities && _state.progress.activities[activity.activity_id];
            var attempts = savedEntry ? (savedEntry.cold_attempts || 0) : 0;
            if (result.verdict === 'correct') {
              solBtn.style.display = 'inline-block';
              solBtn.textContent = '정답 코드 확인 (선택)';
              solBtn.style.opacity = '0.55';
            } else if (attempts >= 2) {
              solBtn.style.display = 'inline-block';
              solBtn.textContent = '정답 코드 보기';
              solBtn.style.opacity = '';
            }
          }

          ctx.emit({ type: 'activity-completed', result: result });
          _applyNavState(container, activities, _state.activityIndex);
        }).catch(function (e) {
          _showResult(container.querySelector('.cad-result'), null, '채점 오류: ' + (e && (e.message || e)));
        }).then(function () {
          _state.scoreInFlight = false;
          submitBtn.disabled = false;
        });
      });
    }

    // "정답 코드 보기" 버튼
    var solBtn2 = container.querySelector('.cad-btn-solution');
    if (solBtn2) {
      solBtn2.addEventListener('click', function () {
        var activity = _state.activity;
        if (!activity || !activity.back) return;
        var solArea = container.querySelector('.cad-solution-area');
        if (!solArea) return;
        var html = '<div style="margin-top:8px;padding:12px;background:var(--surface2,#f2eee5);border-radius:6px;border:1px solid var(--line2,#ddd)">';
        html += '<div style="font-size:0.82rem;color:var(--ink3,#666);margin-bottom:6px">정답 코드:</div>';
        if (activity.back.solution_code) {
          html += '<pre style="margin:0;padding:10px;background:#1e1e1e;color:#d4d4d4;border-radius:4px;font-size:0.84em;overflow-x:auto;white-space:pre-wrap">' + _esc(activity.back.solution_code) + '</pre>';
        }
        if (activity.back.why) {
          html += '<div style="margin-top:8px;font-size:0.87rem;color:var(--ink2,#444)"><strong>이유:</strong> ' + _esc(activity.back.why) + '</div>';
        }
        if (activity.back.explanation) {
          html += '<div style="margin-top:4px;font-size:0.87rem;color:var(--ink2,#444)"><strong>해설:</strong> ' + _esc(activity.back.explanation) + '</div>';
        }
        html += '</div>';
        solArea.innerHTML = html;
        solBtn2.style.display = 'none';
      });
    }

    return Promise.resolve();
  }

  /* ─────────────────────────────────────────────
     PluginInstance: unmount() (실습러너계약 §5)
  ───────────────────────────────────────────── */
  function unmount() {
    if (_state.runner) {
      _state.runner.dispose();
      _state.runner = null;
    }
    if (_state.host) {
      _state.host.innerHTML = '';
      _state.host = null;
    }
    _state.mounted        = false;
    _state.ctx            = null;
    _state.editor         = null;
    _state.activity       = null;
    _state.activityIndex  = 0;
    _state.scoreInFlight  = false;
    _state._sceneMeshRef  = null;
    _state._runnerCtx     = null;
    _state.progress       = null;
  }

  /* ─────────────────────────────────────────────
     PluginInstance: score(userAnswer) (플러그인계약 §3)
     런타임규격 §4-2 conform
     @param {string} userAnswer  사용자 JSCAD 코드
     @returns {Promise<ScoreResult>}
  ───────────────────────────────────────────── */
  function score(userAnswer) {
    var code     = (typeof userAnswer === 'string') ? userAnswer : '';
    var activity = _state.activity;

    if (!activity) {
      return Promise.resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'jscad',
        feedback:  { volume_user: NaN, volume_target: 0, volume_err_pct: Infinity, bbox_diff: [Infinity, Infinity, Infinity], manifold: false, hint: '문제 없음' }
      });
    }

    if (!activity.back || !activity.back.grading) {
      return Promise.resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'jscad',
        feedback:  { volume_user: NaN, volume_target: 0, volume_err_pct: Infinity, bbox_diff: [Infinity, Infinity, Infinity], manifold: false, hint: '채점 기준(grading) 없음' }
      });
    }

    var grading = activity.back.grading;

    return _gradeCode(code, grading).then(function (result) {
      // 진도 캐시 업데이트
      _updateProgress(activity.activity_id, code, result);
      return result;
    });
  }

  /* ─────────────────────────────────────────────
     PluginInstance: getProgressSnapshot() (런타임규격 §4-3)
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
     PluginInstance: onProgressRestored(snapshot)
  ───────────────────────────────────────────── */
  function onProgressRestored(snapshot) {
    if (!snapshot) return;
    _state.progress = snapshot;
    if (_state.mounted && _state.editor && _state.activity) {
      var actId = _state.activity.activity_id;
      var saved = snapshot.activities && snapshot.activities[actId];
      if (saved && saved.plugin_extra && saved.plugin_extra.last_code) {
        _state.editor.setValue(saved.plugin_extra.last_code);
      }
    }
  }

  /* ─────────────────────────────────────────────
     PluginInstance: getDashboardContrib() (선택)
  ───────────────────────────────────────────── */
  function getDashboardContrib() {
    var snap  = getProgressSnapshot();
    var acts  = snap.activities || {};
    var actIds = Object.keys(acts);
    if (!actIds.length) return null;

    var areaMap = {};
    actIds.forEach(function (id) {
      var a = acts[id];
      var actList = (window.ACTIVITIES && window.ACTIVITIES[PLUGIN_ID]) || [];
      var activity = null;
      for (var i = 0; i < actList.length; i++) {
        if (actList[i].activity_id === id) { activity = actList[i]; break; }
      }
      if (!activity || !activity.tags) return;
      var key = activity.tags.area + '||' + activity.tags.subarea;
      if (!areaMap[key]) {
        areaMap[key] = { area: activity.tags.area, subarea: activity.tags.subarea, correct: 0, total: 0 };
      }
      areaMap[key].total++;
      if (a.last_verdict === 'correct') areaMap[key].correct++;
    });

    var byArea = Object.keys(areaMap).map(function (k) {
      var r = areaMap[k];
      return { area: r.area, subarea: r.subarea, retrieval_rate: r.total ? r.correct / r.total : null };
    });

    var weakness = [];
    actIds.forEach(function (id) {
      var a = acts[id];
      if (!a.cold_attempts) return;
      var actList2 = (window.ACTIVITIES && window.ACTIVITIES[PLUGIN_ID]) || [];
      var activity2 = null;
      for (var j = 0; j < actList2.length; j++) {
        if (actList2[j].activity_id === id) { activity2 = actList2[j]; break; }
      }
      if (!activity2 || !activity2.tags) return;
      var rate = (a.cold_attempts - a.cold_correct) / a.cold_attempts;
      if (rate > 0) weakness.push({ area: activity2.tags.area, subarea: activity2.tags.subarea, unit: activity2.tags.unit, wrong_rate: rate });
    });
    weakness.sort(function (a, b) { return b.wrong_rate - a.wrong_rate; });

    return {
      plugin_id:    PLUGIN_ID,
      by_area:      byArea,
      weakness:     weakness,
      pass_path:    [],
      completion:   byArea.map(function (r) { return { area: r.area, subarea: r.subarea, mastery_rate: r.retrieval_rate || 0, box_dist: { box1: 0, box2: 0, box3: 0 } }; }),
      extra_widgets: []
    };
  }

  /* ─────────────────────────────────────────────
     PluginInstance 조립
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
     shell.js 등록 규칙 준수
     plugin_id = "cad-print"
     globalKey  = "_CAD_PRINT_PLUGIN"
  ───────────────────────────────────────────── */
  window._CAD_PRINT_PLUGIN = _instance;

  /* ─────────────────────────────────────────────
     테스트 전용 export 가드 (Node.js 환경 한정)
     브라우저에서는 typeof module === 'undefined' → 실행 안 됨.
  ───────────────────────────────────────────── */
  if (typeof module !== 'undefined' && module.exports) {
    global._CAD_PRINT_TEST_EXPORTS = {
      _gradeCode:       _gradeCode,
      _isManifold:      _isManifold,
      _calcScoreRaw:    _calcScoreRaw,
      _diagnoseHint:    _diagnoseHint,
      _jscadRun:        _jscadRun,
      _makeRequireShim: _makeRequireShim
    };
  }

})();
