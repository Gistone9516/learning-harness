/**
 * coding / _example / activities.js
 * ─────────────────────────────────────────────────────────────────
 * coding 플러그인 ActivitySpec 예제 데이터.
 * window.ACTIVITIES["coding"] 배열에 등록.
 *
 * ActivitySpec (coding 플러그인 확정 스펙):
 *   type        : "code-problem"
 *   front       : { prompt: string, starter_code: string, language: "python" }
 *   back        : { solution?: string, explanation?: string }
 *   grading     : {
 *                   test_cases : [{ input: string (stdin), expected: string (stdout) }],
 *                   compare    : "stdout-trim"
 *                 }
 *
 * 채점 흐름:
 *   Pyodide로 각 test_case 실행 (stdin = input) →
 *   stdout을 expected와 trim 비교 →
 *   ScoreResult = {
 *     verdict   : "correct" | "incorrect",
 *     score_raw : passed / total  (0..1),
 *     grader_id : "pyodide",
 *     feedback  : { passed, total, first_fail?: { input, expected, got } }
 *   }
 *
 * 문제 선정 기준: 보편·무편향 알고리즘/기초 프로그래밍 주제.
 *   1. 두 정수의 합
 *   2. 리스트 최댓값
 *   3. 문자열 뒤집기
 *   4. 팩토리얼
 *   5. 피보나치 수열 N번째
 *   6. 소수 판별
 * ─────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['coding'] = [

    /* ────────────────────────────────────────────────────────────
       1. 두 정수의 합
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'coding-ex-001',
      type: 'code-problem',
      front: {
        prompt: [
          '표준 입력으로 정수 두 개가 공백으로 구분되어 한 줄에 주어진다.',
          '두 수의 합을 출력하라.',
          '',
          '입력 예: 3 5',
          '출력 예: 8'
        ].join('\n'),
        starter_code: [
          '# 표준 입력에서 두 정수를 읽어 합을 출력하세요.',
          'a, b = map(int, input().split())',
          'print(  )  # 여기를 완성하세요'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'a, b = map(int, input().split())',
          'print(a + b)'
        ].join('\n'),
        explanation: [
          'input().split()으로 공백 구분 토큰 리스트를 얻고,',
          'map(int, ...)으로 정수 변환한 뒤 a, b에 언패킹한다.',
          'a + b를 print()로 출력하면 개행 포함 stdout에 쓰인다.'
        ].join('\n')
      },
      grading: {
        test_cases: [
          { input: '3 5',    expected: '8'    },
          { input: '0 0',    expected: '0'    },
          { input: '-4 10',  expected: '6'    }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       2. 리스트 최댓값
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'coding-ex-002',
      type: 'code-problem',
      front: {
        prompt: [
          '첫 번째 줄에 정수 N(1 ≤ N ≤ 100)이 주어진다.',
          '두 번째 줄에 공백으로 구분된 N개의 정수가 주어진다.',
          '이 중 가장 큰 수를 출력하라.',
          '',
          '입력 예:',
          '5',
          '3 1 4 1 5',
          '출력 예: 5'
        ].join('\n'),
        starter_code: [
          'n = int(input())',
          'nums = list(map(int, input().split()))',
          '# nums에서 최댓값을 구해 출력하세요.',
          'print(  )  # 여기를 완성하세요'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'n = int(input())',
          'nums = list(map(int, input().split()))',
          'print(max(nums))'
        ].join('\n'),
        explanation: [
          'max() 내장 함수는 이터러블에서 최댓값을 O(N)에 반환한다.',
          '직접 구현한다면 변수 하나에 첫 원소를 넣고',
          '반복하며 더 큰 값으로 갱신하는 방식을 쓸 수 있다.'
        ].join('\n')
      },
      grading: {
        test_cases: [
          { input: '5\n3 1 4 1 5',  expected: '5'   },
          { input: '1\n42',         expected: '42'  },
          { input: '4\n-3 -1 -7 -2', expected: '-1' }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       3. 문자열 뒤집기
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'coding-ex-003',
      type: 'code-problem',
      front: {
        prompt: [
          '표준 입력으로 문자열 한 줄이 주어진다.',
          '해당 문자열을 뒤집어서 출력하라.',
          '(공백·특수문자 포함, 대소문자 그대로)',
          '',
          '입력 예: hello',
          '출력 예: olleh'
        ].join('\n'),
        starter_code: [
          's = input()',
          '# s를 뒤집어 출력하세요.',
          'print(  )  # 여기를 완성하세요'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          's = input()',
          'print(s[::-1])'
        ].join('\n'),
        explanation: [
          "슬라이싱 s[::-1]은 step=-1로 문자열을 끝에서 처음까지 순회해 뒤집는다.",
          "reversed(s)와 ''.join()을 조합하거나,",
          "리스트로 변환 후 .reverse()를 써도 동일한 결과를 얻는다."
        ].join('\n')
      },
      grading: {
        test_cases: [
          { input: 'hello',    expected: 'olleh'    },
          { input: 'racecar',  expected: 'racecar'  },
          { input: 'a b c',    expected: 'c b a'    }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       4. 팩토리얼
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'coding-ex-004',
      type: 'code-problem',
      front: {
        prompt: [
          '정수 N(0 ≤ N ≤ 12)이 한 줄에 주어진다.',
          'N! (N 팩토리얼)을 출력하라.',
          '',
          '팩토리얼 정의:',
          '  0! = 1',
          '  N! = N × (N-1) × ... × 1',
          '',
          '입력 예: 5',
          '출력 예: 120'
        ].join('\n'),
        starter_code: [
          'n = int(input())',
          '# n!을 계산해 출력하세요.',
          '# 반복문 또는 재귀를 사용할 수 있습니다.',
          'result = 1',
          '# 여기를 완성하세요',
          'print(result)'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'n = int(input())',
          'result = 1',
          'for i in range(2, n + 1):',
          '    result *= i',
          'print(result)'
        ].join('\n'),
        explanation: [
          'result를 1로 초기화하고 2부터 n까지 곱해 나간다.',
          'n=0 또는 n=1일 때 반복이 실행되지 않아 result=1이 그대로 출력된다.',
          'math.factorial(n)을 써도 되지만, 직접 구현이 원리 이해에 유리하다.'
        ].join('\n')
      },
      grading: {
        test_cases: [
          { input: '0',  expected: '1'        },
          { input: '1',  expected: '1'        },
          { input: '5',  expected: '120'      },
          { input: '10', expected: '3628800'  }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       5. 피보나치 수열 N번째
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'coding-ex-005',
      type: 'code-problem',
      front: {
        prompt: [
          '정수 N(1 ≤ N ≤ 30)이 한 줄에 주어진다.',
          '피보나치 수열의 N번째 항을 출력하라.',
          '',
          '피보나치 수열 정의 (1-indexed):',
          '  F(1) = 1, F(2) = 1',
          '  F(n) = F(n-1) + F(n-2)  (n ≥ 3)',
          '',
          '입력 예: 7',
          '출력 예: 13'
        ].join('\n'),
        starter_code: [
          'n = int(input())',
          '# 피보나치 수열 n번째 항을 계산해 출력하세요.',
          '# F(1)=1, F(2)=1, F(3)=2, F(4)=3, F(5)=5, ...',
          'a, b = 1, 1',
          '# 여기를 완성하세요',
          'print(  )'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'n = int(input())',
          'a, b = 1, 1',
          'for _ in range(n - 1):',
          '    a, b = b, a + b',
          'print(a)'
        ].join('\n'),
        explanation: [
          'a=F(1)=1, b=F(2)=1로 시작하고, 매 반복마다 (a,b) → (b, a+b)로 한 칸씩 앞으로 밀어 나간다.',
          '반복을 n-1번 수행하면 a에 F(n)이 담긴다.',
          '재귀로 구현하면 코드가 짧지만 n=30에서 중복 계산이 많아 느려진다 — 반복이 효율적.'
        ].join('\n')
      },
      grading: {
        test_cases: [
          { input: '1',  expected: '1'    },
          { input: '2',  expected: '1'    },
          { input: '7',  expected: '13'   },
          { input: '10', expected: '55'   },
          { input: '20', expected: '6765' }
        ],
        compare: 'stdout-trim'
      }
    },

    /* ────────────────────────────────────────────────────────────
       6. 소수 판별
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'coding-ex-006',
      type: 'code-problem',
      front: {
        prompt: [
          '정수 N(2 ≤ N ≤ 10000)이 한 줄에 주어진다.',
          'N이 소수이면 "YES", 소수가 아니면 "NO"를 출력하라.',
          '',
          '소수: 1과 자기 자신만을 약수로 갖는 2 이상의 자연수.',
          '',
          '입력 예: 17',
          '출력 예: YES',
          '',
          '입력 예: 18',
          '출력 예: NO'
        ].join('\n'),
        starter_code: [
          'n = int(input())',
          '# n이 소수인지 판별해 YES 또는 NO를 출력하세요.',
          'is_prime = True',
          '# 여기를 완성하세요',
          'print("YES" if is_prime else "NO")'
        ].join('\n'),
        language: 'python'
      },
      back: {
        solution: [
          'n = int(input())',
          'is_prime = True',
          'if n < 2:',
          '    is_prime = False',
          'else:',
          '    i = 2',
          '    while i * i <= n:',
          '        if n % i == 0:',
          '            is_prime = False',
          '            break',
          '        i += 1',
          'print("YES" if is_prime else "NO")'
        ].join('\n'),
        explanation: [
          '2부터 √n까지만 나누어 보면 된다. n=a×b에서 a≤√n인 인수가 반드시 존재하기 때문이다.',
          '루프 조건을 i*i <= n으로 쓰면 math.sqrt 없이 정수 연산만으로 동일한 범위를 검사할 수 있다.',
          '문제 조건상 N≥2이므로 < 2 분기는 방어 코드지만 포함하면 더 안전하다.'
        ].join('\n')
      },
      grading: {
        test_cases: [
          { input: '2',     expected: 'YES' },
          { input: '17',    expected: 'YES' },
          { input: '18',    expected: 'NO'  },
          { input: '9973',  expected: 'YES' },
          { input: '10000', expected: 'NO'  }
        ],
        compare: 'stdout-trim'
      }
    }

  ];

})();
