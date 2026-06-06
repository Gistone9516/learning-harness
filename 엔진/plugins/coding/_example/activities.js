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
    }

  ];

})();
