/**
 * excel/plugin.js 순수 채점 로직 단위 테스트
 * 대상: _compareValue · _runScore (cell_results 집계 · score_raw) · _gridToCellData
 * 실행: node 엔진/plugins/excel/_test_scoring.js
 * Univer 렌더·DOM·Pyodide = untestable, 제외.
 */
'use strict';

const { _compareValue, _runScore, _gridToCellData } = require('./plugin.js');

/* ──────────────────────────────────────────
   미니 테스트 하네스
────────────────────────────────────────── */
var _pass = 0, _fail = 0, _errors = [];

function test(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
    _pass++;
  } catch (e) {
    console.error('  FAIL  ' + label + '\n         ' + e.message);
    _fail++;
    _errors.push({ label: label, msg: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + '  expected=' + JSON.stringify(b) + '  actual=' + JSON.stringify(a));
}

function assertClose(a, b, eps, msg) {
  if (Math.abs(a - b) > eps) throw new Error((msg || '') + '  |' + a + ' - ' + b + '| > ' + eps);
}

/* ──────────────────────────────────────────
   §1  _compareValue  (런타임규격 §4-2)
────────────────────────────────────────── */
console.log('\n[§1 _compareValue]');

test('V9a  number exact match: (15, 15) → true', function () {
  assert(_compareValue(15, 15, 0));
});

test('V9b  string→number cross: ("15", 15) → true', function () {
  assert(_compareValue('15', 15, 0));
});

test('V10  number mismatch: (15, 16) → false', function () {
  assert(!_compareValue(15, 16, 0));
});

test('string exact match: ("딸기", "딸기") → true', function () {
  assert(_compareValue('딸기', '딸기', 0));
});

test('string mismatch: ("배", "딸기") → false', function () {
  assert(!_compareValue('배', '딸기', 0));
});

test('float exact (no tol): (82.2, 82.2) → true', function () {
  assert(_compareValue(82.2, 82.2, 0));
});

test('float mismatch (no tol): (82.3, 82.2) → false', function () {
  assert(!_compareValue(82.3, 82.2, 0));
});

test('float within tolerance: (82.20001, 82.2, 0.001) → true', function () {
  assert(_compareValue(82.20001, 82.2, 0.001));
});

test('float outside tolerance: (82.202, 82.2, 0.001) → false', function () {
  assert(!_compareValue(82.202, 82.2, 0.001));
});

test('string-number cross with tol: ("525", 525, 0) → true', function () {
  assert(_compareValue('525', 525, 0));
});

test('string-number cross with tol: (" 82.2 ", 82.2, 0.001) → true (whitespace trim)', function () {
  assert(_compareValue(' 82.2 ', 82.2, 0.001));
});

test('non-numeric string vs number: ("abc", 15) → false', function () {
  assert(!_compareValue('abc', 15, 0));
});

test('number vs string expected: (525, "525") → true via string conversion', function () {
  // both become strings → "525" === "525"
  assert(_compareValue(525, '525', 0));
});

test('tolerance=0 is exact for numbers: (525.0001, 525, 0) → false', function () {
  assert(!_compareValue(525.0001, 525, 0));
});

test('null actual vs string expected: (null, "딸기") → false', function () {
  // String(null) = "null" !== "딸기"
  assert(!_compareValue(null, '딸기', 0));
});

test('undefined tolerance defaults to 0: (15, 15) → true', function () {
  assert(_compareValue(15, 15));  // no tol arg
});

/* ──────────────────────────────────────────
   §2  _gridToCellData
────────────────────────────────────────── */
console.log('\n[§2 _gridToCellData]');

test('number cell → {v, t:2}', function () {
  var cd = _gridToCellData([[1, 2], [3, 4]]);
  assertEqual(cd[0][0].v, 1);
  assertEqual(cd[0][0].t, 2);
  assertEqual(cd[1][1].v, 4);
  assertEqual(cd[1][1].t, 2);
});

test('string cell → {v, t:1}', function () {
  var cd = _gridToCellData([['월', '판매량']]);
  assertEqual(cd[0][0].v, '월');
  assertEqual(cd[0][0].t, 1);
});

test('empty string cell → no entry (sparse)', function () {
  var cd = _gridToCellData([['', 'x']]);
  assert(!cd[0][0], 'empty string should be omitted');
  assertEqual(cd[0][1].v, 'x');
});

test('null cell → no entry', function () {
  var cd = _gridToCellData([[null, 5]]);
  assert(!cd[0][0], 'null should be omitted');
  assertEqual(cd[0][1].v, 5);
});

test('row length varies — each row independently indexed', function () {
  var cd = _gridToCellData([['A', 'B', 'C'], [1, 2]]);
  assertEqual(cd[0][2].v, 'C');
  assertEqual(cd[1][1].v, 2);
  assert(!cd[1][2], 'missing col should be absent');
});

/* ──────────────────────────────────────────
   §3  _runScore — 채점 통합 (mock univerAPI)
   목업 픽스처 기반 — Univer 없이 getValue mock으로 대체
────────────────────────────────────────── */
console.log('\n[§3 _runScore — mock univerAPI]');

/**
 * 셀 주소 → 값 맵으로 mock univerAPI 생성
 * @param {Object} cellMap  { 'B7': 525, 'B8': '딸기', ... }
 */
function makeMockAPI(cellMap) {
  return {
    getActiveWorkbook: function () {
      return {
        getActiveSheet: function () {
          return {
            getRange: function (cell) {
              return {
                getValue: function () {
                  var v = cellMap[cell];
                  return (v === undefined) ? null : v;
                }
              };
            }
          };
        }
      };
    }
  };
}

/** 픽스처 #1 xls-sum-001 */
var actSum = {
  activity_id: 'xls-sum-001',
  grading: {
    expected: [{ cell: 'B7', value: 525 }],
    compare: 'value'
  }
};

test('[sum-001] correct answer → verdict=correct, score_raw=1, passed=1/total=1', function () {
  var api = makeMockAPI({ 'B7': 525 });
  var r = _runScore(actSum, api);
  assertEqual(r.verdict, 'correct');
  assertClose(r.score_raw, 1, 1e-9);
  assertEqual(r.feedback.passed, 1);
  assertEqual(r.feedback.total, 1);
  assert(r.feedback.first_fail === null, 'first_fail should be null on all-pass');
});

test('[sum-001] correct string answer ("525") → verdict=correct via cross-type', function () {
  var api = makeMockAPI({ 'B7': '525' });
  var r = _runScore(actSum, api);
  assertEqual(r.verdict, 'correct');
});

test('[sum-001] wrong answer (500) → verdict=incorrect, score_raw=0, first_fail set', function () {
  var api = makeMockAPI({ 'B7': 500 });
  var r = _runScore(actSum, api);
  assertEqual(r.verdict, 'incorrect');
  assertClose(r.score_raw, 0, 1e-9);
  assertEqual(r.feedback.first_fail.cell, 'B7');
  assertEqual(r.feedback.first_fail.expected, 525);
  assertEqual(r.feedback.first_fail.actual, 500);
});

test('[sum-001] null actual (empty cell) → verdict=incorrect', function () {
  var api = makeMockAPI({ 'B7': null });
  var r = _runScore(actSum, api);
  assertEqual(r.verdict, 'incorrect');
});

test('[sum-001] grader_id = "engine"', function () {
  var api = makeMockAPI({ 'B7': 525 });
  var r = _runScore(actSum, api);
  assertEqual(r.grader_id, 'engine');
});

/** 픽스처 #2 xls-avg-001 float */
var actAvg = {
  activity_id: 'xls-avg-001',
  grading: {
    expected: [{ cell: 'B7', value: 82.2 }],
    compare: 'value',
    tolerance: 0.001
  }
};

test('[avg-001] float exact match with tolerance → correct', function () {
  var api = makeMockAPI({ 'B7': 82.2 });
  var r = _runScore(actAvg, api);
  assertEqual(r.verdict, 'correct');
});

test('[avg-001] float within tolerance (82.2001) → correct', function () {
  var api = makeMockAPI({ 'B7': 82.2001 });
  var r = _runScore(actAvg, api);
  assertEqual(r.verdict, 'correct');
});

test('[avg-001] float outside tolerance (82.21) → incorrect', function () {
  var api = makeMockAPI({ 'B7': 82.21 });
  var r = _runScore(actAvg, api);
  assertEqual(r.verdict, 'incorrect');
});

test('[avg-001] string "82.2" with tolerance → correct (cross-type)', function () {
  var api = makeMockAPI({ 'B7': '82.2' });
  var r = _runScore(actAvg, api);
  assertEqual(r.verdict, 'correct');
});

/** 픽스처 #3 xls-vlookup-001 string result */
var actVlookup = {
  activity_id: 'xls-vlookup-001',
  grading: {
    expected: [{ cell: 'B8', value: '딸기' }],
    compare: 'value'
  }
};

test('[vlookup-001] string match "딸기" → correct', function () {
  var api = makeMockAPI({ 'B8': '딸기' });
  var r = _runScore(actVlookup, api);
  assertEqual(r.verdict, 'correct');
});

test('[vlookup-001] string mismatch "포도" → incorrect', function () {
  var api = makeMockAPI({ 'B8': '포도' });
  var r = _runScore(actVlookup, api);
  assertEqual(r.verdict, 'incorrect');
  assertEqual(r.feedback.first_fail.expected, '딸기');
  assertEqual(r.feedback.first_fail.actual, '포도');
});

/** 픽스처 #4 xls-sumif-001 다중셀 3개 */
var actSumif = {
  activity_id: 'xls-sumif-001',
  grading: {
    expected: [
      { cell: 'B10', value: 795000 },
      { cell: 'B11', value: 360000 },
      { cell: 'B12', value: 220000 }
    ],
    compare: 'value'
  }
};

test('[sumif-001] all 3 cells correct → verdict=correct, score_raw=1, cell_results length=3', function () {
  var api = makeMockAPI({ 'B10': 795000, 'B11': 360000, 'B12': 220000 });
  var r = _runScore(actSumif, api);
  assertEqual(r.verdict, 'correct');
  assertClose(r.score_raw, 1, 1e-9);
  assertEqual(r.feedback.passed, 3);
  assertEqual(r.feedback.total, 3);
  assertEqual(r.feedback.cell_results.length, 3);
  assert(r.feedback.cell_results.every(function (cr) { return cr.ok === true; }), 'all ok');
  assert(r.feedback.first_fail === null);
});

test('[sumif-001] 1 of 3 wrong → verdict=incorrect, score_raw=2/3', function () {
  var api = makeMockAPI({ 'B10': 795000, 'B11': 999, 'B12': 220000 }); // B11 wrong
  var r = _runScore(actSumif, api);
  assertEqual(r.verdict, 'incorrect');
  assertClose(r.score_raw, 2 / 3, 1e-9);
  assertEqual(r.feedback.passed, 2);
  assertEqual(r.feedback.total, 3);
  assertEqual(r.feedback.first_fail.cell, 'B11');
  assertEqual(r.feedback.first_fail.expected, 360000);
  assertEqual(r.feedback.first_fail.actual, 999);
});

test('[sumif-001] 2 of 3 wrong → score_raw=1/3', function () {
  var api = makeMockAPI({ 'B10': 795000, 'B11': 0, 'B12': 0 });
  var r = _runScore(actSumif, api);
  assertClose(r.score_raw, 1 / 3, 1e-9);
  assertEqual(r.feedback.passed, 1);
});

test('[sumif-001] all wrong → verdict=incorrect, score_raw=0', function () {
  var api = makeMockAPI({ 'B10': 0, 'B11': 0, 'B12': 0 });
  var r = _runScore(actSumif, api);
  assertEqual(r.verdict, 'incorrect');
  assertClose(r.score_raw, 0, 1e-9);
  assertEqual(r.feedback.cell_results[0].ok, false);
  assertEqual(r.feedback.cell_results[1].ok, false);
  assertEqual(r.feedback.cell_results[2].ok, false);
});

test('[sumif-001] cell_results preserves cell labels in order', function () {
  var api = makeMockAPI({ 'B10': 795000, 'B11': 360000, 'B12': 220000 });
  var r = _runScore(actSumif, api);
  assertEqual(r.feedback.cell_results[0].cell, 'B10');
  assertEqual(r.feedback.cell_results[1].cell, 'B11');
  assertEqual(r.feedback.cell_results[2].cell, 'B12');
});

test('[sumif-001] first_fail is FIRST fail only (B11 wrong but B10 ok → first_fail=B11)', function () {
  var api = makeMockAPI({ 'B10': 795000, 'B11': 999, 'B12': 999 });
  var r = _runScore(actSumif, api);
  assertEqual(r.feedback.first_fail.cell, 'B11');
});

/* ──────────────────────────────────────────
   §4  edge cases
────────────────────────────────────────── */
console.log('\n[§4 edge cases]');

test('empty expected array → score_raw=0, verdict=correct (0/0 === all passed)', function () {
  // When total=0, passed===total → 'correct', score_raw = 0/0 → 0 (NaN guard in code: total>0 ? passed/total : 0)
  var activity = { activity_id: 'empty', grading: { expected: [] } };
  var api = makeMockAPI({});
  var r = _runScore(activity, api);
  assertEqual(r.verdict, 'correct');
  assertEqual(r.score_raw, 0);
});

test('no worksheet (null workbook) → fallback ScoreResult with verdict=incorrect', function () {
  var badAPI = {
    getActiveWorkbook: function () { return null; }
  };
  var r = _runScore(actSum, badAPI);
  assertEqual(r.verdict, 'incorrect');
  assertEqual(r.score_raw, 0);
  assertEqual(r.grader_id, 'engine');
});

test('tolerance missing (undefined) defaults to 0 — exact match required', function () {
  var actNoTol = {
    activity_id: 'notol',
    grading: {
      expected: [{ cell: 'A1', value: 10 }]
      // tolerance absent
    }
  };
  var api = makeMockAPI({ 'A1': 10.001 });
  var r = _runScore(actNoTol, api);
  assertEqual(r.verdict, 'incorrect', 'no tolerance: 10.001 != 10');

  var api2 = makeMockAPI({ 'A1': 10 });
  var r2 = _runScore(actNoTol, api2);
  assertEqual(r2.verdict, 'correct');
});

/* ──────────────────────────────────────────
   결과 출력
────────────────────────────────────────── */
console.log('\n' + '='.repeat(50));
console.log('결과: PASS ' + _pass + ' / FAIL ' + _fail + ' / TOTAL ' + (_pass + _fail));
if (_fail > 0) {
  console.log('\n실패 목록:');
  _errors.forEach(function (e) { console.log('  - ' + e.label); });
  process.exit(1);
} else {
  console.log('전체 통과');
  process.exit(0);
}
