// 목업 콘텐츠 (cycle-3 r2) — 테스트 픽스처용. 원본 _example와 별개.
//
// 픽스처 목적:
//   A. cod-mock-001 — stdout-trim 정수 비교 core 픽스처 (현행 compare="stdout-trim" 기본 동작)
//   B. cod-mock-002 — stdout-float-tol 계약변경 검증용 픽스처
//                     (현재 규격 grading.compare = "stdout-trim" const.
//                      C1/stdout-float-tol 계약변경 승인·구현 후 compare를 "stdout-float-tol"로
//                      교체하고 이 픽스처로 회귀 검증할 것. 변경 전에는 expected를 고정 소수점
//                      문자열로 작성해 stdout-trim으로도 통과 가능하게 유지.)
//   C. cod-mock-003 — 테스트케이스 다건(5개) 전체 케이스 결과표 core 픽스처
//                     (C1 계약 승인 후 전체 cases[] 배열 렌더링 검증에 사용)
//   D. cod-mock-004 — back.solution·back.explanation 해설 패널 core 픽스처 (D3 심화)

(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['coding'] = (window.ACTIVITIES['coding'] || []).concat([

    /* ────────────────────────────────────────────────────────────
       A. 정수 stdout-trim 비교 픽스처
       // [픽스처: stdout-trim 정수 비교 — compare="stdout-trim" 기본 채점 경로]
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cod-mock-001',
      plugin_id:   'coding',
      type:        'code-problem',
      weight:      2,
      tags: { area: '기초 I/O', subarea: '정수 연산', unit: '합계 출력' },
      enabled:     true,
      front: {
        prompt: [
          '정수 두 개를 공백으로 구분하여 한 줄에 입력받아 두 수의 합을 출력하시오.',
          '(−10^9 ≤ a, b ≤ 10^9)'
        ].join('\n'),
        starter_code: [
          'a, b = map(int, input().split())',
          '# 두 수의 합을 출력하세요.',
          'print(  )  # 완성 필요'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'a, b = map(int, input().split())',
          'print(a + b)'
        ].join('\n'),
        explanation: [
          '핵심: input().split()으로 토큰 분리 → map(int, ...) 정수 변환 → 덧셈 출력.',
          '복잡도: O(1).',
          '주의: 음수·0 입력 모두 처리됨.'
        ].join(' / ')
      },
      grading: {
        test_cases: [
          { input: '3 5',          expected: '8'  },
          { input: '0 0',          expected: '0'  },
          { input: '-1000000000 1000000000', expected: '0' }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       B. 부동소수 출력 픽스처 (stdout-float-tol 계약변경 시 검증용)
       // [픽스처: stdout-float-tol — C1/stdout-float-tol 계약변경 시 검증용]
       //
       // stdout-float-tol 비교 모드 구현 완료 (런타임규격 §2-1, plugin.js _compare()).
       // 이 픽스처는 현재 compare="stdout-trim" + 고정 소수점 expected로 유지.
       // float-tol 회귀 검증 시:
       //   1. compare를 "stdout-float-tol"으로 변경
       //   2. tolerance: 1e-4 추가
       //   3. expected를 정확값으로 교체해도 동작 확인 가능
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cod-mock-002',
      plugin_id:   'coding',
      type:        'code-problem',
      weight:      2,
      tags: { area: '수학', subarea: '부동소수', unit: '원의 넓이' },
      enabled:     true,
      front: {
        prompt: [
          '실수 r(0 < r ≤ 100)을 입력받아 반지름이 r인 원의 넓이를 소수점 둘째 자리까지',
          '반올림하여 출력하시오.',
          '(π = 3.14159265358979 사용)',
          '',
          '출력 형식: 소수점 둘째 자리까지 고정 출력 (예: 12.57)'
        ].join('\n'),
        starter_code: [
          'import math',
          'r = float(input())',
          '# 원의 넓이를 소수점 둘째 자리까지 반올림하여 출력하세요.',
          'print(  )  # 완성 필요'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'import math',
          'r = float(input())',
          'print(round(math.pi * r * r, 2))'
        ].join('\n'),
        explanation: [
          '핵심: math.pi * r^2 계산 후 round(..., 2)로 소수점 둘째 자리 반올림.',
          '복잡도: O(1).',
          '주의: f-string {:.2f}와 round()는 banker\'s rounding 차이 있음 — round() 사용 통일.'
        ].join(' / ')
      },
      grading: {
        // 현행 stdout-trim 비교용 expected (고정 소수점 문자열).
        // stdout-float-tol 계약변경 후 tolerance 기반 비교로 전환 예정.
        test_cases: [
          { input: '2',   expected: '12.57' },
          { input: '1',   expected: '3.14'  },
          { input: '10',  expected: '314.16' }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       C. 테스트케이스 다건(5개) — 전체 케이스 결과표 core 픽스처
       // [픽스처: 전체 케이스 결과표 — C1 계약 승인 후 cases[] 배열 렌더링 검증용]
       //
       // 5개 케이스 중 일부 일부러 경계값·엣지케이스 포함.
       // C1 승인 후 ScoreResult.feedback.cases[] 배열에서
       // 각 행(idx·input·expected·actual·pass)이 모두 렌더되는지 검증.
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cod-mock-003',
      plugin_id:   'coding',
      type:        'code-problem',
      weight:      5,
      tags: { area: '알고리즘', subarea: '정렬', unit: '오름차순 정렬 출력' },
      enabled:     true,
      front: {
        prompt: [
          '첫 번째 줄에 정수 N(1 ≤ N ≤ 1000)이 주어진다.',
          '두 번째 줄에 공백으로 구분된 N개의 정수(−10^6 ≤ 각 수 ≤ 10^6)가 주어진다.',
          'N개의 정수를 오름차순으로 정렬하여 공백으로 구분해 한 줄에 출력하시오.'
        ].join('\n'),
        starter_code: [
          'def solve(nums):',
          '    # 리스트를 오름차순 정렬하여 반환하세요.',
          '    pass',
          '',
          'n = int(input())',
          'nums = list(map(int, input().split()))',
          'print(*solve(nums))'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'def solve(nums):',
          '    return sorted(nums)',
          '',
          'n = int(input())',
          'nums = list(map(int, input().split()))',
          'print(*solve(nums))'
        ].join('\n'),
        explanation: [
          '핵심: sorted()는 TimSort 기반 안정 정렬, 원본 리스트 불변.',
          '복잡도: O(N log N).',
          '주의: print(*list)는 공백 구분 한 줄 출력 — join 없이 간결하게 처리.'
        ].join(' / ')
      },
      grading: {
        // 5개 케이스: 기본·경계최솟값·음수혼합·이미정렬·역순
        // C1 승인 후 전체 cases[] 렌더링으로 idx=0~4 행 검증
        test_cases: [
          { input: '5\n3 1 4 1 5',        expected: '1 1 3 4 5'       },
          { input: '1\n0',                 expected: '0'               },
          { input: '4\n-3 2 -1 0',         expected: '-3 -1 0 2'      },
          { input: '3\n1 2 3',             expected: '1 2 3'           },
          { input: '4\n100 50 -50 -100',   expected: '-100 -50 50 100' }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       D. back.solution·back.explanation 해설 패널 픽스처 (D3 심화)
       // [픽스처: back 해설 패널 — solution·explanation 토글 렌더링 검증용]
       //
       // D3 난이도 — 재귀+메모이제이션 패턴. back 필드가 충분히 채워져 있어
       // 해설 패널 렌더링(토글 ON/OFF)·solution 코드블록·explanation 텍스트 표시를
       // 이 픽스처 하나로 검증 가능.
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cod-mock-004',
      plugin_id:   'coding',
      type:        'code-problem',
      weight:      8,
      tags: { area: '알고리즘', subarea: '동적 프로그래밍', unit: '최장 증가 부분 수열(LIS)' },
      enabled:     true,
      front: {
        prompt: [
          '첫 번째 줄에 정수 N(1 ≤ N ≤ 1000)이 주어진다.',
          '두 번째 줄에 공백으로 구분된 N개의 정수(1 ≤ 각 수 ≤ 10^6)가 주어진다.',
          '이 수열의 최장 증가 부분 수열(LIS)의 길이를 출력하시오.',
          '(LIS: 원래 순서를 유지하면서 값이 순증가하는 부분 수열 중 가장 긴 것)'
        ].join('\n'),
        starter_code: [
          'import sys',
          '',
          'def lis_length(nums):',
          '    """',
          '    최장 증가 부분 수열 길이를 반환한다.',
          '    :param nums: 정수 리스트',
          '    :return: LIS 길이 (int)',
          '    """',
          '    # 여기에 작성',
          '    pass',
          '',
          'n = int(input())',
          'nums = list(map(int, input().split()))',
          'print(lis_length(nums))'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'def lis_length(nums):',
          '    n = len(nums)',
          '    if n == 0:',
          '        return 0',
          '    dp = [1] * n',
          '    for i in range(1, n):',
          '        for j in range(i):',
          '            if nums[j] < nums[i]:',
          '                dp[i] = max(dp[i], dp[j] + 1)',
          '    return max(dp)',
          '',
          'n = int(input())',
          'nums = list(map(int, input().split()))',
          'print(lis_length(nums))'
        ].join('\n'),
        explanation: [
          '핵심: dp[i] = nums[i]로 끝나는 LIS 최대 길이. 이전 원소 중 nums[j]<nums[i]이면 dp[j]+1 후보.',
          '복잡도: O(N²) — N≤1000이면 충분. O(N log N) bisect 풀이로 최적화 가능.',
          '주의: dp 초기값 1(자기 자신만으로 이루어진 LIS). 빈 수열 방어 처리 포함.'
        ].join(' / ')
      },
      grading: {
        // 7개 케이스: 기본·단조증가·단조감소·길이1·반복원소·혼합·대입력
        test_cases: [
          { input: '6\n10 9 2 5 3 7',           expected: '4' },
          { input: '5\n1 2 3 4 5',               expected: '5' },
          { input: '4\n5 4 3 2',                 expected: '1' },
          { input: '1\n42',                       expected: '1' },
          { input: '5\n3 3 3 3 3',               expected: '1' },
          { input: '7\n2 1 5 3 6 4 8',           expected: '5' },
          { input: '8\n1 3 2 4 3 5 4 6',         expected: '5' }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       E. micropip 화이트리스트 core 픽스처 — numpy 통계 문제
       // [픽스처: micropip 화이트리스트 core — 구현 완료]
       //
       // 런타임규격.md §2-1 grading 스키마에 allowed_packages[] 추가 완료.
       // plugin.js mount() → _collectAllowedPackages() → _installPackages() 경로 구현 완료.
       // V12 체크리스트 추가 완료.
       //
       // 이 픽스처로 회귀 검증: mount 후 Pyodide에서 'import numpy' 성공 여부 확인.
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cod-mock-005',
      plugin_id:   'coding',
      type:        'code-problem',
      weight:      3,
      tags: { area: '과학 컴퓨팅', subarea: '통계', unit: '평균·표준편차 출력' },
      enabled:     true,
      front: {
        prompt: [
          '첫 번째 줄에 정수 N(2 ≤ N ≤ 100)이 주어진다.',
          '두 번째 줄에 공백으로 구분된 N개의 실수가 주어진다.',
          'numpy를 사용하여 이 수열의 산술 평균과 표준편차(모표준편차)를',
          '각각 소수점 둘째 자리까지 반올림하여 한 줄에 공백으로 구분해 출력하시오.',
          '',
          '예) 입력: 4 / 1.0 2.0 3.0 4.0  →  출력: 2.5 1.12'
        ].join('\n'),
        starter_code: [
          'import numpy as np',
          '',
          'n = int(input())',
          'nums = list(map(float, input().split()))',
          '# numpy로 평균과 모표준편차를 계산하여 출력하세요.',
          'print(  )  # 완성 필요'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'import numpy as np',
          '',
          'n = int(input())',
          'nums = list(map(float, input().split()))',
          'arr = np.array(nums)',
          'mean = round(float(np.mean(arr)), 2)',
          'std  = round(float(np.std(arr)),  2)',
          'print(mean, std)'
        ].join('\n'),
        explanation: [
          '핵심: np.mean()=산술 평균, np.std()=모표준편차(ddof=0 기본값).',
          'round() + float() 변환으로 소수점 둘째 자리 고정 출력.',
          '복잡도: O(N). numpy 없이 statistics.stdev()(표본표준편차)와 혼동 주의 — ddof 기본값 다름.'
        ].join(' / ')
      },
      grading: {
        // allowed_packages: 런타임규격 §2-1 grading 스키마에 정의됨 (구현 완료).
        // mount() 시 micropip.install(['numpy']) 사전 실행됨.
        allowed_packages: ['numpy'],
        test_cases: [
          { input: '4\n1.0 2.0 3.0 4.0',          expected: '2.5 1.12'   },
          { input: '2\n0.0 0.0',                    expected: '0.0 0.0'   },
          { input: '3\n10.0 20.0 30.0',             expected: '20.0 8.16' },
          { input: '5\n-2.0 -1.0 0.0 1.0 2.0',     expected: '0.0 1.41'  }
        ],
        compare: 'stdout-trim'
      }
    }

  ]);

})();
