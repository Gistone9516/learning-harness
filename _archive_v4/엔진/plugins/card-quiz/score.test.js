/**
 * card-quiz 채점 로직 Node 테스트
 * 대상: 엔진/app/app.js score() + normalize()
 * 픽스처: 규격/card-quiz/_목업카드.js (answer_spec은 generate.py 역할을 인라인으로 조립)
 *
 * 실행: node 엔진/plugins/card-quiz/score.test.js
 */
'use strict';

const path = require('path');
const {
  score,
  normalize,
  ScoreInputError,
} = require(path.join(__dirname, '../../app/app.js'));

// ─────────────────────────────────────────────
// 미니 테스트 러너
// ─────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    process.stdout.write('  PASS  ' + name + '\n');
  } catch (e) {
    fail++;
    failures.push({ name, msg: e.message });
    process.stdout.write('  FAIL  ' + name + '\n        ' + e.message + '\n');
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || '') + ' expected=' + JSON.stringify(expected) + ' got=' + JSON.stringify(actual));
  }
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((msg || '') + ' expected=' + b + ' got=' + a);
  }
}

function assertThrows(fn, errName, msg) {
  let threw = false;
  try { fn(); } catch (e) {
    threw = true;
    if (errName && e.name !== errName) {
      throw new Error((msg || '') + ' expected error.name=' + errName + ' got=' + e.name + ': ' + e.message);
    }
  }
  if (!threw) throw new Error((msg || '') + ' expected throw but none');
}

// ─────────────────────────────────────────────
// §1  normalize() 단위 테스트
// ─────────────────────────────────────────────
console.log('\n── §1 normalize ──');

test('trim: 앞뒤 공백 제거', () => {
  assertEqual(normalize('  hello  ', ['trim']), 'hello');
});

test('trim: 전각공백 앞뒤', () => {
  assertEqual(normalize('　hello　', ['trim', 'collapse_space']), 'hello');
});

test('lower: ASCII 대문자만 소문자화', () => {
  assertEqual(normalize('SUMIF', ['lower']), 'sumif');
});

test('lower: 한글 미변경', () => {
  assertEqual(normalize('홈 탭', ['lower']), '홈 탭');
});

test('collapse_space: 연속 공백 → 단일', () => {
  assertEqual(normalize('a  b\t\tc', ['collapse_space']), 'a b c');
});

test('strip_trailing_paren: SUMIF() → SUMIF', () => {
  assertEqual(normalize('SUMIF()', ['strip_trailing_paren']), 'SUMIF');
});

test('strip_trailing_paren: 내용있는괄호도 제거', () => {
  // 규격: 후행 "(내용)" 제거
  assertEqual(normalize('SUMIF(range)', ['strip_trailing_paren']), 'SUMIF');
});

test('fullwidth_to_halfwidth: 전각 → 반각', () => {
  assertEqual(normalize('（）＝', ['fullwidth_to_halfwidth']), '()=');
});

test('규칙 순서: trim → lower', () => {
  assertEqual(normalize('  HELLO  ', ['trim', 'lower']), 'hello');
});

test('synonyms: lower 직후 치환', () => {
  // synonyms = {동의어: 대표어}
  const syn = { 'sumifs': 'sumif' };
  assertEqual(normalize('SUMIFS', ['lower'], syn), 'sumif');
});

test('synonyms: lower 없으면 치환 안됨', () => {
  const syn = { 'sumifs': 'sumif' };
  // lower 없는 파이프라인 → synonyms 치환 없음
  assertEqual(normalize('sumifs', ['trim'], syn), 'sumifs');
});

test('unify_arg_sep: 세미콜론 → 쉼표', () => {
  assertEqual(normalize('SUMIF(A1;B1)', ['unify_arg_sep']), 'SUMIF(A1,B1)');
});

test('nfkc: 전각 숫자 정규화', () => {
  // U+FF11 = ① 아니고 '１' (FULLWIDTH DIGIT ONE), NFKC → '1'
  assertEqual(normalize('１２３', ['nfkc']), '123');
});

// ─────────────────────────────────────────────
// §2  exact 모드 채점 (func/judge 카드)
// ─────────────────────────────────────────────
console.log('\n── §2 exact 모드 ──');

// 목업카드 comp1-ss-func-0001 기반
// generate.py 조립: accepted = [answer] + grading.accept → normalize 후 비교
// answerSpec 조립: accepted=["SUMIF","SUMIF()","sumif","sumif()"], normalize=["trim","lower","strip_trailing_paren"]
// (normalize 후 모두 → "sumif")

const funcCard_answerSpec = {
  accepted: ['SUMIF', 'SUMIF()', 'sumif', 'sumif()'],
  normalize: ['trim', 'lower', 'strip_trailing_paren']
};

test('exact/func: 정확 정답 "SUMIF"', () => {
  const r = score({ mode: 'exact', userAnswer: 'SUMIF', answerSpec: funcCard_answerSpec });
  assertEqual(r.verdict, 'correct');
});

test('exact/func: "SUMIF()" 복수정답 accept', () => {
  const r = score({ mode: 'exact', userAnswer: 'SUMIF()', answerSpec: funcCard_answerSpec });
  assertEqual(r.verdict, 'correct');
});

test('exact/func: 대소문자 무시 "sumif"', () => {
  const r = score({ mode: 'exact', userAnswer: 'sumif', answerSpec: funcCard_answerSpec });
  assertEqual(r.verdict, 'correct');
});

test('exact/func: 앞뒤공백 trim "  SUMIF  "', () => {
  const r = score({ mode: 'exact', userAnswer: '  SUMIF  ', answerSpec: funcCard_answerSpec });
  assertEqual(r.verdict, 'correct');
});

test('exact/func: 오답 "SUMIFS"', () => {
  const r = score({ mode: 'exact', userAnswer: 'SUMIFS', answerSpec: funcCard_answerSpec });
  assertEqual(r.verdict, 'incorrect');
});

test('exact/func: 빈 입력 → incorrect', () => {
  const r = score({ mode: 'exact', userAnswer: '', answerSpec: funcCard_answerSpec });
  assertEqual(r.verdict, 'incorrect');
});

// judge 카드: comp1-ss-judge-0001
// answer = "찾을값·범위의 셀 서식(텍스트 vs 숫자) 불일치"
// normalize: ["trim","collapse_space"]
const judgeCard_answerSpec = {
  accepted: ['찾을값·범위의 셀 서식(텍스트 vs 숫자) 불일치'],
  normalize: ['trim', 'collapse_space']
};

test('exact/judge: 정답 선택지 완전일치', () => {
  const r = score({ mode: 'exact', userAnswer: '찾을값·범위의 셀 서식(텍스트 vs 숫자) 불일치', answerSpec: judgeCard_answerSpec });
  assertEqual(r.verdict, 'correct');
});

test('exact/judge: 오답 선택지', () => {
  const r = score({ mode: 'exact', userAnswer: 'col_index_num이 범위 열 수를 초과', answerSpec: judgeCard_answerSpec });
  assertEqual(r.verdict, 'incorrect');
});

test('exact/judge: 앞뒤공백 있어도 trim 후 정답', () => {
  const r = score({ mode: 'exact', userAnswer: '  찾을값·범위의 셀 서식(텍스트 vs 숫자) 불일치  ', answerSpec: judgeCard_answerSpec });
  assertEqual(r.verdict, 'correct');
});

// exact 입력 타입 오류
test('exact: 배열 입력 시 ScoreInputError (sequence 없는 케이스)', () => {
  assertThrows(() => {
    score({ mode: 'exact', userAnswer: ['a', 'b'], answerSpec: { accepted: ['a'], normalize: [] } });
  }, 'ScoreInputError');
});

// ─────────────────────────────────────────────
// §3  keyword 모드 채점 (proc 카드)
// ─────────────────────────────────────────────
console.log('\n── §3 keyword 모드 ──');

// 목업카드 comp1-ss-proc-0001
// grading.keywords → answerSpec.requiredKeywords (any-of 그룹 배열)
// generate.py 조립: requiredKeywords = grading.keywords[].any[] 배열
const procCard_answerSpec = {
  requiredKeywords: [
    ['조건부 서식', '조건부서식'],
    ['상위/하위 규칙', '상위 하위 규칙', '상위/하위'],
    ['상위 10%', '상위10%']
  ],
  normalize: ['trim', 'collapse_space', 'fullwidth_to_halfwidth']
};

test('keyword: 모든 그룹 포함 → correct', () => {
  const r = score({
    mode: 'keyword',
    userAnswer: '홈탭에서 조건부 서식 → 상위/하위 규칙 → 상위 10% 선택',
    answerSpec: procCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

test('keyword: 동의어 포함 (조건부서식)', () => {
  const r = score({
    mode: 'keyword',
    userAnswer: '조건부서식에서 상위/하위 규칙, 상위 10%',
    answerSpec: procCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

test('keyword: 하나 누락 (상위/하위 없음) → incorrect', () => {
  const r = score({
    mode: 'keyword',
    userAnswer: '조건부 서식에서 상위 10% 설정',
    answerSpec: procCard_answerSpec
  });
  // "상위/하위 규칙" 그룹 누락
  assertEqual(r.verdict, 'incorrect');
});

test('keyword: 전부 누락 → incorrect', () => {
  const r = score({
    mode: 'keyword',
    userAnswer: '홈 탭 → 스타일',
    answerSpec: procCard_answerSpec
  });
  assertEqual(r.verdict, 'incorrect');
});

test('keyword: highlightMissed 에 누락 그룹 포함', () => {
  const r = score({
    mode: 'keyword',
    userAnswer: '조건부 서식',
    answerSpec: procCard_answerSpec
  });
  assertEqual(r.verdict, 'incorrect');
  // 2개 그룹 누락
  if (r.feedback.highlightMissed.length < 2) {
    throw new Error('highlightMissed 에 누락 그룹 2개 이상 기대, got=' + JSON.stringify(r.feedback.highlightMissed));
  }
});

test('keyword: requiredKeywords 빈 배열이면 incorrect', () => {
  const r = score({
    mode: 'keyword',
    userAnswer: '뭐든지',
    answerSpec: { requiredKeywords: [], normalize: [] }
  });
  // isCorrect = missed.length===0 && requiredKeywords.length>0 → length=0이므로 incorrect
  assertEqual(r.verdict, 'incorrect');
});

test('keyword: string 아닌 입력 → ScoreInputError', () => {
  assertThrows(() => {
    score({ mode: 'keyword', userAnswer: ['a'], answerSpec: { requiredKeywords: [['a']], normalize: [] } });
  }, 'ScoreInputError');
});

// ─────────────────────────────────────────────
// §4  recall_seq 모드 채점
// ─────────────────────────────────────────────
console.log('\n── §4 recall_seq 모드 ──');

// 목업카드 comp1-ss-seq-0001
// answer: string[] → answerSpec.sequence
const seqCard_answerSpec = {
  sequence: [
    '데이터 범위 내 셀 선택',
    '데이터 탭 클릭',
    '정렬 버튼 클릭',
    '기준 추가 및 열·순서 설정',
    '확인 클릭'
  ],
  normalize: ['trim', 'collapse_space']
};

test('recall_seq: 정확한 순서 배열 → correct', () => {
  const r = score({
    mode: 'exact',
    userAnswer: [
      '데이터 범위 내 셀 선택',
      '데이터 탭 클릭',
      '정렬 버튼 클릭',
      '기준 추가 및 열·순서 설정',
      '확인 클릭'
    ],
    answerSpec: seqCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

test('recall_seq: 순서 틀림 (2,1번 바뀜) → incorrect', () => {
  const r = score({
    mode: 'exact',
    userAnswer: [
      '데이터 탭 클릭',      // 순서 다름
      '데이터 범위 내 셀 선택',
      '정렬 버튼 클릭',
      '기준 추가 및 열·순서 설정',
      '확인 클릭'
    ],
    answerSpec: seqCard_answerSpec
  });
  assertEqual(r.verdict, 'incorrect');
});

test('recall_seq: 일부만 일치 (3개) → incorrect (부분점수 없음)', () => {
  const r = score({
    mode: 'exact',
    userAnswer: [
      '데이터 범위 내 셀 선택',
      '데이터 탭 클릭',
      '정렬 버튼 클릭',
      '틀린 단계',
      '확인 클릭'
    ],
    answerSpec: seqCard_answerSpec
  });
  assertEqual(r.verdict, 'incorrect');
});

test('recall_seq: 길이 부족 → incorrect', () => {
  const r = score({
    mode: 'exact',
    userAnswer: ['데이터 범위 내 셀 선택', '데이터 탭 클릭'],
    answerSpec: seqCard_answerSpec
  });
  assertEqual(r.verdict, 'incorrect');
});

test('recall_seq: 앞뒤공백 있어도 trim 후 정답', () => {
  const r = score({
    mode: 'exact',
    userAnswer: [
      '  데이터 범위 내 셀 선택  ',
      '데이터 탭 클릭',
      '정렬 버튼 클릭',
      '기준 추가 및 열·순서 설정',
      '확인 클릭'
    ],
    answerSpec: seqCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

test('recall_seq: string 입력 → 쉼표 분리로 fallback 처리', () => {
  // 엔진: string 단일값이면 "," 분리
  const r = score({
    mode: 'exact',
    userAnswer: '데이터 범위 내 셀 선택,데이터 탭 클릭,정렬 버튼 클릭,기준 추가 및 열·순서 설정,확인 클릭',
    answerSpec: seqCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

// ─────────────────────────────────────────────
// §5  cloze 모드 채점 (0-base 빈칸)
// ─────────────────────────────────────────────
console.log('\n── §5 cloze 모드 ──');

// 목업카드 comp1-ss-cloze-0001
// front.text: =VLOOKUP(찾을값, 범위, {{0}}, {{1}})
// answer: {"0":"열", "1":"FALSE"}
// grading.accept_map: {"0":["열 번호","col_index_num"],"1":["FALSE","0","false"]}
// generate.py 조립 결과:
//   blanks[0] = ["열","열 번호","col_index_num"]
//   blanks[1] = ["FALSE","0","false"]
//   normalize: ["trim","lower","collapse_space"]
const clozeCard_answerSpec = {
  blanks: [
    ['열', '열 번호', 'col_index_num'],
    ['false', '0']   // normalize lower 후: "FALSE"→"false"
  ],
  normalize: ['trim', 'lower', 'collapse_space']
};

test('cloze: 0-base 두 빈칸 모두 정답 (열, FALSE)', () => {
  const r = score({
    mode: 'cloze',
    userAnswer: ['열', 'FALSE'],
    answerSpec: clozeCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

test('cloze: 복수정답 accept_map "열 번호" → correct', () => {
  const r = score({
    mode: 'cloze',
    userAnswer: ['열 번호', 'FALSE'],
    answerSpec: clozeCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

test('cloze: 빈칸[1] "0"도 정답', () => {
  const r = score({
    mode: 'cloze',
    userAnswer: ['열', '0'],
    answerSpec: clozeCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
});

test('cloze: blanks[0] 오답 → incorrect (부분점수 없음)', () => {
  const r = score({
    mode: 'cloze',
    userAnswer: ['틀린답', 'FALSE'],
    answerSpec: clozeCard_answerSpec
  });
  assertEqual(r.verdict, 'incorrect');
  // missed에 "0" 포함 (0-base)
  if (!r.missed.includes('0')) {
    throw new Error('missed에 빈칸 인덱스 "0" 기대, got=' + JSON.stringify(r.missed));
  }
});

test('cloze: 빈칸 비움(빈 문자열) → incorrect', () => {
  const r = score({
    mode: 'cloze',
    userAnswer: ['', 'FALSE'],
    answerSpec: clozeCard_answerSpec
  });
  assertEqual(r.verdict, 'incorrect');
});

test('cloze: 빈칸 수 불일치 → ScoreInputError', () => {
  assertThrows(() => {
    score({
      mode: 'cloze',
      userAnswer: ['열'],   // 빈칸 1개, blanks 2개
      answerSpec: clozeCard_answerSpec
    });
  }, 'ScoreInputError');
});

test('cloze: matched/missed 0-base 인덱스 문자열', () => {
  const r = score({
    mode: 'cloze',
    userAnswer: ['col_index_num', 'FALSE'],
    answerSpec: clozeCard_answerSpec
  });
  assertEqual(r.verdict, 'correct');
  assertDeepEqual(r.matched, ['0', '1'], 'matched 인덱스');
  assertDeepEqual(r.missed, [], 'missed 인덱스');
});

// ─────────────────────────────────────────────
// §6  self 모드 채점
// ─────────────────────────────────────────────
console.log('\n── §6 self 모드 ──');

// 목업카드 comp1-ss-self-0001 (grade_mode=self)
const selfCard_answerSpec = { normalize: [] };

test('self: "correct" → verdict correct', () => {
  const r = score({ mode: 'self', userAnswer: 'correct', answerSpec: selfCard_answerSpec });
  assertEqual(r.verdict, 'correct');
});

test('self: "incorrect" → verdict incorrect', () => {
  const r = score({ mode: 'self', userAnswer: 'incorrect', answerSpec: selfCard_answerSpec });
  assertEqual(r.verdict, 'incorrect');
});

test('self: "o" 직접 전달 → ScoreInputError (UI가 변환해야 함)', () => {
  assertThrows(() => {
    score({ mode: 'self', userAnswer: 'o', answerSpec: selfCard_answerSpec });
  }, 'ScoreInputError');
});

test('self: "x" 직접 전달 → ScoreInputError', () => {
  assertThrows(() => {
    score({ mode: 'self', userAnswer: 'x', answerSpec: selfCard_answerSpec });
  }, 'ScoreInputError');
});

test('self: matched/missed/normalizedUser 빈값', () => {
  const r = score({ mode: 'self', userAnswer: 'correct', answerSpec: selfCard_answerSpec });
  assertDeepEqual(r.matched, []);
  assertDeepEqual(r.missed, []);
  assertEqual(r.normalizedUser, 'correct');
});

// ─────────────────────────────────────────────
// §7  알 수 없는 mode → ScoreInputError
// ─────────────────────────────────────────────
console.log('\n── §7 입력 오류 ──');

test('알 수 없는 mode → ScoreInputError', () => {
  assertThrows(() => {
    score({ mode: 'unknown', userAnswer: 'foo', answerSpec: {} });
  }, 'ScoreInputError');
});

// ─────────────────────────────────────────────
// §8  cycle-4 신규 기능 검증
// ─────────────────────────────────────────────
console.log('\n── §8 cycle-4 신규 기능 ──');

// 복수정답 OR 비교 (exact accepted[])
test('exact: accepted[] OR 비교 — 여러 항목 중 하나', () => {
  const spec = {
    accepted: ['정답1', '정답2', '정답3'],
    normalize: ['trim', 'lower']
  };
  assertEqual(score({ mode: 'exact', userAnswer: '정답2', answerSpec: spec }).verdict, 'correct');
  assertEqual(score({ mode: 'exact', userAnswer: '정답4', answerSpec: spec }).verdict, 'incorrect');
});

// keyword 그룹 일부충족도 incorrect
test('keyword: 그룹 일부 충족(N-1) → incorrect', () => {
  const spec = {
    requiredKeywords: [['A'], ['B'], ['C']],
    normalize: ['trim', 'lower']
  };
  // A, B만 있고 C 없음
  const r = score({ mode: 'keyword', userAnswer: 'A B', answerSpec: spec });
  assertEqual(r.verdict, 'incorrect');
  assertEqual(r.missed.length, 1);
});

// recall_seq 정확히 full match만 correct
test('recall_seq: 완전 일치 시에만 correct', () => {
  const spec = { sequence: ['step1', 'step2', 'step3'], normalize: ['trim'] };
  assertEqual(score({ mode: 'exact', userAnswer: ['step1', 'step2', 'step3'], answerSpec: spec }).verdict, 'correct');
  assertEqual(score({ mode: 'exact', userAnswer: ['step1', 'step2'], answerSpec: spec }).verdict, 'incorrect');
  assertEqual(score({ mode: 'exact', userAnswer: ['step1', 'step3', 'step2'], answerSpec: spec }).verdict, 'incorrect');
});

// cloze 0-base 인덱스 계약
test('cloze: 0-base blanks 인덱스 matched/missed 문자열화', () => {
  const spec = {
    blanks: [['정답A'], ['정답B'], ['정답C']],
    normalize: ['trim']
  };
  const r = score({ mode: 'cloze', userAnswer: ['정답A', '오답', '정답C'], answerSpec: spec });
  assertEqual(r.verdict, 'incorrect');
  assertDeepEqual(r.matched, ['0', '2']);
  assertDeepEqual(r.missed, ['1']);
  assertDeepEqual(r.feedback.highlightMissed, ['1']);
});

// synonyms + exact 상호작용
test('exact: synonyms 치환 후 정답 매칭', () => {
  const spec = {
    accepted: ['sumif'],
    normalize: ['trim', 'lower']
  };
  // synonyms: "합계조건함수" → "sumif"
  const syn = { '합계조건함수': 'sumif' };
  const r = score({ mode: 'exact', userAnswer: '합계조건함수', answerSpec: spec, synonyms: syn });
  assertEqual(r.verdict, 'correct', 'synonyms 치환 후 exact 정답 기대');
});

// ─────────────────────────────────────────────
// 요약
// ─────────────────────────────────────────────
console.log('\n──────────────────────────────────');
console.log('결과: PASS=' + pass + '  FAIL=' + fail + '  TOTAL=' + (pass + fail));
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach(f => console.log('  [FAIL] ' + f.name + '\n         ' + f.msg));
  process.exitCode = 1;
} else {
  console.log('전체 통과');
}
