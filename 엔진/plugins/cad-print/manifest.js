/**
 * cad-print / manifest.js
 * 플러그인계약 §2 PluginManifest — cad-print 플러그인 자기선언
 * ────────────────────────────────────────────────────────────
 * SoT: 규격/cad-print/런타임규격.md §1 (2026-06-09)
 *
 * infra = "static": JSCAD(@jscad/modeling, MIT) + three.js(0.160.0, MIT) CDN 기반.
 *   서버·외부 API·BYO-key 전부 불필요. 채점 100% 브라우저 내 실행.
 *   WASM·worker·iframe 의존 없음. 순수 JS.
 *
 * 부트 순서(플러그인계약 §7): shell.js 로드 전에 이 파일 실행됨.
 * 등록: window.MANIFEST[subject].plugins 배열에 push.
 *
 * CDN 로드 순서 (study.html / index.html):
 *   1. @jscad/modeling UMD  → window.jscadModeling 전역
 *   2. three.js 0.160.0 ESModule (importmap) — 1회만, robot-arm 공유
 *   3. practice-runner.js (_shared)
 *   4. 이 파일 (manifest.js)
 *   5. plugin.js
 */
(function () {
  'use strict';

  /** @type {PluginManifest} */
  var CAD_PRINT_MANIFEST = {
    plugin_id:               'cad-print',
    label:                   'CAD 3D 모델링 실습',
    version:                 '0.1.0',
    infra:                   'static',          // JSCAD + three.js CDN; entry_url 불요
    byok:                    null,              // BYO-key 불필요
    capabilities:            ['practice'],
    scoring_mode:            'auto',            // score() = JSCAD 자동 채점 (기하 측정)
    activity_type:           'cad-model',
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
        return p.plugin_id === CAD_PRINT_MANIFEST.plugin_id;
      });
      if (!exists) subj.plugins.push(CAD_PRINT_MANIFEST);
    });
  }

  registerManifest();

  // 안전망: 로드 순서 역전 시에도 복구되도록 DOMContentLoaded 후 재시도
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('DOMContentLoaded', registerManifest);
  }

  // 외부 참조용 전역 노출 (검증 편의 — 런타임규격 §7 기계검증 V1~V3)
  window.MANIFEST_CAD_PRINT = CAD_PRINT_MANIFEST;

})();
