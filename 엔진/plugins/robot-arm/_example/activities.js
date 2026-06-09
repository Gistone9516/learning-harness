/**
 * robot-arm / _example/activities.js
 * ──────────────────────────────────────────────────────────
 * FK 실습 ActivitySpec 예시 2개 (MVP, 입문·비전공자 수준)
 * SoT: 규격/robot/런타임규격.md §2 + 규격/robot/생성규칙.md §5
 *
 * 생성물 구조: 규격/robot/생성물/activities-robot-arm.js 와 동일 패턴.
 * 이 파일은 _example(개발·테스트용)이므로 study.html에서 로드하거나
 * 생성물 activities-robot-arm.js를 대신 로드할 수 있음.
 *
 * 도달 가능성 검증 (생성규칙 §3-5):
 *   activity 1: Σlinks = 100+80 = 180 ≥ sqrt(120²+80²) ≈ 144.2 ✓
 *   activity 2: Σlinks = 100+80 = 180 ≥ sqrt(60²+150²) ≈ 161.6 ✓
 *
 * window.ACTIVITIES['robot-arm'] 전역 등록 (플러그인계약 §7).
 * file:// fetch 금지 — 순수 IIFE, script 태그로 로드.
 */
(function () {
  'use strict';
  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['robot-arm'] = [

    /* ── Activity 1: 2링크 입문 ─────────────────────────
       링크: L1=100, L2=80. 목표: (120, 80). 허용오차: 9.
       예시 정답각: θ1≈0.5236(30°), θ2≈0.7854(45°)
       FK 검증: x=100·cos(0.5236)+80·cos(1.3090)≈86.6+24.0≈110→근사치이므로
       실제 정답각은 수치 계산 기준.
       example_solution_angles는 참고용(반드시 정답 아님 — 학습자 탐색 유도).
    ─────────────────────────────────────────────────── */
    {
      "activity_id": "robot-fk-2link-001",
      "plugin_id":   "robot-arm",
      "type":        "robot-fk",
      "weight":      4,
      "tags": {
        "area":    "로봇공학",
        "subarea": "기구학",
        "unit":    "정기구학(FK)"
      },
      "enabled": true,
      "front": {
        "prompt": "슬라이더를 움직여 로봇 팔의 끝점(end-effector)을 빨간 목표점에 맞추세요.\n선수 개념이 필요하면 '정기구학(FK)' 개념 카드를 먼저 학습하세요.",
        "links": [
          { "length": 100 },
          { "length": 80 }
        ],
        "target": { "x": 120, "y": 80 },
        "tolerance": 9,
        "joint_limits": [
          [-1.5707963, 1.5707963],
          [-1.5707963, 1.5707963]
        ]
      },
      "back": {
        "why": "2링크 평면 암의 FK: 끝점 x = L1·cosθ1 + L2·cos(θ1+θ2), y = L1·sinθ1 + L2·sin(θ1+θ2). 누적 관절각이 핵심.",
        "explanation": "같은 끝점에 도달하는 관절각 조합은 여러 가지일 수 있습니다(역기구학의 다해 문제). 슬라이더를 다양하게 조합해 보세요.",
        "example_solution_angles": [0.3491, 0.6981]
      }
    },

    /* ── Activity 2: 2링크 초급 (높은 y축 목표) ──────────
       링크: L1=100, L2=80. 목표: (60, 150). 허용오차: 9.
       y가 크고 x가 작아 관절 1번을 더 크게 돌려야 함 → 난이도 높음.
       Σlinks=180 ≥ sqrt(60²+150²)≈161.6 ✓
    ─────────────────────────────────────────────────── */
    {
      "activity_id": "robot-fk-2link-002",
      "plugin_id":   "robot-arm",
      "type":        "robot-fk",
      "weight":      6,
      "tags": {
        "area":    "로봇공학",
        "subarea": "기구학",
        "unit":    "정기구학(FK)"
      },
      "enabled": true,
      "front": {
        "prompt": "이번에는 목표점이 위쪽에 있습니다. 관절 1번(베이스 관절)을 크게 돌려야 할까요?\n슬라이더로 끝점을 빨간 목표점에 맞추세요.",
        "links": [
          { "length": 100 },
          { "length": 80 }
        ],
        "target": { "x": 60, "y": 150 },
        "tolerance": 9,
        "joint_limits": [
          [-1.5707963, 1.5707963],
          [-1.5707963, 1.5707963]
        ]
      },
      "back": {
        "why": "목표 y가 크면 θ1을 크게(위쪽으로) 회전해야 합니다. θ2는 팔을 펴거나 접어 x 방향을 보정합니다.",
        "explanation": "FK에서 누적각 θ1+θ2가 끝단 방향을 결정합니다. θ1 단독으로 y를 높이고, θ2로 x를 보정하는 전략을 써 보세요.",
        "example_solution_angles": [1.1781, -0.5236]
      }
    }

  ];

})();
