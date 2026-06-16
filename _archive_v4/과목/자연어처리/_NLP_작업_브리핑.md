# 자연어처리 카드퀴즈 — 무인 작업 종료 브리핑

작성: 2026-06-09 (사용자 취침 중 자율 진행). hard-floor(회귀깨짐)만 정지 원칙, 결정사항은 아래 파킹.

## 한 일
1. **과목 리스트 랜딩 구조** (요청: 첫 페이지=과목 선택 → 학습 페이지 이동)
   - `엔진/app/index.html` = 과목 카드 랜딩(현재 nlp·comp1·cad3dp·robot 표시 — cad3dp·robot은 야간 병렬작업이 추가, 내가 안 건드림).
   - `엔진/app/study.html` = `?subject=` 동적 로더(file:// DOM 주입, synonyms→manifest→decks→엔진→shell→init). 원본 comp1 index는 `_index.comp1.bak.html`로 백업.
   - `엔진/app/subjects.js` = 과목 레지스트리.
2. **자연어처리(nlp) 과목 신설** — `config/규칙.json` + `콘텐츠/*.md` → `생성물/` 빌드. **총 259장**.
   - 3단계 = 사이드바 3그룹: **1)개념(64) · 2)라이브러리 명령어(74) · 3)기말 답안·실전(7.1 61 + 7.2 60)**.
   - 비전공자 기준 세분화(한 카드=한 개념, 토대카드부터). 명령어=함수·파라미터 단위. 실전=문제 self 자가채점 100문 + 핵심용어 exact/cloze 추출.
3. **실전 2-pane** (요청: 코드 좌 / 문제 우) — `card-quiz/plugin.js` 렌더 분기 + `styles.css`. front에 ```코드``` 있으면 좌=코드·우=문제, 없으면 자동 1-pane. 엔진 로직 무변경.
4. **deepflow-auto 4라운드** 수렴개선 — 5렌즈 비판→opus 합성(소스 대조)→덱별 개선. 채택 의미건수 19·11·17·17.

## 검증 (모두 통과)
- 빌드: `generate.py build --subject nlp` E_ 0 (개념서 경고만).
- 정합: self→`answer_spec:null` 위반 0, card_id 중복 0.
- **verbatim: 실전 self Q01~50 4라운드 내내 원본 유지(7.1 0미스 / 7.2 4건은 코드블록 시작 오탐, 직접대조로 내용 일치 확인).**
- 회귀: card-quiz score 54/54, boot PASS. (엔진 무수정·렌더만 변경 → 회귀 0)

## deepflow-auto 주요 개선 (개념·명령어·term 카드에 한정, 실전 self는 verbatim 잠금)
- 사실정정: Embedding 학습기제(과제-지도 역전파, co-occurrence 아님), LSTM 게이트 순서(망각→입력→출력), TF-IDF `smooth_idf`(sklearn 공식=0나눗셈 방지로 web검증·정정), `max_df` 경계(초과 vs 이상 off-by-one 주석).
- 인출품질: 앞면 정답누설(cue-leakage) 제거, 한 카드=한 개념 원자성, cloze 자기힌트 제거.
- 비전공자 보강: 뉴런/층/relu/기울기소실/경사하강 전방참조·인과 공백 메우기, 토대카드 신설.

## ⚠️ 사용자 판단 필요 (파킹 — 자율로 안 건드림)
1. **deepflow-auto 미수렴**: 4라운드 캡까지 매 라운드 의미개선이 계속 나옴(17,17로 안 줄어듦, 2-dry 미도달). 더 돌리면 추가 개선 여지 있음. **한 사이클 더 돌릴까요?** (캡은 지시대로 4 지킴)
2. **area/subarea enum**: NLP 3단계를 컴활 전용 enum(written/computer·spreadsheet·database)에 라벨로 매핑(=의도된 3단계 분리, 정상동작). 정식 NLP-native enum은 `규격/생성규칙.md`+`generate.py`(E_AREA_UNKNOWN)+엔진 탭까지 동반수정 = 회귀위험이라 **파킹**. cad3dp·robot도 같은 한계 공유 → 과목-무관 area 일반화를 별도 사이클로 권장. **enum 확장 진행할까요?**
3. **노트북 `stratify=y_onehot`(2D 원핫)**: 작동하나 sklearn 표준은 1D(`stratify=y`). 원본 노트북 수정은 교수/사용자 영역이라 미변경, 명령어 덱엔 주의메모만 반영.

## code_todos 점검 결과 (deepflow가 올린 것 중 대부분은 오판 — 이미 처리됨)
- "코드 없는 카드 2-pane 좌측 공백" → **이미 자동 1-pane 폴백** 구현됨(오판).
- "self BACK 채점 전 노출(스포일러)" → BACK은 reveal 클릭 전 숨김, self는 recall→reveal→O/X 정상흐름(오판).
- 실제 미해결 = enum 확장(위 2번)뿐.

## 사용법
`엔진/app/index.html` 더블클릭 → **자연어처리** → 1)개념 → 2)명령어 → 3)실전 순. 실전은 좌측 코드 보며 우측 문제 → 답 떠올리고 정답확인 → O/X 자가채점. 진도 localStorage 저장.

## 임시 파일 (삭제 가능)
- `과목/자연어처리/_verify.py`, `_verify_report.txt` (정합 검증 스크립트)
- `과목/자연어처리/_annotate.py` (이전 노트북 주석 스크립트), `_repo/` (clone 원본, 용량 큼)
삭제 여부 알려주세요.
