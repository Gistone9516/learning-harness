---
section_id: cad.basics.modeling-intro
subject: cad
area: written
subarea: computer
unit: 3D 모델링 기초
title: 3D 모델링이란 무엇인가
ref_type: concept
weight: 8
related_cards: []
prereq: []
tags: [modeling, intro]
schema_version: 1
---

3D 모델링은 컴퓨터 안에서 물체의 형태를 3차원 수학 데이터로 표현하는 작업이다.
실제로 출력하거나 제조하기 전에 화면 안에서 형상을 설계·수정할 수 있다는 점이 핵심이다.

## 왜 3D 모델이 필요한가

손으로 그린 도면은 2D 정보(너비·높이)만 담는다. 3D 모델은 여기에 깊이(depth)가 더해져 부피·무게·강도를 미리 계산하고 시뮬레이션할 수 있다. 3D 프린터, CNC 가공기, 금형은 모두 이 3D 데이터를 입력으로 받는다.

## 주요 표현 방식

- **솔리드 모델(Solid model)**: 물체의 내부가 꽉 찬 상태로 표현. 부피·질량 계산 가능. 3D 프린팅에 가장 적합.
- **서피스 모델(Surface model)**: 껍데기(표면)만 정의. 시각화·유체역학 시뮬레이션에 주로 사용. 3D 프린팅에는 *닫힌 솔리드*로 변환이 필요.
- **와이어프레임 모델(Wireframe model)**: 모서리(edge)만 표현. 가장 가벼우나 내부 정보 없음.

## 대표 소프트웨어

| 분류 | 예시 |
|------|------|
| 프리미엄 CAD | Fusion 360, SolidWorks, CATIA |
| 오픈소스 / 파라메트릭 | FreeCAD, OpenSCAD, **JSCAD** |
| 메시 편집 | Blender, MeshMixer |

## 선수지식

없음 (이 과목의 첫 번째 개념). 마우스 조작과 좌표(x·y·z축) 개념만 알면 충분하다.
