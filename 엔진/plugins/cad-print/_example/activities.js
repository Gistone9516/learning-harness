/**
 * cad-print / _example / activities.js
 * ─────────────────────────────────────────────────────────────────
 * cad-print 플러그인 ActivitySpec 실습 데이터.
 * window.ACTIVITIES["cad-print"] 배열에 등록.
 *
 * SoT: 규격/cad-print/생성규칙.md (2026-06-09)
 *      규격/cad-print/런타임규격.md §2 ActivitySpec 스키마
 *
 * ActivitySpec (cad-model 타입):
 *   type        : "cad-model"
 *   front       : { prompt, starter_code, target_spec, hints[] }
 *   back        : { solution_code, grading, why, explanation }
 *   grading     : {
 *                   volume_target       : number  (mm³)
 *                   volume_tolerance_pct: number  (%)
 *                   bbox_target         : {x,y,z} (mm)
 *                   bbox_tolerance      : number  (mm)
 *                 }
 *
 * 채점 흐름:
 *   사용자 JSCAD 코드 실행 → geometry 생성
 *   → measureVolume / measureBoundingBox 측정
 *   → 부피 오차(%) + 바운딩박스 오차(mm) + 매니폴드 여부 판정
 *   → ScoreResult (진단형 feedback)
 *
 * 비전공자 MVP 분량: 5개 activity (생성규칙 §1-2)
 *   1. cad-box-001     직육면체 (입문)
 *   2. cad-cylinder-001 원기둥 (입문)
 *   3. cad-union-001   두 직육면체 union (기초)
 *   4. cad-subtract-001 직육면체에 원통 구멍 (기초)
 *   5. cad-manifold-check-001 닫힌 솔리드 수정 (기초)
 *
 * grading 수치 근거 (생성규칙 §2-3 검증 의무):
 *   JSCAD primitives 수학 공식으로 계산한 정확값.
 *   cuboid(size=[x,y,z])  → vol = x*y*z, bbox = [x,y,z]
 *   cylinder(r,h)         → vol = π*r²*h, bbox = [2r,2r,h]
 *   union(겹침 없음)        → vol = 합산, bbox = 합산 바운딩박스
 *   subtract              → vol = base - hole, bbox = base bbox
 *   (JSCAD 원점 중심 배치로 치수 = size 그대로)
 * ─────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (!window.ACTIVITIES) window.ACTIVITIES = {};

  window.ACTIVITIES['cad-print'] = [

    /* ────────────────────────────────────────────────────────────
       1. cad-box-001 — 직육면체 (입문, weight 2)
       형상: 20×30×15mm 직육면체
       vol   = 20 * 30 * 15 = 9000 mm³
       bbox  = {x:20, y:30, z:15}
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cad-box-001',
      plugin_id:   'cad-print',
      type:        'cad-model',
      weight:      2,
      tags: { area: '3D모델링', subarea: '기초형상', unit: 'unit-modeling-basic' },
      enabled: true,
      front: {
        prompt:      '20×30×15mm 직육면체를 JSCAD 코드로 만드세요.\n치수: 가로 20mm, 세로 30mm, 높이 15mm.\n(cuboid 함수 하나만 사용하면 됩니다.)',
        target_spec: '20×30×15mm 직육면체 (부피 9000mm³)',
        starter_code: [
          '// JSCAD @jscad/modeling 라이브러리에서 primitives 가져오기',
          'const { cuboid } = require(\'@jscad/modeling\').primitives;',
          '',
          'function main() {',
          '  // cuboid({ size: [가로, 세로, 높이] }) 형태로 직육면체 생성',
          '  // 여기에 작성',
          '',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        hints: [
          '선수지식: 3D 좌표계(x,y,z)와 mm 단위 이해 필요.',
          'cuboid({ size: [x, y, z] }) — size 배열 순서는 x(가로), y(세로), z(높이)입니다.',
          'main() 함수가 return 값으로 geometry 객체를 반환해야 합니다.'
        ]
      },
      back: {
        solution_code: [
          'const { cuboid } = require(\'@jscad/modeling\').primitives;',
          '',
          'function main() {',
          '  return cuboid({ size: [20, 30, 15] });',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        grading: {
          volume_target:        9000,
          volume_tolerance_pct: 5,
          bbox_target:          { x: 20, y: 30, z: 15 },
          bbox_tolerance:       0.5
        },
        why:         'cuboid의 size 배열이 [x, y, z] 순이며 직육면체 부피 = x×y×z = 20×30×15 = 9000mm³.',
        explanation: 'cuboid() 프리미티브로 직육면체 즉시 생성. JSCAD는 원점(0,0,0) 중심 배치. size [20,30,15]이 각 축 치수(mm).'
      }
    },

    /* ────────────────────────────────────────────────────────────
       2. cad-cylinder-001 — 원기둥 (입문, weight 2)
       형상: 반지름 10mm, 높이 25mm 원기둥
       vol   = π * 10² * 25 ≈ 7853.98 mm³
       bbox  = {x:20, y:20, z:25}  (지름×지름×높이)
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cad-cylinder-001',
      plugin_id:   'cad-print',
      type:        'cad-model',
      weight:      2,
      tags: { area: '3D모델링', subarea: '파라메트릭', unit: 'unit-parametric' },
      enabled: true,
      front: {
        prompt:      '반지름 10mm, 높이 25mm인 원기둥을 JSCAD 코드로 만드세요.\n치수: 반지름 10mm (지름 20mm), 높이 25mm.\n(cylinder 함수의 radius와 height 파라미터를 사용합니다.)',
        target_spec: '반지름 10mm, 높이 25mm 원기둥 (부피 ≈ 7854mm³)',
        starter_code: [
          '// primitives에서 cylinder 가져오기',
          'const { cylinder } = require(\'@jscad/modeling\').primitives;',
          '',
          'function main() {',
          '  // cylinder({ radius: 반지름, height: 높이 }) 형태',
          '  // 여기에 작성',
          '',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        hints: [
          '선수지식: 파라메트릭 모델링 — 수치(파라미터)로 형상을 정의하는 방식.',
          'cylinder({ radius: r, height: h }) — r=반지름(mm), h=높이(mm).',
          '부피 공식: π × r² × h ≈ 3.14159 × 100 × 25 ≈ 7853.98mm³.'
        ]
      },
      back: {
        solution_code: [
          'const { cylinder } = require(\'@jscad/modeling\').primitives;',
          '',
          'function main() {',
          '  return cylinder({ radius: 10, height: 25 });',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        grading: {
          volume_target:        7853.98,
          volume_tolerance_pct: 5,
          bbox_target:          { x: 20, y: 20, z: 25 },
          bbox_tolerance:       0.5
        },
        why:         'cylinder의 radius=10(mm), height=25(mm). 부피 = π×r²×h = π×100×25 ≈ 7853.98mm³. 바운딩박스 x=y=지름=20, z=높이=25.',
        explanation: 'cylinder() 프리미티브 — radius가 반지름(지름 아님)임을 주의. JSCAD 세그먼트 기본값(32)으로 충분히 매끄러운 원형 단면 생성.'
      }
    },

    /* ────────────────────────────────────────────────────────────
       3. cad-union-001 — 두 직육면체 union (기초, weight 4)
       형상: 40×10×10mm 직육면체 + 10×40×10mm 직육면체 (십자 모양)
             두 직육면체가 중심(원점)에서 교차 — 겹치는 영역 10×10×10mm 존재
       vol   = 40*10*10 + 10*40*10 - 10*10*10 = 4000 + 4000 - 1000 = 7000 mm³
       bbox  = {x:40, y:40, z:10}
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cad-union-001',
      plugin_id:   'cad-print',
      type:        'cad-model',
      weight:      4,
      tags: { area: '3D모델링', subarea: 'CSG', unit: 'unit-csg' },
      enabled: true,
      front: {
        prompt:      '두 직육면체를 union(합집합)으로 합쳐 십자(+) 형태를 만드세요.\n직육면체 A: 40×10×10mm (x방향 긴 막대)\n직육면체 B: 10×40×10mm (y방향 긴 막대)\n두 막대를 원점 중심에 배치하고 union으로 합치세요.',
        target_spec: '십자형 union 솔리드 (부피 7000mm³, 바운딩박스 40×40×10mm)',
        starter_code: [
          'const { cuboid } = require(\'@jscad/modeling\').primitives;',
          'const { union } = require(\'@jscad/modeling\').booleans;',
          '',
          'function main() {',
          '  // 직육면체 A: 40×10×10mm (x방향 막대)',
          '  const barA = cuboid({ size: [40, 10, 10] });',
          '',
          '  // 직육면체 B: 10×40×10mm (y방향 막대)',
          '  // 여기에 barB 작성',
          '',
          '  // union으로 두 솔리드 합치기',
          '  // 여기에 return 작성',
          '',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        hints: [
          '선수지식: CSG(Constructive Solid Geometry) — 불리언 연산으로 복잡한 형상 생성.',
          'union(solidA, solidB) — 두 솔리드의 합집합(겹친 부분 제거, 외부 형상만 남음).',
          '겹치는 부분(10×10×10mm)이 있으므로 부피 = 4000 + 4000 - 1000 = 7000mm³.'
        ]
      },
      back: {
        solution_code: [
          'const { cuboid } = require(\'@jscad/modeling\').primitives;',
          'const { union } = require(\'@jscad/modeling\').booleans;',
          '',
          'function main() {',
          '  const barA = cuboid({ size: [40, 10, 10] });',
          '  const barB = cuboid({ size: [10, 40, 10] });',
          '  return union(barA, barB);',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        grading: {
          volume_target:        7000,
          volume_tolerance_pct: 5,
          bbox_target:          { x: 40, y: 40, z: 10 },
          bbox_tolerance:       0.5
        },
        why:         'union은 두 솔리드의 합집합. 겹치는 10×10×10mm 큐브는 한 번만 계산되어 총 부피 = 4000+4000-1000 = 7000mm³.',
        explanation: 'cuboid 두 개를 원점 중심 배치 후 union. JSCAD union()은 매니폴드(닫힌 솔리드)를 보장. 바운딩박스는 두 막대의 합산 = 40×40×10.'
      }
    },

    /* ────────────────────────────────────────────────────────────
       4. cad-subtract-001 — 구멍 뚫기 subtract (기초, weight 4)
       형상: 30×30×20mm 직육면체에서 반지름 5mm, 높이 30mm 원기둥(관통)을 빼기
       base  = 30*30*20 = 18000 mm³
       hole  = π*5²*30 ≈ 2356.19 mm³  (높이 30 = base보다 커서 완전 관통)
       vol   = 18000 - 2356.19 ≈ 15643.81 mm³
       bbox  = {x:30, y:30, z:20}  (base bbox 그대로)
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cad-subtract-001',
      plugin_id:   'cad-print',
      type:        'cad-model',
      weight:      4,
      tags: { area: '3D모델링', subarea: 'CSG', unit: 'unit-csg' },
      enabled: true,
      front: {
        prompt:      '30×30×20mm 직육면체 블록 중앙에 반지름 5mm 원형 구멍을 수직으로 뚫으세요.\n구멍: 반지름 5mm, 블록을 완전히 관통해야 합니다(매니폴드 조건).\nsubract 불리언 연산을 사용하세요.',
        target_spec: '30×30×20mm 블록에 반지름 5mm 구멍 (부피 ≈ 15644mm³, bbox 30×30×20mm)',
        starter_code: [
          'const { cuboid, cylinder } = require(\'@jscad/modeling\').primitives;',
          'const { subtract } = require(\'@jscad/modeling\').booleans;',
          '',
          'function main() {',
          '  // 베이스 블록: 30×30×20mm',
          '  const base = cuboid({ size: [30, 30, 20] });',
          '',
          '  // 구멍용 원기둥: 반지름 5mm, 블록 관통(높이 > 20mm)',
          '  // 반드시 블록을 완전히 관통해야 매니폴드(닫힌 솔리드) 유지',
          '  // 여기에 hole 작성',
          '',
          '  // subtract(base, hole) — base에서 hole 빼기',
          '  // 여기에 return 작성',
          '',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        hints: [
          '선수지식: CSG subtract — 첫 번째 솔리드에서 두 번째 솔리드를 빼는 차집합 연산.',
          'subtract(base, hole) — base에서 hole을 뺍니다. 인수 순서 주의.',
          '구멍 cylinder의 height를 base보다 크게(예: 30mm) 설정해야 완전 관통 → 매니폴드 보장.',
          '부피 ≈ 18000 - π×25×30 ≈ 18000 - 2356 ≈ 15644mm³.'
        ]
      },
      back: {
        solution_code: [
          'const { cuboid, cylinder } = require(\'@jscad/modeling\').primitives;',
          'const { subtract } = require(\'@jscad/modeling\').booleans;',
          '',
          'function main() {',
          '  const base = cuboid({ size: [30, 30, 20] });',
          '  const hole = cylinder({ radius: 5, height: 30 }); // 완전 관통',
          '  return subtract(base, hole);',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        grading: {
          volume_target:        15643.81,
          volume_tolerance_pct: 5,
          bbox_target:          { x: 30, y: 30, z: 20 },
          bbox_tolerance:       0.5
        },
        why:         'subtract는 base에서 hole을 빼는 차집합. hole height > base height(30>20)이어야 완전 관통 → 매니폴드. 부피 = 18000 - π×25×30 ≈ 15643.81mm³.',
        explanation: 'subtract(base, hole) — 인수 순서가 base, hole 순임을 주의. hole이 완전 관통해야 내부에 닫힌 면이 생기지 않아 watertight(매니폴드) 유지. bbox는 base 그대로.'
      }
    },

    /* ────────────────────────────────────────────────────────────
       5. cad-manifold-check-001 — 닫힌 솔리드(매니폴드) 수정 (기초, weight 4)
       학습 목표: 비매니폴드 starter 코드를 수정해 watertight 솔리드 만들기
       형상: 25×25×25mm 정육면체 (매니폴드)
       vol   = 25*25*25 = 15625 mm³
       bbox  = {x:25, y:25, z:25}
       starter는 의도적으로 열린 geometry를 반환하는 잘못된 코드
    ──────────────────────────────────────────────────────────── */
    {
      activity_id: 'cad-manifold-check-001',
      plugin_id:   'cad-print',
      type:        'cad-model',
      weight:      4,
      tags: { area: '3D모델링', subarea: '매니폴드', unit: 'unit-stl-manifold' },
      enabled: true,
      front: {
        prompt:      '아래 starter 코드는 올바른 매니폴드(watertight) 솔리드를 생성하지 못합니다.\n코드를 수정해 25×25×25mm 정육면체 닫힌 솔리드를 만드세요.\n핵심 개념: 3D프린팅에서 STL 슬라이싱이 되려면 솔리드가 반드시 닫혀야(watertight) 합니다.',
        target_spec: '25×25×25mm 정육면체, 매니폴드(닫힌 솔리드) (부피 15625mm³)',
        starter_code: [
          '// 주의: 이 코드는 열린(open) 폴리곤을 반환해 매니폴드가 깨집니다.',
          '// 수정해서 올바른 닫힌 솔리드(cuboid)를 반환하도록 고치세요.',
          '',
          'const { primitives, geometries } = require(\'@jscad/modeling\');',
          '',
          'function main() {',
          '  // 잘못된 코드: 빈 geom3 반환 → 비매니폴드',
          '  // return geometries.geom3.create([]);  // ← 이 줄을 수정하세요',
          '',
          '  // 올바른 코드: cuboid 프리미티브 사용',
          '  // 여기에 작성 (primitives.cuboid 또는 require 패턴 모두 가능)',
          '',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        hints: [
          '선수지식: 매니폴드(watertight) = 솔리드의 모든 면이 닫혀있어 내부/외부가 구분되는 상태. STL 슬라이싱 필수 조건.',
          '비매니폴드란 열린 면(open edge), 자기교차(self-intersection), 중복 면 등으로 "구멍"이 생긴 상태.',
          'JSCAD primitives.cuboid()는 항상 매니폴드 솔리드를 반환합니다.',
          '빈 geom3나 2D 평면 폴리곤은 부피가 NaN/0 → 채점기가 매니폴드 실패로 판정.'
        ]
      },
      back: {
        solution_code: [
          'const { cuboid } = require(\'@jscad/modeling\').primitives;',
          '',
          'function main() {',
          '  return cuboid({ size: [25, 25, 25] });',
          '}',
          '',
          'module.exports = { main };'
        ].join('\n'),
        grading: {
          volume_target:        15625,
          volume_tolerance_pct: 5,
          bbox_target:          { x: 25, y: 25, z: 25 },
          bbox_tolerance:       0.5
        },
        why:         'JSCAD primitives는 수학적으로 닫힌 솔리드를 보장. cuboid({ size:[25,25,25] })는 부피=15625mm³, 모든 면이 닫힌 watertight 솔리드.',
        explanation: '매니폴드 여부는 measureVolume() 반환값으로 확인: NaN 또는 ≤0이면 비매니폴드. cuboid 등 기본 프리미티브는 항상 매니폴드. CSG 연산 후 비매니폴드가 발생하면 열린 면 또는 자기교차가 원인.'
      }
    }

  ]; // end window.ACTIVITIES['cad-print']

})();
