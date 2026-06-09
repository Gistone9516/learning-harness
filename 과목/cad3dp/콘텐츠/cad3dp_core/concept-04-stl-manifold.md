---
section_id: cad.basics.stl-manifold
subject: cad
area: written
subarea: computer
unit: STL·매니폴드
title: STL 포맷과 매니폴드(닫힌 솔리드) 개념
ref_type: concept
weight: 8
related_cards: []
prereq: [cad.basics.modeling-intro]
tags: [stl, manifold, mesh]
schema_version: 1
---

3D 프린터에 파일을 보내려면 CAD 모델을 **STL** 형식으로 저장한다.
STL은 표면을 수많은 **삼각형(폴리곤)**으로 분해해 저장하는 포맷이다.

## STL 파일 구조

- 표면 전체를 삼각형 메시(triangle mesh)로 표현
- 각 삼각형: 꼭짓점 3개의 좌표 + 법선 벡터(바깥 방향)
- 색상·재질 정보 없음(순수 형상만)
- ASCII / 바이너리 두 형식 — 3D 프린터 슬라이서는 둘 다 지원

## 매니폴드(Manifold) — 닫힌 솔리드

**매니폴드 메시**란 모든 삼각형의 모서리(edge)가 정확히 두 면과만 공유되는 상태다.
쉽게 말해 "구멍이 없고, 안팎이 명확한 닫힌 표면"이다.

| 상태 | 설명 | 3D 프린팅 가능? |
|------|------|:---:|
| 매니폴드 O | 구멍 없음, 내부/외부 구분 명확 | ✅ |
| 매니폴드 X (비매니폴드) | 열린 면, T자 엣지, 중복 꼭짓점 등 | ❌ (슬라이서 오류) |

## 비매니폴드가 생기는 흔한 원인

1. **열린 면(open face)**: 서피스 모델을 그대로 저장 — 두께가 없음
2. **T자 엣지(T-junction)**: 한 엣지에 3개 이상의 면이 붙음
3. **중복 꼭짓점(duplicate vertex)**: 같은 위치의 꼭짓점이 별개로 존재
4. **뒤집힌 법선(flipped normal)**: 삼각형의 안팎 방향이 일관되지 않음

## JSCAD와 매니폴드

JSCAD의 기본 프리미티브(`cuboid`, `sphere`, `cylinder` 등)는 처음부터 매니폴드를 보장한다.
단, 직접 메시를 조작하거나 CSG 연산을 잘못 쓰면 비매니폴드가 발생할 수 있다.
`measureVolume()` 함수가 **NaN 또는 음수**를 반환하면 비매니폴드 신호로 볼 수 있다.

## 선수지식

[3D 모델링이란 무엇인가](cad.basics.modeling-intro) — 솔리드 vs 서피스 모델 구분
