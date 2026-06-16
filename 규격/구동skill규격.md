# v5 구동 skill 규격

> buildflow ② per-folder 계약. **SoT(`_인터페이스계약.md`)에 conform.** 충돌 시 SoT 권위.
> 범위: `skills/` — 소비 프로젝트가 이 프레임워크를 복사·구동하는 global skill + install. 모델 = `discord-bridge` 동일.
> 출처 모델 = `~/.claude/skills/discord-bridge/SKILL.md`, `Discord Agents/skills/discord-harness.md`.

---

## 1. APP / DATA 분리 모델 (기획 §3·§8)

- **APP(고정 키트)** = 이 리포(봇·엔진코어·harness·skill·`.env`·토큰). 한 곳에 설치.
- **DATA(콘텐츠)** = 소비 과목 프로젝트 폴더(manifest·deck·config = 성격부여, 주입인터페이스).
- "앱은 고정, 콘텐츠 폴더만 갈아끼움." 봇은 **콘텐츠 폴더를 마운트**해 그 과목을 Discord에 올린다.
- 학습 봇 토큰 하나 공유(토큰당 1봇), 콘텐츠 폴더만 바꿔 구동. discord-bridge와 별개 앱/토큰/서버(SoT §0).

---

## 2. global skill (`~/.claude/skills/<name>/SKILL.md`)

소비 프로젝트의 어떤 폴더 세션이든 읽으면 **APP 경로·구동법**을 인지한다(discord-bridge가 cwd를 디스코드에 올리듯).
SKILL.md 내용 계약:
- **APP 경로 명시**: `APP = <이 리포 절대경로>`. 봇·엔진·harness·`.env`·토큰이 여기.
- **구동 명령**: 소비 콘텐츠 폴더에서 `python "<APP>/봇/main.py" [콘텐츠폴더]`. 폴더 생략 시 cwd.
- **APP/DATA 설명**: 토큰·`.env`는 APP에서 읽으므로 폴더마다 재설정 불요. 콘텐츠만 마운트.
- **트리거**: "이 과목을 디스코드로", "학습 봇 띄워", "<프레임워크명> 구동" 등.
- **선행조건 안내**: 새 봇 앱·토큰·학습 서버·`.env`(§5). 미충족 시 구동 거부 메시지.
- **비밀값**: 토큰은 APP `.env`에만, 노출 금지.
- skill 본문은 명령형·간결(운영 지시). 설계 산문 금지(discord skill 재설계 교훈).

---

## 3. install 스크립트 (`skills/install.py`)

- 소비/배포 후 1회 실행 → 클론 위치를 자동 감지해 `~/.claude/skills/<name>/SKILL.md` 생성(유일한 절대경로는 install이 주입, 커밋 안 함).
- self-locating(경로 무관). `.env.example`를 안내. `git clone → python skills/install.py → .env 작성 → 구동` 흐름.
- 봇·엔진·harness는 self-locating(절대경로 비커밋).

---

## 4. 실행 (소비 폴더에서)

```
python "<APP>/봇/main.py" [콘텐츠폴더] [--resume?]
```
- 콘텐츠폴더 = 마운트 대상(생략 시 cwd). 봇이 그 폴더 manifest·deck·config를 로드(주입인터페이스).
- 진도는 그 콘텐츠 폴더 `_상태/`에 저장(콘텐츠별 진도 격리, SoT §2).
- 중지 = Ctrl+C. 봇 1인스턴스(토큰당).
- 소비 프로젝트는 보통 자기 폴더에서 `python "<APP>/봇/main.py"` 한 줄로 자기 과목을 학습.

---

## 5. 선행조건 (사용자 액션, 기획 §12)

1. Discord 개발자포털 **새 봇 앱 생성·토큰 발급**(브리지와 별개).
2. **학습 전용 새 서버(길드) 신설** + 봇 초대(필요 권한 + `applications.commands` 스코프).
3. APP `.env`에 4키(토큰·길드ID·채널ID·허용사용자ID) 기입.
- 권한 부족·스코프 미초대 시 일부 기능(스레드·웹훅·파일·슬래시) 비활성(봇은 기본 대화 동작, 경고).

---

## 6. 배포 (선택, 프라이빗)

- `.gitignore`로 `.env`(토큰)·`_상태`·`__pycache__` 제외. `.env.example` 키 템플릿.
- 절대경로 산출물(global skill)은 비커밋, install이 생성. 봇·엔진·harness·skills 소스만 커밋.
