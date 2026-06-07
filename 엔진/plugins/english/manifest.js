/**
 * english / manifest.js
 * 플러그인계약 §2 PluginManifest — english 플러그인 자기선언
 * 런타임규격(english/런타임규격.md) §1 conform.
 *
 * infra = "hybrid"
 *   정적 핵심(vocab/grammar/reading/listening): 브라우저 JS + SpeechSynthesis. 서버·키 불요.
 *   BYO-key(writing/speaking): llm_api_key / azure_speech_key. 키 없으면 graceful.
 *
 * 등록 방식 (shell.js _registerPlugins):
 *   plugin_id = "english"
 *   globalKey  = "_ENGLISH_PLUGIN"
 *   → window._ENGLISH_PLUGIN = instance  (plugin.js에서 설정)
 */
window.MANIFEST_ENGLISH = {
  plugin_id:              "english",
  label:                  "영어 학습",
  version:                "1.0.0",
  infra:                  "hybrid",
  entry_url:              null,          // hybrid지만 외부 서버 없음; BYO-key API는 클라이언트 직접 호출
  byok: {
    keys: [
      {
        id:    "llm_api_key",
        label: "LLM API 키 (writing 채점용)",
        where: "header",
        help:  "OpenAI / Anthropic 등 OpenAI-compatible 엔드포인트 키. writing 모달 llm-rubric 채점에 사용."
      },
      {
        id:    "azure_speech_key",
        label: "Azure Speech 키 (speaking 발음 채점용)",
        where: "header",
        help:  "Azure Cognitive Services Speech API 키. speaking 모달 pronunciation 채점에 사용. 지역(region)은 설정 화면에서 별도 입력."
      },
      {
        id:    "llm_endpoint",
        label: "LLM 엔드포인트 URL",
        where: "url",
        help:  "OpenAI-compatible chat/completions 엔드포인트 URL. 기본값: https://api.openai.com/v1/chat/completions. ollama·vLLM·Anthropic-proxy 등 커스텀 엔드포인트 지원."
      },
      {
        id:    "llm_model",
        label: "LLM 모델명",
        where: "body",
        help:  "LLM 요청 시 사용할 모델 식별자. 기본값: gpt-4o-mini. 예) claude-3-haiku-20240307, llama3, mistral."
      }
    ]
  },
  capabilities:           ["language"],
  scoring_mode:           "auto",
  activity_type:          "lang-task",
  progress_schema_version: 1
};
