/**
 * app.js — 퀴즈 런타임 엔진 (브라우저 바닐라 JS, 무의존, 정적 file:// 동작)
 *
 * 계약 출처:
 *   엔진규격.md  (§0–§9)
 *   _인터페이스계약.md (§1–§15)
 *   UI규격.md    (§1–§10)
 *
 * 불변:
 *   - 네트워크 호출 0 (fetch 금지)
 *   - 런타임 외부 라이브러리 import 금지
 *   - score()는 정답률/합격확률 산출 안 함
 *   - 박스 이동 = cold 첫시도 정답에만
 *   - 부분점수 없음 (이진 correct/incorrect)
 *   - localStorage 읽기/쓰기: schema_version + 마이그레이션 shim
 */

"use strict";

// ─────────────────────────────────────────────
// §0  전역 상수
// ─────────────────────────────────────────────
const BOX_MIN = 1;
const BOX_MAX = 3;
const BOX_INTERVALS_DAYS = { 1: 1, 2: 3, 3: 7 };
const SCHEMA_VERSION = 1;
const STORAGE_KEY_PREFIX = "clf:";
const MS_PER_DAY = 86400000;
const DDAY_COMPRESS_DAYS = 1;

// ─────────────────────────────────────────────
// §6  에러 클래스
// ─────────────────────────────────────────────
class ScoreInputError extends Error {
  constructor(msg) { super(msg); this.name = "ScoreInputError"; }
}
class SchemaVersionError extends Error {
  constructor(msg) { super(msg); this.name = "SchemaVersionError"; }
}
class StorageQuotaError extends Error {
  constructor(msg) { super(msg); this.name = "StorageQuotaError"; }
}
class ManifestMissingError extends Error {
  constructor(msg) { super(msg); this.name = "ManifestMissingError"; }
}
class DeckNotFoundError extends Error {
  constructor(msg) { super(msg); this.name = "DeckNotFoundError"; }
}

// ─────────────────────────────────────────────
// §3.4  정규화 (normalize)
// ─────────────────────────────────────────────

/**
 * 단일 정규화 규칙 id 적용.
 * synonyms 치환은 lower 직후에 별도 적용 (호출 측에서 시퀀스 관리).
 */
function _applyRule(s, ruleId) {
  switch (ruleId) {
    case "nfkc":
      return s.normalize("NFKC");
    case "trim":
      return s.trim();
    case "collapse_space":
      // 모든 유니코드 공백류(스페이스·탭·개행·전각공백·NBSP 등) → 단일 스페이스
      return s.replace(/[\s　 ﻿]+/gu, " ");
    case "strip_all_space":
      return s.replace(/[\s　 ﻿]+/gu, "");
    case "lower":
      // ASCII 영문 소문자화만 (유니코드 전체 toLowerCase는 의도 밖)
      return s.replace(/[A-Z]/g, c => c.toLowerCase());
    case "fullwidth_to_halfwidth":
      // 전각 ASCII 영숫자·기호 → 반각
      return s.replace(/[！-～]/g, c =>
        String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
      );
    case "unify_cell_dollar":
      // 셀 참조 $ 표기 통일: $A$1 / A$1 / $A1 → A1 ($ 제거)
      return s.replace(/\$/g, "");
    case "unify_arg_sep":
      // 인자 구분자 통일: 세미콜론·전각쉼표 → 쉼표
      return s.replace(/[；;]/g, ",").replace(/，/g, ",");
    case "strip_trailing_paren":
      // 후행 괄호 제거: "함수()" 같은 후행 "()" 또는 "(내용)" 제거
      return s.replace(/\s*\(.*?\)\s*$/, "").trimEnd();
    default:
      // 알 수 없는 규칙 id는 건너뜀 (엔진 무오염 원칙)
      return s;
  }
}

/**
 * synonyms 치환 (lower 직후, 비교 직전).
 * 공백 토큰 분리 → 각 토큰이 synonyms 키(동의어)이면 값(대표어)으로 치환 → 재결합.
 * 토큰 단위 정확일치만 (부분문자열 아님). 다어절 구 치환 = v1 밖.
 *
 * @param {string} s
 * @param {Record<string,string>|undefined} synonyms - 역인덱스 {동의어: 대표어}
 * @returns {string}
 */
function _applySynonyms(s, synonyms) {
  if (!synonyms || typeof synonyms !== "object") return s;
  const tokens = s.split(" ");
  const replaced = tokens.map(tok => {
    const rep = synonyms[tok];
    return rep !== undefined ? rep : tok;
  });
  return replaced.join(" ");
}

/**
 * 정규화 파이프라인 (엔진규격 §3.4, §3.6).
 * rules 배열 순서대로 결정적 적용.
 * synonyms 치환 = lower 직후 삽입.
 *
 * @param {string} s
 * @param {string[]} rules
 * @param {Record<string,string>|undefined} synonyms
 * @returns {string}
 */
function normalize(s, rules, synonyms) {
  if (typeof s !== "string") s = String(s);
  let result = s;
  const rulesArr = Array.isArray(rules) ? rules : [];
  for (let i = 0; i < rulesArr.length; i++) {
    const ruleId = rulesArr[i];
    result = _applyRule(result, ruleId);
    // lower 직후에 synonyms 치환 삽입 (§3.4, §8 SoT)
    if (ruleId === "lower") {
      result = _applySynonyms(result, synonyms);
    }
  }
  // lower 규칙이 없는 경우엔 synonyms 치환 없음 (계약대로)
  return result;
}

// ─────────────────────────────────────────────
// §3  채점코어 (score)
// ─────────────────────────────────────────────

/**
 * weight 정상화 (엔진규격 §2.3).
 * @param {*} w
 * @returns {number}
 */
function _normalizeWeight(w) {
  if (typeof w !== "number" || isNaN(w)) return 5;
  return Math.max(1, Math.min(10, w));
}

/**
 * ScoreInput 유효성 검사 + 채점.
 *
 * @param {{
 *   mode: string,
 *   userAnswer: string|string[]|"correct"|"incorrect",
 *   answerSpec: object,
 *   synonyms?: Record<string,string>
 * }} input
 * @returns {{
 *   verdict: "correct"|"incorrect",
 *   matched: string[],
 *   missed: string[],
 *   normalizedUser: string|string[],
 *   feedback: {highlightMissed: string[]}
 * }}
 */
function score(input) {
  const { mode, userAnswer, answerSpec, synonyms } = input;

  // grade_mode 검증
  const validModes = ["exact", "keyword", "cloze", "self"];
  if (!validModes.includes(mode)) {
    throw new ScoreInputError(`알 수 없는 grade_mode: ${mode}`);
  }

  // answerSpec.normalize
  const normalizeRules = (answerSpec && Array.isArray(answerSpec.normalize))
    ? answerSpec.normalize
    : [];

  // 정규화 헬퍼 (양변 동일 적용)
  const norm = s => normalize(s, normalizeRules, synonyms);

  // ── self 모드 ──
  if (mode === "self") {
    if (userAnswer !== "correct" && userAnswer !== "incorrect") {
      throw new ScoreInputError(
        `self 모드 userAnswer는 "correct"|"incorrect"만 허용. 받은 값: ${userAnswer}`
      );
    }
    return {
      verdict: userAnswer,
      matched: [],
      missed: [],
      normalizedUser: userAnswer,
      feedback: { highlightMissed: [] }
    };
  }

  // ── exact 모드 ──
  if (mode === "exact") {
    // recall_seq: answerSpec.sequence 기반 순서 채점 (엔진규격 §3.3, SoT §9)
    // 카드규격 §10: recall_seq grade() 입력 = string[] (UI 레이어 소유)
    if (answerSpec && Array.isArray(answerSpec.sequence)) {
      // userAnswer = string[] (UI가 멀티입력 칸에서 수집한 배열)
      // 하위호환: string 단일값이 들어오면 "," 분리로 처리
      let userSteps;
      if (Array.isArray(userAnswer)) {
        userSteps = userAnswer.map(s => norm(s));
      } else if (typeof userAnswer === "string") {
        userSteps = userAnswer.split(",").map(s => norm(s.trim()));
      } else {
        throw new ScoreInputError(`recall_seq exact 모드 userAnswer는 string[] 또는 string이어야 함`);
      }
      const seqSteps = answerSpec.sequence.map(s => norm(s));
      if (userSteps.length !== seqSteps.length) {
        return {
          verdict: "incorrect",
          matched: [],
          missed: seqSteps,
          normalizedUser: userSteps,
          feedback: { highlightMissed: seqSteps }
        };
      }
      const allMatch = userSteps.every((u, i) => u === seqSteps[i]);
      return {
        verdict: allMatch ? "correct" : "incorrect",
        matched: allMatch ? seqSteps : [],
        missed: allMatch ? [] : seqSteps,
        normalizedUser: userSteps,
        feedback: { highlightMissed: allMatch ? [] : seqSteps }
      };
    }
    // 일반 exact: string 단일값
    if (typeof userAnswer !== "string") {
      throw new ScoreInputError(`exact 모드 userAnswer는 string이어야 함`);
    }
    const normUser = norm(userAnswer);
    const accepted = (answerSpec && Array.isArray(answerSpec.accepted))
      ? answerSpec.accepted
      : [];
    const normAccepted = accepted.map(a => norm(a));
    const matchedAns = normAccepted.find(a => a === normUser);
    const isCorrect = matchedAns !== undefined;
    return {
      verdict: isCorrect ? "correct" : "incorrect",
      matched: isCorrect ? [matchedAns] : [],
      missed: [],
      normalizedUser: normUser,
      feedback: { highlightMissed: [] }
    };
  }

  // ── keyword 모드 ──
  if (mode === "keyword") {
    if (typeof userAnswer !== "string") {
      throw new ScoreInputError(`keyword 모드 userAnswer는 string이어야 함`);
    }
    const normUser = norm(userAnswer);
    // requiredKeywords: string[][] — 내부배열 = 한 필수그룹의 동의어 후보(any-of), 모든 그룹 필수
    const requiredKeywords = (answerSpec && Array.isArray(answerSpec.requiredKeywords))
      ? answerSpec.requiredKeywords
      : [];

    const matched = [];
    const missed = [];
    for (const group of requiredKeywords) {
      // 그룹은 동의어 후보 배열(any-of)
      const normGroup = Array.isArray(group) ? group.map(k => norm(k)) : [];
      const hit = normGroup.find(k => normUser.includes(k));
      if (hit !== undefined) {
        matched.push(hit);
      } else {
        // 피드백용으로 그룹의 첫 번째 후보(대표) 기록
        missed.push(normGroup[0] || "");
      }
    }
    const isCorrect = missed.length === 0 && requiredKeywords.length > 0;
    return {
      verdict: isCorrect ? "correct" : "incorrect",
      matched,
      missed,
      normalizedUser: normUser,
      feedback: { highlightMissed: missed }
    };
  }

  // ── cloze 모드 ──
  if (mode === "cloze") {
    if (!Array.isArray(userAnswer)) {
      throw new ScoreInputError(`cloze 모드 userAnswer는 string[]이어야 함`);
    }
    const blanks = (answerSpec && Array.isArray(answerSpec.blanks))
      ? answerSpec.blanks
      : [];
    if (userAnswer.length !== blanks.length) {
      throw new ScoreInputError(
        `cloze 빈칸 수 불일치: 입력 ${userAnswer.length}개, 정답 ${blanks.length}개`
      );
    }
    const normUser = userAnswer.map(u => norm(u));
    const matched = [];
    const missed = [];
    for (let i = 0; i < blanks.length; i++) {
      const candidates = Array.isArray(blanks[i]) ? blanks[i].map(c => norm(c)) : [];
      const userVal = normUser[i];
      // 빈 입력은 candidates에 ""가 명시되지 않는 한 불일치
      const hit = candidates.find(c => c === userVal);
      if (hit !== undefined) {
        matched.push(String(i));
      } else {
        missed.push(String(i));
      }
    }
    const isCorrect = missed.length === 0 && blanks.length > 0;
    return {
      verdict: isCorrect ? "correct" : "incorrect",
      matched,
      missed,
      normalizedUser: normUser,
      feedback: { highlightMissed: missed }
    };
  }

  // 도달 불가 (validModes 검사 위에서 처리됨)
  throw new ScoreInputError(`처리할 수 없는 mode: ${mode}`);
}

// ─────────────────────────────────────────────
// §1  Leitner 코어
// ─────────────────────────────────────────────

/**
 * 박스 간격 해소.
 * @param {number} box
 * @param {{intervals_days?: Record<number,number>}|undefined} leitnerCfg
 * @returns {number} 일수
 */
function _getInterval(box, leitnerCfg) {
  const intervals = (leitnerCfg && leitnerCfg.intervals_days)
    ? leitnerCfg.intervals_days
    : BOX_INTERVALS_DAYS;
  return intervals[box] !== undefined ? intervals[box] : BOX_INTERVALS_DAYS[box] || 1;
}

/**
 * due_at 계산.
 * @param {number} box
 * @param {number} now
 * @param {object|undefined} leitnerCfg
 * @returns {number} epoch ms
 */
function nextDueAt(box, now, leitnerCfg) {
  return now + _getInterval(box, leitnerCfg) * MS_PER_DAY;
}

/**
 * due 판정 (경계 포함, >=).
 * @param {{due_at: number}} state
 * @param {number} now
 * @returns {boolean}
 */
function isDue(state, now) {
  return now >= state.due_at;
}

/**
 * Leitner 전이 (순수함수, 부수효과 없음).
 * 엔진규격 §1.3 전이표 전체 구현.
 *
 * @param {object} state - CardProgress
 * @param {"cold"|"warm"} attemptKind
 * @param {"correct"|"incorrect"|"skip"} verdict
 * @param {number} now - epoch ms
 * @param {object|undefined} leitnerCfg
 * @param {boolean} dDayMode - D-day 간격압축 (§2.4)
 * @returns {object} 새 CardProgress (불변 복사)
 */
function leitnerTransition(state, attemptKind, verdict, now, leitnerCfg, dDayMode) {
  const s = Object.assign({}, state);

  // cold_attempts 누적 (correct/incorrect/skip 모두, cold 시에만)
  if (attemptKind === "cold") {
    s.cold_attempts = (s.cold_attempts || 0) + 1;
    if (verdict === "correct") {
      s.cold_correct = (s.cold_correct || 0) + 1;
    }
  }

  s.last_attempt_at = now;
  s.last_verdict = verdict;

  // warm: 박스/due 변화 없음 (§1.3)
  if (attemptKind === "warm") {
    return s;
  }

  // skip: 박스/due 변화 없음 (§1.3)
  if (verdict === "skip") {
    return s;
  }

  // cold + correct
  if (verdict === "correct") {
    const newBox = Math.min(s.box + 1, BOX_MAX);
    // 졸업 조건: 이전 box == BOX_MAX (이미 BOX_MAX였고 cold 정답)
    if (s.box === BOX_MAX) {
      s.graduated = true;
    }
    s.box = newBox;
    // D-day 간격 압축
    const rawInterval = _getInterval(newBox, leitnerCfg);
    const ddayCompress = (leitnerCfg && leitnerCfg.dday_compress_days !== undefined)
      ? leitnerCfg.dday_compress_days
      : DDAY_COMPRESS_DAYS;
    const interval = dDayMode ? Math.min(rawInterval, ddayCompress) : rawInterval;
    s.due_at = now + interval * MS_PER_DAY;
    return s;
  }

  // cold + incorrect
  if (verdict === "incorrect") {
    s.box = BOX_MIN;
    s.graduated = false;
    s.due_at = nextDueAt(BOX_MIN, now, leitnerCfg);
    return s;
  }

  return s;
}

// ─────────────────────────────────────────────
// §4  localStorage 스키마 + 마이그레이션
// ─────────────────────────────────────────────

/**
 * 기본 CardProgress 생성 (§4.2).
 * @param {string} card_id
 * @returns {object}
 */
function _defaultCardProgress(card_id) {
  return {
    card_id,
    box: BOX_MIN,
    due_at: 0,
    graduated: false,
    cold_attempts: 0,
    cold_correct: 0,
    last_attempt_at: null,
    last_verdict: null
  };
}

/**
 * 빈 ProgressStore 반환.
 * @param {string} deckNamespace
 * @returns {object}
 */
function _emptyProgressStore(deckNamespace) {
  return {
    schema_version: SCHEMA_VERSION,
    deck_namespace: deckNamespace,
    cards: {}
  };
}

/**
 * v0 → v1 마이그레이션 (항등에 가까우나 shim 구조 확보).
 * @param {object} raw
 * @param {string} deckNamespace
 * @returns {object}
 */
function _migrate_v0_to_v1(raw, deckNamespace) {
  const store = {
    schema_version: 1,
    deck_namespace: raw.deck_namespace || deckNamespace,
    cards: {}
  };
  const rawCards = raw.cards || {};
  for (const [cid, cp] of Object.entries(rawCards)) {
    store.cards[cid] = Object.assign(_defaultCardProgress(cid), cp);
  }
  return store;
}

/**
 * 마이그레이션 체인: v(n) → v(n+1) → … → SCHEMA_VERSION.
 * @param {object} raw
 * @param {string} deckNamespace
 * @returns {object}
 */
function migrate(raw, deckNamespace) {
  let current = raw;
  let ver = typeof current.schema_version === "number" ? current.schema_version : 0;
  while (ver < SCHEMA_VERSION) {
    if (ver === 0) {
      current = _migrate_v0_to_v1(current, deckNamespace);
      ver = 1;
    } else {
      // 미래 버전 단계 자리
      break;
    }
  }
  return current;
}

/**
 * deckNamespace에 콜론이 있으면 ScoreInputError (§4.1 키 네임스페이스 제약).
 * @param {string} ns
 */
function _validateNamespace(ns) {
  if (typeof ns !== "string" || ns.includes(":")) {
    throw new ScoreInputError(
      `deckNamespace에 콜론 포함 불가: "${ns}"`
    );
  }
}

/**
 * localStorage에서 ProgressStore 로드.
 * §4.3 마이그레이션 shim 완전 구현.
 *
 * @param {string} deckNamespace
 * @returns {object} ProgressStore
 */
function loadProgress(deckNamespace) {
  _validateNamespace(deckNamespace);
  const key = STORAGE_KEY_PREFIX + deckNamespace + ":progress";
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return _emptyProgressStore(deckNamespace);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // JSON parse 실패 → 폴백 + 백업 + 경고
    console.warn(`[clf] ProgressStore parse 실패 (${deckNamespace}):`, e);
    try {
      localStorage.setItem(key + ".bak", raw);
    } catch (_) { /* 백업 실패는 무시 */ }
    return _emptyProgressStore(deckNamespace);
  }

  // schema_version 없으면 v0으로 간주
  if (typeof parsed.schema_version !== "number") {
    parsed.schema_version = 0;
  }

  if (parsed.schema_version > SCHEMA_VERSION) {
    throw new SchemaVersionError(
      `저장된 스키마 버전(${parsed.schema_version})이 코드 버전(${SCHEMA_VERSION})보다 높습니다 (다운그레이드 금지).`
    );
  }

  if (parsed.schema_version < SCHEMA_VERSION) {
    let migrated;
    try {
      migrated = migrate(parsed, deckNamespace);
    } catch (e) {
      console.warn(`[clf] 마이그레이션 실패 (${deckNamespace}):`, e);
      try {
        localStorage.setItem(key + ".bak", raw);
      } catch (_) { /* 무시 */ }
      return _emptyProgressStore(deckNamespace);
    }
    return migrated;
  }

  // schema_version == SCHEMA_VERSION
  // cards 내 누락 필드 보충
  const cards = parsed.cards || {};
  for (const [cid, cp] of Object.entries(cards)) {
    parsed.cards[cid] = Object.assign(_defaultCardProgress(cid), cp);
  }
  return parsed;
}

/**
 * ProgressStore를 localStorage에 저장.
 * schema_version = SCHEMA_VERSION 강제 (§4.3).
 *
 * @param {object} store - ProgressStore
 */
function saveProgress(store) {
  _validateNamespace(store.deck_namespace);
  const key = STORAGE_KEY_PREFIX + store.deck_namespace + ":progress";
  store.schema_version = SCHEMA_VERSION;
  const json = JSON.stringify(store);
  try {
    localStorage.setItem(key, json);
  } catch (e) {
    if (e.name === "QuotaExceededError" || (e instanceof DOMException && e.code === 22)) {
      throw new StorageQuotaError("localStorage 저장 공간 초과. 데이터를 export/백업하세요.");
    }
    throw e;
  }
}

// ─────────────────────────────────────────────
// §5  deck 네임스페이스 + manifest 로딩
// ─────────────────────────────────────────────

/**
 * 전역 manifest 반환.
 * SoT §16: window.MANIFEST[subject] = { ..., decks: deck_id[] }
 *
 * @param {string} subject - subject id (예: "comp1")
 * @returns {{ decks: string[], [key: string]: any }}
 */
function getManifest(subject) {
  const reg = (typeof window !== "undefined" && window.MANIFEST);
  if (!reg || !reg[subject]) {
    throw new ManifestMissingError(
      `전역 manifest(window.MANIFEST["${subject}"])가 없습니다. manifest.js를 먼저 로드하세요.`
    );
  }
  return reg[subject];
}

/**
 * 전역 deck 레지스트리에서 DeckData 반환.
 * SoT §16: window.DECKS[deck_id] = { meta, cards }
 *
 * @param {string} deck_id
 * @returns {{ meta: object, cards: object[] }}
 */
function loadDeck(deck_id) {
  const reg = (typeof window !== "undefined" && window.DECKS);
  if (!reg || !reg[deck_id]) {
    throw new DeckNotFoundError(`deck "${deck_id}"를 찾을 수 없습니다. (window.DECKS["${deck_id}"])`);
  }
  return reg[deck_id];
}

/**
 * 활성 deck 전환 (무로드, 전역 등록된 deck만).
 * @param {string} deck_id
 */
function switchDeck(deck_id) {
  // 존재 확인만 (throw 전파)
  loadDeck(deck_id);
  if (typeof window !== "undefined") {
    window.__CLF_ACTIVE_DECK__ = deck_id;
  }
}

// ─────────────────────────────────────────────
// §2  출제큐 (buildQueue)
// ─────────────────────────────────────────────

/**
 * 출제큐 구성 (엔진규격 §2.1–§2.5).
 *
 * @param {object[]} cards - CardDef[]
 * @param {Record<string,object>} progress - card_id → CardProgress
 * @param {number} now - epoch ms
 * @param {{
 *   dDayMode: boolean,
 *   newCardLimit?: number,
 *   reviewLimit?: number,
 *   deckNamespace: string,
 *   leitnerCfg?: object
 * }} opts
 * @returns {string[]} card_id 배열 (출제 순서)
 */
function buildQueue(cards, progress, now, opts) {
  const dDayMode = !!opts.dDayMode;

  // enabled == true 카드만 대상
  const enabledCards = cards.filter(c => c.enabled !== false);

  const newCards = [];
  const reviewCards = [];
  const futureCards = []; // D-day 모드에서 사용

  for (const card of enabledCards) {
    const prog = progress[card.card_id];
    const coldAttempts = prog ? prog.cold_attempts : 0;

    if (coldAttempts === 0) {
      // new: 한 번도 cold 시도 없음
      newCards.push(card);
    } else {
      // 학습이력 있음
      const state = prog;
      if (dDayMode) {
        // D-day: 전박스 강제소환 (due 무시)
        futureCards.push(card);
      } else if (isDue(state, now)) {
        reviewCards.push(card);
      }
      // else: due 아님 → 큐 제외
    }
  }

  // weight 정상화 헬퍼
  const w = card => _normalizeWeight(card.tags && card.tags.weight !== undefined ? card.tags.weight : 5);

  // F-09: 공통 비교자 (weight DESC → card_id ASC)
  const byWeightId = (a, b) => {
    const wDiff = w(b) - w(a);
    if (wDiff !== 0) return wDiff;
    return a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0;
  };

  // ── 정렬 ──
  if (dDayMode) {
    // D-day: box ASC → weight DESC → card_id ASC
    const allDDay = [...futureCards, ...newCards];
    allDDay.sort((a, b) => {
      const boxA = (progress[a.card_id] ? progress[a.card_id].box : BOX_MIN);
      const boxB = (progress[b.card_id] ? progress[b.card_id].box : BOX_MIN);
      if (boxA !== boxB) return boxA - boxB;
      return byWeightId(a, b);
    });
    return allDDay.map(c => c.card_id);
  }

  // 일반: review weight DESC → card_id ASC
  reviewCards.sort(byWeightId);
  // new weight DESC → card_id ASC
  newCards.sort(byWeightId);

  // limit 적용: 정렬 후 그룹별 상한 자르기 (§2.5)
  const reviewLimited = opts.reviewLimit !== undefined
    ? reviewCards.slice(0, opts.reviewLimit)
    : reviewCards;
  const newLimited = opts.newCardLimit !== undefined
    ? newCards.slice(0, opts.newCardLimit)
    : newCards;

  // review 먼저 (due-first, §2.2)
  return [...reviewLimited, ...newLimited].map(c => c.card_id);
}

// ─────────────────────────────────────────────
// §7  대시보드 집계 (getDashboardData)
// ─────────────────────────────────────────────

// pass_path target 상수 (§3.6, SoT _인터페이스계약.md §15)
const PASS_TARGET = {
  written: 40,
  practical: 70
};

/**
 * (area, subarea) 쌍을 문자열 키로.
 * @param {string} area
 * @param {string} subarea
 * @returns {string}
 */
function _areaKey(area, subarea) {
  return area + "|" + subarea;
}

/**
 * 대시보드 집계 (순수함수, 부수효과 없음).
 * 엔진규격 §7, _인터페이스계약.md §15.
 *
 * @param {{namespace:string, cards:object[]}} deck - DeckData
 * @param {{schema_version:number, deck_namespace:string, cards:Record<string,object>}} progress - ProgressStore
 * @param {number} now - epoch ms
 * @returns {{
 *   by_area: object[],
 *   weakness: object[],
 *   pass_path: object[],
 *   completion: object[]
 * }}
 */
function getDashboardData(deck, progress, now) {
  // enabled == true 카드만 집계
  const enabledCards = deck.cards.filter(c => c.enabled !== false);
  const progCards = progress.cards || {};

  // (area, subarea) 쌍 집합 수집
  // by_area / pass_path / completion: area AND subarea 모두 있는 카드만
  const areaMap = new Map(); // key → {area, subarea, cards:[]}

  // weakness: unit 기준, area/subarea 모두 없는 카드는 제외
  const unitMap = new Map(); // key → {area, subarea, unit, coldAttempts, coldErrors}

  for (const card of enabledCards) {
    const area = card.tags && card.tags.area;
    const subarea = card.tags && card.tags.subarea;
    const unit = card.unit;
    const prog = progCards[card.card_id];
    const coldAttempts = prog ? prog.cold_attempts : 0;
    const coldCorrect = prog ? prog.cold_correct : 0;

    // area + subarea 있는 카드: by_area / pass_path / completion 집계
    if (area && subarea) {
      const key = _areaKey(area, subarea);
      if (!areaMap.has(key)) {
        areaMap.set(key, {
          area, subarea,
          total: 0,
          coldAttempts: 0,
          coldCorrect: 0,
          attempted: 0, // cold_attempts >= 1 카드 수
          attemptsCorrect: 0, // attempted 중 cold_correct >= 1 카드 수 (mastery용)
          boxDist: { box1: 0, box2: 0, box3: 0 }
        });
      }
      const entry = areaMap.get(key);
      entry.total++;
      entry.coldAttempts += coldAttempts;
      entry.coldCorrect += coldCorrect;
      if (coldAttempts >= 1) {
        entry.attempted++;
      }

      // mastery 계산용: cold_attempts>=1인 카드 중 cold_correct수 합산
      // (mastery = cold_correct / cold_attempts>=1인 카드수, 엔진규격 §7.2 ③)
      // 정확히는 "cold_attempts>=1인 카드 수" 분모, 분자는 그 카드들의 cold_correct 합산
      // → attemptsCorrect 에 cold_correct 누적
      if (coldAttempts >= 1) {
        entry.attemptsCorrect += coldCorrect;
      }

      // box 분포 (progress 미존재 = box1)
      const box = prog ? prog.box : BOX_MIN;
      // graduated → box3으로 집계
      const effectiveBox = (prog && prog.graduated) ? BOX_MAX : box;
      if (effectiveBox <= 1) entry.boxDist.box1++;
      else if (effectiveBox === 2) entry.boxDist.box2++;
      else entry.boxDist.box3++;
    }

    // weakness: area + subarea 모두 있는 카드만 (§7.3)
    if (area && subarea && unit) {
      const key = _areaKey(area, subarea) + "|" + unit;
      if (!unitMap.has(key)) {
        unitMap.set(key, { area, subarea, unit, coldAttempts: 0, coldErrors: 0 });
      }
      const ue = unitMap.get(key);
      ue.coldAttempts += coldAttempts;
      ue.coldErrors += Math.max(0, coldAttempts - coldCorrect);
    }
  }

  // ── by_area 집계 ──
  const by_area = [];
  for (const [, e] of areaMap) {
    by_area.push({
      area: e.area,
      subarea: e.subarea,
      retrieval_rate: e.coldAttempts === 0 ? null : e.coldCorrect / e.coldAttempts
    });
  }

  // ── weakness 집계 ──
  const weakness = [];
  for (const [, ue] of unitMap) {
    if (ue.coldAttempts === 0) continue; // cold_attempts==0 단원 제외
    weakness.push({
      area: ue.area,
      subarea: ue.subarea,
      unit: ue.unit,
      wrong_rate: ue.coldErrors / ue.coldAttempts
    });
  }
  // wrong_rate DESC → unit ASC (결정성)
  weakness.sort((a, b) => {
    if (b.wrong_rate !== a.wrong_rate) return b.wrong_rate - a.wrong_rate;
    return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0;
  });

  // ── pass_path 집계 ──
  const pass_path = [];
  for (const [, e] of areaMap) {
    const target = PASS_TARGET[e.area] || 40;
    const coverage = e.total === 0 ? 0 : e.attempted / e.total;
    // mastery = cold_correct 합산 / cold_attempts>=1 카드 수 (§7.2 ③)
    const mastery = e.attempted === 0 ? 0 : e.attemptsCorrect / e.attempted;
    const prog = coverage * mastery;
    const t = target / 100;
    let status;
    if (prog >= t) status = "safe";
    else if (prog >= t * 0.7) status = "watch";
    else status = "danger";

    pass_path.push({
      area: e.area,
      subarea: e.subarea,
      target,
      coverage,
      mastery,
      progress: prog,
      status
    });
  }

  // ── completion 집계 ──
  const completion = [];
  for (const [, e] of areaMap) {
    const total = e.total;
    const mastery_rate = total === 0 ? 0 : e.boxDist.box3 / total;
    completion.push({
      area: e.area,
      subarea: e.subarea,
      box_dist: { box1: e.boxDist.box1, box2: e.boxDist.box2, box3: e.boxDist.box3 },
      mastery_rate
    });
  }

  return { by_area, weakness, pass_path, completion };
}

// ─────────────────────────────────────────────
// 세션 상태 (메모리 휘발, 새로고침 시 리셋)
// ─────────────────────────────────────────────

/**
 * 세션 상태 팩토리.
 * seen_card_ids: Set<card_id> — cold/warm 판정용.
 * queue: card_id[] — 현 세션 출제큐.
 * requeue: card_id[] — 세션내 재큐(오답/skip 카드).
 * dDayMode: boolean
 */
function _createSession(deckNamespace) {
  return {
    deckNamespace,
    seen_card_ids: new Set(),
    queue: [],
    requeue: [],    // 재큐(다시 맞출 때까지 유지)
    dDayMode: false,
    currentCardId: null
  };
}

// ─────────────────────────────────────────────
// getNextCard (UI규격 §8 반환 계약)
// ─────────────────────────────────────────────

/**
 * 현재 활성 deck + 세션에서 다음 카드를 반환.
 * 세션내 재큐(오답/skip)를 소진한 뒤 메인큐로 진행.
 * due 카드 없음 + requeue 없음 → null.
 *
 * @param {object} session
 * @param {object[]} cards - CardDef[]
 * @param {object} progressStore - ProgressStore
 * @param {number} now
 * @returns {object|null} CardDef 형태 (UI규격 §8 getNextCard() 형상) | null
 */
function getNextCard(session, cards, progressStore, now) {
  // 재큐 먼저 소진 (세션내 재출제)
  while (session.requeue.length > 0) {
    const cid = session.requeue[0];
    const card = cards.find(c => c.card_id === cid);
    if (card && card.enabled !== false) {
      session.currentCardId = cid;
      return card;
    }
    session.requeue.shift(); // 유효하지 않으면 제거
  }

  // 메인큐에서 다음 카드
  while (session.queue.length > 0) {
    const cid = session.queue.shift();
    const card = cards.find(c => c.card_id === cid);
    if (card && card.enabled !== false) {
      session.currentCardId = cid;
      return card;
    }
  }

  session.currentCardId = null;
  return null;
}

// ─────────────────────────────────────────────
// 시도 처리 (attempt)
// ─────────────────────────────────────────────

/**
 * 카드 응답 처리.
 * cold/warm 분류 → Leitner 전이 → 진도 저장 → 세션내 재큐 관리.
 *
 * @param {string} card_id
 * @param {"correct"|"incorrect"|"skip"} verdict
 * @param {object} session
 * @param {object} progressStore
 * @param {number} now
 * @param {object|undefined} leitnerCfg
 */
function processAttempt(card_id, verdict, session, progressStore, now, leitnerCfg) {
  // cold/warm 판정 (§1.2)
  const isCold = !session.seen_card_ids.has(card_id);
  const attemptKind = isCold ? "cold" : "warm";
  session.seen_card_ids.add(card_id);

  // 현재 CardProgress 취득 (없으면 기본값)
  const existing = progressStore.cards[card_id] || _defaultCardProgress(card_id);

  // Leitner 전이 (순수함수)
  const newState = leitnerTransition(
    existing,
    attemptKind,
    verdict,
    now,
    leitnerCfg,
    session.dDayMode
  );
  progressStore.cards[card_id] = newState;

  // 세션내 재큐 관리 (§1.2, v4 §3)
  // incorrect 또는 skip: 재큐에 추가 (다시 맞출 때까지)
  // correct: 재큐에서 제거
  if (verdict === "incorrect" || verdict === "skip") {
    if (!session.requeue.includes(card_id)) {
      session.requeue.push(card_id);
    }
  } else if (verdict === "correct") {
    const idx = session.requeue.indexOf(card_id);
    if (idx !== -1) session.requeue.splice(idx, 1);
    // 재큐에서 제거 후 맞은 카드는 더 이상 이 세션에서 재출제 안 됨
  }
}

// ─────────────────────────────────────────────
// 앱 세션 초기화
// ─────────────────────────────────────────────

/**
 * 세션 큐 초기화 (buildQueue 호출 + 세션 초기화).
 * SoT §16: deck_id = window.MANIFEST[subject].decks 목록 중 하나.
 *
 * @param {string} deck_id - window.DECKS의 키
 * @param {{
 *   dDayMode?: boolean,
 *   newCardLimit?: number,
 *   reviewLimit?: number,
 *   leitnerCfg?: object
 * }} opts
 * @param {number} now
 * @returns {{session: object, progressStore: object, deck: object, queue: string[], isEmpty: boolean}}
 */
function initSession(deck_id, opts, now) {
  const deck = loadDeck(deck_id);
  const progressStore = loadProgress(deck_id);
  const session = _createSession(deck_id);
  session.dDayMode = !!(opts && opts.dDayMode);

  const queueOpts = {
    dDayMode: session.dDayMode,
    newCardLimit: opts && opts.newCardLimit,
    reviewLimit: opts && opts.reviewLimit,
    deckNamespace: deck_id,
    leitnerCfg: opts && opts.leitnerCfg
  };

  const queue = buildQueue(deck.cards, progressStore.cards, now, queueOpts);
  session.queue = queue;

  return {
    session,
    progressStore,
    deck,
    queue,
    isEmpty: queue.length === 0
  };
}

// ─────────────────────────────────────────────
// 전역 공개 인터페이스 (window.__CLF__)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// §7.1  공용 순수 헬퍼 (플러그인 공통 — DEFER-C)
// ─────────────────────────────────────────────

/**
 * HTML 이스케이프 (coding/excel/english/aws 공통).
 * @param {*} s
 * @returns {string}
 */
function _clfEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * localStorage에서 JSON 로드 (플러그인 진도 공용).
 * @param {string} key  localStorage 키 (예: 'clf:coding:progress')
 * @returns {object|null}
 */
function _clfLoadPersist(key) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/**
 * localStorage에 JSON 저장 (플러그인 진도 공용).
 * @param {string} key  localStorage 키
 * @param {*}      val  직렬화할 값
 */
function _clfSavePersist(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

/**
 * activities 배열에서 activity_id로 검색 (플러그인 공용).
 * @param {object[]} list  ActivitySpec 배열
 * @param {string}   activityId
 * @returns {object|null}
 */
function _clfFindActivity(list, activityId) {
  if (!Array.isArray(list)) return null;
  for (var _i = 0; _i < list.length; _i++) {
    if (list[_i].activity_id === activityId) return list[_i];
  }
  return null;
}

if (typeof window !== "undefined") {
  window.__CLF__ = {
    // 상수
    BOX_MIN,
    BOX_MAX,
    BOX_INTERVALS_DAYS,
    SCHEMA_VERSION,
    STORAGE_KEY_PREFIX,
    MS_PER_DAY,
    DDAY_COMPRESS_DAYS,

    // 에러 클래스
    ScoreInputError,
    SchemaVersionError,
    StorageQuotaError,
    ManifestMissingError,
    DeckNotFoundError,

    // 정규화
    normalize,

    // 채점코어
    score,

    // Leitner
    leitnerTransition,
    nextDueAt,
    isDue,

    // localStorage
    loadProgress,
    saveProgress,
    migrate,

    // deck 로딩
    getManifest,
    loadDeck,
    switchDeck,

    // 출제큐
    buildQueue,

    // 대시보드
    getDashboardData,

    // 세션
    initSession,
    getNextCard,
    processAttempt,

    // 공용 순수 헬퍼 (DEFER-C §7.1)
    esc:          _clfEsc,
    loadPersist:  _clfLoadPersist,
    savePersist:  _clfSavePersist,
    findActivity: _clfFindActivity,
  };
}

// ─────────────────────────────────────────────
// 부트 진입점 (SoT §16)
// window.APP = { init, ... }
// index.html이 [synonyms→manifest→decks→app.js] 로드 후 window.APP.init() 호출.
// ─────────────────────────────────────────────

/**
 * 앱 부트스트랩.
 * 1. window.MANIFEST["comp1"].decks 에서 deck_id 목록 취득.
 * 2. 각 deck_id 에 대해 window.DECKS[deck_id] 존재 확인.
 * 3. 첫 번째 deck_id로 세션 초기화 + 첫 카드 출제 준비.
 * 4. window.SYNONYMS["comp1"] 가져와 채점에 공급.
 *
 * @param {{
 *   subject?: string,       기본 "comp1"
 *   dDayMode?: boolean,
 *   newCardLimit?: number,
 *   reviewLimit?: number,
 *   leitnerCfg?: object,
 *   onCard?: function(card: object, session: object, progressStore: object): void,
 *   onEmpty?: function(): void,
 *   onError?: function(err: Error): void
 * }} opts
 * @returns {{ session: object, progressStore: object, deck: object, queue: string[], isEmpty: boolean }|null}
 */
function init(opts) {
  opts = opts || {};
  const subject = opts.subject || "comp1";

  let manifest;
  try {
    manifest = getManifest(subject);
  } catch (e) {
    if (opts.onError) { opts.onError(e); } else { console.error("[APP.init]", e); }
    return null;
  }

  const deckIds = Array.isArray(manifest.decks) ? manifest.decks : [];
  if (deckIds.length === 0) {
    const err = new ManifestMissingError(
      `window.MANIFEST["${subject}"].decks 배열이 비어 있습니다.`
    );
    if (opts.onError) { opts.onError(err); } else { console.error("[APP.init]", err); }
    return null;
  }

  // 첫 번째 deck으로 세션 초기화 (다중 deck 지원은 v1 밖)
  // SoT §16: manifest.decks = 객체배열 {deck_id, title, ...}. 문자열 배열도 허용(하위호환).
  const _d0 = deckIds[0];
  const deck_id = (typeof _d0 === "string") ? _d0 : (_d0 && _d0.deck_id);
  let result;
  try {
    result = initSession(deck_id, {
      dDayMode: opts.dDayMode,
      newCardLimit: opts.newCardLimit,
      reviewLimit: opts.reviewLimit,
      leitnerCfg: opts.leitnerCfg
    }, Date.now());
  } catch (e) {
    if (opts.onError) { opts.onError(e); } else { console.error("[APP.init]", e); }
    return null;
  }

  // synonyms: window.SYNONYMS[subject] (역인덱스, SoT §16·§8)
  const synonyms = (typeof window !== "undefined" && window.SYNONYMS && window.SYNONYMS[subject])
    || undefined;

  // 첫 카드 출제
  if (result.isEmpty) {
    if (opts.onEmpty) opts.onEmpty();
  } else {
    const firstCard = getNextCard(
      result.session,
      result.deck.cards,
      result.progressStore,
      Date.now()
    );
    if (firstCard && opts.onCard) {
      opts.onCard(firstCard, result.session, result.progressStore, synonyms);
    }
  }

  // 채점 시 synonyms 공급용으로 result에 포함
  result.synonyms = synonyms;
  result.subject = subject;
  return result;
}

if (typeof window !== "undefined") {
  window.APP = {
    init,
    // 세션 진행 헬퍼 (UI가 직접 쓸 수 있도록)
    getNextCard,
    processAttempt,
    score,
    saveProgress,
    getDashboardData,
    // 내부 유틸 노출 (디버깅·테스트)
    getManifest,
    loadDeck,
    initSession,
    loadProgress,
  };
}

// Node.js / 테스트 환경 지원
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BOX_MIN, BOX_MAX, BOX_INTERVALS_DAYS, SCHEMA_VERSION,
    STORAGE_KEY_PREFIX, MS_PER_DAY, DDAY_COMPRESS_DAYS,
    ScoreInputError, SchemaVersionError, StorageQuotaError,
    ManifestMissingError, DeckNotFoundError,
    normalize, score,
    leitnerTransition, nextDueAt, isDue,
    loadProgress, saveProgress, migrate,
    getManifest, loadDeck, switchDeck,
    buildQueue,
    getDashboardData,
    initSession, getNextCard, processAttempt,
    _defaultCardProgress, _emptyProgressStore, _normalizeWeight,
    PASS_TARGET,
  };
}
