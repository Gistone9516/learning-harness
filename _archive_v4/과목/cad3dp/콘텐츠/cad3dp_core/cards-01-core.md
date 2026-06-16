---
deck_id: cad3dp_core1
subject_id: cad3dp
title: "CAD·3D 프린팅 입문 — 핵심 개념·원리"
unit: cad3dp-core
area: written
subarea: computer
schema_version: 1
---

## @cad3dp-func-0001
- type: func
- grade_mode: exact
- weight: 8
- concept_ref: cad.basics.modeling-intro
- answers: 솔리드 모델|솔리드

---FRONT---
컴퓨터 안에서 물체의 내부가 꽉 찬 상태로 표현되며, 부피와 질량 계산이 가능한 3D 표현 방식은?

---BACK---
**솔리드 모델(Solid model)**

- 내부가 채워진 완전한 3D 물체 표현
- 부피·질량·무게중심 계산 가능
- 3D 프린팅에 가장 적합한 형식
- 대비: 서피스 모델(껍데기만) / 와이어프레임(모서리만)

**선수지식**: 3D 모델링 기초 — 솔리드·서피스·와이어프레임 세 가지 구분

---

## @cad3dp-func-0002
- type: func
- grade_mode: exact
- weight: 9
- concept_ref: cad.basics.csg-boolean
- answers: subtract|subtract 함수

---FRONT---
JSCAD에서 형상 A에서 형상 B가 겹친 부분을 제거하는(차집합) 불리언 연산 함수는?

---BACK---
**`subtract(a, b)`**

```js
const { subtract } = require('@jscad/modeling').booleans

// 정육면체에서 구를 뺀 형태
const result = subtract(box, ball)
```

- 순서 주의: `subtract(a, b)`는 a에서 b를 뺌. 순서 바꾸면 결과 반대
- 활용: 구멍 뚫기, 오목 패인 부분, 나사 자리 등

**유사 함수**
- `union(a, b)` — 합집합(두 형상을 하나로 합침)
- `intersect(a, b)` — 교집합(겹치는 부분만 남김)

**선수지식**: CSG 불리언 연산 — union·subtract·intersect 세 가지 역할

---

## @cad3dp-func-0003
- type: func
- grade_mode: exact
- weight: 8
- concept_ref: cad.basics.csg-boolean
- answers: union|union 함수

---FRONT---
JSCAD에서 두 형상을 하나의 솔리드로 합치는(합집합) 불리언 연산 함수는?

---BACK---
**`union(a, b)`**

```js
const { union } = require('@jscad/modeling').booleans

const combined = union(boxA, boxB)
```

- 두 형상이 겹치든 아니든 외곽 전체를 하나의 솔리드로 만들어 반환
- 유사 함수: `subtract(차집합)` / `intersect(교집합)`

**선수지식**: CSG 불리언 연산

---

## @cad3dp-cloze-0001
- type: cloze
- grade_mode: cloze
- weight: 9
- concept_ref: cad.basics.parametric

---FRONT---
JSCAD에서 가로 50, 세로 30, 높이 20인 직육면체를 만드는 코드의 빈칸을 채우시오.

```js
const { cuboid } = require('@jscad/modeling').{{primitives}}
function main() {
  return cuboid({ size: [50, 30, {{20}}] })
}
```

---BACK---
- 첫 번째 빈칸: **primitives** — JSCAD의 기본 도형(프리미티브) 모듈 이름
- 두 번째 빈칸: **20** — size 배열의 세 번째 값이 높이(height)

**구문 설명**
- `cuboid({ size: [width, depth, height] })` — 직육면체 생성
- size 배열 순서: [X방향(가로), Y방향(세로), Z방향(높이)]
- primitives 모듈에는 cuboid 외에 sphere, cylinder, cone 등이 있음

**선수지식**: 파라메트릭 모델링 — JSCAD 코드 기반 모델링 기초

---

## @cad3dp-judge-0001
- type: judge
- grade_mode: exact
- weight: 9
- concept_ref: cad.basics.stl-manifold
- answers: measureVolume가 NaN을 반환한다|NaN 반환|measureVolume이 NaN

---FRONT---
JSCAD로 만든 모델의 `measureVolume()` 결과가 NaN으로 표시됐다. 이는 어떤 상태를 의미하는가?

---BACK---
**비매니폴드(non-manifold) 상태** — 솔리드가 닫혀있지 않음

- `measureVolume()`이 NaN 또는 음수를 반환하면 메시가 닫혀있지 않다는 신호
- 원인: 열린 면(open face), T자 엣지, 뒤집힌 법선 등
- 결과: 3D 프린터 슬라이서가 내부/외부를 구분하지 못해 출력 오류 발생

**대처법**
1. CSG 연산 순서 재확인
2. 기본 프리미티브(`cuboid`, `sphere` 등)는 매니폴드 보장 — 직접 메시 조작 시 주의
3. 에러 피드백의 manifold 항목 확인

**선수지식**: STL 포맷과 매니폴드 — 매니폴드(닫힌 솔리드) 개념

---

## @cad3dp-judge-0002
- type: judge
- grade_mode: exact
- weight: 7
- concept_ref: cad.basics.csg-boolean
- answers: subtract(b, a)|subtract(b,a)

---FRONT---
JSCAD에서 구(ball)에서 정육면체(box)를 빼고 싶다. 올바른 코드는?

---BACK---
**`subtract(ball, box)`** — 순서가 핵심

- `subtract(a, b)` = a에서 b를 제거
- `subtract(box, ball)` → 정육면체에서 구를 뺌 (반대)
- `subtract(ball, box)` → 구에서 정육면체를 뺌 (원하는 결과)

**핵심 포인트**: 차집합은 순서가 의미를 바꾼다. "~에서 ~를 뺀다"의 주어(첫 번째 인수)를 항상 확인.

**선수지식**: CSG 불리언 연산 — subtract 순서

---

## @cad3dp-seq-0001
- type: recall_seq
- grade_mode: exact
- weight: 8
- concept_ref: cad.basics.print-workflow
- answers: CAD 모델링|STL 변환|슬라이싱|G-code 전송|출력

---FRONT---
3D 프린팅의 전체 워크플로를 순서대로 나열하시오. (5단계)

---BACK---
**순서**
1. **CAD 모델링** — JSCAD, Fusion 360 등으로 3D 형상 설계
2. **STL 변환** — 표면을 삼각형 메시로 내보내기. 매니폴드 확인 필수
3. **슬라이싱** — Cura, PrusaSlicer 등으로 레이어별 경로 계산
4. **G-code 전송** — 슬라이서가 생성한 기계 명령어를 프린터에 전달
5. **출력** — 프린터가 레이어 순서대로 재료 적층

**중요 체크포인트**
- STL 변환 전: 매니폴드(닫힌 솔리드) 확인
- 슬라이싱 시: 레이어 두께·인필 밀도·지지대 설정

**선수지식**: 3D 프린팅 워크플로 — 전체 흐름 개요

---

## @cad3dp-proc-0001
- type: proc
- grade_mode: keyword
- weight: 6
- concept_ref: cad.basics.print-workflow
- keywords: stl|내보내기|export

---FRONT---
JSCAD로 만든 모델을 3D 프린터용 파일로 저장하려면 어떤 형식으로 내보내야 하는가?

---BACK---
**STL 파일로 내보내기(Export)**

**절차 (JSCAD 기준)**
1. 뷰어에서 모델 확인
2. [Export] 버튼 클릭
3. 파일 형식 = **STL** 선택 (ASCII 또는 Binary)
4. 파일명 지정 후 저장

**확인 사항**
- STL 내보내기 전 `measureVolume()` 값이 정상 양수인지 확인 (매니폴드 검증)
- 해상도 설정: 곡면이 있으면 segmentCount 파라미터로 삼각형 개수 조절

**선수지식**: STL 포맷과 매니폴드, 3D 프린팅 워크플로
