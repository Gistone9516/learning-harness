# 학습 프레임워크 (Discord 네이티브)

> **Discord 위에서 도는 개인 학습 하네스(범용 프레임워크).** 카드 인출·간격반복(Leitner)·진단·AI 학습을
> 파이썬 봇 + Discord로 제공한다. **과목·콘텐츠가 없는 도구 키트** — 다른 프로젝트가 복사·소비하며 과목을 붙인다.
> (v5. 이전 정적 HTML 버전 v4는 `_archive_v4/`에 보존.)

---

## 1. 한눈에

- **무엇** — 결정적 채점·Leitner·대시보드(토큰 0) + AI 학습 모드(`claude -p` 구독 토큰, 선택)를 Discord 네이티브로.
- **왜 Discord** — 멀티기기(폰·PC)와 UI를 Discord가 흡수(자동 동기화·네이티브 컴포넌트). 옆 폴더 `Discord Agents/harness` 카탈로그를 복사해 만든다.
- **과목 무관** — 엔진·봇·하네스에 과목 어휘 하드코딩 0. 콘텐츠·config는 소비 프로젝트가 JSON으로 주입(성격부여).
- **배포 모델** — `discord-bridge`처럼 고정 APP 키트 + 콘텐츠 폴더 마운트. 구동 skill 동봉.

## 2. 빠른 시작 (실행)

**선행조건(사용자 액션):**
1. Discord 개발자포털에서 **새 봇 앱 생성·토큰 발급**(기존 discord-bridge와 별개).
2. **학습 전용 새 서버(길드) 신설** + 봇 초대(필요 권한 + `applications.commands` 스코프).
3. 루트 `.env` 작성(`​.env.example` 복사) — `DISCORD_BOT_TOKEN`·`DISCORD_GUILD_ID`·`DISCORD_CHANNEL_ID`·`DISCORD_ALLOWED_USER_ID`(+ 선택 `USER_LANG`·`MOUNT`).
4. `pip install -U "discord.py>=2.6" python-dotenv`.

**구동:**
```bash
python "봇/main.py" [콘텐츠폴더]      # 폴더 생략 시 현재 폴더. 예시: python "봇/main.py" _예시
```
콘텐츠 폴더의 `manifest.json`·`decks/`·`config/`을 로드해 그 과목을 Discord에 올린다. 진도는 그 폴더 `_상태/`에 저장.

**소비 프로젝트에서:** `python skills/install.py` 1회 → 전역 skill 생성 → 어느 과목 폴더에서든 한 줄로 구동.

## 3. 폴더 구조

```
학습 프레임워크 제작/           ← 범용 프레임워크 리포(실제 과목 콘텐츠 없음)
├ README.md                    ← 이 문서
├ .env.example                 ← .env 템플릿(토큰 빈값)
├ 기획_v5_discord.md           ← ① 기획(의도·아키텍처·스코프)
├ _이데이션_능력카탈로그.md     ← 4계층 학습 능력 카탈로그(+ _이데이션_원본.json)
├ 규격/                        ← ② 명세(계약, SoT-first)
│   ├ _인터페이스계약.md        코어 SoT(공유 타입·영속·와이어링·능력 레지스트리·AI 어댑터·에러·불변)
│   ├ 주입인터페이스.md         소비 프로젝트 콘텐츠·config 주입 포맷
│   ├ 엔진계약.md / 봇계약.md   엔진(순수)·봇(discord.py) 계약
│   ├ 학습타입규격.md           4계층 능력 레지스트리
│   ├ AI모드골격.md             _invoke 어댑터·토큰 통제
│   └ 구동skill규격.md          global skill·install
├ 엔진코어/                    ← 순수 파이썬 코어(discord·파일 I/O 0): scoring·leitner·selection·dashboard·migrate
├ 봇/                          ← discord.py 셸: boot·session·dispatch·handlers·persist·ai·commands
│   └ harness/                 Discord harness 카탈로그(복사본 59파일)
├ skills/                      ← 구동 skill 소스 + install.py
├ _예시/                       ← 개발·검증용 목업 콘텐츠(실제 과목 아님)
├ 웹/                          ← (예약) frontend-design 작업공간 — 연속 인터랙티브 실습·장문 정독, 후순위
└ _archive_v4/                 ← 옛 정적 HTML 프레임워크(포팅·참고 소스)
```

## 4. 기획·설계 핵심

**두 기둥**
- **A. 결정적 학습**(토큰 0) — 채점 4모드(exact/keyword/cloze/self)·정규화·Leitner·출제큐(인터리빙·D-day)·대시보드 집계. v4 JS 코어를 파이썬 순수 함수로 포팅.
- **B. AI 학습 모드**(선택 토큰) — `claude -p --input-format stream-json` `_invoke` 어댑터 패턴 복제(브리지 import·실행 0). 토큰 통제(짧은 preamble·effort low·저렴 모델·조건부 미호출).

**4계층 능력 카탈로그**(소비 config로 켜고 끔) — ① 엔진 코어 ② Discord 학습(harness 프리미티브) ③ AI ④ 인프라(gating·heartbeat 등). 상세 = `_이데이션_능력카탈로그.md`.

**불변 경계**(SoT `규격/_인터페이스계약.md §7`)
- 과목 무관(어휘 하드코딩 0, 전부 주입) · 복사 모델(discord-bridge 런타임 의존 0) · 봇 격리(새 앱·토큰·서버) ·
  **엔진 vs harness 경계**(학습 알고리즘=엔진코어 완전 순수, Discord I/O·파일 저장=harness/봇) · 이진 채점(부분점수·합격확률 없음) · card_id 안정 id · 결정적=토큰0.

**의존 방향**: `봇 → 엔진코어(순수) · harness · 콘텐츠(주입)`. 엔진코어는 누구에도 의존하지 않는다(파일 I/O·discord·harness import 0).

## 5. 개발·테스트

```bash
cd 엔진코어 && python -m pytest tests/ -q      # 엔진 순수 회귀 159
cd 봇       && python -m pytest tests/ -q      # 봇 헤드리스 부트·세션 + _예시 통합 13
```
- 엔진코어 = 순수 함수(`now` 주입 결정성). 봇 = discord 없이 부트·세션 루프 헤드리스 검증(Discord I/O는 라이브 전용).

## 6. 현재 상태

- ✅ **① 기획 · ② 명세(7종, 적대 무결성 통과) · ③ 구현**(엔진코어 + 봇 셸 + 목업 + skill) 완료.
- ✅ **회귀 172 green**(엔진 159 + 봇 13). 결정적 전 루프(부트→큐→채점→Leitner→영속) 헤드리스 증명.
- ⏳ **라이브 Discord 검증** — 사용자 선행조건(봇 앱·토큰·서버). Discord I/O 핸들러는 라이브에서만 검증.
- ⏳ **남은 능력 증분** — mcq_select·seq_modal·AI 모드·SRS 푸시·대시보드 렌더 등(카탈로그 ~30종). 웹(frontend-design) 후순위.

## 7. 어디부터 읽나 (AI·신규 기여자)

1. `기획_v5_discord.md` — 큰 그림. 2. `규격/_인터페이스계약.md` — 코어 SoT(타입·계약). 3. `규격/주입인터페이스.md` — 과목을 붙이는 법. 4. `엔진코어/`·`봇/` 코드 + 테스트.
