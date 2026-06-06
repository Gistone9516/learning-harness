/**
 * card-quiz / manifest.js
 * 플러그인계약 §2 PluginManifest + §9 card-quiz 재배치
 * ─────────────────────────────────────────────────────
 * 전역 등록: window.MANIFEST[subject].plugins 배열에 push.
 * 부트 순서(SoT §7): shell.js 로드 전에 이 파일이 실행됨.
 */
(function () {
  'use strict';

  /** @type {PluginManifest} */
  var CARD_QUIZ_MANIFEST = {
    plugin_id:              'card-quiz',
    label:                  '카드 퀴즈',
    version:                '1.0.0',
    infra:                  'static',          // ACTIVITIES 전역 + JS 채점 + localStorage
    byok:                   null,              // BYO-key 불필요
    capabilities:           ['quiz'],
    scoring_mode:           'auto',            // window.APP.score() 위임
    activity_type:          'card',
    progress_schema_version: 1
    // entry_url 불필요 (static)
  };

  // window.MANIFEST[subject].plugins 배열에 자신을 등록.
  // manifest.js(생성물)가 먼저 로드되어 있어야 함.
  // 아직 로드 안 된 경우 DOMContentLoaded 이전에 실행되더라도
  // window.MANIFEST 자체는 생성물 manifest.js가 등록해 줌.
  function registerManifest() {
    var reg = window.MANIFEST;
    if (!reg) return;
    Object.keys(reg).forEach(function (subjectId) {
      var subj = reg[subjectId];
      if (!Array.isArray(subj.plugins)) subj.plugins = [];
      // 중복 등록 방지
      var exists = subj.plugins.some(function (p) {
        return p.plugin_id === CARD_QUIZ_MANIFEST.plugin_id;
      });
      if (!exists) subj.plugins.push(CARD_QUIZ_MANIFEST);
    });
  }

  // 생성물 manifest.js 이후 로드되므로 즉시 실행 가능
  registerManifest();

  // 혹시 MANIFEST가 아직 없는 경우 대비 (로드 순서 안전망)
  if (!window.MANIFEST) {
    window.addEventListener('DOMContentLoaded', registerManifest);
  }
})();
