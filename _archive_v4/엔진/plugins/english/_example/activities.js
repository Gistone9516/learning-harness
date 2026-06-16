/**
 * english / _example / activities.js
 * ─────────────────────────────────────────────────────────────────
 * english 플러그인 ActivitySpec 예제 데이터.
 * window.ACTIVITIES["english"] 배열에 등록.
 *
 * ActivitySpec (english 플러그인 확정 스펙):
 *   type   : "lang-task"
 *   front  : {
 *               modality : "vocab" | "grammar" | "reading" | "listening"
 *                          | "writing" | "speaking",
 *               prompt   : string,
 *               passage? : string,          // reading 전용
 *               audio_text? : string,       // listening 전용 (Web Speech TTS 원문)
 *               options? : string[]         // 객관식 선택지
 *             }
 *   back   : { answer?: string, explanation?: string }
 *   grading: {
 *               mode    : "exact" | "keyword" | "cloze"
 *                         | "dictation-diff"              // 정적(키 불요)
 *                         | "llm-rubric" | "pronunciation", // BYO-key
 *               accept? : string[],         // exact: 허용 동의어 목록
 *               keywords? : string[][],     // keyword: [[필수 후보군], ...]
 *               expected? : string,         // cloze / dictation-diff 원문
 *               rubric?  : string           // llm-rubric 채점 기준
 *             }
 *
 * 채점 흐름 (infra = "hybrid"):
 *
 *   [정적 — grader_id = "engine"]
 *   · exact        : 입력.trim().toLowerCase() ∈ accept(+answer) → correct
 *   · keyword      : 각 keywords[i] 중 하나 이상 포함 → 전체 그룹 passed
 *   · cloze        : 공란별 accept 비교 (exact와 동일 로직, multi-blank 확장)
 *   · dictation-diff: Web Speech TTS 재생 → 사용자 받아쓰기 →
 *                     diff(expected, input) → WER(단어오류율) 기반 score_raw
 *   ScoreResult = {
 *     verdict   : "correct" | "partial" | "incorrect",
 *     score_raw : 0..1,
 *     grader_id : "engine",
 *     feedback  : { ... }
 *   }
 *
 *   [BYO-key — grader_id = "llm" / "external"]
 *   · llm-rubric   : ctx.getKey("llm_api_key") → LLM 채점 요청 (writing)
 *   · pronunciation: ctx.getKey("azure_speech_key") → Azure Speech 채점 (speaking)
 *   키 없으면 graceful: mount는 정상, 제출 시 "키 필요" 안내 UI 표시.
 *
 * 파킹 (BYO-key, 이 예제에서 제외):
 *   · writing  / llm-rubric     (llm_api_key 필요)
 *   · speaking / pronunciation  (azure_speech_key 필요)
 *
 * manifest.byok:
 *   [
 *     { id: "llm_api_key",      label: "LLM API Key",         required_for: ["writing"]  },
 *     { id: "azure_speech_key", label: "Azure Speech API Key", required_for: ["speaking"] }
 *   ]
 *
 * 예제 선정 기준: 보편 영어, 특정 시험 편향 회피.
 *   1. vocab    — 기초 어휘 (명사 "capital" 다의어 문맥)
 *   2. grammar  — 동사 시제 (현재완료 vs. 단순과거)
 *   3. reading  — 단문 독해 (일상 공지문, 주제 파악)
 *   4. listening — 단문 받아쓰기 (일상 문장 TTS)
 *   5. vocab    — 형용사 "ambiguous" 의미 선택 (단어 맥락)
 *   6. grammar  — 관계대명사 which vs. who vs. whom (객관식)
 * ─────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['english'] = [

    /* ────────────────────────────────────────────────────────────
       1. Vocabulary — "capital" 다의어 문맥 선택
       modality : vocab
       grading  : exact  (grader_id = "engine")
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'english-ex-001',
      type: 'lang-task',
      front: {
        modality: 'vocab',
        prompt:
          'Choose the word that best completes the sentence.\n\n' +
          'The government decided to move the country\'s ______ to a new city\n' +
          'to distribute economic activity more evenly across the region.',
        options: [
          'A) money',
          'B) capital',
          'C) center',
          'D) border'
        ]
      },
      back: {
        answer: 'B',
        explanation:
          '"Capital" here means the city that serves as the seat of government ' +
          '(e.g., Washington D.C., Tokyo). ' +
          '"Money" and "center" are plausible distractors but do not collocate with ' +
          '"move the country\'s ___" in this political-geography context. ' +
          '"Border" is unrelated to the idea of a governmental seat.'
      },
      grading: {
        mode:   'exact',
        accept: ['B', 'b', 'B) capital', 'capital']
      }
    },

    /* ────────────────────────────────────────────────────────────
       2. Grammar — 현재완료 vs. 단순과거
       modality : grammar
       grading  : exact  (grader_id = "engine")
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'english-ex-002',
      type: 'lang-task',
      front: {
        modality: 'grammar',
        prompt:
          'Choose the grammatically correct sentence.\n\n' +
          'The speaker is referring to an action completed at an unspecified\n' +
          'time in the past that is still relevant now.',
        options: [
          'A) She finished the report yesterday.',
          'B) She has finished the report.',
          'C) She is finishing the report.',
          'D) She had finished the report.'
        ]
      },
      back: {
        answer: 'B',
        explanation:
          'The present perfect ("has finished") expresses a past action with ' +
          'current relevance and no specific time reference. ' +
          'Option A uses simple past with "yesterday" — a specific time marker — ' +
          'so it cannot express the "unspecified time, current relevance" condition. ' +
          'Option C is present continuous (ongoing). ' +
          'Option D is past perfect, which requires a second past reference point.'
      },
      grading: {
        mode:   'exact',
        accept: ['B', 'b', 'B) She has finished the report.', 'She has finished the report.']
      }
    },

    /* ────────────────────────────────────────────────────────────
       3. Reading — 단문 독해 (주제 파악)
       modality : reading
       passage  : 도서관 공지문 (가상)
       grading  : keyword  (grader_id = "engine")
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'english-ex-003',
      type: 'lang-task',
      front: {
        modality: 'reading',
        passage:
          'Notice — City Library\n\n' +
          'The main reading room will be closed for renovation from Monday,\n' +
          'June 9 through Friday, June 13. During this period, library members\n' +
          'may still borrow and return books at the side entrance on Oak Street.\n' +
          'Digital resources, including e-books and online databases, remain\n' +
          'fully accessible through the library website. We apologize for any\n' +
          'inconvenience and thank you for your patience.',
        prompt:
          'What is the main purpose of this notice?\n\n' +
          'Write your answer in one or two sentences.'
      },
      back: {
        answer:
          'The notice informs library users that the main reading room will be ' +
          'closed for renovation from June 9 to 13, and explains what services ' +
          'remain available during that time.',
        explanation:
          'The passage is a public announcement. Its primary function is to ' +
          'notify members of the temporary closure and redirect them to ' +
          'alternative services (side-entrance borrowing and digital resources).'
      },
      grading: {
        mode: 'keyword',
        // Each inner array = one required concept group; at least one term per group must appear.
        keywords: [
          ['clos', 'shut', 'unavailab'],            // closure concept
          ['renovat', 'repair', 'maintenance'],      // reason
          ['borrow', 'return', 'access', 'availab']  // alternative services
        ]
      }
    },

    /* ────────────────────────────────────────────────────────────
       4. Listening — 단문 받아쓰기 (Web Speech TTS)
       modality   : listening
       audio_text : TTS로 재생할 원문 (브라우저 speechSynthesis)
       grading    : dictation-diff  (grader_id = "engine")
                    WER 기반 score_raw; 대소문자·구두점 무시 diff
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'english-ex-004',
      type: 'lang-task',
      front: {
        modality:    'listening',
        audio_text:  'The train to the airport departs every thirty minutes.',
        prompt:
          'Listen to the sentence and type exactly what you hear.\n' +
          '(Punctuation is not required.)'
      },
      back: {
        answer: 'The train to the airport departs every thirty minutes.',
        explanation:
          'Key words: "train", "airport", "departs", "every", "thirty minutes". ' +
          'Note that "departs" (not "leaves" or "goes") and "thirty" (not "13" or "30") ' +
          'are the precise words used in the audio.'
      },
      grading: {
        mode:     'dictation-diff',
        expected: 'The train to the airport departs every thirty minutes.'
        // Engine normalises both strings to lowercase, strips punctuation,
        // then computes WER: score_raw = 1 - (substitutions+deletions+insertions) / ref_word_count
      }
    },

    /* ────────────────────────────────────────────────────────────
       5. Vocabulary — "ambiguous" 의미 파악 (문맥 선택)
       modality : vocab
       grading  : exact  (grader_id = "engine")
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'english-ex-005',
      type: 'lang-task',
      front: {
        modality: 'vocab',
        prompt:
          'Read the sentence and answer the question.\n\n' +
          '"The instructions were so ambiguous that each team member\n' +
          'interpreted them differently."\n\n' +
          'What does the word "ambiguous" mean in this context?',
        options: [
          'A) very detailed and specific',
          'B) unclear and open to more than one interpretation',
          'C) written in a foreign language',
          'D) too long to read carefully'
        ]
      },
      back: {
        answer: 'B',
        explanation:
          '"Ambiguous" describes something that can be understood in more than one ' +
          'way, causing confusion. The context clue is "each team member interpreted ' +
          'them differently," which directly shows multiple interpretations arising ' +
          'from the unclear instructions. Option A is the opposite meaning; ' +
          'C and D are unrelated to the sentence.'
      },
      grading: {
        mode:   'exact',
        accept: ['B', 'b', 'B) unclear and open to more than one interpretation',
                 'unclear and open to more than one interpretation']
      }
    },

    /* ────────────────────────────────────────────────────────────
       6. Grammar — 관계대명사 who / which / whom 선택
       modality : grammar
       grading  : exact  (grader_id = "engine")
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'english-ex-006',
      type: 'lang-task',
      front: {
        modality: 'grammar',
        prompt:
          'Choose the correct relative pronoun to complete the sentence.\n\n' +
          '"The scientist ______ discovered the new compound received an award."',
        options: [
          'A) which',
          'B) whom',
          'C) who',
          'D) whose'
        ]
      },
      back: {
        answer: 'C',
        explanation:
          '"Who" is used as a subject relative pronoun referring to a person. ' +
          'In this sentence the relative clause needs a subject ("___ discovered"), ' +
          'so the subject form "who" is correct. ' +
          '"Whom" is the object form (used when the pronoun is the object of a verb ' +
          'or preposition, e.g. "the scientist whom we honoured"). ' +
          '"Which" refers to things, not people. ' +
          '"Whose" indicates possession.'
      },
      grading: {
        mode:   'exact',
        accept: ['C', 'c', 'C) who', 'who']
      }
    }

  ];

})();
