# UI규격 v2 (계약 · 레퍼런스 디자인 언어 전면 채택)

> buildflow ② 명세. 기계검증 가능 계약. 자유서술 금지.
> 상위 결정 출처: `../기획_v4_수렴.md` · 디자인 원천: `통합 세션/소비자 물가 공부/물가전달_백엔드_학습가이드.html`(이하 **REF**).
> v2 변경: 디자인토큰을 REF의 *확장형 토큰*(종이배경·세리프/모노·레벨색)으로 교체, 3뷰(개념서/퀴즈/대시보드) 레이아웃을 REF 컴포넌트로 재설계. **CDN 허용**(`_인터페이스계약.md` §16 사용자 결정).
> 교차계약 정합: `grade_mode` 집합·`card_id` 규약·Leitner 박스 수(3)는 `../엔진규격.md`·`../카드규격.md`와 동일 고정. 데이터·로직·노출 API = `app.js`(편집 금지) 소관, 본 계약은 **표시·와이어링 계약**.

---

## 0. 용어·표기 규약
- 타입: `string | number | boolean | int | float01(0.0~1.0) | enum | hex | px | ms | array<T> | object`.
- 본 계약의 식별자(`data-*`, CSS 변수명, route key, DOM id)는 **리터럴 고정**. 변경 = 계약 개정.
- 색상값 = `#RRGGBB` 소문자 또는 `rgba()`.
- **데이터구동 불변**: 과목·단원·카드 종류 불문, 화면은 `window.DECKS`/`window.MANIFEST`/`window.SYNONYMS` + `window.APP.*` 반환만으로 렌더. 카드 내용 하드코딩 금지.
- **로직 불가침**: `app.js`는 편집 대상 아님. 본 계약이 보장하는 것은 ① REF 디자인 언어 ② 와이어링 코드가 호출하는 노출 API(§11)의 보존이다.

---

## 1. 라우팅 / 화면 enum

### 1.1 ROUTE (enum, 필수)
| key | 설명 | 기본진입 |
|---|---|---|
| `quiz` | 카드퀴즈 세션 화면 | ✅ default |
| `dashboard` | 진단 대시보드(4위젯) | 부차 |
| `concept` | 개념서 뷰(REF 사이드바+읽기 레이아웃) | 부차 |
| `settings` | 설정(데이터 export/백업) | 부차 |

- cold start = `route="quiz"`. 활성 route는 `<body data-route="<key>">`로 노출(검증 훅).
- route ∉ enum = `E_ROUTE_UNKNOWN`(경고, `quiz` 폴백).
- 화면 전환 메커니즘(hidden 토글/display) 구현 자유. file:// 더블클릭 동작 보장. 세션 휘발 허용.

### 1.2 진입동선 (machine-checkable)
- `R-ENTRY-1`: 로드 완료 & due≥1 → 즉시 `quiz`. 대시보드 경유 금지.
- `R-ENTRY-2`: 대시보드 진입 = 명시적 액션(`[data-route-trigger="dashboard"]`)만.
- `R-ENTRY-3`: `quiz`에 대시보드 진입점 1개 상주, 시각비중 secondary.
- 검증: 초기 DOM에서 `[data-screen="quiz"]` 가시, 나머지 `[hidden]`.

### 1.3 빈상태(위→아래 우선순위)
| 우선 | 상태 | 조건 | 표시 |
|---|---|---|---|
| 1 | `EMPTY_NO_DECK` | 활성 deck 0 | 안내 + settings 링크 |
| 2 | `EMPTY_NEW_USER` | deck≥1 & 진도 0 | quiz 즉시(신규 weight순) |
| 3 | `EMPTY_ALL_FUTURE` | deck≥1 & due=0 & 신규=0 | "오늘 due 없음" + [전체복습 강제소환] |
| — | 정상 | due≥1 | quiz 렌더 |

### 1.4 [전체복습 강제소환]
- `[data-action="force-review-all"]` → 엔진 D-day/전박스 소환 큐(`initSession({dDayMode:true})` 경유). 큐≠∅면 `route="quiz"` + 첫 카드 렌더.

---

## 2. 디자인 토큰 (REF 확장형, `:root` 리터럴 고정)
REF의 종이톤·세리프/모노·레벨색을 채택. 값은 REF에서 직접 이식(확정값 — 더 이상 [OPEN] 아님).

### 2.1 색상 토큰 (확정)
| 변수 | 역할 | 값 |
|---|---|---|
| `--paper` | 종이 배경 베이스 | `#f4f1ea` |
| `--paper2` | 배경 음영 | `#ece7dc` |
| `--surface` | 카드/위젯 면 | `#fbfaf6` |
| `--surface2` | 보조 면/호버 | `#f2eee5` |
| `--ink` | 본문 | `#23211c` |
| `--ink2s` | 보조 텍스트 | `#5a554a` |
| `--ink3` | 흐린 텍스트/캡션 | `#938c7d` |
| `--line` | 경계선 | `#ded7c8` |
| `--line2` | 진한 경계선 | `#cfc7b4` |
| `--brand` | 브랜드 그린(주강조/정답/CTA) | `#1f6b4a` |
| `--brand-deep` | 진한 브랜드 | `#124e35` |
| `--brand-bg` | 브랜드 배경틴트 | `#e4efe7` |
| `--brand-line` | 브랜드 경계 | `#a9d3bc` |
| `--hot` | 최빈출/함정/오답 crimson | `#a8301f` |
| `--hot-bg` / `--hot-line` | crimson 배경/경계 | `#f9e7e2` / `#e4b3a6` |
| `--warn` | 빈출/watch amber | `#9a5a09` |
| `--warn-bg` / `--warn-line` | amber 배경/경계 | `#f8edd7` / `#e6c587` |
| `--blue` | 공식/cloze formula | `#1d4f86` |
| `--blue-bg` / `--blue-line` | blue 배경/경계 | `#e6eef8` / `#aac6e6` |
| `--slate` / `--slate-bg` | 심화/중립 | `#4a5560` / `#eaecef` |

**레벨색 매핑(데이터구동)**: 카드 `tags.weight`(float[1,10])를 3단계 빈출레벨로 환산해 색 부여 —
`weight ≥ 8` → **최빈출**(`--hot`) · `5 ≤ weight < 8` → **빈출**(`--warn`) · `weight < 5` → **심화**(`--slate`). (REF의 ★★★/★★/★ 3단계와 1:1.)
대시보드 status enum 매핑: `safe`→`--brand` · `watch`→`--warn` · `danger`→`--hot`. box 분포: `box1`→`--brand-line` · `box2`→`--brand` · `box3`→`--brand-deep`(동일계열 명도 그라데이션).

### 2.2 타이포 토큰 (CDN 폰트)
| 변수 | 스택 | 용도 |
|---|---|---|
| `--serif` | `'Gowun Batang', serif` | 제목/카드 프롬프트/히어로 |
| `--sans` | `'IBM Plex Sans KR', sans-serif` | 본문/UI |
| `--mono` | `'IBM Plex Mono','Consolas',monospace` | 코드/수치/id/배지 |
- 폰트 = **CDN 로드 허용**(`_인터페이스계약.md` §16). Google Fonts `<link>`(Gowun Batang / IBM Plex Sans KR / IBM Plex Mono). 폰트 미로드 시 시스템 폴백.
- 크기 스케일(권장, 단조증가 불변): `--fs-xs 11px` < `--fs-sm 12.5px` < `--fs-md 14px` < `--fs-lg 17px` < `--fs-xl 25px` < `--fs-2xl 38px`(히어로). `--lh-base 1.6`.

### 2.3 형태/여백/그림자/모션
- radius: `--r 10px`(인풋/배지) · `--r-lg 16px`(카드/위젯) · `--r-xl 24px`(큰 면). `R-SHAPE-1`: 면 컴포넌트 `border-radius ≥ --r`(둥근, 직각 금지).
- 여백(4px 그리드): `--space-1 4px`·`-2 8px`·`-3 12px`·`-4 16px`·`-6 24px`·`-8 32px`.
- 그림자: `--shadow: 0 1px 2px rgba(40,35,25,.04), 0 8px 24px -12px rgba(40,35,25,.16)`(차분 1단, REF).
- 종이 노이즈 배경: `body::before` SVG fractalNoise 오버레이(REF), `opacity ~.4`.
- 모션: `--motion-fast 120ms` · `--motion-base 200ms`. `prefers-reduced-motion` → 0ms(필수).

---

## 3. 공통 셸 컴포넌트 (REF 차용, 3뷰 공유)

### 3.1 사이드바 (`.sidebar`) — 접이식 네비 + 진도바
- 좌측 고정 282px(데스크톱), 종이 그라데이션 면, 우경계 hairline.
- `.brand`: glyph(브랜드 그린 라운드 사각, 세리프 글자) + 과목명(`MANIFEST[subject].subject_label`) + 부제.
- `.overall`: 전체 학습 진도바(`#ov-bar`/`#ov-pct`) — `getDashboardData().completion` 합산 mastery로 채움.
- `.nav`: **area/subarea 그룹**(접이식 `.nav-group`, 헤더 클릭 토글 `.open`) → 그룹 내 **deck/unit 링크**(`.nav-link`). 데이터구동: `MANIFEST[subject].areas` + `.decks`로 생성. 활성 = `.active`.
- 모바일(<980px): off-canvas 드로어(`.sidebar.open` + `.drawer-scrim`), `.menu-btn` 토글.

### 3.2 툴바 (`.toolbar`) — sticky 검색 + 필터칩
- 상단 sticky, 종이 blur. `.menu-btn`(모바일) + `.search-wrap`(`#search`) + `.chips`(필터칩) + route 전환칩.
- 필터칩 `.chip[data-lv]`: `all|3|2|1`(빈출레벨), 활성색 = 레벨색(`.lv3.active`=hot, `.lv2.active`=warn). 개념서/퀴즈에서 카드 필터링에 사용(데이터구동).

### 3.3 히어로 (`.hero`) + 통계 (`.hero-stats`)
- kicker(모노 대문자) + 세리프 h1 + lead. `.hero-stats` = 4 stat 카드(`getDashboardData()`/`MANIFEST.counts`에서 수치). `.legend` = 레벨색 범례.

### 3.4 읽기 진행바 (`#read-bar`)
- 최상단 fixed 3px 그린 게이지(REF), 개념서 스크롤 비율로 width 갱신.

### 3.5 콜아웃·prose·KaTeX·테이블 (REF 그대로)
- `.prose`: 카드 `back.detail`(마크다운) 렌더 컨테이너. `marked`로 파싱, `renderMathInElement`(KaTeX)로 수식.
- `.callout.note|trap|problem`: 노트(brand)·함정(hot, 사선해치)·문제(blue). `.section-card`/`.sec-id`/`.freq.l1..l3`(레벨 배지).
- `.table-wrap`/`.prose table`·`.katex-display`(공식 카드)·`.prose pre`(다이어그램 코드펜스 다크).

---

## 4. QUIZ 뷰 (카드중심 재설계 — REF 톤)
`<section data-screen="quiz">`. 중앙 단일 카드 무대(읽기 폭 ~`740px`), 종이 위 `--surface` 카드.

### 4.1 필수 DOM 노드 (계약)
| selector / id | 역할 | 필수 |
|---|---|---|
| `[data-quiz="progress"]` / `#progress-current` `#progress-fill` `#progress-track-el` | 세션 진행(현재/총 + 게이지) | ✅ |
| `[data-quiz="card-front"]` / `#card-front-prompt` | 앞면(최소단서, 세리프 프롬프트). `R-DENSITY-1`: 핵심블록 ≤1 | ✅ |
| `#card-type-badge` | 카드 type 배지(레벨색) | ✅ |
| `[data-quiz="card-back"]` / `#card-back-detail` `#card-back-note` | 뒷면(`.prose` 상세), 초기 `hidden` | ✅ |
| `[data-quiz="answer-input"][data-grade-mode]` | 입력영역(모드별 §4.2) | exact/keyword/cloze |
| `[data-quiz="self-grade"]` / `[data-self-verdict="o|x"]` | 자가 O·X | self |
| `[data-quiz="reveal"]` / `#btn-reveal` | 정답확인(유일 primary CTA) | ✅ |
| `[data-quiz="concept-link"]` / `#concept-link-btn` | `links.concept_ref` 존재 시 개념서 딥링크 | 조건부 |
| `#feedback-area` `#verdict-display` `#feedback-detail` | 채점 결과(정/오 색, REF 콜아웃 톤) | ✅ |
| `#btn-next` `#btn-skip-card` | 다음/넘기기 | ✅ |
| `#empty-no-deck` `#empty-all-future` `#storage-error-area` | 빈상태/오류(§1.3, §7) | ✅ |

### 4.2 grade_mode별 입력 UI
| grade_mode | 입력 UI | 모바일(<600px) fallback |
|---|---|---|
| `exact` | 단일행 text(`#input-exact-field`) | 단답 유지 |
| `keyword` | textarea(`#input-keyword-field`, `data-input-fallback`) | 단답 단일행 |
| `cloze` | 빈칸별 inline input, `data-blank-index="N"`(0-base 연속) — `getNextCard().answer_spec.blanks`(`string[][]`)로 개수 생성 | inline 유지 |
| `self` | reveal→O·X 버튼. UI가 `o→correct`/`x→incorrect` 변환 후 `score()` 호출 | 동일 |
- 활성 grade_mode 블록만 가시. 채점은 `window.APP.score()`(엔진), UI는 입력 수집·verdict 변환·표시만.

### 4.3 카드 진행 흐름(와이어링 계약)
1. `onCard(card, session, progressStore, synonyms)`로 카드 수신 → 앞면·배지·진행바·입력블록 렌더, 뒷면/피드백 `hidden`.
2. `#btn-reveal` → 입력 수집 → `score({mode, userAnswer, answerSpec, synonyms})` → verdict 산출 → 뒷면(`marked`+KaTeX)·피드백 표시.
3. verdict 확정 시 `window.APP.processAttempt(card_id, verdict, session, progressStore, now, leitnerCfg)` → `saveProgress(progressStore)` → 진도바 갱신.
4. `#btn-next`/`#btn-skip-card` → `getNextCard(session, deck.cards, progressStore, now)` → null이면 빈상태(§1.3).

---

## 5. CONCEPT 뷰 (REF 사이드바 + 스크롤 읽기 — 거의 그대로)
`<section data-screen="concept">`. REF의 사이드바+히어로+섹션카드 읽기 레이아웃 채택.
- 필수: `[data-concept="body"]`(`.prose` 본문 렌더), `[data-concept="back-to-quiz"]`(복귀).
- 딥링크: quiz `[data-quiz="concept-link"]` → `route="concept"` + `links.concept_ref` 섹션 표시. 복귀 시 세션 큐 위치 보존(카드 소비 아님).
- 본 v1 데이터: 개념서 deck 부재 시 카드 `back.detail`을 섹션카드로 묶어 읽기 모드 제공(데이터구동 폴백) + "개념서 미연결" placeholder 허용.
- `#read-bar` 스크롤 진행바 동작.

---

## 6. DASHBOARD 뷰 (REF 위젯 톤)
`<section data-screen="dashboard">`. `.widget-grid`(데스크톱 2열, 모바일 1열) 내 `[data-widget]` 4종, **순서 고정**. 입력 = `window.APP.getDashboardData()`(`_인터페이스계약.md` §15).

| 순서 | widget | 데이터 키 | 표시 | 필수 규칙 |
|---|---|---|---|---|
| 1 | `[data-widget="retrieval"]` | `by_area:{area,subarea,retrieval_rate:float01\|null}` | 영역별 % 정수반올림. `null`→"데이터 부족" | `data-proxy-label`에 "인출성취율(proxy)" 명시(`E_PROXY_LABEL_MISSING`). 합격확률 표현 금지 |
| 2 | `[data-widget="weakness"]` | `weakness:{area,subarea,unit,wrong_rate:float01}` | 리스트형 TOP `WEAKNESS_TOP_N=5`, 행내 게이지(hot). | wrong_rate 내림차순(엔진순서), 범위이탈 클램프 |
| 3 | `[data-widget="pass-path"]` | `pass_path:{area,subarea,target,coverage,mastery,progress,status}` | 목표대비 progress + status enum 색칩 | **status 엔진산출 렌더만**, 임계 재계산 금지. 확률/예측 표현 금지(`E_PASS_PREDICTION`) |
| 4 | `[data-widget="progress-bar"]` | `completion:{area,subarea,box_dist{box1,box2,box3},mastery_rate}` | 영역별 누적 스택바(box색=§2.1) + 범례 | box 3개. UI 연산 금지(엔진 공급값) |

- §3.5 공통: 데이터 0 → 위젯 렌더 유지 + 본문 placeholder. 위젯 헤더 = subhead 명사구. 본문 = 1차 시각블록 ≤1 + 보조 1줄(`R-DENSITY-2`; 스택바/리스트 = 1블록).

---

## 7. 에러/예외 (enum, throw 아닌 상태→안내)
| code | 수준 | 처리 |
|---|---|---|
| `E_ROUTE_UNKNOWN` | 경고 | `quiz` 폴백 + warn |
| `E_GRADE_MODE` | 경고 | 카드 skip + 로그 |
| `E_PROXY_LABEL_MISSING` / `E_PASS_PREDICTION` | 차단 | 빌드 차단 |
| `E_DATA_OUT_OF_RANGE` | 경고 | 클램프 후 표시 |
| `E_DECK_EMPTY` | 상태 | `EMPTY_NO_DECK` |
| `E_STORAGE_SCHEMA` | 상태 | 안내 + settings export 링크, 크래시 금지 |

### 7.1 접근성
- 키보드 단독 네비. focus = DOM 논리순. self-grade `[data-self-verdict="o|x"]` 포커스/키 활성. `o→correct`/`x→incorrect` UI 변환.

---

## 8. 반응형
- `R-RESP-1` PC 우선(≥1024px): 사이드바 282px + 본문, 대시보드 2열.
- bp: `--bp-mobile 600px` · `--bp-tablet 900px` · `--bp-desktop 1024px`.
- `<980px`: 사이드바 off-canvas 드로어. `<600px`: keyword/cloze 단답 강등(`data-input-fallback`), 대시보드 1열. `<body data-viewport-mode="mobile|tablet|desktop">`.

---

## 9. CDN 의존성 (허용, `_인터페이스계약.md` §16)
- 카드/진도 **데이터는 전역**(`window.DECKS/MANIFEST/SYNONYMS`) — fetch 금지(file:// CORS). 앱 = 정적 HTML 더블클릭 유지.
- **원격 허용**(폰트·라이브러리만): Google Fonts(Gowun Batang·IBM Plex Sans KR·IBM Plex Mono), KaTeX(css+js+auto-render), marked. `<head>` `<link>`/`defer <script src>`.
- generate.py는 stdlib 무의존 유지(빌드 레이어 별개).

---

## 10. 인터페이스 시그니처 (UI ↔ 엔진, 표시계약)
`getNextCard()` / `getDashboardData()` 반환 형상 = `../엔진규격.md`·`_인터페이스계약.md` §14/§15와 1:1(v1과 동일, 변경 없음). UI는 표시·수집만, 채점/집계/Leitner는 엔진.

---

## 11. 보존 필수 노출 API (app.js, 와이어링이 호출 — 절대 변경 금지)
와이어링 코드(index.html 인라인)는 아래만 호출한다. 명칭·시그니처 = `app.js` SoT.
- 부트: `window.APP.init(opts)` (opts: `subject?, dDayMode?, newCardLimit?, reviewLimit?, leitnerCfg?, onCard, onEmpty, onError`).
- 세션: `window.APP.initSession(deck_id, opts, now)` · `window.APP.getNextCard(session, cards, progressStore, now)` · `window.APP.processAttempt(card_id, verdict, session, progressStore, now, leitnerCfg)`.
- 채점/진도: `window.APP.score(input)` · `window.APP.saveProgress(store)` · `window.APP.loadProgress(ns)` · `window.APP.getDashboardData(deck, progress, now)`.
- deck: `window.APP.getManifest(subject)` · `window.APP.loadDeck(deck_id)`.
- 콜백 계약: `onCard(card, session, progressStore, synonyms)` · `onEmpty()` · `onError(err)`.
- 코어 네임스페이스 `window.__CLF__.*`(상수·에러클래스·normalize·score·leitnerTransition·nextDueAt·isDue·loadProgress·saveProgress·migrate·getManifest·loadDeck·switchDeck·buildQueue·getDashboardData·initSession·getNextCard·processAttempt) + `window.__CLF_ACTIVE_DECK__` + 전역 데이터 `window.MANIFEST[subject]`·`window.DECKS[deck_id]`·`window.SYNONYMS[subject]`는 모두 그대로 존속(읽기 전용 소비).
- 부트 진입점 = `window.APP.init()` 호출(생성물 scripts → app.js 로드 후).
