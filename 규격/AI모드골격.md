# v5 AI 모드 골격

> buildflow ② per-folder 계약. **SoT(`_인터페이스계약.md`)에 conform**, 특히 §5 `invoke`.
> 범위: AI 학습 능력(layer 3)의 공통 골격 — `_invoke` 어댑터 · 토큰 통제 · AI 모드 plug · 멀티턴.
> **복사 모델(SoT §7.2)**: discord-bridge `bridge.py`의 stream-json 어댑터 **패턴을 복제**(~140줄). 브리지 import·실행 0.
> 구체 AI 모드(영단어·문법 등)는 콘텐츠/config 주입 — 본 규격은 **골격만**.

---

## 1. `_invoke` 어댑터 (구독 구동, stream-json)

> **권한 분리(SoT §5)**: `invoke` 인터페이스(시그니처·반환·파라미터 의미)의 권위는 SoT §5. 본 §1은 그 **구동 상세**(CLI 플래그·`--session-id`/`--resume` 분기·Windows 구동)다. 충돌 시 SoT §5.

구동 = `claude -p --input-format stream-json --output-format stream-json --verbose --session-id <uuid>`
(이후 재개 `--resume <uuid>`). **API 키 아님 — 구독 OAuth.** 메시지는 stdin에 JSON 한 줄:
`{"type":"user","message":{"role":"user","content":<text>}}`. 출력 줄 중 `{"type":"result",...}`의 `.result`가 최종 응답.

```python
async def invoke(prompt, *, system=None, model=None, effort="low",
                 max_tokens=None, session_id=None, on_stream=None) -> AIResult: ...
```
- **Windows**: `subprocess.list2cmdline` + `create_subprocess_shell`로 `claude.CMD` 구동. 임의 텍스트는 **argv 아닌 stdin**(인젝션 없음). 줄버퍼 `limit` 상향(긴 추론 줄 대비).
- **스트리밍**: stdout 줄 파싱 — `{"type":"assistant",...}` 중간 텍스트는 `on_stream` 콜백(있으면), `{"type":"result"}`가 최종.
- **세션 미지정**: 단발(새 session_id 생성, 재개 안 함). **지정**: 그 session_id로 `--resume`(멀티턴).
- 반환 = `AIResult{text, ok, error}`. 실패(서브프로세스 오류·타임아웃) → `ok=False`, `error` 설정(throw 아님 — 호출측 graceful).

---

## 2. 토큰 통제 규율 (계약, 모든 AI 능력)

결정적 학습은 토큰 0(SoT §7.8). AI는 **선택적 토큰 + 통제 동반**:
1. **짧은 system preamble** — 역할·종료조건·필요 데이터만(예: 정답 + 채점기준 ~100토큰). 전체 덱·이력 주입 금지.
2. **effort 기본 `low`** — 학습 생성·채점은 깊은 추론 불요. 어려운 경우만 상향.
3. **저렴 모델 우선** — config `capabilities.ai.model`(예: haiku tier). 미지정 시 계정 기본.
4. **max_tokens 상한** — 능력별(힌트 80, 채점 150, 피드백 250, 요약 300 등 권장).
5. **조건부 미호출(토큰 0)** — 트리거 미충족 시 LLM 호출 스킵: due=0 → 리마인더 스킵 / 반복오답 없음 → 일반 폴백 / 규칙으로 충분(적응형 weight) → AI 미호출.
6. **컨텍스트 슬라이싱** — 이력은 최근 N개만(오답 3, 대화 4턴, 대표 카드 5개).

봇은 호출 전 `gating`(layer 4) 통과 필수. AI 호출 중 `typing_indicator` 표시(유휴 중 미표시).

---

## 3. AI 모드 plug 인터페이스

AI 능력 핸들러(학습타입규격 layer 3)는 `_invoke`만 의존(브리지·전역 미의존). 공통 골격:
```python
async def ai_capability(ctx, card_or_input) -> HandlerResult:   # HandlerResult = SoT §1
    if not should_invoke(ctx): return fallback(ctx)        # 조건부 미호출(§2.5)
    sys = build_preamble(card_or_input)                    # 짧은 preamble(§2.1)
    async with typing(ctx.channel):
        r = await invoke(prompt, system=sys, model=ctx.ai_model,
                         effort=ctx.ai_effort, max_tokens=CAP_MAX, session_id=ctx.sid)
    if not r.ok: return graceful(ctx, r.error)             # AIInvokeError graceful
    return parse_and_render(r.text)                        # cards/webhook 렌더
```
- **`ai_openend_grade` 특례(이진 채점)**: preamble에 정답+기준, 출력을 `{"verdict":"correct"|"incorrect","reason":"..."}` JSON으로 **강제**. 파싱 성공 → verdict를 Leitner에 전달(SoT 이진 계약 준수). **파싱 실패 → self 모드 폴백**(사용자 자가판정). AI가 점수·합격확률 산출 금지(SoT §7.5).
- producer→consumer: 결정적 데이터(예: 사용자 큐레이션 목록·외운 항목)를 prompt 재료로 → AI가 실습 생성(파이프라인, 동시병렬 아님).

---

## 4. 멀티턴 (소크라테스·대화형)

- `session_id`로 `--resume` 멀티턴. **슬라이딩 윈도우**(최근 4턴만 컨텍스트) = 호출측 책임(토큰 통제).
- [OPEN-C] 해소: **session_id는 스레드 단위, 봇 메모리 휘발**(봇 재시작 시 새 세션). 진도(store)와 달리 대화 컨텍스트는 영속 안 함(v1). 긴 배치 생성은 `driver`가 자체 상태로 재개(아래).

---

## 5. 배치·생존 (driver + heartbeat)

- 대량 AI 생성/채점은 harness `automation/driver.py`(크래시 내성·키별 resume·웹훅 마일스톤) + `_invoke`(`attempt` 콜백).
- `driver` 진행 = `progressbar`/webhook. asyncio 루프 자체 사망은 `heartbeat`(layer 4)가 멘션으로 감지.
- 토큰: job 단위 1호출 직렬. 배치도 §2 통제 적용.

---

## 6. 에러·보안
- `AIInvokeError`(서브프로세스 실패·타임아웃) → catch, graceful(AI 미사용 경로 폴백, 봇 무중단). SoT §6.
- 비밀값 비노출(프롬프트·출력에 토큰·키 금지). 구독 OAuth의 제3자 사용은 개인 사용만(공개·멀티유저 금지).
- 모든 AI 입력 경로 `gating` 통과.
