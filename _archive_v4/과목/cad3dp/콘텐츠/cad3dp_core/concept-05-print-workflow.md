---
section_id: cad.basics.print-workflow
subject: cad
area: written
subarea: computer
unit: 3D 프린팅 워크플로
title: 3D 프린팅 전체 워크플로 개요
ref_type: concept
weight: 7
related_cards: []
prereq: [cad.basics.stl-manifold]
tags: [workflow, slicing, fdm]
schema_version: 1
---

3D 프린팅은 "모델링 → STL 변환 → 슬라이싱 → 출력" 4단계 흐름으로 이루어진다.

## 단계별 개요

### 1단계: 모델링(CAD)

CAD 소프트웨어(JSCAD, Fusion 360 등)로 3D 형상을 설계한다.
설계 시 고려사항: 최소 벽 두께(보통 ≥1.2mm), 오버행 각도(45° 이내 권장), 지지대 필요 여부.

### 2단계: STL 변환

CAD 모델을 STL 파일로 저장(내보내기). 이 과정에서 곡면이 삼각형 메시로 분해된다.
해상도(삼각형 개수)를 너무 낮게 설정하면 표면이 울퉁불퉁해지고, 너무 높게 설정하면 파일 크기가 커진다.

### 3단계: 슬라이싱

슬라이서 소프트웨어(Cura, PrusaSlicer 등)가 STL을 얇은 층(레이어)으로 자른다.
이 층별 정보를 G-code로 변환해 프린터에 전달한다.

**주요 슬라이싱 파라미터**

| 파라미터 | 영향 | 일반 입문 설정 |
|---------|------|-------------|
| 레이어 두께 | 표면 품질·출력 시간 | 0.2mm |
| 인필 밀도 | 강도·무게·재료 소비 | 15~20% |
| 지지대 | 오버행 지지 | 45° 초과 시 자동 생성 |
| 출력 속도 | 품질·시간 | 40~60mm/s |

### 4단계: 출력(프린팅)

G-code를 프린터에 전송하면 노즐이 레이어 순서대로 재료를 쌓는다.
**FDM(Fused Deposition Modeling)** 방식이 가장 보편적 — 필라멘트(PLA, PETG 등)를 녹여 적층.

## 워크플로 요약 다이어그램

```
CAD 모델 → [STL 내보내기] → STL 파일 → [슬라이서] → G-code → [3D 프린터] → 출력물
```

## 이 과목에서 다루는 범위

- **모델링(JSCAD)**: 이 과목 실습 플러그인의 핵심
- **STL 변환·매니폴드 검사**: `measureVolume()` 자동 채점으로 간접 확인
- **슬라이싱·출력**: 현재 실습 범위 외(별도 소프트웨어 필요)

## 선수지식

[STL 포맷과 매니폴드](cad.basics.stl-manifold) — STL, 매니폴드 개념
