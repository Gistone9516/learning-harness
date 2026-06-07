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
    mounted:  false,
    host:     null,   // HTMLElement — #plugin-host
    ctx:      null,   // PluginContext
    activity: null,   // 현재 ActivitySpec (lang-task)
    progress: null,   // PluginProgressSnapshot 메모리 캐시
    restored: false,  // onProgressRestored 호출 여부
    currentRecognition: null,  // SpeechRecognition 인스턴스 (speaking)
    activityIndex: 0   // 현재 활성 문제 인덱스
  };

  var PROGRESS_KEY = 'clf:english:progress';

  /* ─────────────────────────────────────────────
     진도 localStorage 헬퍼
  ───────────────────────────────────────────── */
  function _loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _saveProgress(snap) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(snap)); } catch (e) {}
  }

  /* ─────────────────────────────────────────────
     normalize / tokenize (런타임규격 §4-5, §4-6)
  ───────────────────────────────────────────── */
  function normalize(s) {
    if (typeof s !== 'string') return '';
    return s
      .toLowerCase()
      .replace(/[.,!?;:'"()\[\]{}—\-]/g, '')  // 구두점 제거 (em dash 포함)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(s) {
    return normalize(s).split(' ').filter(function (t) { return t.length > 0; });
  }

  /* ─────────────────────────────────────────────
     LCS 길이 계산 (dictation-diff용)
     런타임규격 §4-3: expected_tokens.length ≤ 200
  ───────────────────────────────────────────── */
  function _lcsLength(a, b) {
    var m = a.length, n = b.length;
    // 200단어 상한 방어
    if (m > 200) { throw new Error('dictation-diff: expected 단어 수 200 초과 (' + m + ')'); }
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp.push(new Array(n + 1).fill(0));
    }
    for (var i = 1; i <= m; i++) {
      for (var j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    return dp[m][n];
  }

  /* word-level diff: [{word, status: "match"|"miss"|"extra"}] */
  function _wordDiff(expected, actual) {
    var m = expected.length, n = actual.length;
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
      lcsLen     = _lcsLength(expTokens, actTokens);
      diffDetail = _wordDiff(expTokens, actTokens);
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
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { parsed = { score: 0, feedback: text }; }
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
    var interval = (extra && typeof extra.sm2_interval === 'number') ? extra.sm2_interval : 1;
    var efactor  = (extra && typeof extra.sm2_efactor === 'number')  ? extra.sm2_efactor  : 2.5;

    var q = verdict === 'correct' ? 5 : 1;

    // EF 업데이트: EF' = EF + (0.1 - (5-q)(0.08 + (5-q)*0.02))
    var newEF = efactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (newEF < 1.3) newEF = 1.3;

    var newInterval;
    if (verdict !== 'correct') {
      // 오답: 간격 초기화 (1일)
      newInterval = 1;
    } else {
      // 정답: SM-2 간격 확장
      if (interval <= 1) {
        newInterval = 1;
      } else if (interval <= 6) {
        newInterval = 6;
      } else {
        newInterval = Math.round(interval * newEF);
      }
    }

    // due_at: 지금으로부터 newInterval 일 후 (ms)
    var dueAt = now + newInterval * 24 * 60 * 60 * 1000;

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
    // pending은 시도 횟수 미집계
    if (result.verdict !== 'pending') {
      entry.cold_attempts++;
      if (result.verdict === 'correct') entry.cold_correct++;
    }
    entry.last_verdict = result.verdict;

    // SM-2: vocab/grammar 모달에만 적용 (core ③)
    var sm2Fields = {};
    if ((modality === 'vocab' || modality === 'grammar') && result.verdict !== 'pending') {
      sm2Fields = _sm2Update(entry.plugin_extra, result.verdict);
    } else if (entry.plugin_extra) {
      // 다른 모달은 기존 SM-2 필드 보존
      sm2Fields = {
        sm2_interval: entry.plugin_extra.sm2_interval,
        sm2_efactor:  entry.plugin_extra.sm2_efactor,
        due_at:       entry.plugin_extra.due_at
      };
    }

    entry.plugin_extra = Object.assign(
      {
        modality:    modality,
        last_answer: typeof lastAnswer === 'string' ? lastAnswer : null,
        score_raw:   result.score_raw
      },
      sm2Fields
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
      return '<span style="display:inline-block;padding:3px 9px;font-size:0.78rem;border-radius:12px;background:var(--ok-bg,#e6f4ea);color:var(--ok,#22863a);margin-bottom:8px">' +
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
      btns[i].style.background = isActive ? 'var(--accent,#0550ae)' : 'var(--surface,#fff)';
      btns[i].style.color = isActive ? '#fff' : (done ? 'var(--ok,#22863a)' : 'var(--ink3,#666)');
      btns[i].style.borderColor = isActive ? 'var(--accent,#0550ae)' : (done ? 'var(--ok,#22863a)' : 'var(--line2,#ddd)');
      btns[i].title = done ? '완료 ✓' : '';
    }
    var countEl = container.querySelector('.act-count');
    if (countEl) countEl.textContent = (currentIdx + 1) + ' / ' + activities.length;
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

    if (!activity) {
      contentArea.innerHTML = '<div class="error-banner" style="margin:var(--space-6,24px)">english 플러그인: 문제 데이터가 없습니다.</div>';
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
    html += '<div class="eng-modality-badge" style="display:inline-block;padding:2px 10px;font-size:0.78rem;border-radius:12px;background:var(--accent-bg,#e8f0fe);color:var(--accent,#0550ae);margin-bottom:12px;font-weight:600">' + _esc(modality.toUpperCase()) + '</div>';
    html += '<div class="eng-prompt" style="font-size:var(--fs-lg,1.1rem);font-weight:600;margin-bottom:12px;line-height:1.5">' + _esc(activity.front.prompt) + '</div>';

    // reading: 지문 표시
    if (modality === 'reading' && activity.front.passage) {
      html += '<div class="eng-passage" style="background:var(--surface2,#f6f8fa);border:1px solid var(--line2,#ddd);border-radius:var(--r,6px);padding:14px 16px;margin-bottom:14px;font-size:0.95rem;line-height:1.7;white-space:pre-wrap">' + _esc(activity.front.passage) + '</div>';
    }

    // listening: TTS 재생 버튼 + 받아쓰기 입력
    if (modality === 'listening') {
      if (!ttSupport) {
        html += '<div class="eng-tts-unsupported" style="padding:10px 14px;background:var(--warn-bg,#fff8e1);border-radius:var(--r,6px);color:var(--warn,#b45309);margin-bottom:12px">' +
                '이 브라우저는 TTS(SpeechSynthesis)를 지원하지 않습니다. Chrome/Edge를 사용해 주세요.</div>';
      } else {
        html += '<button type="button" id="eng-tts-btn" class="eng-tts-btn"' +
                ' style="padding:8px 20px;border-radius:6px;border:1px solid var(--line2,#ccc);background:var(--surface,#fff);cursor:pointer;margin-bottom:12px;display:inline-flex;align-items:center;gap:6px">' +
                '<span>&#9654;</span> 듣기</button>';
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
            ' style="padding:9px 24px;border-radius:6px;border:none;background:var(--accent,#0550ae);color:#fff;font-weight:600;cursor:pointer;font-size:var(--fs-md,1rem)">제출·채점</button>';
    html += '</div>';

    // 결과 영역
    html += '<div id="eng-result" class="eng-result" style="min-height:28px;margin-top:14px"></div>';
    html += '</div>';

    contentArea.innerHTML = html;

    // 이전 답안 복원
    if (lastAnswer) {
      var inp = contentArea.querySelector('#eng-answer-input');
      if (inp) inp.value = lastAnswer;
    }

    // TTS 버튼 바인딩 (listening)
    if (modality === 'listening' && ttSupport) {
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
            _speakText(text, { lang: 'en-US', rate: 0.85 }).then(function () {
              ttsBtn.disabled = false;
              ttsBtn.innerHTML = '<span>&#9654;</span> 다시 듣기';
            }).catch(function (e) {
              ttsBtn.disabled = false;
              ttsBtn.innerHTML = '<span>&#9654;</span> 듣기';
              console.warn('[english] TTS 오류:', e);
            });
          }
          if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.onvoiceschanged = function () {
              window.speechSynthesis.onvoiceschanged = null;
              doSpeak();
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
            var transcript  = e.results[0][0].transcript;
            if (ansInput) ansInput.value = transcript;
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
        }).catch(function (e) {
          if (resultEl) resultEl.innerHTML = '<span style="color:var(--hot,#d73a49)">채점 오류: ' + _esc(e.message) + '</span>';
        });
      });
    }

    // nav 배지 업데이트
    _updateNavBadges(container, activities, idx);
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
    // due_at이 작은(더 급한) 항목 먼저. due_at 없는 항목은 맨 뒤.
    var now = Date.now();
    var snap = _state.progress || _loadProgress();
    if (snap) _state.progress = snap;

    var activities = activitiesRaw.slice().sort(function (a, b) {
      var ea = snap && snap.activities && snap.activities[a.activity_id];
      var eb = snap && snap.activities && snap.activities[b.activity_id];
      var da = (ea && ea.plugin_extra && typeof ea.plugin_extra.due_at === 'number') ? ea.plugin_extra.due_at : Infinity;
      var db = (eb && eb.plugin_extra && typeof eb.plugin_extra.due_at === 'number') ? eb.plugin_extra.due_at : Infinity;
      // SM-2 적용 대상(vocab/grammar)만 due_at 정렬; 나머지는 원래 순서 유지 위해 Infinity 처리됨
      return da - db;
    });

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
        _loadEnglishActivity(container, ctx, activities, newIdx);
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
      _state.progress = {
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

    // 마운트 상태에서 복원 시 last_answer 갱신
    if (_state.mounted && _state.host && _state.activity) {
      var actId = _state.activity.activity_id;
      var saved = snapshot.activities && snapshot.activities[actId];
      if (saved && saved.plugin_extra && saved.plugin_extra.last_answer) {
        var contentArea = _state.host.querySelector('#eng-content-area');
        var inp = contentArea ? contentArea.querySelector('#eng-answer-input') : null;
        if (inp) inp.value = saved.plugin_extra.last_answer;
      }
      // nav 배지도 갱신
      var activities = (window.ACTIVITIES && window.ACTIVITIES['english']) || [];
      if (activities.length > 1) {
        _updateNavBadges(_state.host, activities, _state.activityIndex);
      }
    }
  }

  /* ─────────────────────────────────────────────
     getDashboardContrib() (플러그인계약 §3 선택)
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
      if (!activity) return;
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
      if (!activity) return;
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

    return {
      plugin_id:    'english',
      by_area:      byArea,
      weakness:     weakness,
      pass_path:    [],
      completion:   completion,
      extra_widgets: []
    };
  }

  /* ─────────────────────────────────────────────
     결과 렌더 헬퍼
  ───────────────────────────────────────────── */
  function _renderResult(el, result, activity) {
    if (!el) return;

    var fb      = result.feedback || {};
    var verdict = result.verdict;

    var colorMap = { correct: 'var(--ok,#22863a)', incorrect: 'var(--hot,#d73a49)', pending: 'var(--warn,#b45309)' };
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
          html += '<span style="text-decoration:line-through;color:var(--hot,#d73a49)">' + _esc(d.word) + '</span> ';
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
      html += '<div style="margin-top:6px;font-size:0.85rem;color:var(--hot,#d73a49)">오류: ' + _esc(fb.error) + '</div>';
    }

    // back.explanation 표시 (있으면, 정답/오답 시)
    if (verdict !== 'pending' && activity && activity.back && activity.back.explanation) {
      html += '<div style="margin-top:10px;padding:10px 12px;background:var(--surface2,#f6f8fa);border-radius:6px;font-size:0.88rem;color:var(--ink2,#444)">' +
              '<strong>해설:</strong> ' + _esc(activity.back.explanation) + '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
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
