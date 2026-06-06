/**
 * excel / manifest.js
 * 플러그인계약 §2 PluginManifest 선언 — excel 플러그인
 * ────────────────────────────────────────────────────────────
 * 런타임규격 §1 conform.
 *
 * plugin_id  = "excel"
 * infra      = "static"  (Univer CDN UMD, 서버·키 불요)
 * 등록 전역명: window.MANIFEST_EXCEL
 *
 * shell.js _registerPlugins 규칙:
 *   plugin_id = "excel"
 *   camelCase 변환: globalKey  = "_EXCEL_PLUGIN"
 *   direct 변환:    directKey  = "_EXCEL_PLUGIN"  (동일)
 *   → window._EXCEL_PLUGIN 을 PLUGIN_REGISTRY['excel']에 삽입.
 */

window.MANIFEST_EXCEL = {
  plugin_id:               'excel',
  label:                   '엑셀 실습',
  version:                 '1.0.0',
  infra:                   'static',      // Univer CDN, 서버·키 불요 (런타임규격 §1)
  entry_url:               undefined,
  byok:                    null,
  capabilities:            ['sheet'],
  scoring_mode:            'auto',
  activity_type:           'sheet-task',
  progress_schema_version: 1
};
