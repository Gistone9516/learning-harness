/**
 * nlp-study / manifest.js
 * 플러그인계약 §2 PluginManifest — 자연어처리 학습(읽기+시험시뮬) 플러그인 자기선언.
 * infra=static: marked(읽기) + CodeMirror(시험 에디터) CDN. 서버·BYO-key 불요. 자가확인(self).
 * 부트: shell.js 로드 전 실행. window.MANIFEST['nlp'].plugins 에만 등록(타 과목 오염 금지).
 */
(function () {
  'use strict';

  var NLP_STUDY_MANIFEST = {
    plugin_id:               'nlp-study',
    label:                   '자연어처리 학습',
    version:                 '1.0.0',
    infra:                   'static',
    byok:                    null,
    capabilities:            ['quiz'],
    scoring_mode:            'self',
    activity_type:           'nlp-study',
    progress_schema_version: 1
  };

  // nlp 과목에만 등록(맨 앞 = 기본 플러그인). 이미 있으면 스킵.
  function registerManifest() {
    var reg = window.MANIFEST;
    if (!reg || !reg['nlp']) return;
    var subj = reg['nlp'];
    if (!Array.isArray(subj.plugins)) subj.plugins = [];
    var exists = subj.plugins.some(function (p) { return p.plugin_id === 'nlp-study'; });
    if (!exists) subj.plugins.unshift(NLP_STUDY_MANIFEST);  // 맨 앞 → 기본 플러그인
  }

  registerManifest();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('DOMContentLoaded', registerManifest);
  }
  window.MANIFEST_NLP_STUDY = NLP_STUDY_MANIFEST;
})();
