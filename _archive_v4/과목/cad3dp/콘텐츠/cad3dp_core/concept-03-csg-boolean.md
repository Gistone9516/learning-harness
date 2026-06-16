---
section_id: cad.basics.csg-boolean
subject: cad
area: written
subarea: computer
unit: CSG 불리언 연산
title: CSG와 불리언 연산(합집합·차집합·교집합)
ref_type: concept
weight: 9
related_cards: []
prereq: [cad.basics.parametric]
tags: [csg, boolean, jscad]
schema_version: 1
---

**CSG(Constructive Solid Geometry)**는 기본 도형(프리미티브)을 조합해 복잡한 형상을 만드는 방법이다.
도형을 직접 깎거나 붙이는 게 아니라, **집합 연산(불리언)**으로 결합·제거한다.

## 3가지 불리언 연산

| 연산 | 이름 | 결과 | JSCAD 함수 |
|------|------|------|-----------|
| ∪ | 합집합(Union) | 두 형상을 합친 하나의 솔리드 | `union(a, b)` |
| − | 차집합(Subtract) | A에서 B가 겹친 부분을 제거 | `subtract(a, b)` |
| ∩ | 교집합(Intersect) | 두 형상이 겹치는 부분만 남김 | `intersect(a, b)` |

## JSCAD 예시

```js
const { union, subtract, intersect } = require('@jscad/modeling').booleans
const { cuboid, sphere } = require('@jscad/modeling').primitives

function main() {
  const box   = cuboid({ size: [40, 40, 40] })
  const ball  = sphere({ radius: 25 })

  // 차집합: 정육면체에서 구를 뺀 오목한 형태
  return subtract(box, ball)
}
```

## 실수포인트

- **순서 중요**: `subtract(a, b)`와 `subtract(b, a)`는 결과가 다르다(a에서 b를 빼는 것 vs b에서 a를 빼는 것).
- **완전히 겹치지 않으면** 차집합이 예상과 다를 수 있다. 두 형상이 실제로 겹치는지 미리 확인.
- union 후 비매니폴드(구멍 또는 T자 접합)가 생기면 출력 오류 가능 — 솔리드 내부에 면이 남지 않도록 주의.

## 왜 중요한가

복잡한 부품(나사구멍이 있는 케이스, 요철 있는 조인트 등)은 기본 도형 여러 개를 CSG로 조합해 만든다. JSCAD 실습에서 대부분의 형상 과제는 이 세 연산의 조합으로 해결된다.

## 선수지식

[파라메트릭 모델링](cad.basics.parametric) — JSCAD 함수 호출 방식
