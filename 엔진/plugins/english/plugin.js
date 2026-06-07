/**
 * english / plugin.js
 * 플러그인계약 §3 PluginInstance 구현 — english 플러그인
 * 런타임규격(english/런타임규격.md) §2~§6 conform.
 * ────────────────────────────────────────────────────────────
 * 정적 채점(grader_id="engine"):
 *   vocab / grammar / reading  → exact | keyword | cloze
 *   listening                  → dictation-diff  (SpeechSynthesis TTS + 받아쓰기)
 *
 * BYO-key(키 없으면 graceful):
 *   writing  → llm-rubric  (llm_api_key)    grader_id="llm"
 *   speaking → pronunciation(azure_speech_key) grader_id="external"
 *
 * 등록:
 *   plugin_id = "english"
 *   globalKey  = "_ENGLISH_PLUGIN"
 *   → window._ENGLISH_PLUGIN = instance
 *
 * 진도 키: clf:english:progress
 * file:// 더블클릭 동작 (fetch 금지, CDN 외 외부 통신 0).
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     내부 상태
  ───────────────────────────────────────────── */
  var _state = {
    mounted:    false,
    host:       null,   // HTMLElement — #plugin-host
    ctx:        null,   // PluginContext
    activity:   null,   // 현재 ActivitySpec (lang-task)
    activities: null,   // SM-2 정렬 후 배열 (mount 클로저와 onProgressRestored 공유용)
    progress:   null,   // PluginProgressSnapshot 메모리 캐시
    restored:   false,  // onProgressRestored 호출 여부
    currentRecognition: null,  // SpeechRecognition 인스턴스 (speaking)
    activityIndex: 0   // 현재 활성 문제 인덱스
  };

  var PROGRESS_KEY    = 'clf:english:progress';
  var WRONG_NOTES_KEY = 'clf:wrong_notes:english';

  /* ─────────────────────────────────────────────
     진도 localStorage 헬퍼
  ───────────────────────────────────────────── */
  function _loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // 폴백: 스키마 필수 필드 누락 시 null 반환 (getProgressSnapshot이 신규 생성)
      if (!parsed || typeof parsed !== 'object' || !parsed.activities) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function _saveProgress(snap) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(snap)); } catch (e) {}
  }

  function _loadWrongNotes() {
    try {
      var raw = localStorage.getItem(WRONG_NOTES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function _saveWrongNotes(notes) {
    try { localStorage.setItem(WRONG_NOTES_KEY, JSON.stringify(notes)); } catch (e) {}
  }

  /* ─────────────────────────────────────────────
     normalize / tokenize (런타임규격 §4-5, §4-6)
  ───────────────────────────────────────────── */
  function normalize(s) {
    if (typeof s !== 'string') return '';
    return s
      .toLowerCase()
      .replace(/[‘’‚‛]/g, "’") // 유니코드 어포스트로피 → ASCII (STT 출력 대응, 런타임규격 §4-5)
      .replace(/[.,!?;:'"()\[\]{}—\-]/g, '')  // 구두점 제거 (em dash 포함)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(s) {
    return normalize(s).split(' ').filter(function (t) { return t.length > 0; });
  }

  /* word-level diff: [{word, status: "match"|"miss"|"extra"}]
     런타임규격 §4-3: expected_tokens.length ≤ 200
     lcsLen = diff.filter(match).length (별도 _lcsLength 불요 — DP 1회)
  */
  function _wordDiff(expected, actual) {
    // 200단어 상한 방어 (런타임규격 §4-3) — actual도 동일 상한 clamp (극단 입력 DP OOM 방지)
    if (actual.length > 200) { actual = actual.slice(0, 200); }
    var m = expected.length, n = actual.length;
    if (m > 200) { throw new Error('dictation-diff: expected 단어 수 200 초과 (' + m + ')'); }
    // DP 경로 역추적
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp.push(new Array(n + 1).fill(0));
    }
    for (var i = 1; i <= m; i++) {
      for (var j = 1; j <= n; j++) {
        if (expected[i - 1] === actual[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    // 역추적
    var result = [];
    var i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && expected[i - 1] === actual[j - 1]) {
        result.unshift({ word: expected[i - 1], status: 'match' });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ word: actual[j - 1], status: 'extra' });
        j--;
      } else {
        result.unshift({ word: expected[i - 1], status: 'miss' });
        i--;
      }
    }
    return result;
  }

  /* ─────────────────────────────────────────────
     HTML 이스케이프
  ───────────────────────────────────────────── */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────
     Web Speech TTS 헬퍼 (런타임규격 §3-1)
  ───────────────────────────────────────────── */
  function _getEnglishVoice() {
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    return (
      voices.find(function (v) { return v.lang === 'en-US' && v.localService; }) ||
      voices.find(function (v) { return v.lang.indexOf('en-US') === 0; }) ||
      voices.find(function (v) { return v.lang.indexOf('en') === 0; }) ||
      (voices.length ? voices[0] : null)
    );
  }

  function _speakText(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!window.speechSynthesis) {
        reject(new Error('SpeechSynthesis not supported'));
        return;
      }
      var utt = new SpeechSynthesisUtterance(text);
      utt.lang  = opts.lang  || 'en-US';
      utt.rate  = typeof opts.rate  === 'number' ? opts.rate  : 0.85;
      utt.pitch = typeof opts.pitch === 'number' ? opts.pitch : 1.0;
      var voice = _getEnglishVoice();
      if (voice) utt.voice = voice;
      utt.onend   = function () { resolve(); };
      utt.onerror = function (e) { reject(e); };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
    });
  }

  /* ─────────────────────────────────────────────
     SpeechRecognition 헬퍼 (런타임규격 §3-2, speaking 보조)
     Chrome/Edge 전용. 미지원 시 null 반환 → 텍스트 입력 폴백.
  ───────────────────────────────────────────── */
  function _getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /* ─────────────────────────────────────────────
     정적 채점기 (런타임규격 §4)
  ───────────────────────────────────────────── */

  /** exact / cloze 채점 (런타임규격 §4-1) */
  function _scoreExact(activity, userText) {
    var accept = (activity.grading && activity.grading.accept) || [];
    var norm = normalize(userText);
    for (var i = 0; i < accept.length; i++) {
      if (normalize(accept[i]) === norm) {
        return {
          verdict:   'correct',
          score_raw: 1.0,
          grader_id: 'engine',
          feedback:  { matched: accept[i] }
        };
      }
    }
    return {
      verdict:   'incorrect',
      score_raw: 0.0,
      grader_id: 'engine',
      feedback:  { accepted: accept }
    };
  }

  /** keyword 채점 (런타임규격 §4-2) */
  function _scoreKeyword(activity, userText) {
    var groups = (activity.grading && activity.grading.keywords) || [];
    var norm = normalize(userText);
    var hitCount = 0;
    var missed = [];
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      var hit = false;
      for (var j = 0; j < group.length; j++) {
        if (norm.indexOf(normalize(group[j])) !== -1) { hit = true; break; }
      }
      if (hit) { hitCount++; } else { missed.push(group); }
    }
    var total = groups.length;
    var scoreRaw = total > 0 ? hitCount / total : 0;
    return {
      verdict:   scoreRaw === 1.0 ? 'correct' : 'incorrect',
      score_raw: scoreRaw,
      grader_id: 'engine',
      feedback:  { hit: hitCount, total: total, missed: missed }
    };
  }

  /** dictation-diff 채점 (런타임규격 §4-3) */
  function _scoreDictationDiff(activity, userText) {
    var expectedRaw = (activity.grading && activity.grading.expected) ||
                      (activity.front  && activity.front.audio_text);
    if (!expectedRaw) {
      return {
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  { error: 'dictation-diff requires expected or audio_text' }
      };
    }
    var expTokens = tokenize(expectedRaw);
    var actTokens = tokenize(userText);

    var lcsLen, diffDetail;
    try {
      diffDetail = _wordDiff(expTokens, actTokens);
      lcsLen = diffDetail.filter(function (d) { return d.status === 'match'; }).length;
    } catch (e) {
      return {
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  { error: e.message }
      };
    }

    var total    = expTokens.length;
    var scoreRaw = total > 0 ? lcsLen / total : 0;
    // 런타임규격 §4-3 기본값 0.9, 문항별 grading.dictation_threshold로 재정의 가능 (core ①)
    var threshold = (activity.grading && typeof activity.grading.dictation_threshold === 'number')
      ? activity.grading.dictation_threshold
      : 0.9;
    return {
      verdict:   scoreRaw >= threshold ? 'correct' : 'incorrect',
      score_raw: scoreRaw,
      grader_id: 'engine',
      feedback:  {
        correct_words: lcsLen,
        total_words:   total,
        diff:          diffDetail
      }
    };
  }

  /* ─────────────────────────────────────────────
     BYO-key 채점 stub (런타임규격 §5)
     키 없으면 즉시 pending 반환.
     키 있는 경우는 v1 파킹 — 기반 구조만 확보.
  ───────────────────────────────────────────── */

  /** writing → llm-rubric (런타임규격 §5-1) */
  function _scoreLlmRubric(activity, userText, ctx) {
    var key = ctx && ctx.getKey ? ctx.getKey('llm_api_key') : null;
    if (!key) {
      return Promise.resolve({
        verdict:   'pending',
        score_raw: null,
        grader_id: 'llm',
        feedback:  {
          message: "LLM API 키가 필요합니다. 설정 > 키 설정에서 'LLM API 키'를 입력하세요."
        }
      });
    }
    // F-07: file:// 프로토콜에서는 fetch가 항상 실패 → 키 문제로 오인 방지
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      return Promise.resolve({
        verdict:   'pending',
        score_raw: null,
        grader_id: 'llm',
        feedback:  {
          message: 'file://에서는 LLM 호출 불가 — 웹서버로 여세요 (예: npx serve 또는 VS Code Live Server).'
        }
      });
    }

    // 키 있는 경우: OpenAI-compatible POST /chat/completions
    // llm_endpoint / llm_model byok 키로 유연화 (core ②)
    var rubric    = (activity.grading && activity.grading.rubric) || '';
    var endpoint  = (ctx && ctx.getKey ? ctx.getKey('llm_endpoint') : null) ||
                    'https://api.openai.com/v1/chat/completions';
    var modelName = (ctx && ctx.getKey ? ctx.getKey('llm_model') : null) ||
                    'gpt-4o-mini';
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role:    'system',
            content: 'You are an English writing evaluator. Respond with JSON only: {"score": <0-10>, "feedback": "<string>"}. Rubric: ' + rubric
          },
          { role: 'user', content: userText }
        ],
        temperature: 0,
        max_tokens:  256
      })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('LLM API 오류: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      // 마크다운 코드 펜스 제거 (gpt-4o-mini 등 JSON mode 미설정 시 빈번)
      var cleaned = (text || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      var parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        // 파싱 실패 → incorrect 오채점 대신 pending 반환 (SM-2 오염 방지)
        return {
          verdict:   'pending',
          score_raw: null,
          grader_id: 'llm',
          feedback:  { message: 'LLM 응답 파싱 오류 (JSON 형식 아님). 재시도하거나 모델을 확인하세요.' }
        };
      }
      var scoreRaw = Math.min(10, Math.max(0, Number(parsed.score) || 0)) / 10;
      return {
        verdict:   scoreRaw >= 0.6 ? 'correct' : 'incorrect',
        score_raw: scoreRaw,
        grader_id: 'llm',
        feedback:  { message: parsed.feedback || '' }
      };
    })
    .catch(function (e) {
      return {
        verdict:   'pending',
        score_raw: null,
        grader_id: 'llm',
        feedback:  { message: 'LLM 채점 실패: ' + e.message }
      };
    });
  }

  /** speaking → pronunciation (런타임규격 §5-2) */
  function _scorePronunciation(activity, userAnswer, ctx) {
    var key = ctx && ctx.getKey ? ctx.getKey('azure_speech_key') : null;
    if (!key) {
      return Promise.resolve({
        verdict:   'pending',
        score_raw: null,
        grader_id: 'external',
        feedback:  {
          message: "Azure Speech 키가 필요합니다. 설정 > 키 설정에서 'Azure Speech 키'를 입력하세요."
        }
      });
    }
    // 키 있는 경우: Azure Pronunciation Assessment — v1 파킹
    // 기반 구조만 확보; 실제 SDK 통합은 v2에서
    return Promise.resolve({
      verdict:   'pending',
      score_raw: null,
      grader_id: 'external',
      feedback:  {
        message: 'Azure Speech 채점 통합 준비 중입니다 (v2 예정).'
      }
    });
  }

  /* ─────────────────────────────────────────────
     SM-2 스케줄러 (core ③)
     SuperMemo SM-2 알고리즘: 정답 간격 확장, 오답 간격 단축.
     q(quality): correct=5, incorrect=1 (0-5 scale 단순화)
  ───────────────────────────────────────────── */
  function _sm2Update(extra, verdict) {
    var now      = Date.now();
    // 신규 카드 기본값 0 (미학습 상태). 1은 "첫 복습 완료" 상태.
    var interval = (extra && typeof extra.sm2_interval === 'number') ? extra.sm2_interval : 0;
    var efactor  = (extra && typeof extra.sm2_efactor === 'number')  ? extra.sm2_efactor  : 2.5;

    var q = verdict === 'correct' ? 5 : 1;

    // EF 업데이트: EF' = EF + (0.1 - (5-q)(0.08 + (5-q)*0.02))
    var newEF = efactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (newEF < 1.3) newEF = 1.3;

    var newInterval;
    if (verdict !== 'correct') {
      // 오답: 간격 초기화 (0 → 1일, 다음 복습 시 1→6 진행 가능)
      newInterval = 0;
    } else {
      // 정답: SM-2 간격 확장 (표준 알고리즘)
      // n=1(interval=0): 첫 정답 → 1일 후 복습
      // n=2(interval=1): 두 번째 정답 → 6일 후 복습
      // n≥3(interval≥2): EF 곱하여 간격 확장
      if (interval <= 0) {
        newInterval = 1;
      } else if (interval <= 1) {
        newInterval = 6;
      } else {
        newInterval = Math.round(interval * newEF);
      }
    }

    // due_at: 지금으로부터 newInterval일 후 (ms). 오답(newInterval=0)은 1일 후.
    var daysAhead = newInterval > 0 ? newInterval : 1;
    var dueAt = now + daysAhead * 24 * 60 * 60 * 1000;

    return { sm2_interval: newInterval, sm2_efactor: newEF, due_at: dueAt };
  }

  /* ─────────────────────────────────────────────
     진도 스냅샷 업데이트 헬퍼
  ───────────────────────────────────────────── */
  function _updateProgress(activityId, modality, lastAnswer, result) {
    var snap = getProgressSnapshot();
    if (!snap.activities[activityId]) {
      snap.activities[activityId] = {
        cold_attempts: 0,
        cold_correct:  0,
        last_verdict:  null,
        plugin_extra:  { modality: modality, last_answer: null, score_raw: null }
      };
    }
    var entry = snap.activities[activityId];
    // cold_attempts 의미: "정복(첫 cold_correct 달성)까지의 시도 수"
    // → 이미 correct 달성한 활동은 재제출해도 분모 부풀리지 않음 (wrong_rate 비교가능성 보장)
    // pending은 시도 횟수 미집계; prior last_verdict를 덮어쓰기 전에 읽어 cold 여부 판정
    var priorLastVerdict = entry.last_verdict;
    if (result.verdict !== 'pending') {
      if (priorLastVerdict !== 'correct') {
        entry.cold_attempts++;
        if (result.verdict === 'correct') entry.cold_correct++;
      }
    }
    // pending은 last_verdict 덮어쓰기 금지 — once-correct 상태 보존 (cold_attempts 가드와 동일 패턴)
    if (result.verdict !== 'pending') {
      entry.last_verdict = result.verdict;
    }

    // SM-2: vocab/grammar 모달에만 적용 (core ③)
    // 비대상 모달은 sm2Fields={}로 두면 Object.assign이 기존 값을 덮어쓰지 않아 보존됨.
    // (undefined 값 복사는 JSON 직렬화에서 키 소멸 → 오염 유발하므로 금지)
    var sm2Fields = {};
    if ((modality === 'vocab' || modality === 'grammar') && result.verdict !== 'pending') {
      sm2Fields = _sm2Update(entry.plugin_extra, result.verdict);
    }

    // mid: 오답 노트 — incorrect 시 back.explanation 누적 (최대 20개)
    // 계약 §4 준수: PluginProgressSnapshot 루트에 비계약 필드 금지 → 별도 키(WRONG_NOTES_KEY)로 분리
    if (result.verdict === 'incorrect') {
      var wrongActivity = _findActivity(activityId);
      var explanation = wrongActivity && wrongActivity.back && wrongActivity.back.explanation;
      if (explanation) {
        var wrongNotes = _loadWrongNotes();
        wrongNotes = wrongNotes.filter(function (n) { return n.activity_id !== activityId; });
        wrongNotes.unshift({ activity_id: activityId, modality: modality, explanation: explanation, ts: Date.now() });
        if (wrongNotes.length > 20) wrongNotes = wrongNotes.slice(0, 20);
        _saveWrongNotes(wrongNotes);
      }
    }

    // mid: writing 히스토리 — llm-rubric 채점 완료(pending 제외) 후 저장 (최대 5회 순환)
    // pending = 키 부재 상태; 유의미 채점 기록이 아니므로 슬롯 소모 금지.
    var history = (entry.plugin_extra && Array.isArray(entry.plugin_extra.history))
      ? entry.plugin_extra.history.slice()
      : [];
    if (modality === 'writing' && result.verdict !== 'pending') {
      history.unshift({
        answer:    typeof lastAnswer === 'string' ? lastAnswer : '',
        feedback:  (result.feedback && result.feedback.message) || '',
        score_raw: result.score_raw,
        ts:        Date.now()
      });
      if (history.length > 5) history = history.slice(0, 5);
    }

    // tts_rate 보존 (listening 속도 버튼이 별도로 저장하지만 덮어쓰지 않도록 유지)
    var preservedRate = entry.plugin_extra && typeof entry.plugin_extra.tts_rate === 'number'
      ? { tts_rate: entry.plugin_extra.tts_rate }
      : {};

    entry.plugin_extra = Object.assign(
      {
        modality:    modality,
        last_answer: typeof lastAnswer === 'string' ? lastAnswer : null,
        score_raw:   result.score_raw
      },
      sm2Fields,
      preservedRate,
      modality === 'writing' ? { history: history } : {}
    );
    _state.progress = snap;
    _saveProgress(snap);
  }

  /* ─────────────────────────────────────────────
     모달별 UI 렌더링 헬퍼
  ───────────────────────────────────────────── */

  /** 객관식 옵션 렌더 (options 있을 때 공통 사용) */
  function _renderOptions(options, containerId) {
    var html = '<div class="eng-options" id="' + containerId + '">';
    options.forEach(function (opt, idx) {
      html += '<label class="eng-option-label" style="display:block;margin-bottom:6px;cursor:pointer">' +
              '<input type="radio" name="eng-option-' + containerId + '" value="' + _esc(opt) + '" style="margin-right:6px">' +
              _esc(opt) +
              '</label>';
    });
    html += '</div>';
    return html;
  }

  /** 답안 입력 영역 렌더 (단답형 or 객관식 분기) */
  function _renderAnswerArea(activity) {
    var options = activity.front.options;
    if (options && options.length >= 2) {
      return _renderOptions(options, 'eng-options-' + (activity.activity_id || 'x'));
    }
    return '<input type="text" id="eng-answer-input" class="eng-answer-input"' +
           ' placeholder="답을 입력하세요"' +
           ' style="width:100%;font-size:var(--fs-md,1rem);padding:9px 12px;border:1px solid var(--line2,#ddd);border-radius:var(--r,6px);background:var(--surface,#fff);color:var(--ink,#111);box-sizing:border-box">';
  }

  /** 현재 컨테이너에서 답안 텍스트 읽기 */
  function _readAnswer(container, activity) {
    var options = activity && activity.front && activity.front.options;
    if (options && options.length >= 2) {
      var checked = container.querySelector('input[type=radio]:checked');
      return checked ? checked.value : '';
    }
    var inp = container.querySelector('#eng-answer-input');
    return inp ? inp.value.trim() : '';
  }

  /** 키 상태 배지 (writing/speaking) */
  function _keyBadge(keyPresent, keyLabel) {
    if (keyPresent) {
      return '<span style="display:inline-block;padding:3px 9px;font-size:0.78rem;border-radius:20px;background:var(--brand-bg,#e4efe7);color:var(--brand-deep,#124e35);margin-bottom:8px">' +
             keyLabel + ' 설정됨</span>';
    }
    return '<span style="display:inline-block;padding:3px 9px;font-size:0.78rem;border-radius:12px;background:var(--warn-bg,#fff8e1);color:var(--warn,#b45309);margin-bottom:8px" title="설정 > 키 설정에서 입력">' +
           keyLabel + ' 미설정 — 채점 불가</span>';
  }

  /* ─────────────────────────────────────────────
     Activity Nav Bar 헬퍼
  ───────────────────────────────────────────── */

  /** nav HTML 생성. activities.length <= 1이면 빈 문자열 반환. */
  function _buildNavHTML(activities, currentIdx) {
    if (!activities || activities.length <= 1) return '';
    var html = '<div class="act-nav" style="display:flex;align-items:center;gap:6px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line2,#eee);flex-wrap:wrap">';
    html += '<span style="font-size:0.8rem;color:var(--ink3,#888);font-weight:500;margin-right:2px">문제</span>';
    for (var i = 0; i < activities.length; i++) {
      html += '<button type="button" class="act-nav-btn" data-act-idx="' + i + '"' +
        ' style="min-width:34px;height:34px;border-radius:7px;border:1.5px solid var(--line2,#ddd);background:var(--surface,#fff);cursor:pointer;font-size:0.83rem;font-weight:500">' +
        (i + 1) + '</button>';
    }
    html += '<span class="act-count" style="margin-left:auto;font-size:0.8rem;color:var(--ink3,#888)">' + (currentIdx + 1) + ' / ' + activities.length + '</span>';
    html += '</div>';
    return html;
  }

  /** nav 배지 스타일 업데이트 (완료 = 초록, 현재 = 강조) */
  function _updateNavBadges(container, activities, currentIdx) {
    var btns = container.querySelectorAll('.act-nav-btn');
    for (var i = 0; i < btns.length; i++) {
      var isActive = i === currentIdx;
      var act = activities[i];
      var saved = act && _state.progress && _state.progress.activities && _state.progress.activities[act.activity_id];
      var done = saved && saved.last_verdict === 'correct';
      btns[i].style.background = isActive ? 'var(--brand,#1f6b4a)' : 'var(--surface,#fbfaf6)';
      btns[i].style.color = isActive ? '#fff' : (done ? 'var(--brand-deep,#124e35)' : 'var(--ink3,#7a7168)');
      btns[i].style.borderColor = isActive ? 'var(--brand,#1f6b4a)' : (done ? 'var(--brand,#1f6b4a)' : 'var(--line2,#cfc7b4)');
      btns[i].title = done ? '완료 ✓' : '';
    }
    var countEl = container.querySelector('.act-count');
    if (countEl) countEl.textContent = (currentIdx + 1) + ' / ' + activities.length;
  }

  /* ─────────────────────────────────────────────
     writing 히스토리 타임라인 렌더 (mid: writing 제출 히스토리)
     history: [{answer, feedback, score_raw, ts}, ...] 최대 5개
  ───────────────────────────────────────────── */
  function _renderWritingHistory(el, history) {
    if (!el) return;
    if (!history || !history.length) { el.innerHTML = ''; return; }
    var html = '<div style="border-top:1px solid var(--line2,#eee);padding-top:14px">';
    html += '<div style="font-size:0.82rem;font-weight:600;color:var(--ink3,#888);margin-bottom:10px;letter-spacing:0.02em">이전 제출 기록 (' + history.length + '/5)</div>';
    history.forEach(function (h, i) {
      var ts = h.ts ? new Date(h.ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      var scoreLabel = typeof h.score_raw === 'number' ? Math.round(h.score_raw * 100) + '%' : '채점불가';
      var scoreColor = typeof h.score_raw === 'number'
        ? (h.score_raw >= 0.6 ? 'var(--brand,#1f6b4a)' : 'var(--hot,#a8301f)')
        : 'var(--warn,#b45309)';
      html += '<div style="margin-bottom:10px;padding:10px 12px;background:var(--surface2,#f2eee5);border-radius:6px;border-left:3px solid var(--line2,#ddd)">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
      html += '<span style="font-size:0.78rem;color:var(--ink3,#999)">#' + (i + 1) + ' &nbsp;' + _esc(ts) + '</span>';
      html += '<span style="margin-left:auto;font-size:0.8rem;font-weight:600;color:' + scoreColor + '">' + _esc(scoreLabel) + '</span>';
      html += '</div>';
      if (h.answer) {
        html += '<div style="font-size:0.83rem;color:var(--ink2,#444);margin-bottom:4px;white-space:pre-wrap;word-break:break-word">' + _esc(h.answer.slice(0, 200)) + (h.answer.length > 200 ? '…' : '') + '</div>';
      }
      if (h.feedback) {
        html += '<div style="font-size:0.8rem;color:var(--ink3,#666);font-style:italic">' + _esc(h.feedback.slice(0, 150)) + (h.feedback.length > 150 ? '…' : '') + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  /* ─────────────────────────────────────────────
     _loadEnglishActivity — 문제 전환 (nav 전환 + 초기 로드 공용)
  ───────────────────────────────────────────── */
  function _loadEnglishActivity(container, ctx, activities, idx) {
    // 활성 음성 중단
    if (_state.currentRecognition) {
      try { _state.currentRecognition.stop(); } catch (e) {}
      _state.currentRecognition = null;
    }
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }

    _state.activityIndex = idx;
    _state.activity = activities[idx];
    var activity = _state.activity;

    var contentArea = container.querySelector('#eng-content-area');
    if (!contentArea) return;

    if (!activity || !activity.front) {
      contentArea.innerHTML = '<div class="error-banner" style="margin:var(--space-6,24px)">english 플러그인: 문제 데이터가 없거나 front 필드가 누락되었습니다.</div>';
      _updateNavBadges(container, activities, idx);
      return;
    }

    var modality = activity.front.modality;

    // 진도 복원: last_answer
    var lastAnswer = null;
    if (_state.progress) {
      var actId = activity.activity_id;
      var saved = _state.progress.activities && _state.progress.activities[actId];
      if (saved && saved.plugin_extra) lastAnswer = saved.plugin_extra.last_answer || null;
    }

    // BYO-key 상태 (writing/speaking)
    var llmKey    = ctx.getKey('llm_api_key');
    var azureKey  = ctx.getKey('azure_speech_key');
    var ttSupport = !!window.speechSynthesis;
    var srSupport = !!_getSpeechRecognition();

    // 모달별 HTML 조립
    var html = '<div class="eng-wrap" data-modality="' + _esc(modality) + '" data-activity-id="' + _esc(activity.activity_id) + '">';
    html += '<div class="eng-modality-badge plugin-badge" style="margin-bottom:12px">' + _esc(modality.toUpperCase()) + '</div>';
    html += '<div class="eng-prompt" style="font-size:var(--fs-lg,1.1rem);font-weight:600;margin-bottom:12px;line-height:1.5">' + _esc(activity.front.prompt) + '</div>';

    // reading: 지문 표시
    if (modality === 'reading' && activity.front.passage) {
      html += '<div class="eng-passage" style="background:var(--surface2,#f2eee5);border:1px solid var(--line2,#ddd);border-radius:var(--r,6px);padding:14px 16px;margin-bottom:14px;font-size:0.95rem;line-height:1.7;white-space:pre-wrap">' + _esc(activity.front.passage) + '</div>';
    }

    // listening: TTS 재생 버튼 + 속도 제어 + 받아쓰기 입력 (mid: TTS 재생 속도 제어)
    if (modality === 'listening') {
      // 저장된 속도 복원 (plugin_extra.tts_rate)
      var savedRate = 1.0;
      if (_state.progress) {
        var actSaved = _state.progress.activities && _state.progress.activities[activity.activity_id];
        if (actSaved && actSaved.plugin_extra && typeof actSaved.plugin_extra.tts_rate === 'number') {
          savedRate = actSaved.plugin_extra.tts_rate;
        }
      }
      if (!ttSupport) {
        html += '<div class="eng-tts-unsupported" style="padding:10px 14px;background:var(--warn-bg,#fff8e1);border-radius:var(--r,6px);color:var(--warn,#b45309);margin-bottom:12px">' +
                '이 브라우저는 TTS(SpeechSynthesis)를 지원하지 않습니다. Chrome/Edge를 사용해 주세요.</div>';
      } else {
        // 속도 제어 버튼 3개
        html += '<div class="eng-tts-controls" style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
        html += '<button type="button" id="eng-tts-btn" class="eng-tts-btn"' +
                ' style="padding:8px 20px;border-radius:6px;border:1px solid var(--line2,#ccc);background:var(--surface,#fff);cursor:pointer;display:inline-flex;align-items:center;gap:6px">' +
                '<span>&#9654;</span> 듣기</button>';
        html += '<span style="font-size:0.8rem;color:var(--ink3,#888);margin-left:4px">속도:</span>';
        var rates = [
          { val: 0.75, label: '0.75×' },
          { val: 1.0,  label: '1.0×'  },
          { val: 1.25, label: '1.25×' }
        ];
        rates.forEach(function (r) {
          var isActive = savedRate === r.val;
          html += '<button type="button" class="eng-rate-btn" data-rate="' + r.val + '"' +
                  ' style="padding:5px 12px;border-radius:6px;border:1.5px solid ' +
                  (isActive ? 'var(--brand,#1f6b4a)' : 'var(--line2,#cfc7b4)') +
                  ';background:' + (isActive ? 'var(--brand-bg,#e4efe7)' : 'var(--surface,#fbfaf6)') +
                  ';color:' + (isActive ? 'var(--brand-deep,#124e35)' : 'var(--ink3,#7a7168)') +
                  ';cursor:pointer;font-size:0.82rem;font-weight:' + (isActive ? '600' : '400') + '">' +
                  r.label + '</button>';
        });
        html += '</div>';
      }
      html += '<div style="font-size:0.88rem;color:var(--ink3,#666);margin-bottom:8px">받아쓰기: 들은 내용을 입력하세요</div>';
      html += '<textarea id="eng-answer-input" class="eng-answer-input"' +
              ' placeholder="들은 내용을 그대로 입력하세요"' +
              ' style="width:100%;min-height:80px;font-size:var(--fs-md,1rem);padding:9px 12px;border:1px solid var(--line2,#ddd);border-radius:var(--r,6px);background:var(--surface,#fff);color:var(--ink,#111);box-sizing:border-box;resize:vertical"></textarea>';
    }
    // writing: textarea
    else if (modality === 'writing') {
      html += _keyBadge(!!llmKey, 'LLM API 키');
      html += '<textarea id="eng-answer-input" class="eng-answer-input"' +
              ' placeholder="자유롭게 영작해 보세요"' +
              ' style="width:100%;min-height:120px;font-size:var(--fs-md,1rem);padding:9px 12px;border:1px solid var(--line2,#ddd);border-radius:var(--r,6px);background:var(--surface,#fff);color:var(--ink,#111);box-sizing:border-box;resize:vertical"></textarea>';
    }
    // speaking: 녹음 or 텍스트 폴백
    else if (modality === 'speaking') {
      html += _keyBadge(!!azureKey, 'Azure Speech 키');
      if (srSupport) {
        html += '<button type="button" id="eng-record-btn" class="eng-record-btn"' +
                ' style="padding:8px 20px;border-radius:6px;border:1px solid var(--line2,#ccc);background:var(--surface,#fff);cursor:pointer;margin-bottom:10px;display:inline-flex;align-items:center;gap:6px">' +
                '<span>&#9679;</span> 녹음 시작</button>';
        html += '<div id="eng-record-status" class="eng-record-status" style="font-size:0.85rem;color:var(--ink3,#666);margin-bottom:8px"></div>';
      } else {
        html += '<div style="font-size:0.85rem;color:var(--ink3,#666);margin-bottom:8px">이 브라우저는 음성 입력(SpeechRecognition)을 지원하지 않습니다. 텍스트로 입력하세요.</div>';
      }
      html += '<input type="text" id="eng-answer-input" class="eng-answer-input"' +
              ' placeholder="말하거나 직접 텍스트를 입력하세요"' +
              ' style="width:100%;font-size:var(--fs-md,1rem);padding:9px 12px;border:1px solid var(--line2,#ddd);border-radius:var(--r,6px);background:var(--surface,#fff);color:var(--ink,#111);box-sizing:border-box">';
    }
    // vocab / grammar / reading: 텍스트 or 객관식
    else {
      html += _renderAnswerArea(activity);
    }

    // 제출 버튼
    html += '<div style="margin-top:12px">';
    html += '<button type="button" id="eng-submit-btn" class="eng-submit-btn"' +
            ' style="padding:9px 24px;border-radius:var(--r,10px);border:none;background:var(--brand,#1f6b4a);color:#fff;font-weight:600;cursor:pointer;font-size:var(--fs-md,14px)">제출·채점</button>';
    html += '</div>';

    // 결과 영역
    html += '<div id="eng-result" class="eng-result" style="min-height:28px;margin-top:14px"></div>';
    // writing: 히스토리 타임라인 컨테이너 (mid: writing 제출 히스토리)
    if (modality === 'writing') {
      html += '<div id="eng-history-area" style="margin-top:18px"></div>';
    }
    html += '</div>';

    contentArea.innerHTML = html;

    // 이전 답안 복원
    if (lastAnswer) {
      var inp = contentArea.querySelector('#eng-answer-input');
      if (inp) inp.value = lastAnswer;
    }

    // TTS 버튼 + 속도 제어 바인딩 (listening, mid: TTS 재생 속도 제어)
    if (modality === 'listening' && ttSupport) {
      // 현재 선택 속도 (클로저 상태)
      var _currentRate = savedRate;

      // 속도 버튼 클릭 처리
      var rateBtns = contentArea.querySelectorAll('.eng-rate-btn');
      for (var ri = 0; ri < rateBtns.length; ri++) {
        rateBtns[ri].addEventListener('click', (function (btn) {
          return function () {
            _currentRate = parseFloat(btn.getAttribute('data-rate'));
            // 버튼 스타일 갱신
            var allRateBtns = contentArea.querySelectorAll('.eng-rate-btn');
            for (var j = 0; j < allRateBtns.length; j++) {
              var isActive = parseFloat(allRateBtns[j].getAttribute('data-rate')) === _currentRate;
              allRateBtns[j].style.border = '1.5px solid ' + (isActive ? 'var(--brand,#1f6b4a)' : 'var(--line2,#cfc7b4)');
              allRateBtns[j].style.background = isActive ? 'var(--brand-bg,#e4efe7)' : 'var(--surface,#fbfaf6)';
              allRateBtns[j].style.color = isActive ? 'var(--brand-deep,#124e35)' : 'var(--ink3,#7a7168)';
              allRateBtns[j].style.fontWeight = isActive ? '600' : '400';
            }
            // plugin_extra.tts_rate 저장
            var snap = getProgressSnapshot();
            if (!snap.activities[activity.activity_id]) {
              snap.activities[activity.activity_id] = {
                cold_attempts: 0, cold_correct: 0, last_verdict: null,
                plugin_extra: { modality: modality, last_answer: null, score_raw: null }
              };
            }
            snap.activities[activity.activity_id].plugin_extra.tts_rate = _currentRate;
            _state.progress = snap;
            _saveProgress(snap);
          };
        })(rateBtns[ri]));
      }

      var ttsBtn = contentArea.querySelector('#eng-tts-btn');
      if (ttsBtn) {
        ttsBtn.addEventListener('click', function () {
          var text = activity.front.audio_text;
          if (!text) {
            ttsBtn.textContent = '재생할 텍스트가 없습니다';
            return;
          }
          ttsBtn.disabled = true;
          ttsBtn.innerHTML = '<span>&#9646;&#9646;</span> 재생 중...';
          // voiceschanged 대기 후 재생 (Chrome 비동기 로드)
          function doSpeak() {
            _speakText(text, { lang: 'en-US', rate: _currentRate }).then(function () {
              ttsBtn.disabled = false;
              ttsBtn.innerHTML = '<span>&#9654;</span> 다시 듣기';
            }).catch(function (e) {
              ttsBtn.disabled = false;
              ttsBtn.innerHTML = '<span>&#9654;</span> 듣기';
              console.warn('[english] TTS 오류:', e);
            });
          }
          if (window.speechSynthesis.getVoices().length === 0) {
            // Chrome에서 voices 로드 완료 후 onvoiceschanged 미발화 race 방어: 500ms timeout fallback
            var _voiceStarted = false;
            var _voiceFallback = setTimeout(function () {
              if (!_voiceStarted) {
                window.speechSynthesis.onvoiceschanged = null;
                _voiceStarted = true;
                doSpeak();
              }
            }, 500);
            window.speechSynthesis.onvoiceschanged = function () {
              if (!_voiceStarted) {
                clearTimeout(_voiceFallback);
                window.speechSynthesis.onvoiceschanged = null;
                _voiceStarted = true;
                doSpeak();
              }
            };
          } else {
            doSpeak();
          }
        });
      }
    }

    // 녹음 버튼 바인딩 (speaking, STT 지원)
    if (modality === 'speaking' && srSupport) {
      var recordBtn = contentArea.querySelector('#eng-record-btn');
      var statusEl  = contentArea.querySelector('#eng-record-status');
      var ansInput  = contentArea.querySelector('#eng-answer-input');
      if (recordBtn) {
        var _recording = false;
        recordBtn.addEventListener('click', function () {
          if (_recording) {
            if (_state.currentRecognition) {
              _state.currentRecognition.stop();
              _state.currentRecognition = null;
            }
            _recording = false;
            recordBtn.innerHTML = '<span>&#9679;</span> 녹음 시작';
            if (statusEl) statusEl.textContent = '';
            return;
          }
          var SR = _getSpeechRecognition();
          var rec = new SR();
          rec.lang           = 'en-US';
          rec.interimResults = false;
          rec.maxAlternatives = 1;
          _state.currentRecognition = rec;
          _recording = true;
          recordBtn.innerHTML = '<span>&#9646;&#9646;</span> 녹음 중 (클릭하여 중지)';
          if (statusEl) statusEl.textContent = '말씀하세요...';
          rec.onresult = function (e) {
            var transcript = e.results[0][0].transcript;
            // contentArea가 이미 다른 문항으로 교체됐을 수 있으므로 실시간 재조회
            var currentInput = contentArea.querySelector('#eng-answer-input');
            if (currentInput) currentInput.value = transcript;
            _recording = false;
            _state.currentRecognition = null;
            recordBtn.innerHTML = '<span>&#9679;</span> 다시 녹음';
            if (statusEl) statusEl.textContent = '인식 완료: "' + transcript + '"';
          };
          rec.onerror = function (e) {
            _recording = false;
            _state.currentRecognition = null;
            recordBtn.innerHTML = '<span>&#9679;</span> 녹음 시작';
            if (statusEl) statusEl.textContent = '오류: ' + (e.error || e.message || '알 수 없음');
          };
          rec.onend = function () {
            if (_recording) {
              _recording = false;
              recordBtn.innerHTML = '<span>&#9679;</span> 녹음 시작';
              if (statusEl) statusEl.textContent = '';
            }
          };
          try { rec.start(); } catch (err) {
            _recording = false;
            _state.currentRecognition = null;
            recordBtn.innerHTML = '<span>&#9679;</span> 녹음 시작';
            if (statusEl) statusEl.textContent = '녹음 시작 실패: ' + err.message;
          }
        });
      }
    }

    // writing: 이전 히스토리 초기 렌더 (mid: writing 제출 히스토리)
    if (modality === 'writing') {
      var existingHistory = [];
      if (_state.progress) {
        var wActSaved = _state.progress.activities && _state.progress.activities[activity.activity_id];
        if (wActSaved && wActSaved.plugin_extra && Array.isArray(wActSaved.plugin_extra.history)) {
          existingHistory = wActSaved.plugin_extra.history;
        }
      }
      _renderWritingHistory(contentArea.querySelector('#eng-history-area'), existingHistory);
    }

    // 제출 버튼 바인딩
    var submitBtn = contentArea.querySelector('#eng-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var text = _readAnswer(contentArea, activity);
        var resultEl = contentArea.querySelector('#eng-result');
        if (resultEl) resultEl.innerHTML = '<span style="color:var(--ink3,#666)">채점 중...</span>';

        // speaking은 text + audio_blob 구조 (v1은 text만)
        var userAnswer = modality === 'speaking'
          ? { text: text, audio_blob: null }
          : { text: text };

        score(userAnswer).then(function (result) {
          _renderResult(resultEl, result, activity);
          ctx.emit({ type: 'activity-completed', result: result });
          // 채점 후 nav 배지 즉시 갱신
          _updateNavBadges(container, activities, _state.activityIndex);
          // writing: 히스토리 갱신 표시
          if (modality === 'writing') {
            var histEl = contentArea.querySelector('#eng-history-area');
            var snap2 = getProgressSnapshot();
            var wEntry = snap2.activities && snap2.activities[activity.activity_id];
            var hist2 = (wEntry && wEntry.plugin_extra && wEntry.plugin_extra.history) || [];
            _renderWritingHistory(histEl, hist2);
          }
        }).catch(function (e) {
          if (resultEl) resultEl.innerHTML = '<span style="color:var(--hot,#a8301f)">채점 오류: ' + _esc(e.message) + '</span>';
        });
      });
    }

    // nav 배지 업데이트
    _updateNavBadges(container, activities, idx);
  }

  /* ─────────────────────────────────────────────
     _sortActivitiesByDueAt(activitiesRaw, snap)
     SM-2 due_at 기준 정렬 헬퍼 — mount·onProgressRestored 공용.
     due_at이 작은(더 급한) 항목 먼저; 비대상 모달/미학습 항목은 Infinity로 원래 순서 유지.
  ───────────────────────────────────────────── */
  function _sortActivitiesByDueAt(activitiesRaw, snap) {
    return activitiesRaw.slice().sort(function (a, b) {
      var ea = snap && snap.activities && snap.activities[a.activity_id];
      var eb = snap && snap.activities && snap.activities[b.activity_id];
      var isSmA = a.front && (a.front.modality === 'vocab' || a.front.modality === 'grammar');
      var isSmB = b.front && (b.front.modality === 'vocab' || b.front.modality === 'grammar');
      var da = (isSmA && ea && ea.plugin_extra && typeof ea.plugin_extra.due_at === 'number') ? ea.plugin_extra.due_at : Infinity;
      var db = (isSmB && eb && eb.plugin_extra && typeof eb.plugin_extra.due_at === 'number') ? eb.plugin_extra.due_at : Infinity;
      return da - db;
    });
  }

  /* ─────────────────────────────────────────────
     mount() — UI 주입 (런타임규격 §6-1)
  ───────────────────────────────────────────── */
  function mount(container, ctx) {
    if (_state.mounted) unmount();

    _state.host    = container;
    _state.ctx     = ctx;
    _state.mounted = true;

    var activitiesRaw = (window.ACTIVITIES && window.ACTIVITIES['english']) || [];

    if (!activitiesRaw.length) {
      container.innerHTML = '<div class="error-banner" style="margin:var(--space-6,24px)">' +
                            'english 플러그인: 문제 데이터(window.ACTIVITIES[\'english\'])가 없습니다.</div>';
      return Promise.resolve();
    }

    // SM-2 due_at 기준 정렬 (core ③ — mount 진입점 결합)
    var snap = getProgressSnapshot();  // 캐시 or localStorage 폴백 포함
    var activities = _sortActivitiesByDueAt(activitiesRaw, snap);

    // 정렬된 배열 _state에 보존 (onProgressRestored nav 배지 갱신이 동일 배열 참조하도록)
    _state.activities = activities;

    // 초기 인덱스: URL 해시 또는 0
    var hashParts = window.location.hash.split('/');
    var initIdx = 0;
    if (hashParts[2] !== undefined) {
      var parsed = parseInt(hashParts[2], 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < activities.length) {
        initIdx = parsed;
      }
    }

    // 외부 구조: nav + content area
    var outerHTML = '<div class="eng-outer">' +
                    _buildNavHTML(activities, initIdx) +
                    '<div id="eng-content-area"></div>' +
                    '</div>';
    container.innerHTML = outerHTML;

    // nav 버튼 이벤트 위임
    var navEl = container.querySelector('.act-nav');
    if (navEl) {
      navEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.act-nav-btn');
        if (!btn) return;
        var newIdx = parseInt(btn.getAttribute('data-act-idx'), 10);
        if (isNaN(newIdx) || newIdx === _state.activityIndex) return;
        _loadEnglishActivity(container, ctx, _state.activities, newIdx);
      });
    }

    // 첫 문제 로드
    _loadEnglishActivity(container, ctx, activities, initIdx);

    return Promise.resolve();
  }

  /* ─────────────────────────────────────────────
     unmount()
  ───────────────────────────────────────────── */
  function unmount() {
    // 녹음 중이면 중단
    if (_state.currentRecognition) {
      try { _state.currentRecognition.stop(); } catch (e) {}
      _state.currentRecognition = null;
    }
    // TTS 중단
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (_state.host) _state.host.innerHTML = '';
    _state.mounted       = false;
    _state.host          = null;
    _state.ctx           = null;
    _state.activity      = null;
    _state.activities    = null;
    _state.progress      = null;
    _state.activityIndex = 0;
  }

  /* ─────────────────────────────────────────────
     score(userAnswer) — 채점 (플러그인계약 §3, 런타임규격 §6-2)
     userAnswer: { text?: string; audio_blob?: Blob }
     반환: Promise<ScoreResult>
  ───────────────────────────────────────────── */
  function score(userAnswer) {
    var activity = _state.activity;
    var ctx      = _state.ctx;
    var text     = (userAnswer && userAnswer.text) || '';

    if (!activity) {
      return Promise.resolve({
        verdict:   'incorrect',
        score_raw: 0,
        grader_id: 'engine',
        feedback:  { error: '문제 없음' }
      });
    }

    var mode     = activity.grading && activity.grading.mode;
    var modality = activity.front.modality;
    var result;

    switch (mode) {
      case 'exact':
      case 'cloze':
        result = _scoreExact(activity, text);
        _updateProgress(activity.activity_id, modality, text, result);
        return Promise.resolve(result);

      case 'keyword':
        result = _scoreKeyword(activity, text);
        _updateProgress(activity.activity_id, modality, text, result);
        return Promise.resolve(result);

      case 'dictation-diff':
        result = _scoreDictationDiff(activity, text);
        _updateProgress(activity.activity_id, modality, text, result);
        return Promise.resolve(result);

      case 'llm-rubric':
        return _scoreLlmRubric(activity, text, ctx).then(function (r) {
          _updateProgress(activity.activity_id, modality, text, r);
          return r;
        });

      case 'pronunciation':
        return _scorePronunciation(activity, userAnswer, ctx).then(function (r) {
          _updateProgress(activity.activity_id, modality, text, r);
          return r;
        });

      default:
        result = {
          verdict:   'incorrect',
          score_raw: 0,
          grader_id: 'engine',
          feedback:  { error: '알 수 없는 grading.mode: ' + mode }
        };
        _updateProgress(activity.activity_id, modality, text, result);
        return Promise.resolve(result);
    }
  }

  /* ─────────────────────────────────────────────
     getProgressSnapshot() (런타임규격 §6-3)
  ───────────────────────────────────────────── */
  function getProgressSnapshot() {
    if (!_state.progress) {
      // 폴백: 메모리 캐시 미스 시 localStorage 재시도 (mount 전 호출 또는 캐시 소거 시 복원)
      var loaded = _loadProgress();
      _state.progress = loaded || {
        plugin_id:      'english',
        schema_version: 1,
        activities:     {}
      };
    }
    return _state.progress;
  }

  /* ─────────────────────────────────────────────
     onProgressRestored(snapshot) (플러그인계약 §3)
  ───────────────────────────────────────────── */
  function onProgressRestored(snapshot) {
    if (!snapshot) return;
    _state.progress = snapshot;
    _state.restored = true;

    // due_at 재정렬 — 복원된 진도에 SM-2 값이 있으면 순서가 바뀔 수 있음 (mount와 동일 패턴)
    var activitiesRaw = (window.ACTIVITIES && window.ACTIVITIES['english']) || [];
    if (activitiesRaw.length) {
      _state.activities = _sortActivitiesByDueAt(activitiesRaw, snapshot);
      // 재정렬 후 현재 activity의 새 인덱스로 _state.activityIndex 갱신 (배지 불일치 방지)
      if (_state.activity) {
        var currentId = _state.activity.activity_id;
        var newIdx = -1;
        for (var i = 0; i < _state.activities.length; i++) {
          if (_state.activities[i].activity_id === currentId) { newIdx = i; break; }
        }
        if (newIdx !== -1) _state.activityIndex = newIdx;
      }
    }

    // 마운트 상태에서 복원 시 last_answer 갱신
    if (_state.mounted && _state.host && _state.activity) {
      var actId = _state.activity.activity_id;
      var saved = snapshot.activities && snapshot.activities[actId];
      if (saved && saved.plugin_extra && saved.plugin_extra.last_answer) {
        var contentArea = _state.host.querySelector('#eng-content-area');
        var inp = contentArea ? contentArea.querySelector('#eng-answer-input') : null;
        if (inp) inp.value = saved.plugin_extra.last_answer;
      }
      // nav 배지도 갱신 (재정렬된 배열 사용 — 원본 배열과 인덱스 불일치 방지)
      var activities = _state.activities || [];
      if (activities.length > 1) {
        _updateNavBadges(_state.host, activities, _state.activityIndex);
      }
    }
  }

  /* ─────────────────────────────────────────────
     getDashboardContrib() (플러그인계약 §3 선택)
     mid: 오답 노트 위젯 — extra_widgets에 "자주 틀리는 표현 TOP5" 추가
  ───────────────────────────────────────────── */
  function getDashboardContrib() {
    var snap = getProgressSnapshot();
    var acts = snap.activities || {};
    var actIds = Object.keys(acts);
    if (!actIds.length) return null;

    var areaMap = {};
    actIds.forEach(function (id) {
      var a = acts[id];
      var activity = _findActivity(id);
      if (!activity || !activity.tags) return;
      var key = activity.tags.area + '||' + activity.tags.subarea;
      if (!areaMap[key]) {
        areaMap[key] = { area: activity.tags.area, subarea: activity.tags.subarea, correct: 0, total: 0 };
      }
      areaMap[key].total++;
      if (a.last_verdict === 'correct') areaMap[key].correct++;
    });

    var byArea = Object.keys(areaMap).map(function (k) {
      var r = areaMap[k];
      return { area: r.area, subarea: r.subarea, retrieval_rate: r.total ? r.correct / r.total : null };
    });

    var weakness = [];
    actIds.forEach(function (id) {
      var a = acts[id];
      if (!a.cold_attempts) return;
      var activity = _findActivity(id);
      if (!activity || !activity.tags) return;
      var rate = (a.cold_attempts - a.cold_correct) / a.cold_attempts;
      if (rate > 0) {
        weakness.push({ area: activity.tags.area, subarea: activity.tags.subarea, unit: activity.tags.unit, wrong_rate: rate });
      }
    });
    weakness.sort(function (a, b) { return b.wrong_rate - a.wrong_rate; });

    var completion = byArea.map(function (r) {
      return {
        area:         r.area,
        subarea:      r.subarea,
        mastery_rate: r.retrieval_rate != null ? r.retrieval_rate : 0,
        box_dist:     { box1: 0, box2: 0, box3: 0 }
      };
    });

    // mid: 오답 노트 위젯 — 별도 키(WRONG_NOTES_KEY)에서 TOP5 읽기 (계약 §4 준수)
    var allWrongNotes = _loadWrongNotes();
    // 이미 중복 제거·최신순 정렬된 상태(_updateProgress에서 관리); 앞 5개만 사용
    var top5WrongNotes = allWrongNotes.slice(0, 5);

    var extraWidgets = [];
    if (top5WrongNotes.length > 0) {
      // 위젯 HTML 생성
      var widgetHtml = '<div style="font-size:0.88rem">';
      widgetHtml += '<div style="font-weight:600;color:var(--ink2,#444);margin-bottom:8px">자주 틀리는 표현 TOP' + top5WrongNotes.length + '</div>';
      top5WrongNotes.forEach(function (n, i) {
        var activity = _findActivity(n.activity_id);
        var area = activity ? activity.tags.area : n.modality;
        widgetHtml += '<div style="margin-bottom:8px;padding:8px 10px;background:var(--surface2,#f2eee5);border-radius:var(--r,10px);border-left:3px solid var(--hot,#a8301f)">';
        widgetHtml += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
        widgetHtml += '<span style="font-size:var(--fs-xs,11px);padding:1px 7px;border-radius:20px;background:var(--hot-bg,#f9e7e2);color:var(--hot,#a8301f)">' + _esc(area) + '</span>';
        widgetHtml += '</div>';
        widgetHtml += '<div style="color:var(--ink2,#444);font-size:0.82rem;line-height:1.5">' + _esc(n.explanation.slice(0, 120)) + (n.explanation.length > 120 ? '…' : '') + '</div>';
        widgetHtml += '</div>';
      });
      widgetHtml += '</div>';
      extraWidgets.push({
        widget_id: 'english-wrong-notes',
        title:     '자주 틀리는 표현',
        html:      widgetHtml,
        data:      { wrong_notes: top5WrongNotes }
      });
    }

    return {
      plugin_id:    'english',
      by_area:      byArea,
      weakness:     weakness,
      pass_path:    [],
      completion:   completion,
      extra_widgets: extraWidgets
    };
  }

  /* ─────────────────────────────────────────────
     결과 렌더 헬퍼
  ───────────────────────────────────────────── */
  function _renderResult(el, result, activity) {
    if (!el) return;

    var fb      = result.feedback || {};
    var verdict = result.verdict;

    var colorMap = { correct: 'var(--brand,#1f6b4a)', incorrect: 'var(--hot,#a8301f)', pending: 'var(--warn,#9a5a09)' };
    var labelMap = { correct: '정답', incorrect: '오답', pending: '대기 중' };
    var color = colorMap[verdict] || 'var(--ink3,#666)';
    var label = labelMap[verdict] || verdict;

    var html = '<div style="margin-top:4px">';
    html += '<strong style="color:' + color + ';font-size:1.05rem">' + label + '</strong>';

    if (typeof result.score_raw === 'number') {
      html += ' <span style="color:var(--ink3,#666);font-size:0.88rem">(' + Math.round(result.score_raw * 100) + '%)</span>';
    }

    // pending: 키 안내 메시지
    if (verdict === 'pending' && fb.message) {
      html += '<div style="margin-top:6px;padding:8px 12px;background:var(--warn-bg,#fff8e1);border-radius:6px;font-size:0.88rem;color:var(--warn,#b45309)">' + _esc(fb.message) + '</div>';
    }

    // incorrect: accepted 표시 (exact/cloze)
    if (verdict === 'incorrect' && fb.accepted && fb.accepted.length) {
      html += '<div style="margin-top:6px;font-size:0.88rem;color:var(--ink3,#666)">정답: <strong>' + _esc(fb.accepted.join(', ')) + '</strong></div>';
    }

    // keyword: miss 표시
    if (fb.missed && fb.missed.length) {
      html += '<div style="margin-top:6px;font-size:0.88rem;color:var(--ink3,#666)">누락 키워드: ' +
              fb.missed.map(function (g) { return '<em>' + _esc(g.join(' / ')) + '</em>'; }).join(', ') + '</div>';
    }

    // dictation-diff: diff 하이라이트
    if (fb.diff && fb.diff.length) {
      html += '<div style="margin-top:8px;font-size:0.88rem;line-height:1.8">';
      fb.diff.forEach(function (d) {
        if (d.status === 'match') {
          html += '<span style="color:var(--ink,#111)">' + _esc(d.word) + '</span> ';
        } else if (d.status === 'miss') {
          html += '<span style="text-decoration:line-through;color:var(--hot,#a8301f)">' + _esc(d.word) + '</span> ';
        } else { // extra
          html += '<span style="color:var(--warn,#b45309);font-style:italic">' + _esc(d.word) + '</span> ';
        }
      });
      html += '</div>';
      if (typeof fb.correct_words === 'number') {
        html += '<div style="font-size:0.82rem;color:var(--ink3,#666);margin-top:4px">' +
                fb.correct_words + '/' + fb.total_words + ' 단어 일치</div>';
      }
    }

    // 에러 표시
    if (fb.error) {
      html += '<div style="margin-top:6px;font-size:0.85rem;color:var(--hot,#a8301f)">오류: ' + _esc(fb.error) + '</div>';
    }

    // back.explanation 표시 (원칙4: 인출강도 우선)
    // - pending: 항상 숨김
    // - 정답(correct): 즉시 노출 (인출 완료 후 확인이므로 OK)
    // - 오답(incorrect) + listening: 재인출 차단이므로 숨김 (기존 동작 유지)
    // - 오답(incorrect) + vocab/grammar/reading: 즉시 노출 → 재인출 차단.
    //   → "해설 확인" 버튼 클릭 시에만 노출로 변경 (UX 개선)
    var modality = activity && activity.front && activity.front.modality;
    var hasExplanation = verdict !== 'pending' &&
                         activity && activity.back && activity.back.explanation;
    if (hasExplanation) {
      if (verdict === 'correct') {
        // 정답: 즉시 노출
        html += '<div style="margin-top:10px;padding:10px 12px;background:var(--surface2,#f2eee5);border-radius:6px;font-size:0.88rem;color:var(--ink2,#444)">' +
                '<strong>해설:</strong> ' + _esc(activity.back.explanation) + '</div>';
      } else if (verdict === 'incorrect' && modality !== 'listening') {
        // 오답 + 비-listening: 게이팅 — 클릭 시 노출
        var expId = 'eng-expl-' + _esc(activity.activity_id || 'x');
        html += '<div style="margin-top:10px">' +
                '<button type="button" class="eng-expl-toggle"' +
                ' data-expl-id="' + expId + '"' +
                ' style="padding:5px 14px;border-radius:6px;border:1px solid var(--line2,#cfc7b4);background:var(--surface,#fbfaf6);color:var(--ink3,#666);cursor:pointer;font-size:0.83rem">' +
                '해설 확인</button>' +
                '<div id="' + expId + '" style="display:none;margin-top:8px;padding:10px 12px;background:var(--surface2,#f2eee5);border-radius:6px;font-size:0.88rem;color:var(--ink2,#444)">' +
                '<strong>해설:</strong> ' + _esc(activity.back.explanation) + '</div>' +
                '</div>';
      }
      // 오답 + listening: 숨김 (기존 동작 — 재인출 보호)
    }

    html += '</div>';
    el.innerHTML = html;

    // "해설 확인" 버튼 이벤트 바인딩 (innerHTML 갱신 후 DOM 존재 시점에서 처리)
    var explToggle = el.querySelector('.eng-expl-toggle');
    if (explToggle) {
      explToggle.addEventListener('click', function () {
        var targetId = explToggle.getAttribute('data-expl-id');
        var explDiv = el.querySelector('#' + targetId);
        if (!explDiv) return;
        var isHidden = explDiv.style.display === 'none';
        explDiv.style.display = isHidden ? 'block' : 'none';
        explToggle.textContent = isHidden ? '해설 닫기' : '해설 확인';
      });
    }
  }

  /* ─────────────────────────────────────────────
     내부 헬퍼: window.ACTIVITIES['english'] 검색
  ───────────────────────────────────────────── */
  function _findActivity(activityId) {
    var list = (window.ACTIVITIES && window.ACTIVITIES['english']) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].activity_id === activityId) return list[i];
    }
    return null;
  }

  /* ─────────────────────────────────────────────
     PluginInstance 조립
  ───────────────────────────────────────────── */
  var _instance = {
    mount:               mount,
    unmount:             unmount,
    score:               score,
    getProgressSnapshot: getProgressSnapshot,
    onProgressRestored:  onProgressRestored,
    getDashboardContrib: getDashboardContrib
  };

  /* ─────────────────────────────────────────────
     shell.js 등록 규칙 준수 (_registerPlugins 참조)
     plugin_id = "english"
     globalKey  = "_ENGLISH_PLUGIN"
     directKey  = "_ENGLISH_PLUGIN"  (동일)
  ───────────────────────────────────────────── */
  window._ENGLISH_PLUGIN = _instance;

})();
