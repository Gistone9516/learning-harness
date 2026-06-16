#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate.py — 콘텐츠 md + config → deck.js + manifest.js 빌드
계약: 생성규칙.md + _인터페이스계약.md + 카드규격.md (buildflow ② 명세)
무의존: stdlib only (argparse, json, re, pathlib, datetime, sys, os)

§16 변경(buildflow ③):
  - config = 과목/<폴더>/config/규칙.json (JSON, stdlib json) — .config.js 폐기
  - 전역 등록 = window.DECKS / window.MANIFEST / window.SYNONYMS (이중밑줄 폐기)
  - subject id = comp1
  - 콘텐츠 스캔 = 과목/컴활1급/콘텐츠/**/*.md (재귀)
  - answer_spec.normalize: 모든 non-self type에 포함
  - no-arg 실행 시 cp949 UnicodeEncodeError 방지
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ──────────────────────────────────────────────
# 버전 상수
# ──────────────────────────────────────────────
GENERATOR_VERSION = "1.0.0"
SCHEMA_VERSION = 1          # deck Card schema_version
MAX_SCHEMA_VERSION = 1      # front-matter schema_version 지원 최대
BACKUP_SCHEMA_MAX = 1

# ──────────────────────────────────────────────
# 정규식 상수 (§0)
# ──────────────────────────────────────────────
RE_SUBJECT_ID   = re.compile(r'^[a-z][a-z0-9_]{1,31}$')
RE_DECK_ID      = re.compile(r'^[a-z][a-z0-9_]{1,63}$')
RE_CARD_ID      = re.compile(r'^[a-z][a-z0-9-]{2,63}$')
RE_TAG_TOKEN    = re.compile(r'^[A-Za-z0-9_-]+$')
RE_CARD_MARKER  = re.compile(r'^##\s+@(\S+)\s*$')
RE_META_LINE    = re.compile(r'^-\s+(\S+?):\s+(.*)$')
RE_FRONT_SEP    = re.compile(r'^---FRONT---\s*$')
RE_BACK_SEP     = re.compile(r'^---BACK---\s*$')

# normalize 카탈로그 (§3.4)
NORMALIZE_CATALOG = {
    'nfkc', 'trim', 'collapse_space', 'strip_all_space',
    'lower', 'fullwidth_to_halfwidth', 'unify_cell_dollar',
    'unify_arg_sep', 'strip_trailing_paren'
}

# area/subarea 허용 매트릭스 (§1.2, §3.3, _인터페이스계약 §11)
AREA_SUBAREAS = {
    'written':   {'computer', 'spreadsheet', 'database'},
    'practical': {'excel', 'access'},
}

# type × grade_mode 매트릭스 (생성규칙 §4.3, _인터페이스계약 §4)
# 키: type → (허용 grade_mode set, 기본 grade_mode)
TYPE_GRADE = {
    'func':       ({'exact', 'self'}, 'exact'),
    'proc':       ({'keyword', 'self'}, 'keyword'),
    'recall_seq': ({'exact', 'self'}, 'exact'),
    'cloze':      ({'cloze', 'self'}, 'cloze'),
    'judge':      ({'exact', 'self'}, 'exact'),
}

# ──────────────────────────────────────────────
# 에러/경고 수집기
# ──────────────────────────────────────────────
class Reporter:
    def __init__(self, strict: bool = False):
        self.strict = strict
        self.entries: list[tuple[str, str, str, str]] = []  # (level, code, loc, msg)
        self._has_error = False

    def error(self, code: str, loc: str, msg: str):
        self._has_error = True
        self.entries.append(('ERROR', code, loc, msg))
        print(f"ERROR {code} {loc} {msg}", file=sys.stderr)

    def warn(self, code: str, loc: str, msg: str):
        self.entries.append(('WARN', code, loc, msg))
        print(f"WARN {code} {loc} {msg}", file=sys.stderr)

    def has_error(self) -> bool:
        if self.strict:
            return len(self.entries) > 0
        return self._has_error

    def exit_code(self) -> int:
        return 2 if self.has_error() else 0

    def to_lines(self) -> list[str]:
        return [f"{lvl} {code} {loc} {msg}" for (lvl, code, loc, msg) in self.entries]


# ──────────────────────────────────────────────
# JS 문자열 안전 직렬화 (§2.3)
# ──────────────────────────────────────────────
def js_str(value) -> str:
    """json.dumps + </script> 방어 + U+2028/U+2029 치환"""
    s = json.dumps(value, ensure_ascii=False)
    s = s.replace('</', r'<\/')  # </script> 조기종료 방어
    s = s.replace(' ', r' ')
    s = s.replace(' ', r' ')
    return s


def js_obj(obj) -> str:
    """Python dict/list → JS 인라인 JSON 안전 직렬화"""
    raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    raw = raw.replace('</', r'<\/')
    raw = raw.replace(' ', r' ')
    raw = raw.replace(' ', r' ')
    return raw


# ──────────────────────────────────────────────
# front-matter 파서 (§1.2, stdlib-only)
# ──────────────────────────────────────────────
def parse_frontmatter(lines: list[str], deck_id_hint: str, reporter: Reporter) -> dict | None:
    """
    lines: 파일 전체 라인(개행 제거). 첫 줄은 '---' 이어야 함.
    반환: dict or None(에러 시).
    """
    loc = f"{deck_id_hint}:-"
    if not lines or lines[0].strip() != '---':
        reporter.error('E_FRONTMATTER_INVALID', loc, "front-matter 시작 '---' 없음")
        return None

    end_idx = None
    for i, line in enumerate(lines[1:], 1):
        if line.strip() == '---':
            end_idx = i
            break
    if end_idx is None:
        reporter.error('E_FRONTMATTER_INVALID', loc, "front-matter 종료 '---' 누락")
        return None

    fm: dict = {}
    for line in lines[1:end_idx]:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        m = re.match(r'^(\S+?):\s+(.*)', stripped)
        if not m:
            reporter.error('E_FRONTMATTER_INVALID', loc, f"front-matter 형식 위반 라인: {line!r}")
            return None
        key = m.group(1)
        val = m.group(2).strip()
        if val.startswith('"') and val.endswith('"') and len(val) >= 2:
            val = val[1:-1]
        fm[key] = val

    # 필수 필드 검증
    required = ['deck_id', 'subject_id', 'title', 'unit', 'area', 'subarea', 'schema_version']
    for rf in required:
        if rf not in fm:
            reporter.error('E_FRONTMATTER_INVALID', loc, f"front-matter 필수 필드 누락: {rf}")
            return None

    # schema_version
    try:
        sv = int(fm['schema_version'])
    except (ValueError, TypeError):
        reporter.error('E_FRONTMATTER_INVALID', loc, f"schema_version 정수 아님: {fm['schema_version']!r}")
        return None
    if sv < 1:
        reporter.error('E_FRONTMATTER_INVALID', loc, f"schema_version < 1: {sv}")
        return None
    if sv > MAX_SCHEMA_VERSION:
        reporter.error('E_SCHEMA_UNSUPPORTED', loc, f"schema_version {sv} > 지원 최대 {MAX_SCHEMA_VERSION}")
        return None
    fm['schema_version'] = sv

    # deck_id, subject_id 정규식
    if not RE_DECK_ID.match(fm['deck_id']):
        reporter.error('E_FRONTMATTER_INVALID', loc, f"deck_id 정규식 위반: {fm['deck_id']!r}")
        return None
    if not RE_SUBJECT_ID.match(fm['subject_id']):
        reporter.error('E_FRONTMATTER_INVALID', loc, f"subject_id 정규식 위반: {fm['subject_id']!r}")
        return None

    # area/subarea
    if fm['area'] not in AREA_SUBAREAS:
        reporter.error('E_AREA_UNKNOWN', loc, f"area 알 수 없음: {fm['area']!r}")
        return None
    if fm['subarea'] not in AREA_SUBAREAS[fm['area']]:
        reporter.error('E_AREA_UNKNOWN', loc, f"subarea {fm['subarea']!r}는 area={fm['area']}에 허용되지 않음")
        return None

    return {'fm': fm, 'body_start': end_idx + 1}


# ──────────────────────────────────────────────
# 카드 메타 파서 (§1.3)
# ──────────────────────────────────────────────
ALLOWED_CARD_META_KEYS = {
    'type', 'unit', 'grade_mode', 'area', 'subarea',
    'weight', 'concept_ref', 'tags', 'answers', 'keywords',
    'normalize',  # 카드 grading.normalize — §14·§7
}


def parse_card_meta(meta_lines: list[str], deck_id: str, card_id: str, reporter: Reporter) -> dict | None:
    """카드 헤더 바로 아래의 메타 라인들을 파싱"""
    loc = f"{deck_id}:{card_id}"
    meta: dict = {}
    for line in meta_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        m = RE_META_LINE.match(stripped)
        if not m:
            continue  # 메타가 아닌 라인은 본문 시작으로 처리됨 — 호출측에서 분리
        key = m.group(1)
        val = m.group(2).strip()
        if val.startswith('"') and val.endswith('"') and len(val) >= 2:
            val = val[1:-1]
        if key not in ALLOWED_CARD_META_KEYS:
            reporter.error('E_CARD_META_UNKNOWN', loc, f"알 수 없는 카드 메타 키: {key!r}")
            return None
        meta[key] = val
    return meta


def parse_tags(val: str, deck_id: str, card_id: str, reporter: Reporter) -> list[str] | None:
    loc = f"{deck_id}:{card_id}"
    tokens = [t.strip() for t in val.split(',')]
    result = []
    for t in tokens:
        if not t:
            reporter.error('E_TAG_INVALID', loc, f"tags 빈 토큰: {val!r}")
            return None
        if not RE_TAG_TOKEN.match(t):
            reporter.error('E_TAG_INVALID', loc, f"tags 토큰 정규식 위반: {t!r}")
            return None
        result.append(t)
    return result


def parse_pipe_list(val: str, deck_id: str, card_id: str, reporter: Reporter,
                    empty_code: str) -> list[str] | None:
    """'|' 구분 리스트 파싱. 빈 토큰 → empty_code 에러"""
    loc = f"{deck_id}:{card_id}"
    tokens = [t.strip() for t in val.split('|')]
    result = []
    for t in tokens:
        if not t:
            reporter.error(empty_code, loc, f"빈 토큰 발생: {val!r}")
            return None
        result.append(t)
    return result


# ──────────────────────────────────────────────
# cloze 토큰 파서 (§1.3, _인터페이스계약 §10)
# ──────────────────────────────────────────────
RE_CLOZE_TOKEN = re.compile(r'(?<!\\)\{\{([^}]+?)\}\}')
RE_ESCAPE_BRACE = re.compile(r'\\([{}])')


def parse_cloze_blanks(text: str) -> list[list[str]]:
    """
    본문에서 {{정답|별칭...}} 토큰 추출 → blanks[i] = [정답, 별칭, ...]
    이스케이프된 \\{ \\} 는 스캔 제외, 산출 문자열엔 { } 로 환원.
    """
    blanks = []
    for m in RE_CLOZE_TOKEN.finditer(text):
        inner = m.group(1)
        candidates = [c.strip() for c in inner.split('|')]
        blanks.append(candidates)
    return blanks


def unescape_braces(text: str) -> str:
    """\\{ → {, \\} → }"""
    return RE_ESCAPE_BRACE.sub(r'\1', text)


def has_cloze_token(text: str) -> bool:
    return bool(RE_CLOZE_TOKEN.search(text))


def cloze_token_count(text: str) -> int:
    return len(RE_CLOZE_TOKEN.findall(text))


# ──────────────────────────────────────────────
# front/back 본문 분리 (§1.3)
# ──────────────────────────────────────────────
def split_front_back(body_lines: list[str], deck_id: str, card_id: str,
                     reporter: Reporter) -> tuple[str, str] | None:
    loc = f"{deck_id}:{card_id}"
    front_indices = [i for i, l in enumerate(body_lines) if RE_FRONT_SEP.match(l)]
    back_indices  = [i for i, l in enumerate(body_lines) if RE_BACK_SEP.match(l)]

    if not front_indices and not back_indices:
        reporter.error('E_FRONT_BACK_MISSING', loc, "---FRONT---/---BACK--- 분리 마커 없음")
        return None

    if len(front_indices) > 1 or len(back_indices) > 1:
        reporter.error('E_FRONT_BACK_MALFORMED', loc, "분리 마커 중복")
        return None

    if not front_indices or not back_indices:
        reporter.error('E_FRONT_BACK_MALFORMED', loc, "분리 마커 한쪽만 존재")
        return None

    fi = front_indices[0]
    bi = back_indices[0]

    if bi <= fi:
        reporter.error('E_FRONT_BACK_MALFORMED', loc, "---BACK---가 ---FRONT--- 보다 먼저 등장")
        return None

    front_text = '\n'.join(body_lines[fi+1:bi]).strip()
    back_text  = '\n'.join(body_lines[bi+1:]).strip()

    if not front_text:
        reporter.error('E_FRONT_BACK_EMPTY', loc, "front 영역이 비어있음")
        return None
    if not back_text:
        reporter.error('E_FRONT_BACK_EMPTY', loc, "back 영역이 비어있음")
        return None

    return front_text, back_text


# ──────────────────────────────────────────────
# answer_spec 조립 (§2.4.1, _인터페이스계약 §13)
# ──────────────────────────────────────────────
def build_answer_spec(card_type: str, grade_mode: str, meta: dict,
                      front_text: str, deck_id: str, card_id: str,
                      reporter: Reporter,
                      normalize_config: dict | None = None) -> dict | None:
    """
    normalize_config: {type: [rule_id, ...], '_default': [...]} 형태.
    카드 메타 normalize 미지정 시 type별 기본 프로파일 사용.
    """
    if normalize_config is None:
        normalize_config = {}
    loc = f"{deck_id}:{card_id}"

    if grade_mode == 'self':
        return None  # self → answer_spec: null

    # normalize 결정: 카드 grading.normalize 우선, 미지정 시 config type별 기본 프로파일
    # config는 호출측에서 전달받음 (normalize_config 매개변수)
    card_normalize = meta.get('normalize')
    if card_normalize:
        # 카드 메타에 normalize 명시된 경우: 공백 제거 후 id 리스트
        normalize_ids = [n.strip() for n in card_normalize.split(',') if n.strip()]
    else:
        # config type별 기본 프로파일 사용 (normalize_config = {type: [id, ...]})
        normalize_ids = list(normalize_config.get(card_type, normalize_config.get('_default', [])))

    if card_type in ('func', 'judge'):
        # exact → accepted: string[]
        answers_raw = meta.get('answers')
        if not answers_raw:
            reporter.error('E_MISSING_ANSWERS', loc, f"type={card_type} exact이지만 answers 없음")
            return None
        accepted = parse_pipe_list(answers_raw, deck_id, card_id, reporter, 'E_MISSING_ANSWERS')
        if accepted is None:
            return None
        return {'accepted': accepted, 'normalize': normalize_ids}

    if card_type == 'recall_seq':
        # exact → sequence: string[] (순서 보존)
        answers_raw = meta.get('answers')
        if not answers_raw:
            reporter.error('E_MISSING_ANSWERS', loc, "recall_seq exact이지만 answers 없음")
            return None
        sequence = parse_pipe_list(answers_raw, deck_id, card_id, reporter, 'E_MISSING_ANSWERS')
        if sequence is None:
            return None
        return {'sequence': sequence, 'normalize': normalize_ids}

    if card_type == 'proc':
        # keyword → requiredKeywords: string[][]
        keywords_raw = meta.get('keywords')
        if not keywords_raw:
            reporter.error('E_MISSING_KEYWORDS', loc, "proc keyword이지만 keywords 없음")
            return None
        kw_tokens = parse_pipe_list(keywords_raw, deck_id, card_id, reporter, 'E_MISSING_KEYWORDS')
        if kw_tokens is None:
            return None
        # 각 토큰을 하나의 필수그룹 동의어 후보 배열로 감쌈 (_인터페이스계약 §14)
        required_keywords = [[t] for t in kw_tokens]
        return {'requiredKeywords': required_keywords, 'normalize': normalize_ids}

    if card_type == 'cloze':
        # cloze → blanks: string[][]
        blanks = parse_cloze_blanks(front_text)
        if not blanks:
            reporter.error('E_CLOZE_NO_BLANK', loc, "type=cloze 이지만 {{}} 토큰 없음")
            return None
        # 빈 토큰 검사
        for i, bl in enumerate(blanks):
            for candidate in bl:
                if not candidate:
                    reporter.error('E_CLOZE_NO_BLANK', loc, f"blanks[{i}]에 빈 토큰")
                    return None
        return {'blanks': blanks, 'normalize': normalize_ids}

    reporter.error('E_GRADE_TYPE_MISMATCH', loc, f"알 수 없는 type: {card_type!r}")
    return None


# ──────────────────────────────────────────────
# 카드 블록 파서 (§1.3)
# ──────────────────────────────────────────────
def parse_card_block(marker_line: str, block_lines: list[str],
                     fm: dict, reporter: Reporter,
                     seen_card_ids: set[str],
                     normalize_config: dict | None = None) -> dict | None:
    """
    marker_line: '## @card_id' 형태
    block_lines: 마커 다음 줄부터 다음 마커 직전까지
    fm: 덱 front-matter
    seen_card_ids: 이 과목의 card_id 중복 검사용 (subject_id 범위)
    normalize_config: config에서 추출한 type별 normalize 기본 프로파일
    """
    deck_id = fm['deck_id']

    # card_id 추출
    m = RE_CARD_MARKER.match(marker_line)
    if not m:
        reporter.error('E_CARD_ID_INVALID', f"{deck_id}:-", f"마커 파싱 실패: {marker_line!r}")
        return None
    raw_id = m.group(1)
    if not RE_CARD_ID.match(raw_id):
        reporter.error('E_CARD_ID_INVALID', f"{deck_id}:{raw_id}", f"card_id 정규식 위반: {raw_id!r}")
        return None
    card_id = raw_id
    loc = f"{deck_id}:{card_id}"

    # 중복 검사 (subject_id namespace 범위)
    ns_key = f"{fm['subject_id']}:{card_id}"
    if ns_key in seen_card_ids:
        reporter.error('E_CARD_ID_DUP', loc, f"card_id 중복: {card_id}")
        return None
    seen_card_ids.add(ns_key)

    # 메타 라인과 본문 분리
    meta_lines = []
    body_start = 0
    for i, line in enumerate(block_lines):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            if not meta_lines:
                continue  # 마커 직후 빈 줄은 스킵
            break
        if RE_META_LINE.match(stripped):
            meta_lines.append(line)
            body_start = i + 1
        else:
            body_start = i
            break
    else:
        body_start = len(block_lines)

    meta = parse_card_meta(meta_lines, deck_id, card_id, reporter)
    if meta is None:
        return None

    # type 검증
    card_type = meta.get('type')
    if not card_type:
        reporter.error('E_FRONTMATTER_INVALID', loc, "카드 메타 type 필수 필드 누락")
        return None
    if card_type not in TYPE_GRADE:
        reporter.error('E_GRADE_TYPE_MISMATCH', loc, f"알 수 없는 type: {card_type!r}")
        return None

    # grade_mode 해소 (카드 > config grade_modes > 기본)
    grade_mode_raw = meta.get('grade_mode')
    if grade_mode_raw:
        grade_mode = grade_mode_raw
    else:
        grade_mode = TYPE_GRADE[card_type][1]  # 기본값

    # grade_mode 허용 검사
    allowed_modes, _ = TYPE_GRADE[card_type]
    if grade_mode not in allowed_modes:
        reporter.error('E_GRADE_TYPE_MISMATCH', loc,
                       f"type={card_type}에 grade_mode={grade_mode} 불허 (허용: {allowed_modes})")
        return None

    # unit 해소 (카드 > 덱 front-matter)
    unit = meta.get('unit') or fm.get('unit', '')

    # area/subarea 해소
    area = meta.get('area') or fm['area']
    subarea = meta.get('subarea') or fm['subarea']

    # area/subarea 검증
    if area not in AREA_SUBAREAS:
        reporter.error('E_AREA_UNKNOWN', loc, f"area 알 수 없음: {area!r}")
        return None
    if subarea not in AREA_SUBAREAS[area]:
        reporter.error('E_AREA_UNKNOWN', loc, f"subarea {subarea!r}는 area={area}에 허용 안됨")
        return None

    # weight 해소 (클램프, 폴백)
    weight_raw = meta.get('weight', '5')
    try:
        weight = float(weight_raw)
        weight = max(1.0, min(10.0, weight))
    except (ValueError, TypeError):
        weight = 5.0

    # concept_ref
    concept_ref = meta.get('concept_ref') or None

    # 본문 분리 (front/back)
    body_lines = block_lines[body_start:]
    result = split_front_back(body_lines, deck_id, card_id, reporter)
    if result is None:
        return None
    front_raw, back_raw = result

    # cloze 토큰 ↔ type 정합 (§1.3)
    if card_type == 'cloze':
        if not has_cloze_token(front_raw):
            reporter.error('E_CLOZE_NO_BLANK', loc, "type=cloze 이지만 front에 {{}} 토큰 없음")
            return None
    else:
        if has_cloze_token(front_raw):
            reporter.error('E_CLOZE_UNEXPECTED', loc,
                           f"type={card_type}이지만 front에 cloze 토큰 등장")
            return None

    # front 이스케이프 환원
    front_rendered = unescape_braces(front_raw)

    # front object 구성 (type별)
    if card_type in ('func', 'proc', 'recall_seq'):
        front_obj = {'prompt': front_rendered}
    elif card_type == 'cloze':
        front_obj = {'text': front_rendered}
    elif card_type == 'judge':
        front_obj = {'scenario': front_rendered}
    else:
        front_obj = {'prompt': front_rendered}

    # back object 구성
    back_obj = {'detail': back_raw, 'note': None}

    # answer_spec 조립
    answer_spec = build_answer_spec(card_type, grade_mode, meta,
                                    front_raw, deck_id, card_id, reporter,
                                    normalize_config=normalize_config)
    # self가 아닌데 answer_spec이 None이면 에러 이미 발생 → return None
    if grade_mode != 'self' and answer_spec is None:
        return None

    # tags 오브젝트 조립 (_인터페이스계약 §14)
    tags_obj = {
        'weight': weight,
        'area':    area,
        'subarea': subarea,
    }

    # links 오브젝트 조립 (_인터페이스계약 §12)
    links_obj: dict = {}
    if concept_ref:
        links_obj['concept_ref'] = concept_ref

    # Card 객체 조립 (§2.4, _인터페이스계약 §14 전 필드)
    card = {
        'card_id':        card_id,
        'schema_version': SCHEMA_VERSION,
        'subject':        fm['subject_id'],
        'unit':           unit,
        'type':           card_type,
        'grade_mode':     grade_mode,
        'front':          front_obj,
        'back':           back_obj,
        'answer_spec':    answer_spec,  # self → null
        'tags':           tags_obj,
        'links':          links_obj,
        'enabled':        True,
    }
    return card


# ──────────────────────────────────────────────
# md 파일 파서 (§1.1 ~ §1.4)
# ──────────────────────────────────────────────
def parse_md_file(md_path: Path, subject_id: str, reporter: Reporter,
                  seen_card_ids: set[str], seen_deck_ids: set[str],
                  normalize_config: dict | None = None) -> dict | None:
    """
    md 파일 1개 → deck dict (deck_id, subject_id, title, cards[])
    에러 시 None 반환(에러는 reporter에 누적).
    normalize_config: config에서 추출한 type별 normalize 기본 프로파일
    """
    try:
        text = md_path.read_text(encoding='utf-8')
    except Exception as e:
        reporter.error('E_FRONTMATTER_INVALID', '-:-', f"파일 읽기 실패: {md_path}: {e}")
        return None

    lines = text.splitlines()
    deck_hint = md_path.stem

    result = parse_frontmatter(lines, deck_hint, reporter)
    if result is None:
        return None

    fm = result['fm']
    body_start = result['body_start']

    # subject_id 일치 검사 (§1.4)
    if fm['subject_id'] != subject_id:
        loc = f"{fm['deck_id']}:-"
        reporter.error('E_SUBJECT_ID_MISMATCH', loc,
                       f"front-matter subject_id={fm['subject_id']!r} ≠ --subject {subject_id!r}")
        return None

    # deck_id 중복 검사
    if fm['deck_id'] in seen_deck_ids:
        reporter.error('E_DECK_ID_DUP', f"{fm['deck_id']}:-",
                       f"deck_id 중복: {fm['deck_id']!r}")
        return None

    # deck_id case collision (§0.2)
    lower_ids = {did.lower() for did in seen_deck_ids}
    if fm['deck_id'].lower() in lower_ids:
        reporter.error('E_DECK_ID_CASE_COLLISION', f"{fm['deck_id']}:-",
                       f"deck_id 소문자 접기 충돌: {fm['deck_id']!r}")
        return None
    seen_deck_ids.add(fm['deck_id'])

    # 카드 블록 분리
    body_lines = lines[body_start:]
    card_blocks: list[tuple[str, list[str]]] = []  # (marker_line, block_lines)
    current_marker = None
    current_block: list[str] = []

    for line in body_lines:
        if RE_CARD_MARKER.match(line):
            if current_marker is not None:
                card_blocks.append((current_marker, current_block))
            current_marker = line
            current_block = []
        else:
            if current_marker is not None:
                current_block.append(line)

    if current_marker is not None:
        card_blocks.append((current_marker, current_block))

    # 각 카드 파싱
    cards = []
    for marker, block in card_blocks:
        card = parse_card_block(marker, block, fm, reporter, seen_card_ids,
                                normalize_config=normalize_config)
        if card is not None:
            cards.append(card)

    if not cards:
        reporter.warn('W_EMPTY_DECK', f"{fm['deck_id']}:-", "카드 0개 덱")

    return {
        'deck_id':    fm['deck_id'],
        'subject_id': fm['subject_id'],
        'title':      fm['title'],
        'cards':      cards,
    }


# ──────────────────────────────────────────────
# config JSON 파서 (§16 — 규칙.json, stdlib json)
# ──────────────────────────────────────────────
def parse_config_json(config_path: Path, subject_id: str, reporter: Reporter) -> dict | None:
    """
    과목/<폴더>/config/규칙.json 을 stdlib json으로 파싱.
    (_인터페이스계약 §16: .config.js 폐기 → JSON)
    """
    loc = '-:-'

    # 파일명 검사: 반드시 '규칙.json'
    if config_path.name != '규칙.json':
        reporter.error('E_CONFIG_ID_MISMATCH', loc,
                       f"config 파일명 {config_path.name!r} ≠ '규칙.json'")
        return None

    try:
        text = config_path.read_text(encoding='utf-8')
    except Exception as e:
        reporter.error('E_CONFIG_ID_MISMATCH', loc, f"config 파일 읽기 실패: {config_path}: {e}")
        return None

    try:
        cfg = json.loads(text)
    except json.JSONDecodeError as e:
        reporter.error('E_CONFIG_ID_MISMATCH', loc, f"규칙.json JSON 파싱 실패: {e}")
        return None

    # subject_id 일치
    if cfg.get('subject_id') != subject_id:
        reporter.error('E_CONFIG_ID_MISMATCH', loc,
                       f"config subject_id={cfg.get('subject_id')!r} ≠ --subject {subject_id!r}")
        return None

    # schema 검증
    if cfg.get('schema') != 1:
        reporter.error('E_CONFIG_ID_MISMATCH', loc, f"config schema ≠ 1: {cfg.get('schema')!r}")
        return None

    # normalize id 검증 (공통 normalize 리스트, §7)
    for nid in cfg.get('normalize', []):
        if nid not in NORMALIZE_CATALOG:
            reporter.error('E_CONFIG_NORMALIZE_UNKNOWN', loc, f"normalize id 카탈로그 외: {nid!r}")
            return None

    # normalize_profiles: type별 기본 프로파일 id 리스트 검증
    for t, ids in cfg.get('normalize_profiles', {}).items():
        if not isinstance(ids, list):
            reporter.error('E_CONFIG_NORMALIZE_UNKNOWN', loc,
                           f"normalize_profiles.{t} 배열 아님: {ids!r}")
            return None
        for nid in ids:
            if nid not in NORMALIZE_CATALOG:
                reporter.error('E_CONFIG_NORMALIZE_UNKNOWN', loc,
                               f"normalize_profiles.{t} id 카탈로그 외: {nid!r}")
                return None

    # synonyms 검증
    for rep, syns in cfg.get('synonyms', {}).items():
        if not rep:
            reporter.error('E_CONFIG_SYNONYM_EMPTY', loc, "synonyms 빈 대표어")
            return None
        if not isinstance(syns, list) or not syns:
            reporter.error('E_CONFIG_SYNONYM_EMPTY', loc, f"synonyms {rep!r} 빈 배열")
            return None
        for s in syns:
            if not s:
                reporter.error('E_CONFIG_SYNONYM_EMPTY', loc, f"synonyms {rep!r}에 빈 동의어")
                return None

    # grade_modes 검증
    valid_grade_modes = {'exact', 'keyword', 'cloze', 'self'}
    for t, gm in cfg.get('grade_modes', {}).items():
        if gm not in valid_grade_modes:
            reporter.error('E_CONFIG_GRADE_UNKNOWN', loc, f"grade_modes {t}={gm!r} 알 수 없음")
            return None
        if t in TYPE_GRADE:
            allowed, _ = TYPE_GRADE[t]
            if gm not in allowed:
                reporter.error('E_CONFIG_GRADE_TYPE_MISMATCH', loc,
                               f"grade_modes {t}={gm!r} 매트릭스 위반")
                return None

    # areas 검증
    for area_obj in cfg.get('areas', []):
        a = area_obj.get('area')
        sa = area_obj.get('subarea')
        if a not in AREA_SUBAREAS:
            reporter.error('E_AREA_UNKNOWN', loc, f"config areas area 알 수 없음: {a!r}")
            return None
        if sa not in AREA_SUBAREAS.get(a, set()):
            reporter.error('E_AREA_UNKNOWN', loc,
                           f"config areas subarea {sa!r}는 area={a}에 허용 안됨")
            return None

    # leitner 검증
    leitner = cfg.get('leitner', {})
    boxes = leitner.get('boxes', 3)
    intervals = leitner.get('intervals_days', [1, 3, 7])
    if len(intervals) != boxes:
        reporter.error('E_CONFIG_INTERVALS_LEN', loc,
                       f"intervals_days 길이({len(intervals)}) ≠ boxes({boxes})")
        return None
    promote_on = leitner.get('promote_on', 'cold_first_correct')
    if promote_on != 'cold_first_correct':
        reporter.error('E_CONFIG_PROMOTE_INVALID', loc,
                       f"promote_on={promote_on!r} ≠ cold_first_correct")
        return None

    return cfg


# ──────────────────────────────────────────────
# synonyms 역인덱스 컴파일 (§4.2, _인터페이스계약 §8)
# ──────────────────────────────────────────────
def compile_synonyms(synonyms_map: dict) -> dict:
    """
    작성 형식 {대표어: [동의어,...]} → 역인덱스 {동의어: 대표어}
    (엔진이 소비하는 형식)
    """
    inv: dict = {}
    for rep, syns in synonyms_map.items():
        for s in syns:
            inv[s] = rep
    return inv


# ──────────────────────────────────────────────
# 산출물 출력 (§2.1 ~ §2.6)
# ──────────────────────────────────────────────
def write_deck_js(deck: dict, out_dir: Path) -> Path:
    """deck dict → decks/<deck_id>.js"""
    deck_id = deck['deck_id']
    out_path = out_dir / 'decks' / f"{deck_id}.js"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    obj = {
        'schema':     1,
        'deck_id':    deck['deck_id'],
        'subject_id': deck['subject_id'],
        'title':      deck['title'],
        'cards':      deck['cards'],
    }
    obj_js = js_obj(obj)

    content = (
        '(window.DECKS = window.DECKS || {})' + f'[{js_str(deck_id)}] = {obj_js};\n'
    )
    out_path.write_text(content, encoding='utf-8')
    return out_path


def write_activities_js(subject_id: str, decks: list[dict], out_dir: Path) -> Path:
    """
    activities.js 출력 (플러그인계약 §7·§9, _인터페이스계약 §14)
    window.ACTIVITIES['card-quiz'] = ActivitySpec[]
    ActivitySpec: {activity_id, plugin_id, type, front, back, weight, tags, enabled}
    - activity_id = card_id
    - plugin_id   = 'card-quiz'
    - weight      = tags.weight (float[1,10])
    - tags        = {area, subarea} (weight 제외한 태그 식별 필드)
    - front/back  = 카드의 front/back 오브젝트 그대로
    """
    out_path = out_dir / 'activities.js'

    activity_specs = []
    for d in decks:
        for c in d['cards']:
            spec = {
                'activity_id': c['card_id'],
                'plugin_id':   'card-quiz',
                'type':        c['type'],
                'front':       c['front'],
                'back':        c['back'],
                'weight':      c['tags']['weight'],
                'tags': {
                    'area':    c['tags']['area'],
                    'subarea': c['tags']['subarea'],
                },
                'enabled':     c['enabled'],
            }
            activity_specs.append(spec)

    specs_js = js_obj(activity_specs)
    content = (
        '(window.ACTIVITIES = window.ACTIVITIES || {})'
        + f'[{js_str("card-quiz")}] = {specs_js};\n'
    )
    out_path.write_text(content, encoding='utf-8')
    return out_path


# card-quiz PluginManifest (플러그인계약 §2·§9)
_CARD_QUIZ_PLUGIN_MANIFEST = {
    'plugin_id':              'card-quiz',
    'label':                  '카드 퀴즈',
    'version':                '1.0.0',
    'infra':                  'static',
    'capabilities':           ['quiz'],
    'scoring_mode':           'auto',
    'activity_type':          'card-quiz',
    'progress_schema_version': 1,
}


def write_manifest_js(subject_id: str, subject_label: str, decks: list[dict],
                      config_obj: dict, out_dir: Path, reproducible: bool) -> Path:
    """manifest.js 출력 (§2.5, 플러그인계약 §7·§9)"""
    out_path = out_dir / 'manifest.js'

    if reproducible:
        generated_at = '1970-01-01T00:00:00Z'
    else:
        generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    # counts 집계
    all_cards = [c for d in decks for c in d['cards']]
    by_type: dict = {}
    by_area: dict = {}
    for c in all_cards:
        t = c['type']
        by_type[t] = by_type.get(t, 0) + 1
        area = c['tags']['area']
        by_area[area] = by_area.get(area, 0) + 1

    manifest_obj = {
        'schema':            1,
        'subject_id':        subject_id,
        'subject_label':     subject_label,
        'generated_at':      generated_at,
        'generator_version': GENERATOR_VERSION,
        'areas':             config_obj.get('areas', []),
        'decks': [
            {
                'deck_id':    d['deck_id'],
                'title':      d['title'],
                'area':       d['cards'][0]['tags']['area'] if d['cards'] else '',
                'subarea':    d['cards'][0]['tags']['subarea'] if d['cards'] else '',
                'card_count': len(d['cards']),
                'src':        f"decks/{d['deck_id']}.js",
            }
            for d in decks
        ],
        'config_ref': "config/규칙.json",
        'counts': {
            'cards_total': len(all_cards),
            'by_type':     by_type,
            'by_area':     by_area,
        },
        # 플러그인계약 §7·§9: MANIFEST[subject].plugins = PluginManifest[]
        'plugins': [_CARD_QUIZ_PLUGIN_MANIFEST],
    }

    obj_js = js_obj(manifest_obj)
    content = (
        '(window.MANIFEST = window.MANIFEST || {})' + f'[{js_str(subject_id)}] = {obj_js};\n'
    )
    out_path.write_text(content, encoding='utf-8')
    return out_path


def write_script_tag_list(subject_id: str, decks: list[dict],
                          out_dir: Path) -> Path:
    """HTML 로드 순서 스크립트 태그 목록 파일 (§2.6, 플러그인계약 §7 부트 순서)"""
    out_path = out_dir / 'script_tags.html'
    # 부트 순서: synonyms → manifest → decks → activities (플러그인계약 §7)
    # config는 규칙.json(JSON)이므로 script 태그 불필요 — fetch/import로 소비
    lines = []
    lines.append(f'<!-- config: config/규칙.json (JSON, fetch로 로드) -->')
    lines.append(f'<script src="synonyms.js"></script>')
    lines.append(f'<script src="manifest.js"></script>')
    for d in decks:
        lines.append(f'<script src="decks/{d["deck_id"]}.js"></script>')
    # activities.js: window.ACTIVITIES['card-quiz'] 등록 (플러그인계약 §7·§9)
    lines.append(f'<script src="activities.js"></script>')
    lines.append('<!-- 플러그인 파일(manifest+plugin.js) → shell.js: 플러그인계약 §7 부트 순서 참조 -->')
    lines.append('<!-- 엔진 코어: 엔진규격 소관 -->')
    out_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return out_path


# ──────────────────────────────────────────────
# 개념서 인덱스 로드 (§1.4)
# ──────────────────────────────────────────────
def load_concept_index(out_dir: Path, reporter: Reporter) -> set[str] | None:
    """
    개념서 인덱스 파일 탐색. 부재 시 None 반환 + W_SECTION_INDEX_ABSENT.
    존재 시 section_id set 반환.
    """
    # 인덱스 경로: 개념서규격 의존(현재 OPEN). 탐색 대상: 과목 루트 수준 concept_index.json
    index_path = out_dir.parent / 'concept_index.json'
    if not index_path.exists():
        reporter.warn('W_SECTION_INDEX_ABSENT', '-:-', "개념서 인덱스 미제공 — concept_ref 검증 스킵")
        return None
    try:
        data = json.loads(index_path.read_text(encoding='utf-8'))
        return set(data.get('section_ids', []))
    except Exception as e:
        reporter.warn('W_SECTION_INDEX_ABSENT', '-:-', f"개념서 인덱스 파싱 실패({e}) — 스킵")
        return None


# ──────────────────────────────────────────────
# stale deck 검사 (§2.2)
# ──────────────────────────────────────────────
def check_stale_decks(out_dir: Path, current_deck_ids: set[str],
                      reporter: Reporter, do_clean: bool):
    decks_dir = out_dir / 'decks'
    if not decks_dir.exists():
        return
    for f in decks_dir.glob('*.js'):
        did = f.stem  # deck_id = 파일명 stem
        if did not in current_deck_ids:
            reporter.warn('W_STALE_DECK_FILE', '-:-', f"스테일 deck 파일: {f.name}")
            if do_clean:
                f.unlink()


# ──────────────────────────────────────────────
# concept_ref 검증 (§1.4)
# ──────────────────────────────────────────────
def validate_concept_refs(decks: list[dict], section_ids: set[str] | None, reporter: Reporter):
    if section_ids is None:
        return  # 이미 W_SECTION_INDEX_ABSENT 출력됨
    for d in decks:
        for c in d['cards']:
            ref = c.get('links', {}).get('concept_ref')
            if ref and ref not in section_ids:
                loc = f"{d['deck_id']}:{c['card_id']}"
                reporter.warn('W_CONCEPT_REF_DANGLING', loc,
                              f"concept_ref={ref!r} 개념서 인덱스에 없음")


# ──────────────────────────────────────────────
# 개념서 파일 감지 헬퍼 (§16-skip)
# ──────────────────────────────────────────────
def _is_concept_doc(md_path) -> bool:
    """
    front-matter에 section_id는 있고 deck_id는 없는 파일 → 개념서 문서.
    generate 대상에서 경고 후 스킵.
    """
    try:
        text = Path(md_path).read_text(encoding='utf-8')
        lines = text.splitlines()
        if not lines or lines[0].strip() != '---':
            return False
        has_section_id = False
        has_deck_id = False
        for line in lines[1:]:
            s = line.strip()
            if s == '---':
                break
            if s.startswith('section_id:'):
                has_section_id = True
            if s.startswith('deck_id:'):
                has_deck_id = True
        return has_section_id and not has_deck_id
    except Exception:
        return False


# ──────────────────────────────────────────────
# build 커맨드
# ──────────────────────────────────────────────
def cmd_build(args, reporter: Reporter):
    subject_id = args.subject

    # 과목 루트 탐색: generate.py 위치 기준
    script_dir = Path(__file__).resolve().parent  # 엔진/
    project_root = script_dir.parent              # 학습 프레임워크 제작/

    # config 파일 위치 찾기 (§16 — 규칙.json)
    # 형식: 과목/<subject_label>/config/규칙.json
    # subject_label은 config 파일 내에 있음 → 모든 과목 폴더를 스캔
    subjects_root = project_root / '과목'
    config_path = None
    subject_label = None
    for folder in subjects_root.iterdir():
        if not folder.is_dir():
            continue
        candidate = folder / 'config' / '규칙.json'
        if candidate.exists():
            # JSON 내 subject_id가 일치하는 폴더 선택
            try:
                probe = json.loads(candidate.read_text(encoding='utf-8'))
                if probe.get('subject_id') == subject_id:
                    config_path = candidate
                    subject_label = folder.name
                    break
            except Exception:
                pass  # 파싱 실패 시 다음 폴더 시도

    if config_path is None:
        reporter.error('E_CONFIG_ID_MISMATCH', '-:-',
                       f"config 파일 not found: 과목/**/config/규칙.json (subject_id={subject_id})")
        return

    # config 파싱
    cfg = parse_config_json(config_path, subject_id, reporter)
    if cfg is None:
        return

    subject_label = cfg.get('subject_label', subject_label)
    subject_folder = config_path.parent.parent  # 과목/<subject_label>/

    # normalize_config 추출: config의 normalize_profiles (type → [rule_id, ...])
    normalize_config: dict = cfg.get('normalize_profiles', {})
    # _default: config 최상위 normalize 리스트를 폴백으로
    if '_default' not in normalize_config and cfg.get('normalize'):
        normalize_config = dict(normalize_config)
        normalize_config['_default'] = cfg['normalize']

    # 출력 디렉터리
    if args.out:
        out_dir = Path(args.out)
    else:
        out_dir = subject_folder / '생성물'
    out_dir.mkdir(parents=True, exist_ok=True)

    # 개념서 인덱스 로드
    section_ids = load_concept_index(out_dir, reporter)

    # 콘텐츠 md 파일 수집 (§16 — 과목/컴활1급/콘텐츠/**/*.md, 재귀)
    content_dir = subject_folder / '콘텐츠'
    if not content_dir.exists():
        reporter.warn('W_EMPTY_DECK', '-:-', f"콘텐츠 폴더 없음: {content_dir}")
        md_files = []
    else:
        md_files = sorted(content_dir.rglob('*.md'))

    seen_card_ids: set[str] = set()
    seen_deck_ids: set[str] = set()
    decks = []

    for md_path in md_files:
        # §16-skip: section_id 있고 deck_id 없는 개념서 파일은 경고 후 스킵
        if _is_concept_doc(md_path):
            reporter.warn('W_CONCEPT_DOC_SKIP', '-:-',
                          f"개념서 파일 스킵 (deck_id 없음, section_id 감지): {md_path.name}")
            continue
        deck = parse_md_file(md_path, subject_id, reporter, seen_card_ids, seen_deck_ids,
                             normalize_config=normalize_config)
        if deck is not None:
            decks.append(deck)

    if reporter.has_error():
        return  # 에러 있으면 산출물 쓰지 않음

    # concept_ref 검증
    validate_concept_refs(decks, section_ids, reporter)

    # stale deck 검사
    current_deck_ids = {d['deck_id'] for d in decks}
    check_stale_decks(out_dir, current_deck_ids, reporter, getattr(args, 'clean', False))

    # synonyms 역인덱스 컴파일
    synonyms_inv = compile_synonyms(cfg.get('synonyms', {}))

    # deck.js 출력
    for deck in decks:
        write_deck_js(deck, out_dir)

    # manifest.js 출력 (plugins 필드 포함, 플러그인계약 §7·§9)
    write_manifest_js(subject_id, subject_label, decks, cfg, out_dir,
                      getattr(args, 'reproducible', False))

    # activities.js 출력 — window.ACTIVITIES['card-quiz'] (플러그인계약 §7·§9)
    write_activities_js(subject_id, decks, out_dir)

    # script_tags.html 출력
    write_script_tag_list(subject_id, decks, out_dir)

    # synonyms 역인덱스를 별도 js로 출력 (엔진 소비용)
    inv_path = out_dir / 'synonyms.js'
    inv_js = js_obj(synonyms_inv)
    inv_path.write_text(
        '(window.SYNONYMS = window.SYNONYMS || {})' + f'[{js_str(subject_id)}] = {inv_js};\n',
        encoding='utf-8'
    )

    # build_report.txt 기록
    report_path = Path(getattr(args, 'report', None) or (out_dir / 'build_report.txt'))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text('\n'.join(reporter.to_lines()) + '\n', encoding='utf-8')

    total_cards = sum(len(d['cards']) for d in decks)
    print(f"BUILD OK  subject={subject_id}  decks={len(decks)}  cards={total_cards}  out={out_dir}",
          file=sys.stderr)


# ──────────────────────────────────────────────
# verify 커맨드
# ──────────────────────────────────────────────
def _find_config_json(subjects_root: Path, subject_id: str) -> Path | None:
    """과목/**/config/규칙.json 중 subject_id 일치 경로 반환."""
    for folder in subjects_root.iterdir():
        if not folder.is_dir():
            continue
        candidate = folder / 'config' / '규칙.json'
        if candidate.exists():
            try:
                probe = json.loads(candidate.read_text(encoding='utf-8'))
                if probe.get('subject_id') == subject_id:
                    return candidate
            except Exception:
                pass
    return None


def cmd_verify(args, reporter: Reporter):
    """빌드 없이 검증만"""
    subject_id = args.subject
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    subjects_root = project_root / '과목'
    config_path = _find_config_json(subjects_root, subject_id)
    if config_path is None:
        reporter.error('E_CONFIG_ID_MISMATCH', '-:-',
                       f"config not found for subject: {subject_id}")
        return
    cfg = parse_config_json(config_path, subject_id, reporter)
    if cfg is None:
        return
    normalize_config: dict = cfg.get('normalize_profiles', {})
    if '_default' not in normalize_config and cfg.get('normalize'):
        normalize_config = dict(normalize_config)
        normalize_config['_default'] = cfg['normalize']
    subject_folder = config_path.parent.parent
    content_dir = subject_folder / '콘텐츠'
    md_files = sorted(content_dir.rglob('*.md')) if content_dir.exists() else []
    seen_card_ids: set[str] = set()
    seen_deck_ids: set[str] = set()
    for md_path in md_files:
        if _is_concept_doc(md_path):
            reporter.warn('W_CONCEPT_DOC_SKIP', '-:-',
                          f"개념서 파일 스킵: {md_path.name}")
            continue
        parse_md_file(md_path, subject_id, reporter, seen_card_ids, seen_deck_ids,
                      normalize_config=normalize_config)
    if not reporter.has_error():
        print(f"VERIFY OK  subject={subject_id}", file=sys.stderr)


# ──────────────────────────────────────────────
# verify-backup 커맨드 (§5.3)
# ──────────────────────────────────────────────
def cmd_verify_backup(args, reporter: Reporter):
    loc = '-:-'
    backup_path = Path(args.backup)
    subject_id = args.subject

    try:
        data = json.loads(backup_path.read_text(encoding='utf-8'))
    except Exception as e:
        reporter.error('E_BACKUP_FORMAT', loc, f"백업 파일 읽기/파싱 실패: {e}")
        return

    if data.get('format') != 'study-backup':
        reporter.error('E_BACKUP_FORMAT', loc, f"format≠study-backup: {data.get('format')!r}")
        return

    schema = data.get('schema', 0)
    if not (1 <= schema <= BACKUP_SCHEMA_MAX):
        reporter.error('E_BACKUP_SCHEMA_UNSUPPORTED', loc,
                       f"backup schema={schema} 미지원 (max={BACKUP_SCHEMA_MAX})")
        return

    # 현재 deck card_id 수집
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    subjects_root = project_root / '과목'
    config_path = _find_config_json(subjects_root, subject_id)

    if config_path is None:
        reporter.warn('W_SECTION_INDEX_ABSENT', loc,
                      f"config not found — orphan 검사 스킵")
        return

    cfg = parse_config_json(config_path, subject_id, reporter)
    if cfg is None:
        return
    subject_folder = config_path.parent.parent
    content_dir = subject_folder / '콘텐츠'
    md_files = sorted(content_dir.rglob('*.md')) if content_dir.exists() else []
    seen_card_ids: set[str] = set()
    seen_deck_ids: set[str] = set()
    for md_path in md_files:
        parse_md_file(md_path, subject_id, reporter, seen_card_ids, seen_deck_ids)

    # deck namespace 내 card_id set
    current_ids = {k.split(':', 1)[1] for k in seen_card_ids if k.startswith(f"{subject_id}:")}

    # leitner boxes
    boxes = cfg.get('leitner', {}).get('boxes', 3)

    progress = data.get('progress', {})
    for cid, entry in progress.items():
        ns_key = f"{subject_id}:{cid}"
        if cid not in current_ids:
            reporter.warn('W_ORPHAN_PROGRESS', f"-:{cid}", f"백업 card_id 현 deck에 없음")
        box_val = entry.get('box', 1)
        if isinstance(box_val, int) and box_val > boxes:
            reporter.warn('W_BACKUP_BOX_OUT_OF_RANGE', f"-:{cid}",
                          f"box={box_val} > boxes={boxes}")

    if not reporter.has_error():
        print(f"VERIFY-BACKUP OK  backup={backup_path}", file=sys.stderr)


# ──────────────────────────────────────────────
# CLI 진입점 (§7)
# ──────────────────────────────────────────────
def _ensure_utf8_stdout():
    """
    Windows cp949 환경에서 no-arg 실행 시 argparse help 출력이
    UnicodeEncodeError를 내지 않도록 stdout/stderr를 UTF-8로 재래핑.
    """
    import io
    if hasattr(sys.stdout, 'buffer') and sys.stdout.encoding.lower() not in ('utf-8', 'utf_8'):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'buffer') and sys.stderr.encoding.lower() not in ('utf-8', 'utf_8'):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def main():
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description='generate.py — 콘텐츠 md + config → deck.js + manifest.js'
    )
    subparsers = parser.add_subparsers(dest='command')

    # build
    p_build = subparsers.add_parser('build', help='덱 빌드')
    p_build.add_argument('--subject', required=True, help='subject_id')
    p_build.add_argument('--out', default=None, help='출력 디렉터리')
    p_build.add_argument('--strict', action='store_true', help='경고도 exit 2')
    p_build.add_argument('--clean', action='store_true', help='스테일 deck.js 삭제')
    p_build.add_argument('--reproducible', action='store_true', help='generated_at 고정값')
    p_build.add_argument('--report', default=None, help='빌드 리포트 경로')

    # verify
    p_verify = subparsers.add_parser('verify', help='빌드 없이 검증만')
    p_verify.add_argument('--subject', required=True)
    p_verify.add_argument('--strict', action='store_true')

    # verify-backup
    p_vb = subparsers.add_parser('verify-backup', help='백업 파일 검증(드라이런)')
    p_vb.add_argument('--backup', required=True, help='백업 JSON 경로')
    p_vb.add_argument('--subject', required=True)
    p_vb.add_argument('--strict', action='store_true')

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    reporter = Reporter(strict=getattr(args, 'strict', False))

    if args.command == 'build':
        cmd_build(args, reporter)
    elif args.command == 'verify':
        cmd_verify(args, reporter)
    elif args.command == 'verify-backup':
        cmd_verify_backup(args, reporter)

    sys.exit(reporter.exit_code())


if __name__ == '__main__':
    main()
