# 야간 자율작업 브리핑 — cycle-8 신규 실습 플러그인 (2026-06-09)

> 전권위임·park-and-continue로 진행. 하드플로어(회귀테스트) 그린 유지하며 완주. 사용자 확인 필요분은 본 문서 + `_사용자판단대기.md`.

## 한 줄 요약
**CAD→3D프린팅(`cad3dp`)·로봇(`robot`) 2개 도메인**을 "개념→문제→실습" 입문 학습흐름으로 추가. 개념/문제는 **기존 card-quiz 재사용**, 실습은 **신규 전용 플러그인 2개**(cad-print 모델링 / robot-arm FK). 전 테스트 그린, 부트 와이어링 완료. **남은 건 브라우저 시각검증뿐**(헤드리스 불가).

---

## 적대검토(5렌즈)로 바뀐 핵심 설계 — 왜
처음 플랜은 "개념/문제/실습을 단일 플러그인이 내부 라우팅"이었으나, 5렌즈 전부 high-confidence로 폐기 권고 → 채택:

| # | 원래 | 바뀜 | 이유 |
|---|---|---|---|
| 아키텍처 | 단일 PluginInstance 3모드 | **개념/문제=card-quiz 재사용 + 실습=단일 activity_type 전용플러그인** | 계약(1 plugin=1 activity_type, 단일 score/snapshot) 위반 + 엔진 선행 강제(원칙1 위반) |
| CAD 범위 | 모델링+슬라이싱+G-code 전부 | **모델링만**(JSCAD) | Kiri:Moto self-host·`file://` WASM CORS 미검증(리스크), Tinkercad도 모델링 분리 |
| Robot 갈래 | 경로계획(BFS/A* 코딩) | **FK 슬라이더**(코딩 0) | BFS 직접코딩=입문 부적합, FK 슬라이더가 더 직관·정적·채점명료 |
| 채점 | 이진 통과/실패 | **진단형 피드백**(어디가 왜 틀렸나) | Hattie 피드백모델, 학습효과 |
| 빌드순서 | 콘텐츠/엔진 혼재 병렬 | **_shared SoT 먼저 → 콘텐츠 → 엔진 파이프라인** | producer-consumer 충돌 방지(partition-dry) |

무거운 것(Kiri:Moto·MuJoCo·UAIbotJS·cannon-es·IK·경로계획)은 전부 파킹(브라우저 PoC 선행).

---

## 산출물
**규격(SoT)**: `규격/_shared/실습러너계약.md`, `규격/cad-print/{런타임규격,생성규칙,기능백로그}.md`, `규격/robot/{동일}`.
**콘텐츠(개념/문제, card-quiz용)**: `과목/cad3dp/` · `과목/robot/` 각각 config + 개념서 5섹션 + 문제카드 8장.
**엔진**:
- `엔진/plugins/_shared/practice-runner.js` — 두 실습 공유 3D 골격(three.js 캔버스 생성/리사이즈/dispose).
- `엔진/plugins/cad-print/` — manifest·plugin(JSCAD 실행→부피/바운딩박스/매니폴드 채점)·실습과제·테스트.
- `엔진/plugins/robot-arm/` — manifest·plugin(three.js 2~3링크 암+슬라이더, 순수JS FK 끝점거리 채점)·실습과제·테스트.
**생성물**: `과목/cad3dp/생성물/` · `과목/robot/생성물/`(generate.py로 빌드, deck/manifest/activities/synonyms).
**와이어링**: `엔진/app/subjects.js`(과목 2개 등록), `엔진/app/study.html`(three.js importmap+JSCAD CDN + ENGINE 배열에 신규 6파일).
**공유코어 수정**: `엔진/generate.py`(개념서 .md 스킵 헬퍼 `_is_concept_doc()` 추가).

---

## 검증 결과 (하드플로어 = 회귀테스트 그린)
- **단위테스트**: card-quiz 54 / coding 74 / robot-arm 48 / cad-print exit0 — **전부 PASS, 회귀 깨짐 0**.
- **generate**: cad3dp·robot 각 deck 1·카드 8 빌드 성공.
- **구문검사(node --check)**: 신규 엔진 6파일 + 생성물 8파일 전부 OK → 공유 로더 체인에 넣어도 comp1 안 깨짐 확인.
- **로드-안전성**: 신규 플러그인 전부 top-level에서 THREE/JSCAD 미접근(mount/score 시점만, graceful) → comp1 무영향 확인.

---

## ★ 사용자 할 일 — 브라우저 시각검증 (헤드리스 불가, 육안 필수)
`엔진/app/index.html` 더블클릭 → 과목목록에 **"CAD·3D 프린팅", "로봇 입문(FK)"** 보이는지 확인 → 각 클릭:

**공통(개념/문제 = card-quiz, 가장 확실히 동작):**
1. 개념서 탭에 5개 개념 섹션 표시
2. 퀴즈에서 문제카드 8장 인출 연습 → 채점 동작

**cad-print 실습 탭:**
3. JSCAD 코드 에디터 + "실행 미리보기" → 3D 형상 렌더
4. "제출·채점" → 부피/치수/매니폴드 진단 피드백 표시

**robot-arm 실습 탭:**
5. 2~3링크 로봇팔 렌더 + 관절 슬라이더
6. 슬라이더 조작 → 암 실시간 움직임 + 끝점 좌표 갱신 + 목표 마커
7. "제출·채점" → 끝점-목표 거리 + 방향 진단(예: "끝점이 목표보다 y축 아래")

**⚠️ 만약 3D(3·5번)가 안 뜨면**: `file://`에서 ESM(three.js importmap)이 차단된 것일 수 있음 → 폴더에서 `python -m http.server` 실행 후 `http://localhost:8000/엔진/app/index.html`로 재확인. (개념/문제는 `file://`에서도 정상.)

---

## 파킹(사용자 판단 대기) — 상세 `_사용자판단대기.md`
- **해소됨**: capabilities 셸분기 우려(P4) — 셸은 infra로만 분기, 'practice' 토큰 안전.
- **파킹**: 슬라이싱/G-code(P1)·경로계획/IK(P2)·무거운 라이브러리(P3)·`file://` ESM 실측(P6)·실습탭 전 subject 노출(P7)·generate.py 수정 재확인(P8).

## 다음 사이클 후보
- 브라우저 실측 결과 반영(특히 file:// ESM·CDN).
- 실습탭 subject 스코핑(P7) — 원하면.
- cad-print 모델링 과제·robot FK 과제 추가(현재 각 1~2개) + 개념/문제 분량 확대.
- 슬라이싱/IK 등 파킹 항목 중 사용자 선택분 진입.
