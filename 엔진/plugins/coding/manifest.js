/**
 * coding / manifest.js
 * 플러그인계약 §2 PluginManifest — coding 플러그인 자기선언
 * ────────────────────────────────────────────────────────
 * infra = "static": Pyodide(WebAssembly) + CodeMirror CDN 기반.
 *   서버·외부 API·BYO-key 전부 불필요. 채점 100% 브라우저 내.
 * 부트 순서(플러그인계약 §7): shell.js 로드 전에 이 파일 실행됨.
 * 등록: window.MANIFEST[subject].plugins 배열에 push.
 */
(function () {
  'use strict';

  /** @type {PluginManifest} */
  var CODING_MANIFEST = {
    plugin_id:               'coding',
    label:                   '코딩 실습',
    version:                 '1.0.0',
    infra:                   'static',        // Pyodide + CodeMirror CDN; entry_url 불요
    byok:                    null,            // BYO-key 불필요
    capabilities:            ['code-exec'],
    scoring_mode:            'auto',          // score() = Pyodide 자동 채점
    activity_type:           'code-problem',
    progress_schema_version: 1
    // entry_url 생략 (static)
  };

  // window.MANIFEST[subject].plugins 배열에 자신을 등록.
  // card-quiz/manifest.js 패턴과 동일.
  function registerManifest() {
    var reg = window.MANIFEST;
    if (!reg) return;
    Object.keys(reg).forEach(function (subjectId) {
      var subj = reg[subjectId];
      if (!Array.isArray(subj.plugins)) subj.plugins = [];
      var exists = subj.plugins.some(function (p) {
        return p.plugin_id === CODING_MANIFEST.plugin_id;
      });
      if (!exists) subj.plugins.push(CODING_MANIFEST);
    });
  }

  registerManifest();

  // MANIFEST 아직 없는 경우 안전망 (로드 순서 역전 대비)
  if (!window.MANIFEST) {
    window.addEventListener('DOMContentLoaded', registerManifest);
  }

  // 외부 참조용 전역 노출 (선택적 — 검증 편의)
  window.MANIFEST_CODING = CODING_MANIFEST;
})();
