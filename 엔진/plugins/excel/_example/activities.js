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
    }

  ];

})();
