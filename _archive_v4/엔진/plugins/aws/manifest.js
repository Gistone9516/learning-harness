/**
 * aws / manifest.js — PluginManifest 선언
 * 플러그인계약 §2 conform · aws 런타임규격 §1 conform
 * ────────────────────────────────────────────────────────────
 * plugin_id  = "aws"
 * infra      = "backend"  (boto3 채점서버 필수 — 브라우저 내 실행 불가)
 * entry_url  = "http://localhost:5001"  (grade.py 기본 포트, 사용자 변경 가능)
 *
 * shell.js _registerPlugins 명명 규칙:
 *   plugin_id "aws"
 *   → globalKey  = "_AWS_PLUGIN"   (camelCase 변환)
 *   → directKey  = "_AWS_PLUGIN"   (direct _ 치환)
 *   → window._AWS_PLUGIN 에 인스턴스 등록 (plugin.js 담당)
 */
window.MANIFEST_AWS = {
  plugin_id:               "aws",
  label:                   "AWS 실습",
  version:                 "1.0.0",
  infra:                   "backend",         // boto3 채점서버 필요 (플러그인계약 §8)
  entry_url:               "http://localhost:5001", // grade.py 실행 위치
  byok:                    null,              // 키 불요 (LocalStack dummy key 사용)
  capabilities:            ["cloud-lab"],
  scoring_mode:            "auto",            // 동기 POST /grade (플러그인계약 §2, C2 fix)
  activity_type:           "cloud-task",
  progress_schema_version: 1
};
