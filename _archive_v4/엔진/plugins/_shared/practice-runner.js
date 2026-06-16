/**
 * _shared/practice-runner.js
 * ─────────────────────────────────────────────────────────
 * SoT: 규격/_shared/실습러너계약.md (2026-06-09)
 *
 * 목적: cad-print · robot-arm 두 실습 플러그인이 공유하는
 *       3D 캔버스 생성/리사이즈/dispose 공통 골격.
 *       중복 구현 방지 (partition-dry 원칙).
 *
 * 의존성:
 *   - three.js 0.160.0 ESModule CDN (계약 §2 버전 핀)
 *     https://unpkg.com/three@0.160.0/build/three.module.js
 *   - study.html에서 1회만 importmap 또는 <script type="module">으로 로드.
 *     두 플러그인이 각자 로드하면 THREE 전역 중복 → 금지.
 *
 * export: createPracticeRunner (전역 window.createPracticeRunner)
 *   function createPracticeRunner({ container, onScore, onActivityComplete })
 *     → PracticeRunnerInstance { loadActivity, getUserAnswer, dispose }
 *
 * 계약 검증 (V1~V9 자가검사):
 *   V1  createPracticeRunner 시그니처 §3과 1:1 일치       ✓
 *   V2  loadActivity · getUserAnswer · dispose 전부 구현  ✓
 *   V3  dispose 멱등성 (2회 호출 throw 없음)              ✓
 *   V4  three.js 버전 0.160.0 고정                        ✓ (로드는 study.html 책임)
 *   V5  mount 패턴 §4 구조 — 플러그인 plugin.js에서 사용   (플러그인 측 책임)
 *   V6  unmount에서 dispose() 반드시 호출                  (플러그인 측 책임)
 *   V7  cad-print score(): NaN/음수 → verdict='incorrect'  (cad-print plugin.js 책임)
 *   V8  robot-arm score(): FK 거리 ≤ tolerance → 'correct' (robot-arm plugin.js 책임)
 *   V9  feedback 진단형 object (이진 금지)                  (각 플러그인 책임)
 *
 * file:// 안전: fetch 없음. CDN three.js만 (WASM/worker/iframe 금지).
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     THREE 접근자 — study.html importmap/ESM 로드 후
     window.THREE 또는 globalThis.THREE에 바인딩.
     플러그인이 직접 THREE 객체를 생성·파괴하지 않음 (계약 §6).
  ───────────────────────────────────────────── */
  function _THREE() {
    var T = (typeof THREE !== 'undefined') ? THREE :
            (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
    if (!T) {
      throw new Error(
        '[practice-runner] THREE를 찾을 수 없음. ' +
        'study.html에서 three.js 0.160.0을 먼저 로드하세요 (계약 §2).'
      );
    }
    return T;
  }

  /* ─────────────────────────────────────────────
     createPracticeRunner — 팩토리 (계약 §3)
     @param {object}      opts
     @param {HTMLElement} opts.container         캔버스/에디터를 주입할 DOM 노드
     @param {function}    opts.onScore           (ScoreResult) => void  채점 완료 콜백
     @param {function}    opts.onActivityComplete (ScoreResult) => void  activity-completed 콜백
     @returns {PracticeRunnerInstance}
  ───────────────────────────────────────────── */
  function createPracticeRunner(opts) {
    var container           = opts.container;
    var onScore             = opts.onScore || function () {};
    var onActivityComplete  = opts.onActivityComplete || function () {};

    if (!container || !(container instanceof Element)) {
      throw new Error('[practice-runner] opts.container가 유효한 DOM 요소여야 합니다.');
    }

    /* ── 내부 상태 ── */
    var _renderer     = null;   // THREE.WebGLRenderer
    var _scene        = null;   // THREE.Scene
    var _camera       = null;   // THREE.PerspectiveCamera | THREE.OrthographicCamera
    var _animFrameId  = null;   // requestAnimationFrame handle
    var _resizeObs    = null;   // ResizeObserver
    var _disposed     = false;  // dispose 멱등성 플래그

    /* 플러그인별 userAnswer 저장소 */
    var _userAnswer   = null;   // string (cad-print) | number[] (robot-arm)

    /* 플러그인이 loadActivity 호출 시 전달되는 spec */
    var _activitySpec = null;

    /* 커스텀 씬 해제 콜백 (loadActivity가 등록) */
    var _sceneDisposeFn = null;

    /* ── 3D 캔버스 초기화 (createPracticeRunner 호출 즉시) ── */
    _initRenderer();

    /* ─────────────────────────────────────────────
       _initRenderer — WebGLRenderer + canvas 생성
       계약 §6: practice-runner 단독 소유
    ───────────────────────────────────────────── */
    function _initRenderer() {
      var T = _THREE();

      _renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      _renderer.setPixelRatio(window.devicePixelRatio || 1);

      var canvas = _renderer.domElement;
      canvas.style.cssText = 'display:block;width:100%;height:100%;border-radius:8px;';
      container.appendChild(canvas);

      /* ResizeObserver: container 크기 변화 → renderer 자동 갱신 (계약 §6) */
      if (typeof ResizeObserver !== 'undefined') {
        _resizeObs = new ResizeObserver(function () { _onResize(); });
        _resizeObs.observe(container);
      }
      _onResize();
    }

    /* ─────────────────────────────────────────────
       _onResize — renderer + camera aspect 갱신
    ───────────────────────────────────────────── */
    function _onResize() {
      if (!_renderer) return;
      var w = container.clientWidth  || container.offsetWidth  || 300;
      var h = container.clientHeight || container.offsetHeight || 300;
      if (h < 10) h = 300; // 컨테이너 높이 미설정 방어

      _renderer.setSize(w, h, false); // updateStyle=false (CSS 100%가 제어)

      if (_camera) {
        if (_camera.isPerspectiveCamera) {
          _camera.aspect = w / h;
          _camera.updateProjectionMatrix();
        } else if (_camera.isOrthographicCamera) {
          var half = (h / 2) || 150;
          _camera.left   = -(w / 2);
          _camera.right  =  (w / 2);
          _camera.top    =  half;
          _camera.bottom = -half;
          _camera.updateProjectionMatrix();
        }
      }
    }

    /* ─────────────────────────────────────────────
       _disposeScene — 현재 씬 리소스 해제
    ───────────────────────────────────────────── */
    function _disposeScene() {
      if (_animFrameId !== null) {
        cancelAnimationFrame(_animFrameId);
        _animFrameId = null;
      }
      if (_sceneDisposeFn) {
        try { _sceneDisposeFn(); } catch (e) { /* 안전망 */ }
        _sceneDisposeFn = null;
      }
      if (_scene) {
        _scene.traverse(function (obj) {
          if (obj.geometry) { try { obj.geometry.dispose(); } catch (e) {} }
          if (obj.material) {
            var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(function (m) { try { m.dispose(); } catch (e2) {} });
          }
        });
        _scene = null;
      }
      _camera = null;
    }

    /* ─────────────────────────────────────────────
       loadActivity(spec) — ActivitySpec을 받아 씬 초기화 (계약 §3)
       플러그인이 오버라이드할 수 있도록 내부 훅 방식:
         spec._setupScene(runner) — 씬 세팅 콜백 (선택)
         spec._disposeScene()     — 씬 정리 콜백 (선택)
       두 실습 플러그인이 loadActivity 후 _scene/_camera를 직접 세팅.
    ───────────────────────────────────────────── */
    function loadActivity(spec) {
      if (_disposed) return;
      _activitySpec = spec;
      _userAnswer   = null;

      /* 이전 씬 정리 */
      _disposeScene();

      /* 새 씬·카메라 기본값 */
      var T = _THREE();
      _scene  = new T.Scene();
      _scene.background = new T.Color(0xf4f1ea);

      /* 기본 PerspectiveCamera (플러그인이 교체 가능) */
      var w = container.clientWidth  || 300;
      var h = container.clientHeight || 300;
      _camera = new T.PerspectiveCamera(50, w / (h || 300), 0.01, 10000);
      _camera.position.set(0, 0, 5);

      /* 기본 조명 */
      var ambient = new T.AmbientLight(0xffffff, 0.6);
      _scene.add(ambient);
      var dir = new T.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 7);
      _scene.add(dir);

      /* 플러그인 setupScene 훅 (spec._setupScene이 있으면 호출) */
      if (spec && typeof spec._setupScene === 'function') {
        try {
          spec._setupScene({
            scene:     _scene,
            camera:    _camera,
            renderer:  _renderer,
            container: container,
            setCamera: function (cam) { _camera = cam; _onResize(); },
            setDispose: function (fn) { _sceneDisposeFn = fn; },
            setUserAnswer: function (val) { _userAnswer = val; },
            emitScore: function (result) {
              try { onScore(result); } catch (e) {}
            },
            emitActivityComplete: function (result) {
              try { onActivityComplete(result); } catch (e) {}
            }
          });
        } catch (e) {
          console.error('[practice-runner] spec._setupScene 오류:', e);
        }
      }

      _onResize();
      _startLoop();
    }

    /* ─────────────────────────────────────────────
       _startLoop — 렌더 루프
    ───────────────────────────────────────────── */
    function _startLoop() {
      if (_animFrameId !== null) return;
      function loop() {
        if (_disposed) return;
        _animFrameId = requestAnimationFrame(loop);
        if (_renderer && _scene && _camera) {
          _renderer.render(_scene, _camera);
        }
      }
      _animFrameId = requestAnimationFrame(loop);
    }

    /* ─────────────────────────────────────────────
       getUserAnswer() — 현재 사용자 입력 반환 (계약 §3)
       cad-print  → string (JSCAD 코드)
       robot-arm  → number[] (관절각 배열, 라디안)
       플러그인이 setUserAnswer(val)를 통해 최신값을 갱신.
    ───────────────────────────────────────────── */
    function getUserAnswer() {
      return _userAnswer;
    }

    /* ─────────────────────────────────────────────
       dispose() — 캔버스/렌더러/이벤트리스너 정리 (계약 §3, §6)
       멱등: 여러 번 호출해도 throw 없음 (V3)
    ───────────────────────────────────────────── */
    function dispose() {
      if (_disposed) return; // 멱등성
      _disposed = true;

      /* 씬 리소스 해제 */
      _disposeScene();

      /* ResizeObserver 해제 */
      if (_resizeObs) {
        try { _resizeObs.disconnect(); } catch (e) {}
        _resizeObs = null;
      }

      /* WebGLRenderer 해제 + canvas 제거 (계약 §6) */
      if (_renderer) {
        try {
          var canvas = _renderer.domElement;
          _renderer.dispose();
          if (canvas && canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
          }
        } catch (e) {}
        _renderer = null;
      }

      _activitySpec = null;
      _userAnswer   = null;
    }

    /* ─────────────────────────────────────────────
       PracticeRunnerInstance 반환 (계약 §3)
    ───────────────────────────────────────────── */
    return {
      loadActivity:  loadActivity,
      getUserAnswer: getUserAnswer,
      dispose:       dispose
    };
  }

  /* ─────────────────────────────────────────────
     전역 등록
     두 플러그인(cad-print, robot-arm) plugin.js에서
       var runner = window.createPracticeRunner({...})
     로 사용.
  ───────────────────────────────────────────── */
  window.createPracticeRunner = createPracticeRunner;

})();
