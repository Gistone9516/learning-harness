// 목업 콘텐츠 (cycle-3 r2) — 테스트 픽스처용, 실제 학습 콘텐츠 아님. 원본 deck과 별개.

window.ACTIVITIES = window.ACTIVITIES || {};
window.ACTIVITIES['card-quiz'] = (window.ACTIVITIES['card-quiz'] || []).concat([

  // [픽스처: func/exact — grading.accept[] 복수정답, front.hint 힌트렌더]
  {
    "card_id": "comp1-ss-func-0001",
    "schema_version": 1,
    "type": "func",
    "grade_mode": "exact",
    "subject": "comp1",
    "unit": "ss-func",
    "front": {
      "prompt": "조건 범위에서 기준을 만족하는 셀들의 합계를 구하는 함수는?",
      "hint": "인수 순서: (조건_범위, 조건, 합계_범위)"
    },
    "back": {
      "detail": "SUMIF(range, criteria, [sum_range])\n- range: 조건을 적용할 범위\n- criteria: 조건 값 또는 식\n- sum_range: 실제 합산 범위(생략 시 range 합산)",
      "note": "다중 조건이면 SUMIFS(sum_range, range1, crit1, range2, crit2, …) 사용"
    },
    "answer": "SUMIF",
    "grading": {
      "accept": ["SUMIF()", "sumif", "sumif()"],
      "normalize": ["trim", "lower", "strip_trailing_paren"]
    },
    "tags": {
      "weight": 8,
      "area": "practical",
      "subarea": "excel"
    }
  },

  // [픽스처: proc/keyword — grading.keywords[] 핵심키워드 포함 채점]
  {
    "card_id": "comp1-ss-proc-0001",
    "schema_version": 1,
    "type": "proc",
    "grade_mode": "keyword",
    "subject": "comp1",
    "unit": "ss-proc",
    "front": {
      "prompt": "셀 범위에 조건부 서식을 적용해 상위 10%인 셀을 강조하려면?",
      "hint": "홈 탭 → 스타일 그룹에서 시작"
    },
    "back": {
      "detail": "홈 탭 → 조건부 서식 → 상위/하위 규칙 → 상위 10% → 서식 지정 → 확인",
      "note": "상위 N개 항목과 상위 N%는 다른 메뉴 항목임. 혼동 주의."
    },
    "answer": "홈 탭 → 조건부 서식 → 상위/하위 규칙 → 상위 10% → 서식 지정 → 확인",
    "grading": {
      "keywords": [
        { "any": ["조건부 서식", "조건부서식"] },
        { "any": ["상위/하위 규칙", "상위 하위 규칙", "상위/하위"] },
        { "any": ["상위 10%", "상위10%"] }
      ],
      "normalize": ["trim", "collapse_space", "fullwidth_to_halfwidth"]
    },
    "tags": {
      "weight": 7,
      "area": "practical",
      "subarea": "excel"
    }
  },

  // [픽스처: recall_seq/exact — answer:string[] 순서 포함 완전일치, 세션 내 재큐]
  {
    "card_id": "comp1-ss-seq-0001",
    "schema_version": 1,
    "type": "recall_seq",
    "grade_mode": "exact",
    "subject": "comp1",
    "unit": "ss-proc",
    "front": {
      "prompt": "데이터를 다중 기준으로 정렬할 때 [정렬] 대화상자를 여는 클릭 순서는?",
      "hint": "데이터 탭 기준으로 답할 것"
    },
    "back": {
      "detail": "1. 데이터 범위 내 셀 선택\n2. 데이터 탭 클릭\n3. 정렬 버튼 클릭\n4. 기준 추가·열·정렬 기준·순서 설정\n5. 확인 클릭",
      "note": "Ctrl+Shift+L은 필터 토글이지 정렬 대화상자 진입이 아님."
    },
    "answer": [
      "데이터 범위 내 셀 선택",
      "데이터 탭 클릭",
      "정렬 버튼 클릭",
      "기준 추가 및 열·순서 설정",
      "확인 클릭"
    ],
    "grading": {
      "normalize": ["trim", "collapse_space"]
    },
    "tags": {
      "weight": 6,
      "area": "practical",
      "subarea": "excel"
    }
  },

  // [픽스처: cloze/cloze — {{n}} 빈칸 마커, grading.accept_map[] 빈칸별 복수정답, 0-base blanks[] wiring]
  {
    "card_id": "comp1-ss-cloze-0001",
    "schema_version": 1,
    "type": "cloze",
    "grade_mode": "cloze",
    "subject": "comp1",
    "unit": "ss-func",
    "front": {
      "text": "=VLOOKUP(찾을값, 범위, {{0}}, {{1}})\n세 번째 인수는 반환할 {{0}} 번호, 네 번째 인수는 정확히 일치 검색 시 {{1}}을 입력한다."
    },
    "back": {
      "detail": "VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])\n- col_index_num: 반환 열 번호(1부터 시작)\n- range_lookup: FALSE(또는 0) = 정확 일치, TRUE(또는 1) = 근사 일치",
      "note": "range_lookup 생략 시 기본값은 TRUE(근사 일치) — 실수 주의."
    },
    "answer": {
      "0": "열",
      "1": "FALSE"
    },
    "grading": {
      "accept_map": {
        "0": ["열 번호", "col_index_num"],
        "1": ["FALSE", "0", "false"]
      },
      "normalize": ["trim", "lower", "collapse_space"]
    },
    "tags": {
      "weight": 9,
      "area": "practical",
      "subarea": "excel"
    }
  },

  // [픽스처: judge/exact — front.options[] 객관식 선택지 버튼 UI, back.why 정답근거, options[i] 텍스트 wiring]
  {
    "card_id": "comp1-ss-judge-0001",
    "schema_version": 1,
    "type": "judge",
    "grade_mode": "exact",
    "subject": "comp1",
    "unit": "ss-func",
    "front": {
      "scenario": "VLOOKUP 수식에서 #N/A 오류가 발생했다. range_lookup은 FALSE로 설정돼 있고, 찾을값이 분명히 범위 안에 존재한다. 우선적으로 점검할 항목은?",
      "options": [
        "찾을값·범위의 셀 서식(텍스트 vs 숫자) 불일치",
        "col_index_num이 범위 열 수를 초과",
        "시트 보호 여부"
      ]
    },
    "back": {
      "detail": "정답: 찾을값·범위의 셀 서식(텍스트 vs 숫자) 불일치",
      "why": "range_lookup=FALSE인데 값이 실제로 있음에도 #N/A가 나오는 가장 흔한 원인은 서식 불일치다. 예컨대 찾을값은 숫자인데 범위 첫 열이 텍스트로 저장된 경우 완전 일치 비교에서 불일치 판정이 남. col_index_num 초과는 #REF! 오류를, 시트 보호는 입력 제한이지 VLOOKUP 결과와 무관."
    },
    "answer": "찾을값·범위의 셀 서식(텍스트 vs 숫자) 불일치",
    "grading": {
      "normalize": ["trim", "collapse_space"]
    },
    "tags": {
      "weight": 8,
      "area": "practical",
      "subarea": "excel"
    }
  },

  // [픽스처: self 모드 — O/X 버튼 UI + 'o'→'correct'/'x'→'incorrect' 변환 wiring(UI 레이어 소유)]
  {
    "card_id": "comp1-ss-self-0001",
    "schema_version": 1,
    "type": "func",
    "grade_mode": "self",
    "subject": "comp1",
    "unit": "ss-func",
    "front": {
      "prompt": "COUNTIFS 함수의 기본 구문과 인수 역할을 설명하라.",
      "hint": "다중 조건 카운트 함수. 조건 쌍(범위, 조건)이 반복됨."
    },
    "back": {
      "detail": "COUNTIFS(criteria_range1, criteria1, [criteria_range2, criteria2], …)\n- criteria_range: 조건을 적용할 범위\n- criteria: 각 범위에 대응하는 조건\n- 모든 조건을 동시 만족하는 셀 수를 반환(AND 조건)\n- COUNTIF는 단일 조건, COUNTIFS는 다중 조건"
    },
    "tags": {
      "weight": 7,
      "area": "practical",
      "subarea": "excel"
    }
  }

]);
