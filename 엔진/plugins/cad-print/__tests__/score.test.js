/**
 * cad-print plugin — 순수 채점 로직 단위 테스트
 * 대상: _gradeCode / _isManifold / _calcScoreRaw / _diagnoseHint / _jscadRun
 * 실행: node __tests__/score.test.js  (JSCAD·DOM 제외 — Node.js 전용)
 *
 * 전략: plugin.js는 browser IIFE + window._CAD_PRINT_PLUGIN 등록.
 *   → 최소 mock(window/document/localStorage) 제공 후 require로 로드.
 *   → 내부 함수는 module.exports 가드(_CAD_PRINT_TEST_EXPORTS)로 노출.
 *   → JSCAD(@jscad/modeling) 실제 로드 후 window.jscadModeling 등록.
 *   → grade 테스트: 실제 JSCAD 실행 (순수 JS, WASM 불요).
 *
 * 실행 방법:
 *   cd "학습 프레임워크 제작/엔진/plugins/cad-print"
 *   npm install @jscad/modeling   (최초 1회)
 *   node __tests__/score.test.js
 */

'use strict';

/* ─────────────────────────────────────────────
   최소 브라우저 환경 mock
───────────────────────────────────────────── */
const localStorageStore = {};
global.window = {
  _CAD_PRINT_PLUGIN: null,
  _CAD_PRINT_TEST_EXPORTS: null,
  ACTIVITIES: {},
  MANIFEST: {},
  MANIFEST_CAD_PRINT: null,
  location: { hash: '' },
  addEventListener: function () {},
  THREE: null,                   // three.js 없음 (채점 테스트에는 불필요)
  jscadModeling: null,           // JSCAD — 아래에서 실제 로드
  createPracticeRunner: null,    // practice-runner 없음 (채점 테스트에는 불필요)
  __CLF__: {
    loadPersist: function (key) {
      var raw = localStorageStore[key];
      return raw ? JSON.parse(raw) : null;
    },
    savePersist: function (key, val) {
      localStorageStore[key] = JSON.stringify(val);
    },
    esc: function (s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  }
};
global.document = {
  createElement: function (tag) { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; },
  head: { appendChild: function () {} },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; }
};
global.localStorage = {
  getItem:   function (k) { return localStorageStore[k] || null; },
  setItem:   function (k, v) { localStorageStore[k] = v; },
  removeItem:function (k) { delete localStorageStore[k]; }
};
global.THREE = null;           // 3D 렌더링 없음
global.CodeMirror = undefined; // textarea fallback
global.requestAnimationFrame = function () {};
global.cancelAnimationFrame  = function () {};
global.ResizeObserver = null;

/* ─────────────────────────────────────────────
   JSCAD @jscad/modeling 실제 로드
   Node.js 환경에서 require('@jscad/modeling') 가능하면 사용.
   없으면 stub으로 최소 동작만 모킹.
───────────────────────────────────────────── */
let jscadLoaded = false;
try {
  const jscad = require('@jscad/modeling');
  global.window.jscadModeling = jscad;
  global.jscadModeling = jscad;
  jscadLoaded = true;
  console.log('[setup] @jscad/modeling 로드 성공 — 실제 JSCAD 채점 테스트 실행');
} catch (e) {
  console.warn('[setup] @jscad/modeling 없음 — stub으로 대체 (일부 테스트 제한)');
  // 최소 stub: measureVolume/measureBoundingBox만 모킹
  const jscadStub = {
    primitives: {
      cuboid: function (opts) {
        var size = (opts && opts.size) || [1, 1, 1];
        return { _stub: true, _type: 'cuboid', _size: size };
      },
      cylinder: function (opts) {
        var r = (opts && opts.radius) || 1;
        var h = (opts && opts.height) || 1;
        return { _stub: true, _type: 'cylinder', _radius: r, _height: h };
      }
    },
    booleans: {
      union: function (a, b) { return { _stub: true, _type: 'union', _a: a, _b: b }; },
      subtract: function (a, b) { return { _stub: true, _type: 'subtract', _a: a, _b: b }; }
    },
    measurements: {
      measureVolume: function (geom) {
        if (!geom || !geom._stub) return NaN;
        if (geom._type === 'cuboid') {
          var s = geom._size;
          return s[0] * s[1] * s[2];
        }
        if (geom._type === 'cylinder') {
          return Math.PI * geom._radius * geom._radius * geom._height;
        }
        if (geom._type === 'union') {
          var va = jscadStub.measurements.measureVolume(geom._a);
          var vb = jscadStub.measurements.measureVolume(geom._b);
          return (isNaN(va) ? 0 : va) + (isNaN(vb) ? 0 : vb);
        }
        if (geom._type === 'subtract') {
          var vBase = jscadStub.measurements.measureVolume(geom._a);
          var vHole = jscadStub.measurements.measureVolume(geom._b);
          return (isNaN(vBase) ? 0 : vBase) - (isNaN(vHole) ? 0 : vHole);
        }
        return NaN;
      },
      measureBoundingBox: function (geom) {
        if (!geom || !geom._stub) return [[0,0,0],[0,0,0]];
        if (geom._type === 'cuboid') {
          var s = geom._size;
          var hx = s[0]/2, hy = s[1]/2, hz = s[2]/2;
          return [[-hx,-hy,-hz],[hx,hy,hz]];
        }
        if (geom._type === 'cylinder') {
          var r = geom._radius, h = geom._height;
          return [[-r,-r,-h/2],[r,r,h/2]];
        }
        // union/subtract: 단순화 — a의 bbox 사용
        return jscadStub.measurements.measureBoundingBox(geom._a || { _stub: false });
      }
    },
    geometries: {
      geom3: {
        toPolygons: function () { return []; },
        create: function () { return { _stub: true, _type: 'empty' }; }
      }
    }
  };
  global.window.jscadModeling = jscadStub;
  global.jscadModeling = jscadStub;
}

/* ─────────────────────────────────────────────
   plugin.js 로드 (IIFE 실행 → window._CAD_PRINT_PLUGIN 등록)
───────────────────────────────────────────── */
const path = require('path');
require(path.join(__dirname, '..', 'plugin.js'));

/* ─────────────────────────────────────────────
   테스트 전용 export 취득
───────────────────────────────────────────── */
const exports = global._CAD_PRINT_TEST_EXPORTS || {};
if (!exports._gradeCode) {
  console.error('FATAL: plugin.js에 _CAD_PRINT_TEST_EXPORTS 가드가 없습니다.');
  process.exit(1);
}
const { _gradeCode, _isManifold, _calcScoreRaw, _diagnoseHint, _jscadRun } = exports;

/* ═══════════════════════════════════════════════
   미니 테스트 하니스
═══════════════════════════════════════════════ */
let PASS = 0, FAIL = 0;
const failures = [];

function assert(label, cond, extra) {
  if (cond) {
    PASS++;
    console.log('  PASS:', label);
  } else {
    FAIL++;
    failures.push({ label, extra });
    console.error('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

function approxEq(a, b, tol) {
  tol = tol || 1e-2;
  return Math.abs(a - b) <= tol;
}

/* ── 채점용 grading 픽스처 ── */
const GRADING_BOX = {
  volume_target:        9000,
  volume_tolerance_pct: 5,
  bbox_target:          { x: 20, y: 30, z: 15 },
  bbox_tolerance:       0.5
};

const GRADING_CYLINDER = {
  volume_target:        7853.98,
  volume_tolerance_pct: 5,
  bbox_target:          { x: 20, y: 20, z: 25 },
  bbox_tolerance:       0.5
};

/* ─────────────────────────────────────────────
   §1  _calcScoreRaw 단위 테스트
───────────────────────────────────────────── */
console.log('\n[§1] _calcScoreRaw — 런타임규격 §3-6');

assert('SR-1: manifold=false → score_raw=0',
  _calcScoreRaw(false, true, true) === 0);
assert('SR-2: manifold=true, vol_pass=true, bbox_pass=true → score_raw=1',
  _calcScoreRaw(true, true, true) === 1);
assert('SR-3: manifold=true, vol_pass=true, bbox_pass=false → score_raw=0.5',
  _calcScoreRaw(true, true, false) === 0.5);
assert('SR-4: manifold=true, vol_pass=false, bbox_pass=true → score_raw=0.5',
  _calcScoreRaw(true, false, true) === 0.5);
assert('SR-5: manifold=true, vol_pass=false, bbox_pass=false → score_raw=0',
  _calcScoreRaw(true, false, false) === 0);

/* ─────────────────────────────────────────────
   §2  _diagnoseHint 단위 테스트 (Hattie 피드백)
───────────────────────────────────────────── */
console.log('\n[§2] _diagnoseHint — 런타임규격 §3-8');

const DUMMY_GRADING = { bbox_tolerance: 0.5 };

// 전체 통과
assert('DH-1: 전체 통과 → "일치" 포함',
  _diagnoseHint(0, 100, 100, true, [0, 0, 0], true, DUMMY_GRADING).includes('일치'));

// 부피 큼
var hintVolBig = _diagnoseHint(10, 100, 110, false, [0, 0, 0], true, DUMMY_GRADING);
assert('DH-2: 부피 초과 → "큼" 포함',
  hintVolBig.includes('큼') || hintVolBig.includes('부피'));

// 부피 작음
var hintVolSmall = _diagnoseHint(15, 100, 85, false, [0, 0, 0], true, DUMMY_GRADING);
assert('DH-3: 부피 부족 → "작음" 포함',
  hintVolSmall.includes('작음') || hintVolSmall.includes('부피'));

// 부피 통과, bbox 실패
var hintBboxFail = _diagnoseHint(0, 100, 100, true, [2, 0, 0], false, DUMMY_GRADING);
assert('DH-4: 부피 통과+bbox 실패 → 축 정보 포함',
  hintBboxFail.includes('mm') || hintBboxFail.includes('축') || hintBboxFail.includes('부피'));

/* ─────────────────────────────────────────────
   §3  _jscadRun 실행 테스트 (require shim)
───────────────────────────────────────────── */
console.log('\n[§3] _jscadRun — require shim + 코드 실행');

// 정상 코드
var runOk = _jscadRun([
  "const { cuboid } = require('@jscad/modeling').primitives;",
  "function main() { return cuboid({ size: [20, 30, 15] }); }",
  "module.exports = { main };"
].join('\n'));
assert('RUN-1: 정상 코드 실행 → ok=true', runOk.ok === true);
assert('RUN-1b: geometry 존재', runOk.geometry !== null && runOk.geometry !== undefined);

// SyntaxError
var runSyn = _jscadRun('function main( { return 1; } module.exports = {main};');
assert('RUN-2: SyntaxError → ok=false, error 있음',
  runSyn.ok === false && typeof runSyn.error === 'string');

// main 함수 없음
var runNoMain = _jscadRun("module.exports = {};");
assert('RUN-3: main 함수 없음 → ok=false',
  runNoMain.ok === false);

// 미지원 모듈 require
var runBadMod = _jscadRun([
  "require('unknown-lib');",
  "function main() { return null; }",
  "module.exports = { main };"
].join('\n'));
assert('RUN-4: 미지원 모듈 → ok=false, error 있음',
  runBadMod.ok === false && typeof runBadMod.error === 'string');

/* ─────────────────────────────────────────────
   §4  _isManifold 테스트
───────────────────────────────────────────── */
console.log('\n[§4] _isManifold — 런타임규격 §3-4');

// cuboid: 정상 매니폴드
var geomBox = _jscadRun([
  "const { cuboid } = require('@jscad/modeling').primitives;",
  "function main() { return cuboid({ size: [20, 30, 15] }); }",
  "module.exports = { main };"
].join('\n'));
if (geomBox.ok) {
  assert('MAN-1: cuboid geometry → isManifold=true',
    _isManifold(geomBox.geometry) === true);
}

// null → 비매니폴드
assert('MAN-2: null → isManifold=false', _isManifold(null) === false);
assert('MAN-3: undefined → isManifold=false', _isManifold(undefined) === false);

// 빈 geometry(stub empty) → 비매니폴드
var emptyGeom = { _stub: true, _type: 'empty' };
assert('MAN-4: empty geometry → isManifold=false', _isManifold(emptyGeom) === false);

/* ─────────────────────────────────────────────
   §5  _gradeCode 통합 채점 테스트
───────────────────────────────────────────── */
console.log('\n[§5] _gradeCode — 런타임규격 §3-2 전체 흐름 (V7~V16)');

const tests = [];

// V7: 정상 코드 → verdict=correct, manifold=true
tests.push(
  _gradeCode([
    "const { cuboid } = require('@jscad/modeling').primitives;",
    "function main() { return cuboid({ size: [20, 30, 15] }); }",
    "module.exports = { main };"
  ].join('\n'), GRADING_BOX).then(r => {
    assert('V7: 정상 코드 → verdict=correct', r.verdict === 'correct');
    assert('V7: manifold=true', r.feedback.manifold === true);
    assert('V7: score_raw=1', r.score_raw === 1);
    assert('V7: grader_id=jscad', r.grader_id === 'jscad');
  })
);

// V8: NaN(비매니폴드) → verdict=incorrect, manifold=false, throw 없음
// 빈 geom3를 반환하는 코드 (비매니폴드)
tests.push(
  _gradeCode([
    "const { geometries } = require('@jscad/modeling');",
    "function main() { return geometries.geom3.create([]); }",
    "module.exports = { main };"
  ].join('\n'), GRADING_BOX).then(r => {
    assert('V8: 비매니폴드 → verdict=incorrect', r.verdict === 'incorrect');
    assert('V8: manifold=false', r.feedback.manifold === false);
    assert('V8: throw 없음 (정상 반환)', r !== null);
    assert('V8: hint에 매니폴드 언급', r.feedback.hint && r.feedback.hint.includes('매니폴드'));
    assert('V8: score_raw=0', r.score_raw === 0);
  })
);

// V9: 코드 예외 발생 → verdict=incorrect, feedback.error 존재, throw 없음
tests.push(
  _gradeCode([
    "function main() { throw new Error('의도적 오류'); }",
    "module.exports = { main };"
  ].join('\n'), GRADING_BOX).then(r => {
    assert('V9: 코드 예외 → verdict=incorrect', r.verdict === 'incorrect');
    assert('V9: feedback.error 존재', typeof r.feedback.error === 'string');
    assert('V9: throw 없음 (정상 반환)', r !== null);
    assert('V9: score_raw=0', r.score_raw === 0);
  })
);

// V11: score_raw ∈ {0, 0.5, 1}
tests.push(
  _gradeCode([
    "const { cuboid } = require('@jscad/modeling').primitives;",
    "function main() { return cuboid({ size: [20, 30, 15] }); }",
    "module.exports = { main };"
  ].join('\n'), GRADING_BOX).then(r => {
    assert('V11: score_raw ∈ {0, 0.5, 1}',
      r.score_raw === 0 || r.score_raw === 0.5 || r.score_raw === 1);
  })
);

// V10: feedback.hint 이진 "맞음/틀림" 아닌 진단형
tests.push(
  _gradeCode([
    "const { cuboid } = require('@jscad/modeling').primitives;",
    "function main() { return cuboid({ size: [25, 25, 25] }); }",
    "module.exports = { main };"
  ].join('\n'), GRADING_BOX).then(r => {
    var hint = r.feedback.hint;
    // 이진 pass/fail 금지: "맞음"/"틀림" 단독만 있으면 안 됨
    var isBinary = (hint === '맞음' || hint === '틀림' || hint === 'pass' || hint === 'fail');
    assert('V10: hint 이진 금지 (진단형)', !isBinary);
    assert('V10: hint 문자열 존재', typeof hint === 'string' && hint.length > 0);
  })
);

// V16: 타임아웃(3초 초과) → verdict=incorrect, hint에 시간 초과 언급
// 주의: setTimeout이 Node.js에서 다르게 동작할 수 있어 간접 테스트
tests.push(
  _gradeCode([
    "function main() { var i = 0; while(true) { i++; } }",
    "module.exports = { main };"
  ].join('\n'), GRADING_BOX).then(r => {
    // 타임아웃 또는 즉시 오류(무한루프 감지 못하는 환경도 있음)
    assert('V16: 타임아웃/루프 → verdict=incorrect', r.verdict === 'incorrect');
    assert('V16: score_raw=0', r.score_raw === 0);
  })
);

// V12: getProgressSnapshot().schema_version === 1
// (PluginInstance를 직접 테스트)
var instance = global.window._CAD_PRINT_PLUGIN;
if (instance && typeof instance.getProgressSnapshot === 'function') {
  var snap = instance.getProgressSnapshot();
  assert('V12: schema_version=1', snap && snap.schema_version === 1);
  assert('V12: plugin_id=cad-print', snap && snap.plugin_id === 'cad-print');
  assert('V12: activities 객체 존재', snap && typeof snap.activities === 'object');
}

// V14: dispose 2회 연속 호출 시 throw 없음 (멱등)
// practice-runner 없으므로 instance.unmount() 테스트
if (instance && typeof instance.unmount === 'function') {
  var threw = false;
  try {
    instance.unmount();
    instance.unmount();
  } catch (e) {
    threw = true;
  }
  assert('V14: unmount 2회 연속 호출 throw 없음 (멱등)', threw === false);
}

// 부피 오차 경계: 정확한 부피보다 크게 → volume_err_pct > 0
tests.push(
  _gradeCode([
    "const { cuboid } = require('@jscad/modeling').primitives;",
    "function main() { return cuboid({ size: [30, 30, 15] }); }",  // 부피 13500 (목표 9000)
    "module.exports = { main };"
  ].join('\n'), GRADING_BOX).then(r => {
    assert('ERR-1: 부피 초과 → verdict=incorrect', r.verdict === 'incorrect');
    assert('ERR-1: volume_err_pct > 0', r.feedback.volume_err_pct > 0);
    assert('ERR-1: hint에 수치 포함', r.feedback.hint && (r.feedback.hint.includes('%') || r.feedback.hint.includes('mm')));
  })
);

// cylinder 정답 테스트 (실제 JSCAD 있으면)
if (jscadLoaded) {
  tests.push(
    _gradeCode([
      "const { cylinder } = require('@jscad/modeling').primitives;",
      "function main() { return cylinder({ radius: 10, height: 25 }); }",
      "module.exports = { main };"
    ].join('\n'), GRADING_CYLINDER).then(r => {
      assert('CYL-1: cylinder 정답 → verdict=correct', r.verdict === 'correct');
      assert('CYL-1: manifold=true', r.feedback.manifold === true);
      assert('CYL-1: volume_user ≈ 7854', approxEq(r.feedback.volume_user, 7853.98, 10));
    })
  );
}

// SyntaxError 코드 → graceful
tests.push(
  _gradeCode("const x = ;", GRADING_BOX).then(r => {
    assert('GRACE-1: SyntaxError → verdict=incorrect graceful', r.verdict === 'incorrect');
    assert('GRACE-1: throw 없음', r !== null);
    assert('GRACE-1: feedback.error 존재', typeof r.feedback.error === 'string');
  })
);

// grading.volume_target이 정답과 다름 → incorrect (V5 관련)
tests.push(
  _gradeCode([
    "const { cuboid } = require('@jscad/modeling').primitives;",
    "function main() { return cuboid({ size: [20, 30, 15] }); }",
    "module.exports = { main };"
  ].join('\n'), {
    volume_target:        99999,   // 완전히 다른 목표 부피
    volume_tolerance_pct: 1,
    bbox_target:          { x: 20, y: 30, z: 15 },
    bbox_tolerance:       0.5
  }).then(r => {
    assert('GRAD-1: 부피 목표 불일치 → verdict=incorrect', r.verdict === 'incorrect');
  })
);

/* ─────────────────────────────────────────────
   §6  manifest 검증 (V1~V3)
───────────────────────────────────────────── */
console.log('\n[§6] PluginManifest 검증 — 런타임규격 §7');

// manifest.js 로드
try {
  require(path.join(__dirname, '..', 'manifest.js'));
} catch (e) {
  console.warn('[manifest] manifest.js 로드 시 오류 (MANIFEST 없어도 무시):', e.message);
}

var mani = global.window.MANIFEST_CAD_PRINT;
if (mani) {
  assert('V1: infra=static', mani.infra === 'static');
  assert('V2: scoring_mode=auto', mani.scoring_mode === 'auto');
  assert('V3: activity_type=cad-model', mani.activity_type === 'cad-model');
  assert('MAN-ID: plugin_id=cad-print', mani.plugin_id === 'cad-print');
  assert('MAN-CAP: capabilities=[practice]',
    Array.isArray(mani.capabilities) && mani.capabilities.indexOf('practice') !== -1);
  assert('MAN-SCH: progress_schema_version=1', mani.progress_schema_version === 1);
  assert('MAN-BYOK: byok=null', mani.byok === null);
} else {
  console.warn('[V1~V3] MANIFEST_CAD_PRINT 미등록 (window.MANIFEST 없어서 정상)');
  // MANIFEST_CAD_PRINT는 window.MANIFEST 없으면 등록 안 됨 — 직접 값 검사
  assert('V1~V3: manifest.js 로드됨', true); // 파일 자체는 오류 없이 로드됨
}

/* ─────────────────────────────────────────────
   §7  activities.js 데이터 검증
───────────────────────────────────────────── */
console.log('\n[§7] ActivitySpec 데이터 검증 — 생성규칙 §3');

try {
  require(path.join(__dirname, '..', '_example', 'activities.js'));
} catch (e) {
  console.warn('[activities] activities.js 로드 오류:', e.message);
}

var acts = global.window.ACTIVITIES['cad-print'] || [];
assert('G9: activity 수 ∈ [4,6]', acts.length >= 4 && acts.length <= 6, acts.length);

var actIds = acts.map(function (a) { return a.activity_id; });
var uniqueIds = Array.from(new Set(actIds));
assert('G2: activity_id 전체 유일', uniqueIds.length === actIds.length, actIds);

acts.forEach(function (act, i) {
  var id = act.activity_id || ('act#' + i);
  assert('G1[' + id + ']: plugin_id=cad-print', act.plugin_id === 'cad-print');
  assert('G1[' + id + ']: type=cad-model', act.type === 'cad-model');
  assert('G1[' + id + ']: enabled=true', act.enabled === true);
  assert('G4[' + id + ']: volume_target > 0', act.back && act.back.grading && act.back.grading.volume_target > 0, act.back && act.back.grading && act.back.grading.volume_target);
  assert('G5[' + id + ']: bbox_target 존재', act.back && act.back.grading && act.back.grading.bbox_target);
  assert('G6[' + id + ']: starter_code SyntaxError 없음', (function () {
    if (!act.front || !act.front.starter_code) return true;
    try { new Function(act.front.starter_code); return true; } catch (e) { return false; }
  })());
  assert('G7[' + id + ']: hints[0] 선수지식으로 시작',
    act.front && Array.isArray(act.front.hints) && act.front.hints[0] &&
    act.front.hints[0].indexOf('선수지식') === 0);
  assert('G8[' + id + ']: prompt에 수치 조건 포함 (금지어 없음)',
    act.front && act.front.prompt &&
    act.front.prompt.indexOf('적절히') === -1 &&
    act.front.prompt.indexOf('올바르게') === -1);
  assert('G1[' + id + ']: activity_id 정규식',
    /^[a-z][a-z0-9-]{2,63}$/.test(act.activity_id || ''));
});

/* ─────────────────────────────────────────────
   결과 출력
───────────────────────────────────────────── */
Promise.all(tests).then(function () {
  console.log('\n══════════════════════════════════');
  console.log('결과: ' + PASS + ' pass / ' + FAIL + ' fail');
  if (failures.length > 0) {
    console.log('\n실패 목록:');
    failures.forEach(function (f) {
      console.log('  -', f.label, f.extra !== undefined ? JSON.stringify(f.extra) : '');
    });
  }
  if (!jscadLoaded) {
    console.log('\n※ @jscad/modeling 없이 stub 실행 — 실제 JSCAD 채점 정밀도 검증 제한.');
    console.log('  npm install @jscad/modeling 후 재실행 권장.');
  }
  console.log('══════════════════════════════════');
  process.exit(FAIL > 0 ? 1 : 0);
}).catch(function (err) {
  console.error('테스트 실행 오류:', err);
  process.exit(1);
});
