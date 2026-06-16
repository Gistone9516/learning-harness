/**
 * coding plugin — 순수 채점 로직 단위 테스트
 * 대상: _compare(stdout-trim / stdout-float-tol) + _grade(test_cases 순회 → cases[] + first_fail)
 * 실행: node __tests__/grade.test.js  (Pyodide·DOM 제외 — Node.js 전용)
 *
 * 전략: plugin.js는 browser IIFE + window._CODING_PLUGIN 등록.
 *   → 최소 mock(window/document/localStorage/loadPyodide) 제공 후 require로 로드.
 *   → 내부 _compare/_grade 는 IIFE 스코프 내부라 직접 접근 불가.
 *   → module.exports 가드를 plugin.js에 조건부 추가하여 테스트용 export 제공.
 *   → _grade 는 Pyodide(_runOneCase)에 의존 → stub 주입 방식 사용.
 */

'use strict';

/* ── 최소 브라우저 환경 mock ── */
const localStorageStore = {};
global.window = {
  _CODING_PLUGIN: null,
  ACTIVITIES: {},
  location: { hash: '' }
};
global.document = {
  createElement: () => ({ style: {}, appendChild: () => {} }),
  head: { appendChild: () => {} }
};
global.localStorage = {
  getItem:  (k) => localStorageStore[k] || null,
  setItem:  (k, v) => { localStorageStore[k] = v; },
  removeItem:(k) => { delete localStorageStore[k]; }
};
// Pyodide CDN 미로드 상태 (loadPyodide 없음 → _ensurePyodide는 실패하지만 테스트에서 직접 안씀)
// CodeMirror 없음 — textarea fallback 경로
global.CodeMirror = undefined;

/* ── plugin.js 로드 (IIFE 실행 → window._CODING_PLUGIN 등록) ── */
const path = require('path');
require(path.join(__dirname, '..', 'plugin.js'));

/* ── module.exports 가드로 노출된 테스트 전용 함수 취득 ── */
const { _compareExport, _gradeExport } = global._CODING_TEST_EXPORTS || {};
if (!_compareExport || !_gradeExport) {
  console.error('FATAL: plugin.js에 _CODING_TEST_EXPORTS 가드가 없습니다. 테스트 불가.');
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

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ═══════════════════════════════════════════════
   §1  _compare 단위 테스트
═══════════════════════════════════════════════ */
console.log('\n[§1] _compare — stdout-trim');

// V6: 앞뒤 공백·개행 무시 후 exact match
assert('V6-1: " hello\\n" vs "hello" → true',
  _compareExport(' hello\n', 'hello', 'stdout-trim') === true);
assert('V6-2: "hello" vs "hello" → true',
  _compareExport('hello', 'hello', 'stdout-trim') === true);
assert('V6-3: "Hello" vs "hello" → false (대소문자 구분)',
  _compareExport('Hello', 'hello', 'stdout-trim') === false);
assert('V6-4: "1 2 3" vs "1 2 3" → true',
  _compareExport('1 2 3', '1 2 3', 'stdout-trim') === true);
assert('V6-5: "8\\n" vs "8" → true (trailing newline 무시)',
  _compareExport('8\n', '8', 'stdout-trim') === true);
assert('V6-6: "8" vs "9" → false',
  _compareExport('8', '9', 'stdout-trim') === false);
// 여러 줄 출력: 내부 개행은 그대로 비교
assert('V6-7: multiline match',
  _compareExport('1 1 3 4 5\n', '1 1 3 4 5', 'stdout-trim') === true);
assert('V6-8: multiline mismatch (다른 줄)',
  _compareExport('1 2 3\n4 5', '1 2 3', 'stdout-trim') === false);

console.log('\n[§1] _compare — stdout-float-tol');

// V15: 숫자 토큰 tolerance 비교
assert('V15-1: "3.14159" vs "3.14159265", tol=1e-4 → true',
  _compareExport('3.14159', '3.14159265', 'stdout-float-tol', 1e-4) === true);
assert('V15-2: "3.14159" vs "3.14159265", tol=1e-6 → false (차이 2.65e-6 > 1e-6)',
  _compareExport('3.14159', '3.14159265', 'stdout-float-tol', 1e-6) === false);
assert('V15-3: "12.57" vs "12.57", tol=1e-6 → true',
  _compareExport('12.57', '12.57', 'stdout-float-tol', 1e-6) === true);
assert('V15-4: 줄 수 불일치 → false',
  _compareExport('1.0\n2.0', '1.0', 'stdout-float-tol', 1e-6) === false);
assert('V15-5: 토큰 수 불일치 → false',
  _compareExport('1.0 2.0', '1.0', 'stdout-float-tol', 1e-6) === false);
assert('V15-6: 문자열 토큰 exact match pass',
  _compareExport('ok 3.14', 'ok 3.14', 'stdout-float-tol', 1e-6) === true);
assert('V15-7: 문자열 토큰 mismatch',
  _compareExport('fail 3.14', 'ok 3.14', 'stdout-float-tol', 1e-6) === false);
// 기본값 tol=1e-6 (tolerance 인수 생략)
// diff = |1.000000 - 1.000001| = 1e-6 ≤ 1e-6 → 규격상 pass (≤ tolerance)
assert('V15-8: tolerance 기본값 1e-6 — 차이 정확히 1e-6 → pass (≤ tol)',
  _compareExport('1.000000', '1.000001', 'stdout-float-tol') === true);
assert('V15-8b: tolerance 기본값 1e-6 — 차이 2e-6 → false',
  _compareExport('1.000000', '1.000002', 'stdout-float-tol') === false);
assert('V15-9: tolerance 기본값 — 동일 값',
  _compareExport('2.500000', '2.5', 'stdout-float-tol') === true);
// 여러 줄 여러 토큰 혼합
assert('V15-10: 멀티라인 float 비교',
  _compareExport('2.5\n1.12', '2.5\n1.12', 'stdout-float-tol', 1e-6) === true);
assert('V15-11: 멀티라인 float tolerance',
  _compareExport('2.50\n1.118', '2.5\n1.12', 'stdout-float-tol', 1e-2) === true);
// NaN → 문자열 비교 fallback
assert('V15-12: NaN 토큰(비숫자) exact match',
  _compareExport('abc', 'abc', 'stdout-float-tol', 1e-6) === true);
assert('V15-13: NaN 토큰 mismatch',
  _compareExport('abc', 'def', 'stdout-float-tol', 1e-6) === false);

/* ═══════════════════════════════════════════════
   §2  _grade 단위 테스트 (Pyodide stub)
   _gradeExport(activity, stubRunner) 형태로 호출.
   stubRunner: (code, stdin) => Promise<{stdout, error, plot_b64}>
═══════════════════════════════════════════════ */
console.log('\n[§2] _grade — 전체 케이스 순회 + cases[] + first_fail');

// 픽스처: cod-mock-001 (stdout-trim, 3케이스)
const MOCK_001 = {
  activity_id: 'cod-mock-001',
  grading: {
    test_cases: [
      { input: '3 5',                   expected: '8'  },
      { input: '0 0',                   expected: '0'  },
      { input: '-1000000000 1000000000', expected: '0' }
    ],
    compare: 'stdout-trim'
  }
};

// 픽스처: cod-mock-002 (stdout-trim float)
const MOCK_002 = {
  activity_id: 'cod-mock-002',
  grading: {
    test_cases: [
      { input: '2',  expected: '12.57'  },
      { input: '1',  expected: '3.14'   },
      { input: '10', expected: '314.16' }
    ],
    compare: 'stdout-trim'
  }
};

// 픽스처: stdout-float-tol 전용 (mock-002 variant)
const MOCK_002_TOL = {
  activity_id: 'cod-mock-002-tol',
  grading: {
    test_cases: [
      { input: '2',  expected: '12.566370614359172' },
      { input: '1',  expected: '3.141592653589793'  },
      { input: '10', expected: '314.1592653589793'  }
    ],
    compare: 'stdout-float-tol',
    tolerance: 1e-4
  }
};

// 픽스처: cod-mock-003 (5케이스)
const MOCK_003 = {
  activity_id: 'cod-mock-003',
  grading: {
    test_cases: [
      { input: '5\n3 1 4 1 5',      expected: '1 1 3 4 5'       },
      { input: '1\n0',              expected: '0'               },
      { input: '4\n-3 2 -1 0',      expected: '-3 -1 0 2'      },
      { input: '3\n1 2 3',          expected: '1 2 3'           },
      { input: '4\n100 50 -50 -100', expected: '-100 -50 50 100' }
    ],
    compare: 'stdout-trim'
  }
};

// 올바른 답안 stub 빌더 (입력별 기대 출력 매핑)
function correctStub(inputToOutput) {
  return function(code, stdin) {
    return Promise.resolve({ stdout: inputToOutput[stdin] || '', error: null, plot_b64: null });
  };
}

// 틀린 1케이스 stub (idx=1에서 틀림)
function wrongAtIdx1Stub(inputToOutput) {
  let callCount = 0;
  return function(code, stdin) {
    callCount++;
    if (callCount === 2) {
      return Promise.resolve({ stdout: 'WRONG', error: null, plot_b64: null });
    }
    return Promise.resolve({ stdout: inputToOutput[stdin] || '', error: null, plot_b64: null });
  };
}

// 런타임 에러 stub (idx=0)
function errorStub(msg) {
  return function() {
    return Promise.resolve({ stdout: '', error: msg, plot_b64: null });
  };
}

// 타임아웃 stub
function timeoutStub() {
  return function() {
    return Promise.resolve({ stdout: '', error: 'timeout', plot_b64: null });
  };
}

const CORRECT_001 = { '3 5': '8', '0 0': '0', '-1000000000 1000000000': '0' };
const CORRECT_002 = { '2': '12.57', '1': '3.14', '10': '314.16' };
// tolerance=1e-4 이므로 차이가 1e-4 이내여야 통과.
// 정확값: 2*pi*4=12.5664..., pi*1=3.14159..., pi*100=314.159...
// "12.5664" vs "12.566370614359172" => diff ~2.9e-5 < 1e-4 ✓
// "3.1416"  vs "3.141592653589793"  => diff ~7.3e-6 < 1e-4 ✓
// "314.1593" vs "314.1592653589793" => diff ~3.5e-5 < 1e-4 ✓ (314.159는 diff 2.65e-4 > 1e-4 실패)
const CORRECT_002_TOL = {
  '2':  '12.5664',
  '1':  '3.1416',
  '10': '314.1593'
};
const CORRECT_003 = {
  '5\n3 1 4 1 5':       '1 1 3 4 5',
  '1\n0':               '0',
  '4\n-3 2 -1 0':       '-3 -1 0 2',
  '3\n1 2 3':           '1 2 3',
  '4\n100 50 -50 -100': '-100 -50 50 100'
};

const tests = [];

// T1: cod-mock-001 전부 정답 → verdict=correct, passed=3, cases.length=3
tests.push(_gradeExport(MOCK_001, correctStub(CORRECT_001)).then(r => {
  assert('T1: verdict=correct (전부 정답)', r.verdict === 'correct');
  assert('T1: passed=3', r.feedback.passed === 3);
  assert('T1: total=3', r.feedback.total === 3);
  assert('T1: cases.length=3', r.feedback.cases.length === 3);
  assert('T1: first_fail=null', r.feedback.first_fail === null);
  assert('T1: score_raw=1', r.score_raw === 1);
  assert('T1: grader_id=pyodide', r.grader_id === 'pyodide');
  // V13: cases 길이 === test_cases 길이
  assert('V13: cases 배열 길이 === test_cases 길이 (3)', r.feedback.cases.length === MOCK_001.grading.test_cases.length);
  // V14: idx 0-based 순서
  assert('V14: cases[0].idx=0', r.feedback.cases[0].idx === 0);
  assert('V14: cases[1].idx=1', r.feedback.cases[1].idx === 1);
  assert('V14: cases[2].idx=2', r.feedback.cases[2].idx === 2);
  // pass 플래그
  assert('T1: cases[0].pass=true', r.feedback.cases[0].pass === true);
  assert('T1: cases[2].pass=true', r.feedback.cases[2].pass === true);
}));

// T2: cod-mock-001 idx=1에서 틀림 → verdict=incorrect, passed=2, first_fail.idx=1
tests.push(_gradeExport(MOCK_001, wrongAtIdx1Stub(CORRECT_001)).then(r => {
  assert('T2: verdict=incorrect (1개 오답)', r.verdict === 'incorrect');
  assert('T2: passed=2', r.feedback.passed === 2);
  assert('T2: cases.length=3', r.feedback.cases.length === 3);
  assert('T2: first_fail.idx=1', r.feedback.first_fail && r.feedback.first_fail.idx === 1);
  assert('T2: cases[1].pass=false', r.feedback.cases[1].pass === false);
  assert('T2: cases[0].pass=true', r.feedback.cases[0].pass === true);
  assert('T2: score_raw=2/3', Math.abs(r.score_raw - 2/3) < 1e-9);
}));

// T3: 런타임 에러 → verdict=incorrect, cases[0].error 있음, 나머지 skipped, first_fail.idx=0
tests.push(_gradeExport(MOCK_001, errorStub('NameError: x')).then(r => {
  assert('T3: verdict=incorrect (런타임 에러)', r.verdict === 'incorrect');
  assert('T3: cases.length=3 (에러+skipped 포함)', r.feedback.cases.length === 3);
  assert('T3: cases[0].error 있음', !!r.feedback.cases[0].error);
  assert('T3: cases[1].error=skipped (early-exit)', r.feedback.cases[1].error === 'skipped');
  assert('T3: first_fail.idx=0', r.feedback.first_fail && r.feedback.first_fail.idx === 0);
  assert('T3: feedback.error 있음', !!r.feedback.error);
}));

// T4: 타임아웃 → error='timeout', 나머지 케이스 skipped
tests.push(_gradeExport(MOCK_001, timeoutStub()).then(r => {
  assert('T4: verdict=incorrect (timeout)', r.verdict === 'incorrect');
  assert('T4: feedback.error=timeout', r.feedback.error === 'timeout');
  assert('T4: cases[0].error=timeout', r.feedback.cases[0].error === 'timeout');
  // 타임아웃 후 나머지는 skipped
  assert('T4: cases[1].error=skipped', r.feedback.cases[1].error === 'skipped');
  assert('T4: cases[2].error=skipped', r.feedback.cases[2].error === 'skipped');
}));

// T5: cod-mock-003 5케이스 전부 정답
tests.push(_gradeExport(MOCK_003, correctStub(CORRECT_003)).then(r => {
  assert('T5: verdict=correct (5케이스)', r.verdict === 'correct');
  assert('T5: passed=5', r.feedback.passed === 5);
  assert('T5: cases.length=5', r.feedback.cases.length === 5);
  // V13, V14
  assert('V13: 5케이스 cases.length===5', r.feedback.cases.length === 5);
  for (let i = 0; i < 5; i++) {
    assert(`V14: cases[${i}].idx=${i}`, r.feedback.cases[i].idx === i);
  }
}));

// T6: stdout-float-tol tolerance 비교
tests.push(_gradeExport(MOCK_002_TOL, correctStub(CORRECT_002_TOL)).then(r => {
  assert('T6: stdout-float-tol 전부 통과 (tolerance=1e-4)', r.verdict === 'correct');
  assert('T6: passed=3', r.feedback.passed === 3);
}));

// T7: stdout-trim cod-mock-002 정답
tests.push(_gradeExport(MOCK_002, correctStub(CORRECT_002)).then(r => {
  assert('T7: stdout-trim float string 정답', r.verdict === 'correct');
  assert('T7: passed=3', r.feedback.passed === 3);
}));

// T8: 빈 test_cases 경계 처리
tests.push(_gradeExport(
  { activity_id: 'empty', grading: { test_cases: [], compare: 'stdout-trim' } },
  correctStub({})
).then(r => {
  assert('T8: 빈 test_cases → score_raw=0 (0/0)', r.score_raw === 0);
  assert('T8: cases.length=0', r.feedback.cases.length === 0);
}));

// T9: score_raw 계산 — 3케이스 중 2 통과
tests.push(_gradeExport(MOCK_001, wrongAtIdx1Stub(CORRECT_001)).then(r => {
  assert('T9: score_raw = passed/total', Math.abs(r.score_raw - r.feedback.passed / r.feedback.total) < 1e-9);
}));

// T10: cases[].input / expected 필드 보존 확인
tests.push(_gradeExport(MOCK_001, correctStub(CORRECT_001)).then(r => {
  assert('T10: cases[0].input 보존', r.feedback.cases[0].input === '3 5');
  assert('T10: cases[0].expected 보존', r.feedback.cases[0].expected === '8');
  assert('T10: cases[0].actual = stdout', r.feedback.cases[0].actual === '8');
}));

// T11: first_fail — 여러 오답 중 첫 번째만 기록
const multiFailStub = (function() {
  // idx=0: 틀림, idx=1: 틀림, idx=2: 맞음
  let c = 0;
  return function() {
    c++;
    if (c === 1) return Promise.resolve({ stdout: 'WRONG0', error: null, plot_b64: null });
    if (c === 2) return Promise.resolve({ stdout: 'WRONG1', error: null, plot_b64: null });
    return Promise.resolve({ stdout: '0', error: null, plot_b64: null });
  };
})();

tests.push(_gradeExport(MOCK_001, multiFailStub).then(r => {
  assert('T11: 여러 오답 중 first_fail.idx=0 (첫 번째만)', r.feedback.first_fail && r.feedback.first_fail.idx === 0);
  assert('T11: passed=1', r.feedback.passed === 1);
}));

/* ── 전체 실행 결과 출력 ── */
Promise.all(tests).then(() => {
  console.log('\n══════════════════════════════════');
  console.log(`결과: ${PASS} pass / ${FAIL} fail`);
  if (failures.length > 0) {
    console.log('\n실패 목록:');
    failures.forEach(f => console.log('  -', f.label, f.extra !== undefined ? f.extra : ''));
  }
  console.log('══════════════════════════════════');
  process.exit(FAIL > 0 ? 1 : 0);
}).catch(err => {
  console.error('테스트 실행 오류:', err);
  process.exit(1);
});
