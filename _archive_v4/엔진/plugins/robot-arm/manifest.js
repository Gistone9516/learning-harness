/**
 * robot-arm / manifest.js
 * 플러그인계약 §2 PluginManifest — robot-arm 플러그인 자기선언
 * ────────────────────────────────────────────────────────
 * SoT: 규격/robot/런타임규격.md §1 (2026-06-09)
 *
 * infra = "static": three.js(CDN 0.160.0) + 순수 JS FK 삼각함수 계산.
 *   서버·외부 API·WASM·물리엔진 전부 없음. file:// 더블클릭 동작.
 *
 * 부트 순서(플러그인계약 §7):
 *   study.html이 [CDN → 생성물 scripts → 플러그인(manifest→plugin.js) → shell.js] 순 로드.
 *   practice-runner.js가 이 파일보다 먼저 로드되어야 createPracticeRunner 사용 가능.
 *
 * 등록: window.MANIFEST[subject].plugins 배열에 push (coding/manifest.js 패턴 동일).
 *
 * 기계검증 체크리스트 (런타임규격 §8):
 *   V1  window.MANIFEST_ROBOT_ARM.infra === "static"             ✓
 *   V2  window.MANIFEST_ROBOT_ARM.activity_type === "robot-fk"  ✓
 *   V3  window.MANIFEST_ROBOT_ARM.scoring_mode === "auto"       ✓
 *   V4  window.MANIFEST_ROBOT_ARM.capabilities 에 "practice" 포함 ✓
 */
(function () {
  'use strict';

  /** @type {PluginManifest} */
  var ROBOT_ARM_MANIFEST = {
    plugin_id:               'robot-arm',
    label:                   '로봇 팔 FK 실습',
    version:                 '0.1.0',
    infra:                   'static',      // three.js CDN + 순수 JS FK 계산; entry_url 불요
    byok:                    null,          // BYO-key 불필요
    capabilities:            ['practice'],
    scoring_mode:            'auto',        // score() = 순수 JS FK 거리 자동 채점
    activity_type:           'robot-fk',
    progress_schema_version: 1
    // entry_url 생략 (static)
  };

  // window.MANIFEST[subject].plugins 배열에 자신을 등록.
  // coding/manifest.js 패턴과 동일.
  function registerManifest() {
    var reg = window.MANIFEST;
    if (!reg) return;
    Object.keys(reg).forEach(function (subjectId) {
      var subj = reg[subjectId];
      if (!Array.isArray(subj.plugins)) subj.plugins = [];
      var exists = subj.plugins.some(function (p) {
        return p.plugin_id === ROBOT_ARM_MANIFEST.plugin_id;
      });
      if (!exists) subj.plugins.push(ROBOT_ARM_MANIFEST);
    });
  }

  registerManifest();

  // 안전망: 로드 순서 역전 시에도 복구되도록 DOMContentLoaded에도 등록
  window.addEventListener('DOMContentLoaded', registerManifest);

  // 외부 참조용 전역 노출 (검증 편의, 런타임규격 §1 선언 형태 conform)
  window.MANIFEST_ROBOT_ARM = ROBOT_ARM_MANIFEST;
})();
