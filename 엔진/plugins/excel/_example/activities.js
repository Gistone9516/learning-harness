/**
 * excel / _example / activities.js
 * ─────────────────────────────────────────────────────────────────
 * excel 플러그인 ActivitySpec 예제 데이터.
 * window.ACTIVITIES["excel"] 배열에 등록.
 *
 * ActivitySpec (excel 플러그인 확정 스펙):
 *   type        : "sheet-task"
 *   front       : {
 *                   prompt       : string (과제 설명),
 *                   initial_grid : string[][] (행×열 초기값, "" = 빈 셀),
 *                   target_cells : string[]   (예: ["B6"])
 *                 }
 *   back        : { solution?: string, explanation?: string }
 *   grading     : {
 *                   expected : [{ cell: string, value: string | number }],
 *                   compare  : "value"   // MVP = 정적 값 비교
 *                 }
 *
 * 채점 흐름 (MVP / 정적):
 *   Univer Facade로 target_cells의 계산된 셀 값 읽기 →
 *   expected[i].value와 비교 →
 *   ScoreResult = {
 *     verdict   : "correct" | "incorrect",
 *     score_raw : passed / total  (0..1),
 *     grader_id : "engine",
 *     feedback  : { passed, total, first_fail?: { cell, expected, got } }
 *   }
 *
 * 파킹(v2):
 *   - 수식 동치 채점: PySheetGrader (파이썬 백엔드 필요)
 *   - 서식·조건부서식 채점
 *   - Univer 고급 함수 커버리지 미검증 항목
 *
 * 문제 선정 기준: 보편·무편향 스프레드시트 기초 함수.
 *   1. SUM    — 연속 범위 합계
 *   2. AVERAGE — 연속 범위 평균
 *   3. SUMIF  — 조건부 합계
 *   4. AVERAGE (다중 범위) — 분반별 평균 점수
 *   5. IF     — 조건 판별 레이블 출력
 *   6. COUNTIF — 조건 만족 항목 개수 세기
 * ─────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['excel'] = [

    /* ────────────────────────────────────────────────────────────
       1. SUM — 연속 범위 합계
       그리드 레이아웃 (1-indexed 행, A/B 열):
         A1: "월"    B1: "판매량"
         A2: "1월"   B2: 10
         A3: "2월"   B3: 20
         A4: "3월"   B4: 30
         A5: "4월"   B5: 40
         A6: "5월"   B6: 50  ← 실수 방지: 마지막 데이터 행
         A7: "합계"  B7: (빈 셀 → 학습자가 SUM 수식 입력)
       target: B7  expected: 150  (10+20+30+40+50)
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'excel-ex-001',
      type: 'sheet-task',
      front: {
        prompt: [
          'B2:B6 범위에 있는 월별 판매량의 합계를 구하려 한다.',
          'B7 셀에 SUM 함수를 사용하여 B2:B6의 합계를 입력하라.',
          '',
          '※ 수식 예시: =SUM(B2:B6)'
        ].join('\n'),
        initial_grid: [
          ['월',   '판매량'],
          ['1월',  10],
          ['2월',  20],
          ['3월',  30],
          ['4월',  40],
          ['5월',  50],
          ['합계', '']
        ],
        target_cells: ['B7']
      },
      back: {
        solution: '=SUM(B2:B6)',
        explanation: [
          'SUM(범위)는 지정한 셀 범위의 숫자를 모두 더한다.',
          'B2:B6은 B2부터 B6까지 연속 5개 셀을 의미하며,',
          '10+20+30+40+50 = 150이 계산 결과로 반환된다.'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B7', value: 150 }
        ],
        compare: 'value'
      }
    },

    /* ────────────────────────────────────────────────────────────
       2. AVERAGE — 연속 범위 평균
       그리드 레이아웃:
         A1: "이름"    B1: "점수"
         A2: "Alice"   B2: 85
         A3: "Bob"     B3: 92
         A4: "Carol"   B4: 78
         A5: "Dave"    B5: 96
         A6: "Eve"     B6: 88
         A7: "평균"    B7: (빈 셀 → 학습자가 AVERAGE 수식 입력)
       target: B7  expected: 87.8  ((85+92+78+96+88)/5)
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'excel-ex-002',
      type: 'sheet-task',
      front: {
        prompt: [
          '5명의 시험 점수가 B2:B6에 입력되어 있다.',
          'B7 셀에 AVERAGE 함수를 사용하여 B2:B6의 평균을 구하라.',
          '',
          '※ 수식 예시: =AVERAGE(B2:B6)'
        ].join('\n'),
        initial_grid: [
          ['이름',  '점수'],
          ['Alice', 85],
          ['Bob',   92],
          ['Carol', 78],
          ['Dave',  96],
          ['Eve',   88],
          ['평균',  '']
        ],
        target_cells: ['B7']
      },
      back: {
        solution: '=AVERAGE(B2:B6)',
        explanation: [
          'AVERAGE(범위)는 범위 내 숫자의 산술 평균을 반환한다.',
          '(85+92+78+96+88) / 5 = 439 / 5 = 87.8이다.',
          'SUM(B2:B6)/COUNT(B2:B6)으로도 동일한 결과를 얻을 수 있다.'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B7', value: 87.8 }
        ],
        compare: 'value'
      }
    },

    /* ────────────────────────────────────────────────────────────
       3. SUMIF — 조건부 합계
       그리드 레이아웃:
         A1: "분류"   B1: "금액"
         A2: "과일"   B2: 1200
         A3: "채소"   B3: 500
         A4: "과일"   B4: 800
         A5: "채소"   B5: 300
         A6: "과일"   B6: 950
         A7: (빈)     B7: (빈)
         A8: "과일 합계"  B8: (빈 셀 → 학습자가 SUMIF 수식 입력)
       target: B8  expected: 2950  (1200+800+950)
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'excel-ex-003',
      type: 'sheet-task',
      front: {
        prompt: [
          'A2:A6에 상품 분류, B2:B6에 판매 금액이 입력되어 있다.',
          'B8 셀에 SUMIF 함수를 사용하여',
          '분류가 "과일"인 행의 금액 합계만 구하라.',
          '',
          '※ 수식 예시: =SUMIF(A2:A6,"과일",B2:B6)'
        ].join('\n'),
        initial_grid: [
          ['분류',      '금액'],
          ['과일',      1200],
          ['채소',       500],
          ['과일',       800],
          ['채소',       300],
          ['과일',       950],
          ['',           ''],
          ['과일 합계',  '']
        ],
        target_cells: ['B8']
      },
      back: {
        solution: '=SUMIF(A2:A6,"과일",B2:B6)',
        explanation: [
          'SUMIF(조건_범위, 조건, 합계_범위)는 조건_범위에서',
          '조건을 만족하는 행의 합계_범위 값을 합산한다.',
          'A2:A6 중 "과일"인 행은 A2(1200), A4(800), A6(950)이므로',
          '1200 + 800 + 950 = 2950이 반환된다.'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B8', value: 2950 }
        ],
        compare: 'value'
      }
    },

    /* ────────────────────────────────────────────────────────────
       4. AVERAGE — 두 범위의 평균 비교
       그리드 레이아웃:
         A1: "분반"     B1: "1차 점수"   C1: "2차 점수"
         A2: "A반"      B2: 72           C2: 81
         A3: "A반"      B3: 68           C3: 75
         A4: "A반"      B4: 80           C4: 88
         A5: (빈)       B5: (빈)         C5: (빈)
         A6: "1차 평균" B6: (빈 → AVERAGE(B2:B4) 입력)
         A7: "2차 평균" B7: (빈 → AVERAGE(C2:C4) 입력)
       target: B6=73.333..., B7=81.333...
       주의: 소수 비교 가능하도록 value를 반올림 없이 정수 아닌 값으로 줄 경우
             채점이 까다롭기 때문에 정수 데이터로 정수 평균이 나오도록 구성.
       revised 데이터: 70, 80, 90 → 평균 80; 74, 86, 90 → 평균 83.333 어렵.
       가장 단순하게: 60,80,100 → 평균 80; 70,80,90 → 평균 80.
       아예 정수만: B2:B4 = 60,80,100 → B6=80; C2:C4 = 70,80,90 → C6 불필요.
       단일 셀 정수 결과: B2:B4 = 60,80,100 → AVERAGE=80; C2:C4 = 75,85,95 → AVERAGE=85.
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'excel-ex-004',
      type: 'sheet-task',
      front: {
        prompt: [
          '학생 3명의 1차·2차 시험 점수가 B2:B4, C2:C4에 각각 입력되어 있다.',
          'B6 셀에 AVERAGE 함수로 1차 점수(B2:B4)의 평균을,',
          'C6 셀에 AVERAGE 함수로 2차 점수(C2:C4)의 평균을 구하라.',
          '',
          '※ 수식 예시: B6 → =AVERAGE(B2:B4)  /  C6 → =AVERAGE(C2:C4)'
        ].join('\n'),
        initial_grid: [
          ['학생',  '1차 점수', '2차 점수'],
          ['학생1',  60,         75],
          ['학생2',  80,         85],
          ['학생3', 100,         95],
          ['',       '',          ''],
          ['평균',   '',          '']
        ],
        target_cells: ['B6', 'C6']
      },
      back: {
        solution: 'B6: =AVERAGE(B2:B4)  /  C6: =AVERAGE(C2:C4)',
        explanation: [
          'AVERAGE(B2:B4) = (60+80+100)/3 = 80',
          'AVERAGE(C2:C4) = (75+85+95)/3 = 85',
          '두 평균을 비교하면 2차 점수(85)가 1차 점수(80)보다 높다.'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B6', value: 80 },
          { cell: 'C6', value: 85 }
        ],
        compare: 'value'
      }
    },

    /* ────────────────────────────────────────────────────────────
       5. IF — 조건 판별 레이블 출력
       그리드 레이아웃:
         A1: "이름"    B1: "점수"   C1: "합격여부"
         A2: "민준"    B2: 72       C2: (빈)
         A3: "서연"    B3: 88       C3: (빈)
         A4: "도윤"    B4: 55       C4: (빈)
         A5: "지아"    B5: 95       C5: (빈)
         A6: "현우"    B6: 63       C6: (빈)
       규칙: 점수 >= 60 → "합격", 미만 → "불합격"
       target: C2~C6
         C2: "합격"(72≥60), C3: "합격"(88≥60), C4: "불합격"(55<60),
         C5: "합격"(95≥60), C6: "합격"(63≥60)
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'excel-ex-005',
      type: 'sheet-task',
      front: {
        prompt: [
          '점수가 60 이상이면 "합격", 미만이면 "불합격"을 표시하려 한다.',
          'C2 셀에 IF 함수를 입력하고, C3:C6까지 동일한 수식을 각각 입력하라.',
          '',
          '※ 수식 예시: =IF(B2>=60,"합격","불합격")'
        ].join('\n'),
        initial_grid: [
          ['이름',  '점수', '합격여부'],
          ['민준',   72,     ''],
          ['서연',   88,     ''],
          ['도윤',   55,     ''],
          ['지아',   95,     ''],
          ['현우',   63,     '']
        ],
        target_cells: ['C2', 'C3', 'C4', 'C5', 'C6']
      },
      back: {
        solution: '=IF(B2>=60,"합격","불합격") (C2~C6 각각 입력)',
        explanation: [
          'IF(조건, 참일때값, 거짓일때값) 형식으로 사용한다.',
          '72, 88, 95, 63은 모두 60 이상 → "합격"',
          '55는 60 미만 → "불합격"'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'C2', value: '합격' },
          { cell: 'C3', value: '합격' },
          { cell: 'C4', value: '불합격' },
          { cell: 'C5', value: '합격' },
          { cell: 'C6', value: '합격' }
        ],
        compare: 'value'
      }
    },

    /* ────────────────────────────────────────────────────────────
       6. COUNTIF — 조건 만족 항목 개수 세기
       그리드 레이아웃:
         A1: "부서"   B1: "초과근무"
         A2: "영업"   B2: "Y"
         A3: "기술"   B3: "N"
         A4: "영업"   B4: "Y"
         A5: "인사"   B5: "N"
         A6: "기술"   B6: "Y"
         A7: "영업"   B7: "Y"
         A8: (빈)     B8: (빈)
         A9: "초과근무 Y 인원"  B9: (빈 → COUNTIF 입력)
       target: B9  expected: 4  (B2,B4,B6,B7 = "Y")
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'excel-ex-006',
      type: 'sheet-task',
      front: {
        prompt: [
          'B2:B7에 직원별 초과근무 여부("Y" 또는 "N")가 입력되어 있다.',
          'B9 셀에 COUNTIF 함수를 사용하여',
          '초과근무를 한 직원("Y")의 수를 구하라.',
          '',
          '※ 수식 예시: =COUNTIF(B2:B7,"Y")'
        ].join('\n'),
        initial_grid: [
          ['부서',  '초과근무'],
          ['영업',   'Y'],
          ['기술',   'N'],
          ['영업',   'Y'],
          ['인사',   'N'],
          ['기술',   'Y'],
          ['영업',   'Y'],
          ['',        ''],
          ['초과근무 Y 인원', '']
        ],
        target_cells: ['B9']
      },
      back: {
        solution: '=COUNTIF(B2:B7,"Y")',
        explanation: [
          'COUNTIF(범위, 조건)은 범위 내에서 조건을 만족하는 셀의 개수를 반환한다.',
          'B2:B7 중 "Y"인 셀은 B2, B4, B6, B7 → 총 4개이다.'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B9', value: 4 }
        ],
        compare: 'value'
      }
    }

  ];

})();
