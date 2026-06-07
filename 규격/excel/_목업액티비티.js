// 목업 콘텐츠 (cycle-3 r2) — 테스트 픽스처용. 원본 _example와 별개.
//
// 커버하는 core 기능 픽스처:
//   #1 xls-sum-001   → 단일 target_cell 값비교 (SUM, 정수)
//   #2 xls-avg-001   → 부동소수 결과 float 허용오차 픽스처 (AVERAGE + ROUND)
//   #3 xls-vlookup-001 → 단일 target_cell 문자열 결과 (VLOOKUP)
//   #4 xls-sumif-001 → 다중 target_cells 3셀 결과표 픽스처 (SUMIF×3)
//
// 규격 준수 포인트:
//   - ActivitySpec JSON Schema (런타임규격 §2-1) 완전형 — plugin_id·weight·tags·enabled 전부 포함
//   - target_cells T2: 각 셀이 initial_grid에서 "" 인 위치와 정확히 일치 (G9 포함)
//   - target_cells ↔ grading.expected 동일 순서·동일 길이 (V5·V7)
//   - 부동소수 오차 회피: ROUND(expr, 1) 적용 + expected도 반올림값 기재 (E6)
//   - 안전 함수 목록(생성규칙 §8) 내 함수만 사용
//   - initial_grid 내 수식 문자열 없음 (G9 금지사항)

(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['excel'] = [

    /* ──────────────────────────────────────────────────────────────
       [픽스처: 단일 target_cell 값비교]
       #1 SUM — 월별 판매량 합계
       그리드 레이아웃 (1-indexed 행, A/B 열):
         A1: "월"     B1: "판매량"
         A2: "1월"    B2: 110
         A3: "2월"    B3: 95
         A4: "3월"    B4: 130
         A5: "4월"    B5: 85
         A6: "5월"    B6: 105
         A7: "합계"   B7: "" ← target (학습자가 SUM 수식 입력)
       B7 = 110+95+130+85+105 = 525
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'xls-sum-001',
      plugin_id:   'excel',
      type:        'sheet-task',
      weight:      2,
      tags: { area: '집계함수', subarea: '수학함수', unit: 'SUM' },
      enabled: true,
      front: {
        prompt: [
          'B2:B6 셀에 월별 판매량이 입력되어 있습니다.',
          'B7 셀에 SUM 함수를 사용하여 B2:B6의 합계를 구하시오.',
          '',
          '※ 수식 예시: =SUM(B2:B6)'
        ].join('\n'),
        initial_grid: [
          ['월',   '판매량'],
          ['1월',  110],
          ['2월',   95],
          ['3월',  130],
          ['4월',   85],
          ['5월',  105],
          ['합계',   '']       // row 6 (0-based) → B7
        ],
        target_cells: ['B7']  // initial_grid[6][1] = "" ✓ (G9·T2)
      },
      back: {
        solution:    '=SUM(B2:B6)',
        explanation: 'SUM(범위)는 범위 내 숫자를 모두 더한다. 110+95+130+85+105 = 525.'
      },
      grading: {
        expected: [
          { cell: 'B7', value: 525 }
        ],
        compare: 'value'
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: 부동소수 결과 float 허용오차]
       #2 AVERAGE + ROUND — 시험 점수 평균 (소수 1자리 반올림)
       그리드 레이아웃:
         A1: "이름"   B1: "점수"
         A2: "민준"   B2: 84
         A3: "서연"   B3: 91
         A4: "도윤"   B4: 76
         A5: "지아"   B5: 88
         A6: "현우"   B6: 72
         A7: "평균"   B7: "" ← target
       AVERAGE(B2:B6) = (84+91+76+88+72)/5 = 411/5 = 82.2
       ROUND(AVERAGE(B2:B6),1) = 82.2  (소수 1자리 그대로, 부동소수 오차 방어)
       E6 규칙: 수식에 ROUND 적용, expected = 82.2 (number)
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'xls-avg-001',
      plugin_id:   'excel',
      type:        'sheet-task',
      weight:      3,
      tags: { area: '집계함수', subarea: '통계함수', unit: 'AVERAGE' },
      enabled: true,
      front: {
        prompt: [
          '5명의 시험 점수가 B2:B6에 입력되어 있습니다.',
          'B7 셀에 ROUND와 AVERAGE 함수를 사용하여',
          'B2:B6의 평균을 소수 첫째 자리까지 구하시오.',
          '',
          '※ 수식 예시: =ROUND(AVERAGE(B2:B6),1)'
        ].join('\n'),
        initial_grid: [
          ['이름',  '점수'],
          ['민준',   84],
          ['서연',   91],
          ['도윤',   76],
          ['지아',   88],
          ['현우',   72],
          ['평균',   '']       // row 6 (0-based) → B7
        ],
        target_cells: ['B7']  // initial_grid[6][1] = "" ✓ (G9·T2)
      },
      back: {
        solution:    '=ROUND(AVERAGE(B2:B6),1)',
        explanation: [
          'AVERAGE(B2:B6) = (84+91+76+88+72) / 5 = 82.2',
          'ROUND(82.2, 1) = 82.2 (소수 1자리 반올림).',
          'ROUND를 감싸면 부동소수점 오차 없이 일정한 값으로 채점 가능.'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B7', value: 82.2 }   // ROUND(411/5, 1) = 82.2 ✓ (E4·E6)
        ],
        compare: 'value'
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: 단일 target_cell 문자열 결과 — 조회함수]
       #3 VLOOKUP — 상품코드로 상품명 조회
       그리드 레이아웃:
         A1: "코드"   B1: "상품명"   C1: "단가"
         A2: "P001"   B2: "사과"     C2: 1500
         A3: "P002"   B3: "배"       C3: 2800
         A4: "P003"   B4: "딸기"     C4: 3200
         A5: "P004"   B5: "포도"     C5: 4500
         A6: ""       B6: ""         C6: ""
         A7: "조회코드"  B7: "P003"
         A8: "상품명"    B8: "" ← target
       VLOOKUP("P003", A2:C5, 2, 0) = "딸기"
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'xls-vlookup-001',
      plugin_id:   'excel',
      type:        'sheet-task',
      weight:      4,
      tags: { area: '조회함수', subarea: '참조함수', unit: 'VLOOKUP' },
      enabled: true,
      front: {
        prompt: [
          'A2:C5에 상품코드·상품명·단가 목록이 있습니다.',
          'B7 셀의 조회 코드("P003")에 해당하는 상품명을',
          'B8 셀에 VLOOKUP 함수를 사용하여 구하시오.',
          '',
          '※ 수식 예시: =VLOOKUP(B7,A2:C5,2,0)'
        ].join('\n'),
        initial_grid: [
          ['코드',    '상품명', '단가'],
          ['P001',   '사과',   1500],
          ['P002',   '배',     2800],
          ['P003',   '딸기',   3200],
          ['P004',   '포도',   4500],
          ['',        '',        ''],
          ['조회코드', 'P003',    ''],
          ['상품명',   '',         '']  // row 7 (0-based) → B8
        ],
        target_cells: ['B8']  // initial_grid[7][1] = "" ✓ (G9·T2)
      },
      back: {
        solution:    '=VLOOKUP(B7,A2:C5,2,0)',
        explanation: [
          'VLOOKUP(찾을값, 표범위, 열번호, [일치유형]).',
          '찾을값 = B7("P003"), 표범위 = A2:C5, 열번호 = 2(상품명 열), 0=정확히 일치.',
          'A열에서 "P003"을 찾으면 4번째 행(A5) → 같은 행 B열 = "딸기".'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B8', value: '딸기' }  // 문자열 결과 (E5)
        ],
        compare: 'value'
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: 다중 target_cells 3셀 결과표]
       #4 SUMIF×3 — 카테고리별 매출 합계
       그리드 레이아웃:
         A1: "카테고리"   B1: "매출"
         A2: "전자"       B2: 320000
         A3: "의류"       B3: 150000
         A4: "전자"       B4: 280000
         A5: "식품"       B5: 90000
         A6: "의류"       B6: 210000
         A7: "식품"       B7: 130000
         A8: "전자"       B8: 195000
         A9: ""           B9: ""
         A10: "전자 합계"  B10: "" ← target 1
         A11: "의류 합계"  B11: "" ← target 2
         A12: "식품 합계"  B12: "" ← target 3
       전자: 320000+280000+195000 = 795000
       의류: 150000+210000 = 360000
       식품: 90000+130000 = 220000
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'xls-sumif-001',
      plugin_id:   'excel',
      type:        'sheet-task',
      weight:      5,
      tags: { area: '집계함수', subarea: '조건부집계', unit: 'SUMIF' },
      enabled: true,
      front: {
        prompt: [
          'A2:B8에 카테고리별 매출 데이터가 입력되어 있습니다.',
          '아래 셀에 SUMIF 함수를 사용하여 카테고리별 합계를 구하시오.',
          '  B10: "전자" 카테고리 매출 합계',
          '  B11: "의류" 카테고리 매출 합계',
          '  B12: "식품" 카테고리 매출 합계',
          '',
          '※ 수식 예시(B10): =SUMIF(A2:A8,"전자",B2:B8)'
        ].join('\n'),
        initial_grid: [
          ['카테고리', '매출'],          // row 0 → 행 1
          ['전자',     320000],          // row 1 → 행 2
          ['의류',     150000],          // row 2 → 행 3
          ['전자',     280000],          // row 3 → 행 4
          ['식품',      90000],          // row 4 → 행 5
          ['의류',     210000],          // row 5 → 행 6
          ['식품',     130000],          // row 6 → 행 7
          ['전자',     195000],          // row 7 → 행 8
          ['',            ''],           // row 8 → 행 9
          ['전자 합계',   ''],           // row 9  → 행 10, B10 = ""
          ['의류 합계',   ''],           // row 10 → 행 11, B11 = ""
          ['식품 합계',   '']            // row 11 → 행 12, B12 = ""
        ],
        //  B10: initial_grid[9][1]  = "" ✓
        //  B11: initial_grid[10][1] = "" ✓
        //  B12: initial_grid[11][1] = "" ✓  (G9·T2 전부 충족)
        target_cells: ['B10', 'B11', 'B12']
      },
      back: {
        solution: [
          'B10: =SUMIF(A2:A8,"전자",B2:B8)',
          'B11: =SUMIF(A2:A8,"의류",B2:B8)',
          'B12: =SUMIF(A2:A8,"식품",B2:B8)'
        ].join('\n'),
        explanation: [
          'SUMIF(조건범위, 조건, 합계범위)는 조건을 만족하는 행의 합계를 반환한다.',
          '전자: 320000+280000+195000 = 795000',
          '의류: 150000+210000 = 360000',
          '식품: 90000+130000 = 220000'
        ].join('\n')
      },
      grading: {
        expected: [
          { cell: 'B10', value: 795000 },  // 320000+280000+195000 ✓
          { cell: 'B11', value: 360000 },  // 150000+210000 ✓
          { cell: 'B12', value: 220000 }   // 90000+130000 ✓
        ],
        compare: 'value'
      }
    }

  ];

})();
