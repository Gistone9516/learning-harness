---
section_id: cad.basics.parametric
subject: cad
area: written
subarea: computer
unit: 파라메트릭 모델링
title: 파라메트릭 모델링과 치수 구동
ref_type: concept
weight: 9
related_cards: []
prereq: [cad.basics.modeling-intro]
tags: [parametric, jscad]
schema_version: 1
---

파라메트릭 모델링(Parametric modeling)은 형상을 **숫자(파라미터)로 정의**하는 방식이다.
"가로 50mm, 세로 30mm, 높이 20mm 직육면체"처럼 치수를 변수로 저장하기 때문에 파라미터 하나만 바꾸면 전체 형상이 자동으로 업데이트된다.

## 치수 구동(Dimension-driven) 설계의 장점

1. **재사용성**: 같은 설계를 크기만 바꿔 여러 버전에 활용
2. **오류 감소**: 손으로 좌표를 일일이 수정할 필요 없음
3. **협업**: 파라미터 표로 팀원 간 설계 의도를 공유

## JSCAD — 코드 기반 파라메트릭 모델링

JSCAD(@jscad/modeling)는 JavaScript 코드로 3D 형상을 만드는 오픈소스 라이브러리다.
GUI 없이 **코드(함수 호출)**로 모델을 생성하므로 파라미터를 변수로 자연스럽게 관리한다.

```js
const { cuboid } = require('@jscad/modeling').primitives

function main({ width = 50, depth = 30, height = 20 } = {}) {
  return cuboid({ size: [width, depth, height] })
}
```

위 코드에서 `width`, `depth`, `height`가 파라미터다.
`width = 100`으로 바꾸는 것만으로 모델이 즉시 달라진다.

## 파라메트릭 vs 직접 모델링

| 구분 | 파라메트릭 | 직접(DirectEdit) |
|------|-----------|-----------------|
| 수정 방법 | 파라미터 값 변경 | 면/엣지 직접 이동 |
| 역사 관리 | 히스토리 트리로 추적 | 없음(WYSIWYG) |
| 적합 상황 | 반복 수정·변형 | 빠른 스케치·유기적 형태 |

## 선수지식

[3D 모델링이란 무엇인가](cad.basics.modeling-intro) — 솔리드/서피스 모델 구분
