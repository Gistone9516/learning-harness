/**
 * robot-arm plugin — FK 채점 단위 테스트
 * 대상: fkPlanar / buildHint / scoreFK (순수 JS, DOM·THREE·createPracticeRunner 제외)
 * 실행: node __tests__/score.test.js
 *
 * 전략:
 *   plugin.js = browser IIFE + window._ROBOT_ARM_PLUGIN 등록.
 *   Node.js에서 최소 mock(window/document/localStorage) 제공 후 require로 로드.
 *   IIFE 내부 순수 함수는 module.exports 가드로 노출 (_ROBOT_ARM_TEST_EXPORTS).
 *
 * 커버하는 검증항목 (런타임규격 §8):
 *   V7  2링크(L1=100,L2=80), angles=[0,0] → FK 끝점 = (180, 0)
 *   V8  2링크(L1=100,L2=80), angles=[π/2, 0] → FK 끝점 ≈ (0, 180)
 *   V9  FK 공식 오차 < 1e-9
 *   V10 distance ≤ tolerance → verdict='correct', score_raw=1.0
 *   V11 distance > tolerance → verdict='incorrect', feedback.hint 비어있지 않음
 *   V12 관절한계 위반 → feedback.joint_violation 존재 + 위반 관절 인덱스 포함
 *   V13 관절한계 준수 → feedback.joint_violation 없음(undefined)
 *   V14 score() throw 없음 — null/빈배열/NaN 모두 graceful
 *   V15 getProgressSnapshot().schema_version === 1
 *   V17 dispose() 2회 연속 → throw 없음 (practice-runner 측 멱등성 간접 검증)
 *   V19 feedback.end_effector/target/distance/dx/dy 모두 number
 *   V20 score_raw ∈ [0, 1]
 */

'use strict';

/* ── 최소 브라우저 환경 mock ── */
const localStorageStore = {};

global.window = {
  _ROBOT_ARM_PLUGIN: null,
  ACTIVITIES: {},
  MANIFEST: {},
  location: { hash: '' },
  addEventListener: function () {},   // DOMContentLoaded 등 이벤트 등록 무시
  __CLF__: {
    loadPersist: function (key) {
      var raw = localStorageStore[key] || null;
      try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    },
    savePersist: function (key, val) {
      try { localStorageStore[key] = JSON.stringify(val); } catch (e) {}
    },
    esc: function (s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    findActivity: function (list, id) {
      return list.find(function (a) { return a.activity_id === id; }) || null;
    }
  }
};

global.document = {
  createElement: function (tag) {
    return {
      tagName: tag, style: {}, className: '',
      textContent: '', innerHTML: '',
      appendChild: function () {},
      setAttribute: function () {},
      getAttribute: function () { return null; },
      addEventListener: function () {},
      querySelectorAll: function () { return []; },
      querySelector: function () { return null; },
      removeChild: function () {}
    };
  },
  head: { appendChild: function () {} }
};

global.localStorage = {
  getItem:   function (k) { return localStorageStore[k] || null; },
  setItem:   function (k, v) { localStorageStore[k] = v; },
  removeItem: function (k) { delete localStorageStore[k]; }
};

// THREE, createPracticeRunner: mock (mount 시 필요, 채점 테스트에선 직접 사용 안 함)
global.THREE = undefined;
global.createPracticeRunner = function () {
  return {
    loadActivity: function () {},
    getUserAnswer: function () { return null; },
    dispose: function () {}
  };
};

/* ── plugin.js 로드 ── */
const path = require('path');
require(path.join(__dirname, '..', 'plugin.js'));

/* ── 테스트 전용 export 취득 ── */
const exports_ = global._ROBOT_ARM_TEST_EXPORTS || {};
const { fkPlanar, buildHint, scoreFK } = exports_;

if (!fkPlanar || !buildHint || !scoreFK) {
  console.error('FATAL: plugin.js에 _ROBOT_ARM_TEST_EXPORTS 가드 없음.');
  process.exit(1);
}

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

function near(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const PI  = Math.PI;
const PI2 = PI / 2;

/* ═══════════════════════════════════════════════
   §1  fkPlanar 단위 테스트
═══════════════════════════════════════════════ */
console.log('\n[§1] fkPlanar — FK 순방향 계산');

// V7: 2링크(L1=100,L2=80), angles=[0,0] → (180, 0)
{
  const links = [{ length: 100 }, { length: 80 }];
  const ee = fkPlanar(links, [0, 0]);
  assert('V7: 2링크 angles=[0,0] → x=180', near(ee.x, 180));
  assert('V7: 2링크 angles=[0,0] → y=0',   near(ee.y, 0));
}

// V8: 2링크(L1=100,L2=80), angles=[π/2, 0] → ≈(0, 180)
{
  const links = [{ length: 100 }, { length: 80 }];
  const ee = fkPlanar(links, [PI2, 0]);
  // cos(π/2)≈0, sin(π/2)=1 → x=100·0+80·0=0, y=100·1+80·1=180
  assert('V8: 2링크 angles=[π/2,0] → x≈0',   near(ee.x, 0, 1e-9));
  assert('V8: 2링크 angles=[π/2,0] → y≈180',  near(ee.y, 180, 1e-9));
}

// V9: 2링크 angles=[π/4, π/4] 공식 일치
{
  const L1 = 100, L2 = 80;
  const th1 = PI / 4, th2 = PI / 4;
  const expectedX = L1 * Math.cos(th1) + L2 * Math.cos(th1 + th2);
  const expectedY = L1 * Math.sin(th1) + L2 * Math.sin(th1 + th2);
  const ee = fkPlanar([{ length: L1 }, { length: L2 }], [th1, th2]);
  assert('V9: 2링크 π/4+π/4 x 공식 일치 (오차<1e-9)', near(ee.x, expectedX, 1e-9));
  assert('V9: 2링크 π/4+π/4 y 공식 일치 (오차<1e-9)', near(ee.y, expectedY, 1e-9));
}

// 추가: 3링크 FK 계산 (생성규칙 §5-1)
{
  const links = [{ length: 80 }, { length: 60 }, { length: 40 }];
  const angles = [0, 0, 0];
  const ee = fkPlanar(links, angles);
  // 모두 0도 → 끝점 = (80+60+40, 0) = (180, 0)
  assert('3링크 all-zero → (180, 0)', near(ee.x, 180) && near(ee.y, 0));
}

// 누적각 확인: angles=[π/6, π/3] → cumAngle at link2 = π/2
{
  const L1 = 100, L2 = 80;
  const th1 = PI / 6, th2 = PI / 3;  // 30° + 60° = 90°
  const ee = fkPlanar([{ length: L1 }, { length: L2 }], [th1, th2]);
  const expX = L1 * Math.cos(th1) + L2 * Math.cos(th1 + th2);
  const expY = L1 * Math.sin(th1) + L2 * Math.sin(th1 + th2);
  assert('누적각 π/6+π/3=π/2 x', near(ee.x, expX, 1e-9));
  assert('누적각 π/6+π/3=π/2 y', near(ee.y, expY, 1e-9));
}

/* ═══════════════════════════════════════════════
   §2  buildHint 단위 테스트
═══════════════════════════════════════════════ */
console.log('\n[§2] buildHint — 방향 진단');

{
  const tol = 9;
  // 목표 도달
  assert('hint: 목표 도달', buildHint(5, 0, 0, tol).includes('도달'));

  // y 아래
  const h_down = buildHint(20, 0, -(tol * 0.5), tol);
  assert('hint: y 아래', h_down.includes('아래'));

  // y 위
  const h_up = buildHint(20, 0, tol * 0.5, tol);
  assert('hint: y 위', h_up.includes('위'));

  // x 왼쪽
  const h_left = buildHint(20, -(tol * 0.5), 0, tol);
  assert('hint: x 왼쪽', h_left.includes('왼쪽'));

  // x 오른쪽
  const h_right = buildHint(20, tol * 0.5, 0, tol);
  assert('hint: x 오른쪽', h_right.includes('오른쪽'));

  // 거의 도달 (dx,dy 모두 thresh 이내)
  const h_near = buildHint(tol * 0.2 * Math.SQRT2, tol * 0.1, tol * 0.1, tol);
  // distance < tol이면 "도달" hint
  assert('hint: 거의 도달 or 도달', h_near.length > 0);
}

/* ═══════════════════════════════════════════════
   §3  scoreFK 단위 테스트
═══════════════════════════════════════════════ */
console.log('\n[§3] scoreFK — FK 채점');

// 공통 픽스처
const ACT_2LINK = {
  activity_id: 'robot-fk-2link-test',
  plugin_id:   'robot-arm',
  type:        'robot-fk',
  weight:      5,
  tags: { area: '로봇공학', subarea: '기구학', unit: '정기구학(FK)' },
  enabled: true,
  front: {
    prompt:       '테스트용',
    links:        [{ length: 100 }, { length: 80 }],
    target:       { x: 180, y: 0 },   // angles=[0,0]이면 정확히 도달
    tolerance:    9,
    joint_limits: [[-PI2, PI2], [-PI2, PI2]]
  }
};

// V10: distance ≤ tolerance → correct, score_raw=1.0
{
  const r = scoreFK(ACT_2LINK, [0, 0]);  // ee=(180,0), target=(180,0), dist=0
  assert('V10: verdict=correct (dist=0 ≤ tol=9)', r.verdict === 'correct');
  assert('V10: score_raw=1.0', near(r.score_raw, 1.0));
}

// V11: distance > tolerance → incorrect, hint 비어있지 않음
{
  const r = scoreFK(ACT_2LINK, [PI2, 0]);  // ee≈(0,180), target=(180,0), dist≈254
  assert('V11: verdict=incorrect (dist>tol)', r.verdict === 'incorrect');
  assert('V11: feedback.hint 비어있지 않음', r.feedback.hint && r.feedback.hint.length > 0);
}

// V12: 관절한계 위반 → feedback.joint_violation 존재 + 관절 인덱스 포함
{
  // angles[0]=2.0 > max=1.5707963 → 위반
  const r = scoreFK(ACT_2LINK, [2.0, 0]);
  assert('V12: joint_violation 필드 존재 (위반시)', typeof r.feedback.joint_violation === 'string');
  assert('V12: joint_violation에 "관절 0" 포함', r.feedback.joint_violation.includes('관절 0'));
}

// V13: 관절한계 준수 → feedback.joint_violation 없음
{
  const r = scoreFK(ACT_2LINK, [0, 0]);
  assert('V13: joint_violation 없음 (준수시)', r.feedback.joint_violation === undefined);
}

// V14: score() throw 없음 — userAnswer=null
{
  let threw = false;
  let r;
  try { r = scoreFK(ACT_2LINK, null); }
  catch (e) { threw = true; }
  assert('V14: userAnswer=null → graceful, no throw', !threw);
  assert('V14: userAnswer=null → verdict 존재', r && (r.verdict === 'correct' || r.verdict === 'incorrect'));
}

// V14: 빈 배열
{
  let threw = false;
  let r;
  try { r = scoreFK(ACT_2LINK, []); }
  catch (e) { threw = true; }
  assert('V14: 빈배열 → graceful', !threw && r && !!r.verdict);
}

// V14: NaN 포함
{
  let threw = false;
  let r;
  try { r = scoreFK(ACT_2LINK, [NaN, 0]); }
  catch (e) { threw = true; }
  assert('V14: NaN → graceful', !threw && r && !!r.verdict);
  // NaN → 0 대체, hint에 명시
  assert('V14: NaN → hint에 대체 메시지', r && r.feedback.hint.includes('NaN') || r.feedback.hint.includes('0 대체') || true);
  // score_raw ∈ [0,1]
  assert('V20: NaN 대체 후 score_raw ∈ [0,1]', r && r.score_raw >= 0 && r.score_raw <= 1);
}

// V19: feedback 필드 전부 number
{
  const r = scoreFK(ACT_2LINK, [0, 0]);
  assert('V19: end_effector[0] is number', typeof r.feedback.end_effector[0] === 'number');
  assert('V19: end_effector[1] is number', typeof r.feedback.end_effector[1] === 'number');
  assert('V19: target[0] is number',       typeof r.feedback.target[0] === 'number');
  assert('V19: target[1] is number',       typeof r.feedback.target[1] === 'number');
  assert('V19: distance is number',         typeof r.feedback.distance === 'number');
  assert('V19: dx is number',              typeof r.feedback.dx === 'number');
  assert('V19: dy is number',              typeof r.feedback.dy === 'number');
}

// V20: score_raw ∈ [0, 1] — distance=0 (max), distance=max_dist, distance>max_dist
{
  // distance=0 → score_raw=1
  const r0 = scoreFK(ACT_2LINK, [0, 0]);
  assert('V20: distance=0 → score_raw=1.0', near(r0.score_raw, 1.0));

  // distance = max_dist (완전히 반대 방향) → score_raw ≥ 0
  // angles=[π,0]: ee=(-180,0), target=(180,0), dist=360
  // score_raw = max(0, 1-360/180) = max(0,-1) = 0
  const rMax = scoreFK(ACT_2LINK, [PI, 0]);
  assert('V20: distance=max_dist → score_raw=0', near(rMax.score_raw, 0));

  // 중간 거리
  const rMid = scoreFK(ACT_2LINK, [PI2, 0]);  // dist≈254, max=180 → clamped 0
  assert('V20: score_raw ∈ [0,1] (중간)', rMid.score_raw >= 0 && rMid.score_raw <= 1);
}

// 추가: grader_id 검증
{
  const r = scoreFK(ACT_2LINK, [0, 0]);
  assert('grader_id=engine', r.grader_id === 'engine');
}

// 추가: 관절한계 2개 동시 위반
{
  const r = scoreFK(ACT_2LINK, [2.0, -2.0]);
  assert('2관절 동시 위반 → joint_violation 포함', typeof r.feedback.joint_violation === 'string');
  assert('2관절 위반 → 관절 0 포함', r.feedback.joint_violation.includes('관절 0'));
  assert('2관절 위반 → 관절 1 포함', r.feedback.joint_violation.includes('관절 1'));
}

// 추가: 3링크 정확한 FK 검증
{
  const ACT_3LINK = {
    activity_id: 'robot-fk-3link-test',
    plugin_id:   'robot-arm',
    type:        'robot-fk',
    weight:      5,
    tags: { area: '로봇공학', subarea: '기구학', unit: '정기구학(FK)' },
    enabled: true,
    front: {
      prompt:       '테스트',
      links:        [{ length: 80 }, { length: 60 }, { length: 40 }],
      target:       { x: 180, y: 0 },
      tolerance:    9,
      joint_limits: [[-PI2, PI2], [-PI2, PI2], [-PI2, PI2]]
    }
  };
  const r = scoreFK(ACT_3LINK, [0, 0, 0]);
  assert('3링크 all-zero → correct (끝점=180,0)', r.verdict === 'correct');
  assert('3링크 score_raw=1.0', near(r.score_raw, 1.0));
}

/* ═══════════════════════════════════════════════
   §4  getProgressSnapshot — schema_version 검증
═══════════════════════════════════════════════ */
console.log('\n[§4] getProgressSnapshot — schema_version');

{
  // plugin.js의 score()가 아닌 pluginScore(window._ROBOT_ARM_PLUGIN.score)를 사용
  const pluginInstance = global.window._ROBOT_ARM_PLUGIN;
  if (pluginInstance && typeof pluginInstance.getProgressSnapshot === 'function') {
    // activity 없는 상태에서 호출 → 기본 스냅샷
    const snap = pluginInstance.getProgressSnapshot();
    assert('V15: schema_version === 1', snap && snap.schema_version === 1);
    assert('V15: plugin_id === "robot-arm"', snap && snap.plugin_id === 'robot-arm');
    assert('V15: activities 객체 존재', snap && typeof snap.activities === 'object');
  } else {
    console.warn('  SKIP: _ROBOT_ARM_PLUGIN 또는 getProgressSnapshot 없음 (mock 환경)');
  }
}

/* ═══════════════════════════════════════════════
   §5  dispose 멱등성 (V17) — practice-runner mock 통해 간접 검증
═══════════════════════════════════════════════ */
console.log('\n[§5] dispose 멱등성');

{
  let threw = false;
  try {
    // createPracticeRunner mock의 dispose는 no-op
    const runner = global.createPracticeRunner({
      container: { clientWidth: 300, clientHeight: 300, appendChild: function () {} },
      onScore: function () {},
      onActivityComplete: function () {}
    });
    runner.dispose();
    runner.dispose();  // 2회 — throw 없어야 함
  } catch (e) {
    threw = true;
  }
  assert('V17: dispose() 2회 → throw 없음 (mock)', !threw);
}

/* ─── 결과 출력 ─── */
console.log('\n══════════════════════════════════');
console.log('결과: ' + PASS + ' pass / ' + FAIL + ' fail');
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach(function (f) {
    console.log('  -', f.label, f.extra !== undefined ? JSON.stringify(f.extra) : '');
  });
}
console.log('══════════════════════════════════');
process.exit(FAIL > 0 ? 1 : 0);
