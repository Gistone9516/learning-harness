// 목업 콘텐츠 (cycle-3 r3) — 테스트 픽스처/시드 데이터. LocalStack Hobby 가정.
// plugin_id: "aws" (기능백로그 C3 정합)
// 이 파일: SNS(1) 추가분만 포함.
// S3(3)·Lambda(2)·IAM(2)·DynamoDB(2)·SQS(2) 11개는 _example/activities.js에 이미 있음.
// concat으로 append → activity_id 중복 없음.

window.ACTIVITIES = window.ACTIVITIES || {};

window.ACTIVITIES['aws'] = (window.ACTIVITIES['aws'] || []).concat([

  // [서비스: SNS]
  {
    "activity_id": "aws-sns-create-topic-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 3,
    "tags": { "area": "메시징", "subarea": "SNS", "unit": "토픽 생성" },
    "enabled": true,
    "front": {
      "prompt": "팬아웃 메시징 패턴의 핵심인 SNS 토픽을 만들어 봅니다. SNS 토픽 'lab-alert-topic'을 생성하시오.",
      "provider": "aws",
      "service": "SNS",
      "task": "SNS 토픽 생성",
      "checkpoints": [
        "create-topic 명령으로 'lab-alert-topic' 생성",
        "list-topics 명령으로 토픽 ARN 확인",
        "get-topic-attributes 명령으로 토픽 속성 조회"
      ],
      "cli_hint": "aws sns create-topic --name lab-alert-topic --region ap-northeast-2 --endpoint-url http://localhost:4566\naws sns list-topics --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws sns create-topic --name lab-alert-topic --region ap-northeast-2 --endpoint-url http://localhost:4566",
      "explanation": "SNS 토픽은 발행-구독(Pub/Sub) 패턴의 중앙 허브임. SQS 큐·Lambda·HTTP 엔드포인트 등을 구독자로 등록해 팬아웃 가능. FIFO 토픽(--attributes FifoTopic=true)은 순서 보장이 필요한 경우 사용."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "sns",
          "identifier": "lab-alert-topic"
        }
      ]
    }
  }

]);
