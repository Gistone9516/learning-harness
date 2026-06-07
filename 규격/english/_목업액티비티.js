// 목업 콘텐츠 (cycle-3 r2) — 테스트 픽스처용. 원본 _example와 별개.
//
// 목적: core 기능 픽스처 제공.
//   - vocab/grammar: back.explanation 해설 채움 (static 채점 완전 동작 픽스처)
//   - listening: grading.dictation_threshold 문항별 재정의 (core 픽스처, 전역 0.9 재정의)
//   - writing: llm-rubric + back.explanation graceful fallback 픽스처 (BYO-key pending 시연)
//   - speaking: pronunciation graceful fallback 픽스처 (BYO-key pending 시연)
//
// activity_id 패턴: eng-{prefix}-{unit_slug}-{seq:003}
//   prefix: vcb / grm / rdg / lst / wrt / spk
//
// plugin_id 필드 포함 (런타임규격 §2-1 스키마 conform).
// window.ACTIVITIES 형식은 _example/activities.js 참조.

(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['english'] = [

    /* ──────────────────────────────────────────────────────────────
       [픽스처: static-채점 완전동작 + back.explanation 해설]
       1. Vocabulary — 구동사 "give up" 문맥 선택 (객관식, exact)
       modality : vocab
       grading  : exact  (grader_id = "engine")
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'eng-vcb-phrasal-001',
      plugin_id:   'english',
      type:        'lang-task',
      weight:      3,
      tags: { area: 'vocabulary', subarea: 'phrasal-verb', unit: 'phrasal' },
      enabled: true,
      front: {
        modality: 'vocab',
        prompt:
          'Choose the phrasal verb that best completes the sentence.\n\n' +
          '"After months of failed attempts, she finally decided to ______ ' +
          'and try a completely different approach."',
        options: [
          'A) give up',
          'B) give out',
          'C) give back',
          'D) give in to'
        ]
      },
      back: {
        answer: 'A',
        explanation:
          '"give up"(포기하다): 노력을 그만두다. Cambridge Dictionary 정의: ' +
          '"to stop doing or having something." ' +
          '문맥 단서: "failed attempts" + "try a completely different approach" → 이전 방법을 완전히 포기함. ' +
          '"give out"(배포하다/소진되다), "give back"(돌려주다), "give in to"(굴복하다)는 이 맥락과 불일치. ' +
          '[출처: Cambridge Dictionary – give up]'
      },
      grading: {
        mode:   'exact',
        accept: ['A', 'a', 'A) give up', 'give up']
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: static-채점 완전동작 + back.explanation 해설]
       2. Grammar — 가정법 과거완료 4지선다 (객관식, exact)
       modality : grammar
       grading  : exact  (grader_id = "engine")
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'eng-grm-subjunctive-001',
      plugin_id:   'english',
      type:        'lang-task',
      weight:      5,
      tags: { area: 'grammar', subarea: 'subjunctive-past', unit: 'tense-mood' },
      enabled: true,
      front: {
        modality: 'grammar',
        prompt:
          'Fill in the blank with the correct verb form.\n\n' +
          '"If she ___ more time, she would have finished the project."',
        options: [
          'A) has',
          'B) had had',
          'C) would have',
          'D) has had'
        ]
      },
      back: {
        answer: 'B',
        explanation:
          '가정법 과거완료(third conditional): "If + had + p.p., would have + p.p." 형태. ' +
          '과거 사실과 반대되는 상황을 가정. ' +
          '"had had" = had(조동사) + had(have의 과거분사). ' +
          '"has"(현재)·"has had"(현재완료)는 조건절 가정법에 부적합. ' +
          '"would have"는 결과절(main clause)에 쓰이는 형태. ' +
          '[출처: Purdue OWL – Conditional Sentences]'
      },
      grading: {
        mode:   'exact',
        accept: ['B', 'b', 'B) had had', 'had had']
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: static-채점 완전동작 — reading keyword]
       3. Reading — 단문 독해 (환경 지문, 주제 파악)
       modality : reading
       grading  : keyword  (grader_id = "engine")
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'eng-rdg-main-idea-001',
      plugin_id:   'english',
      type:        'lang-task',
      weight:      5,
      tags: { area: 'reading', subarea: 'main-idea', unit: 'environment' },
      enabled: true,
      front: {
        modality: 'reading',
        passage:
          'Urban green spaces — parks, community gardens, and tree-lined streets — ' +
          'provide far more than aesthetic value. Studies show that access to green ' +
          'areas reduces stress, lowers blood pressure, and improves mental well-being. ' +
          'Cities that invest in green infrastructure also benefit from cooler ' +
          'temperatures due to the shade and evapotranspiration of plants, a phenomenon ' +
          'known as the urban cooling effect. Despite these advantages, rapid urban ' +
          'development continues to shrink green areas in many major cities worldwide. ' +
          'Planners and policymakers are urged to prioritise green space preservation ' +
          'as a core element of sustainable city design.',
        prompt: 'What is the main argument of this passage? Write your answer in one or two sentences.'
      },
      back: {
        answer:
          'Urban green spaces offer significant health and environmental benefits, ' +
          'but they are threatened by urban development; city planners should prioritise ' +
          'their preservation.',
        explanation:
          '주제문 위치: 마지막 문장 "Planners and policymakers are urged to prioritise green space preservation…". ' +
          '지지 근거: (1) 스트레스 감소·혈압 저하(건강 효과), (2) 도시 냉각 효과(환경 효과), ' +
          '(3) 급속한 도시화로 축소 추세(문제 제기). ' +
          'keyword 그룹: 녹지(green/park) + 건강·환경 이점(benefit/health/cooling) + 보전 촉구(preserve/prioritise).'
      },
      grading: {
        mode: 'keyword',
        keywords: [
          ['green', 'park', 'garden', 'vegetation'],
          ['benefit', 'health', 'stress', 'cooling', 'well-being'],
          ['preserve', 'prioritise', 'prioritize', 'protect', 'conservation']
        ]
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: dictation_threshold 문항별 재정의 — 전역 0.9 재정의]
       4. Listening — 3문장 받아쓰기 (threshold = 0.75, 완화)
       modality   : listening
       grading    : dictation-diff
       핵심: grading.dictation_threshold = 0.75 (전역 0.9보다 낮음)
             → 엔진이 activity.grading.dictation_threshold ?? 0.9 로직을 읽어야 동작.
             기능백로그 core "dictation_threshold 문항별 재정의" 검증용.
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'eng-lst-dictation-001',
      plugin_id:   'english',
      type:        'lang-task',
      weight:      4,
      tags: { area: 'listening', subarea: 'dictation', unit: 'business-context' },
      enabled: true,
      front: {
        modality:   'listening',
        audio_text: 'The project deadline has been moved to the end of next month.',
        prompt:
          'Listen carefully and type exactly what you hear.\n' +
          '(Capitalisation and punctuation are not required.)\n' +
          '※ This item uses a relaxed accuracy threshold (75 %).'
      },
      back: {
        answer: 'The project deadline has been moved to the end of next month.',
        explanation:
          '"deadline" — 마감일. "has been moved" — 수동태 현재완료(일정 변경 표현). ' +
          '"end of next month" — 다음 달 말. TTS 발화 속도에서 "moved to" 연음 주의. ' +
          '이 문항은 threshold=0.75 적용: 전체 단어 중 75% 이상 정확히 받아써야 correct.'
      },
      grading: {
        mode:                  'dictation-diff',
        expected:              'The project deadline has been moved to the end of next month.',
        dictation_threshold:   0.75   // [픽스처: 전역 0.9 재정의 — 런타임 activity.grading.dictation_threshold ?? 0.9]
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: writing llm-rubric + back.explanation graceful fallback]
       5. Writing — 비즈니스 이메일 작성 (BYO-key pending 시연)
       modality : writing
       grading  : llm-rubric  (grader_id = "llm")
       핵심: (a) llm_api_key 없으면 verdict="pending" graceful 반환,
             (b) back.explanation은 키 없어도 항상 렌더링 가능 → fallback 해설 시연.
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'eng-wrt-email-001',
      plugin_id:   'english',
      type:        'lang-task',
      weight:      6,
      tags: { area: 'writing', subarea: 'email', unit: 'business-writing' },
      enabled: true,
      front: {
        modality: 'writing',
        prompt:
          'Write a short professional email (3–4 sentences) to your colleague ' +
          'informing them that the Friday team meeting has been cancelled and ' +
          'proposing a reschedule to the following Monday at 10 AM.'
      },
      back: {
        // [픽스처: back.explanation — llm_api_key 없을 때 graceful fallback으로 표시되는 해설]
        // 키가 없어 채점 불가여도 학습자는 이 해설을 참고할 수 있어야 함.
        explanation:
          '핵심 구성 요소:\n' +
          '1. 인사·맥락(Opening): "I wanted to let you know that…"\n' +
          '2. 취소 고지(Cancellation notice): "the Friday team meeting has been cancelled."\n' +
          '3. 재일정 제안(Reschedule proposal): "Would you be available on Monday at 10 AM?"\n' +
          '4. 확인 요청(Confirmation): "Please let me know if that works for you."\n\n' +
          '예시 답안:\n' +
          '"Hi [Name], I wanted to let you know that the Friday team meeting has been ' +
          'cancelled. Would it be possible to reschedule to Monday at 10 AM? ' +
          'Please confirm if that time works for you. Best regards, [Your Name]"\n\n' +
          '※ LLM API 키가 설정되지 않아 자동 채점을 제공할 수 없습니다. ' +
          '설정 > 키 설정에서 LLM API 키를 입력하면 루브릭 기반 점수와 피드백을 받을 수 있습니다.'
      },
      grading: {
        mode:   'llm-rubric',
        // 키 없으면 ScoreResult { verdict: "pending", score_raw: null, grader_id: "llm",
        //   feedback: { message: "LLM API 키가 필요합니다…" } } 반환 (런타임규격 §5-1)
        rubric:
          'Score 0-10. Criteria:\n' +
          '- Task completion (0-3): Mentions Friday meeting cancellation AND proposes Monday 10 AM reschedule.\n' +
          '- Grammar & vocabulary (0-3): Grammatically correct sentences; professional vocabulary appropriate.\n' +
          '- Coherence & cohesion (0-2): Logical flow — notice → proposal → confirmation request.\n' +
          '- Style & register (0-2): Appropriate business email tone (neither too casual nor too stiff).\n' +
          'Return JSON: {"score": <0-10>, "feedback": "<2-3 sentence comment in Korean>"}'
      }
    },

    /* ──────────────────────────────────────────────────────────────
       [픽스처: speaking pronunciation graceful fallback (BYO-key pending 시연)]
       6. Speaking — 최소대립쌍 발음 연습 (/θ/ vs /s/)
       modality : speaking
       grading  : pronunciation  (grader_id = "external")
       핵심: azure_speech_key 없으면 verdict="pending" graceful 반환.
             mount는 항상 성공 (런타임규격 §5-3 conform 검증용).
    ────────────────────────────────────────────────────────────── */
    {
      activity_id: 'eng-spk-th-sound-001',
      plugin_id:   'english',
      type:        'lang-task',
      weight:      5,
      tags: { area: 'speaking', subarea: 'minimal-pair', unit: 'consonant-sounds' },
      enabled: true,
      front: {
        modality: 'speaking',
        prompt:
          'Read the following sentence aloud as clearly as possible:\n\n' +
          '"I think this is the thing that three of them thought about."'
      },
      back: {
        // [픽스처: back.explanation — azure_speech_key 없을 때 발음 참고 해설 표시]
        explanation:
          '/θ/ 발음(무성 치간 마찰음) 연습: "think" /θɪŋk/, "this" /ðɪs/(유성), "thing" /θɪŋ/, ' +
          '"three" /θriː/, "thought" /θɔːt/.\n' +
          '주의: "th-" 단어는 유성(/ð/: this, them, that)과 무성(/θ/: think, three, thought) 두 종류.\n' +
          '"them" /ðɛm/ — 유성 치간 마찰음.\n' +
          '[출처: Merriam-Webster Pronunciation Guide; Cambridge Dictionary – th sounds]\n\n' +
          '※ Azure Speech 키가 설정되지 않아 발음 채점을 제공할 수 없습니다. ' +
          '설정 > 키 설정에서 Azure Speech 키를 입력하면 정확도·유창성 점수를 받을 수 있습니다.'
      },
      grading: {
        mode:     'pronunciation',
        expected: 'I think this is the thing that three of them thought about.',
        // 키 없으면 ScoreResult { verdict: "pending", score_raw: null, grader_id: "external",
        //   feedback: { message: "Azure Speech 키가 필요합니다…" } } (런타임규격 §5-2)
        rubric:
          'Focus on /θ/ vs /s/ distinction: "think" (/θɪŋk/ not /sɪŋk/), ' +
          '"three" (/θriː/ not /sriː/), "thought" (/θɔːt/ not /sɔːt/). ' +
          'Also assess /ð/ in "this" and "them". Clear articulation of each word required.'
      }
    }

  ];

})();
