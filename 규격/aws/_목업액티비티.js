// 목업 콘텐츠 (cycle-3 r2) — 테스트 픽스처/시드 데이터. LocalStack Hobby 가정.
// plugin_id: "aws" (기능백로그 C3 정합)
// 서비스 분포: S3(3) · Lambda(2) · IAM(2) · DynamoDB(2) · SQS(2) = 11개
// checks: resource-exists 11개 + config-equals 4개 (총 15 checks)

window.ACTIVITIES = window.ACTIVITIES || {};

window.ACTIVITIES['aws'] = [

  // [서비스: S3]
  {
    "activity_id": "aws-s3-create-bucket-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 2,
    "tags": { "area": "스토리지", "subarea": "S3", "unit": "버킷 생성" },
    "enabled": true,
    "front": {
      "prompt": "객체 스토리지의 기본 단위인 버킷을 직접 만들어 봅니다. S3 버킷 'lab-practice-bucket-2026'을 ap-northeast-2 리전에 생성하시오.",
      "provider": "aws",
      "service": "S3",
      "task": "S3 버킷 생성",
      "checkpoints": [
        "AWS CLI가 설치되어 있고 --endpoint-url 옵션을 사용할 수 있는지 확인",
        "s3api create-bucket 명령에 --region과 LocationConstraint 옵션 포함",
        "aws s3 ls 또는 list-buckets로 버킷 목록에서 생성 확인"
      ],
      "cli_hint": "aws s3api create-bucket --bucket lab-practice-bucket-2026 --region ap-northeast-2 --create-bucket-configuration LocationConstraint=ap-northeast-2 --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws s3api create-bucket --bucket lab-practice-bucket-2026 --region ap-northeast-2 --create-bucket-configuration LocationConstraint=ap-northeast-2 --endpoint-url http://localhost:4566",
      "explanation": "us-east-1 외 모든 리전은 --create-bucket-configuration LocationConstraint 파라미터 필수임. us-east-1은 이 파라미터를 생략해야 함(지정하면 오류). 버킷명은 전역 고유해야 하며 소문자·숫자·하이픈만 허용됨."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "s3",
          "identifier": "lab-practice-bucket-2026"
        }
      ]
    }
  },

  // [서비스: S3]
  {
    "activity_id": "aws-s3-enable-versioning-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 3,
    "tags": { "area": "스토리지", "subarea": "S3", "unit": "버전 관리 활성화" },
    "enabled": true,
    "front": {
      "prompt": "실수로 덮어쓴 객체를 복구하려면 버전 관리가 필요합니다. 버킷 'lab-versioned-bucket'을 생성하고 버전 관리를 Enabled 상태로 활성화하시오.",
      "provider": "aws",
      "service": "S3",
      "task": "S3 버전 관리 활성화",
      "checkpoints": [
        "버킷 'lab-versioned-bucket' 생성 (ap-northeast-2)",
        "put-bucket-versioning 명령으로 Status=Enabled 설정",
        "get-bucket-versioning으로 Status가 Enabled인지 확인"
      ],
      "cli_hint": "aws s3api create-bucket --bucket lab-versioned-bucket --region ap-northeast-2 --create-bucket-configuration LocationConstraint=ap-northeast-2 --endpoint-url http://localhost:4566\naws s3api put-bucket-versioning --bucket lab-versioned-bucket --versioning-configuration Status=Enabled --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws s3api create-bucket --bucket lab-versioned-bucket --region ap-northeast-2 --create-bucket-configuration LocationConstraint=ap-northeast-2 --endpoint-url http://localhost:4566\naws s3api put-bucket-versioning --bucket lab-versioned-bucket --versioning-configuration Status=Enabled --endpoint-url http://localhost:4566",
      "explanation": "버전 관리는 버킷 생성과 별개 API로 활성화함. 활성화 후 Suspended(일시 중단)는 가능하지만 완전 비활성화(삭제)는 불가. 버전 관리 중 삭제 마커가 생성되므로 삭제 시 완전 제거와 구분 필요."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "s3",
          "identifier": "lab-versioned-bucket"
        },
        {
          "type": "config-equals",
          "service": "s3",
          "identifier": "lab-versioned-bucket",
          "expected": { "versioning": "Enabled" }
        }
      ]
    }
  },

  // [서비스: S3]
  {
    "activity_id": "aws-s3-block-public-access-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 3,
    "tags": { "area": "스토리지", "subarea": "S3", "unit": "퍼블릭 액세스 차단" },
    "enabled": true,
    "front": {
      "prompt": "보안 기본 원칙 실습. 버킷 'lab-private-bucket'을 생성하고 퍼블릭 액세스 차단(BlockPublicAcls=true)을 설정하시오.",
      "provider": "aws",
      "service": "S3",
      "task": "S3 퍼블릭 액세스 차단",
      "checkpoints": [
        "버킷 'lab-private-bucket' 생성 (ap-northeast-2)",
        "put-public-access-block 명령으로 BlockPublicAcls·IgnorePublicAcls·BlockPublicPolicy·RestrictPublicBuckets 모두 true 설정",
        "get-public-access-block으로 설정값 확인"
      ],
      "cli_hint": "aws s3api create-bucket --bucket lab-private-bucket --region ap-northeast-2 --create-bucket-configuration LocationConstraint=ap-northeast-2 --endpoint-url http://localhost:4566\naws s3api put-public-access-block --bucket lab-private-bucket --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws s3api create-bucket --bucket lab-private-bucket --region ap-northeast-2 --create-bucket-configuration LocationConstraint=ap-northeast-2 --endpoint-url http://localhost:4566\naws s3api put-public-access-block --bucket lab-private-bucket --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --endpoint-url http://localhost:4566",
      "explanation": "퍼블릭 액세스 차단은 4가지 설정(BlockPublicAcls·IgnorePublicAcls·BlockPublicPolicy·RestrictPublicBuckets)으로 구성됨. 신규 버킷은 기본적으로 모두 true이지만 명시적 설정 권장. ACL과 버킷 정책 두 경로 모두 차단해야 완전 비공개."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "s3",
          "identifier": "lab-private-bucket"
        },
        {
          "type": "config-equals",
          "service": "s3",
          "identifier": "lab-private-bucket",
          "expected": { "public_access_block": { "BlockPublicAcls": true } }
        }
      ]
    }
  },

  // [서비스: IAM]
  {
    "activity_id": "aws-iam-create-role-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 3,
    "tags": { "area": "보안/IAM", "subarea": "IAM", "unit": "역할 생성" },
    "enabled": true,
    "front": {
      "prompt": "최소 권한 원칙 실습. Lambda 서비스가 맡을 수 있는 IAM 역할 'lab-lambda-exec-role'을 생성하시오.",
      "provider": "aws",
      "service": "IAM",
      "task": "IAM 역할 생성",
      "checkpoints": [
        "신뢰 정책 JSON 파일 작성 — Principal: {Service: lambda.amazonaws.com}, Action: sts:AssumeRole",
        "create-role 명령으로 'lab-lambda-exec-role' 생성",
        "get-role 명령으로 역할 ARN 확인"
      ],
      "cli_hint": "# trust-policy.json 파일 먼저 작성:\n# {\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"lambda.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}\naws iam create-role --role-name lab-lambda-exec-role --assume-role-policy-document file://trust-policy.json --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "# trust-policy.json:\n# {\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"lambda.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}\naws iam create-role --role-name lab-lambda-exec-role --assume-role-policy-document file://trust-policy.json --endpoint-url http://localhost:4566",
      "explanation": "신뢰 정책(Trust Policy)은 '누가 이 역할을 맡을 수 있는가'를 정의함. 권한 정책(Permission Policy, attach-role-policy)과 완전히 별개 개념임. 둘 다 없으면 역할을 맡아도 아무 권한이 없음."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "iam",
          "identifier": "lab-lambda-exec-role"
        }
      ]
    }
  },

  // [서비스: IAM]
  {
    "activity_id": "aws-iam-create-user-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 2,
    "tags": { "area": "보안/IAM", "subarea": "IAM", "unit": "사용자 생성" },
    "enabled": true,
    "front": {
      "prompt": "프로그래밍 방식 접근을 위한 IAM 사용자 관리 실습. IAM 사용자 'lab-dev-user'를 생성하시오.",
      "provider": "aws",
      "service": "IAM",
      "task": "IAM 사용자 생성",
      "checkpoints": [
        "create-user 명령으로 'lab-dev-user' 생성",
        "list-users 명령으로 사용자 목록에서 생성 확인",
        "get-user 명령으로 사용자 ARN 확인"
      ],
      "cli_hint": "aws iam create-user --user-name lab-dev-user --endpoint-url http://localhost:4566\naws iam list-users --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws iam create-user --user-name lab-dev-user --endpoint-url http://localhost:4566",
      "explanation": "IAM 사용자는 장기 자격증명(액세스 키)을 갖는 엔티티임. 모범 사례는 사용자 대신 역할(Role) + 임시 자격증명 사용. 실습 환경에서는 create-access-key로 추가 키 발급 가능."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "iam",
          "identifier": "lab-dev-user"
        }
      ]
    }
  },

  // [서비스: Lambda]
  {
    "activity_id": "aws-lambda-create-function-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 4,
    "tags": { "area": "서버리스", "subarea": "Lambda", "unit": "함수 생성" },
    "enabled": true,
    "front": {
      "prompt": "서버리스 컴퓨팅의 핵심인 Lambda 함수를 배포해 봅니다. Python 3.12 런타임으로 Lambda 함수 'lab-hello-function'을 생성하시오. zip 패키지(hello.zip)에는 lambda_function.lambda_handler 핸들러가 포함되어 있음.",
      "provider": "aws",
      "service": "Lambda",
      "task": "Lambda 함수 생성",
      "checkpoints": [
        "hello.zip 파일 준비 (lambda_function.py에 lambda_handler 함수 포함)",
        "IAM 역할 ARN 확인 (lab-lambda-exec-role 또는 임의 역할)",
        "create-function 명령으로 'lab-hello-function' 생성",
        "list-functions 또는 get-function으로 함수 존재 확인"
      ],
      "cli_hint": "aws lambda create-function --function-name lab-hello-function --runtime python3.12 --role arn:aws:iam::000000000000:role/lab-lambda-exec-role --handler lambda_function.lambda_handler --zip-file fileb://hello.zip --region ap-northeast-2 --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws lambda create-function --function-name lab-hello-function --runtime python3.12 --role arn:aws:iam::000000000000:role/lab-lambda-exec-role --handler lambda_function.lambda_handler --zip-file fileb://hello.zip --region ap-northeast-2 --endpoint-url http://localhost:4566",
      "explanation": "LocalStack에서 IAM ARN 계정 ID는 000000000000(12자리 0) 사용. 실제 AWS는 본인 계정 12자리 ID. --zip-file은 fileb:// 접두사 필수(바이너리 파일 전송). 핸들러 형식은 '파일명.함수명' 패턴."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "lambda",
          "identifier": "lab-hello-function"
        }
      ]
    }
  },

  // [서비스: Lambda]
  {
    "activity_id": "aws-lambda-update-env-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 3,
    "tags": { "area": "서버리스", "subarea": "Lambda", "unit": "환경 변수 설정" },
    "enabled": true,
    "front": {
      "prompt": "하드코딩을 피하고 환경 변수로 설정을 주입하는 패턴을 익힙니다. Lambda 함수 'lab-config-function'을 생성하고 환경 변수 APP_ENV=production을 설정하시오.",
      "provider": "aws",
      "service": "Lambda",
      "task": "Lambda 환경 변수 설정",
      "checkpoints": [
        "Lambda 함수 'lab-config-function' 생성 (python3.12, 임의 handler)",
        "update-function-configuration 명령으로 환경 변수 APP_ENV=production 설정",
        "get-function-configuration으로 Environment.Variables 확인"
      ],
      "cli_hint": "aws lambda create-function --function-name lab-config-function --runtime python3.12 --role arn:aws:iam::000000000000:role/lab-lambda-exec-role --handler index.handler --zip-file fileb://hello.zip --region ap-northeast-2 --endpoint-url http://localhost:4566\naws lambda update-function-configuration --function-name lab-config-function --environment Variables={APP_ENV=production} --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws lambda create-function --function-name lab-config-function --runtime python3.12 --role arn:aws:iam::000000000000:role/lab-lambda-exec-role --handler index.handler --zip-file fileb://hello.zip --region ap-northeast-2 --endpoint-url http://localhost:4566\naws lambda update-function-configuration --function-name lab-config-function --environment Variables={APP_ENV=production} --endpoint-url http://localhost:4566",
      "explanation": "Lambda 환경 변수는 코드 배포 없이 설정 변경 가능. update-function-configuration은 기존 환경 변수 전체를 교체하므로 여러 변수를 유지하려면 한 번에 모두 지정해야 함. 민감한 값은 Secrets Manager나 SSM Parameter Store 참조 권장."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "lambda",
          "identifier": "lab-config-function"
        },
        {
          "type": "config-equals",
          "service": "lambda",
          "identifier": "lab-config-function",
          "expected": { "env_var": { "APP_ENV": "production" } }
        }
      ]
    }
  },

  // [서비스: DynamoDB]
  {
    "activity_id": "aws-dynamodb-create-table-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 3,
    "tags": { "area": "데이터베이스", "subarea": "DynamoDB", "unit": "테이블 생성" },
    "enabled": true,
    "front": {
      "prompt": "스키마 없는 NoSQL 테이블 생성 실습. DynamoDB 테이블 'lab-users-table'을 파티션 키 'userId'(문자열)로 생성하시오.",
      "provider": "aws",
      "service": "DynamoDB",
      "task": "DynamoDB 테이블 생성",
      "checkpoints": [
        "create-table 명령에 --attribute-definitions AttributeName=userId,AttributeType=S 지정",
        "--key-schema AttributeName=userId,KeyType=HASH 지정",
        "--billing-mode PAY_PER_REQUEST 또는 --provisioned-throughput 지정",
        "describe-table로 TableStatus=ACTIVE 확인"
      ],
      "cli_hint": "aws dynamodb create-table --table-name lab-users-table --attribute-definitions AttributeName=userId,AttributeType=S --key-schema AttributeName=userId,KeyType=HASH --billing-mode PAY_PER_REQUEST --region ap-northeast-2 --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws dynamodb create-table --table-name lab-users-table --attribute-definitions AttributeName=userId,AttributeType=S --key-schema AttributeName=userId,KeyType=HASH --billing-mode PAY_PER_REQUEST --region ap-northeast-2 --endpoint-url http://localhost:4566",
      "explanation": "AttributeType: S=문자열, N=숫자, B=바이너리. --attribute-definitions에는 키로 사용하는 속성만 선언(DynamoDB는 나머지 속성을 스키마 없이 저장). PAY_PER_REQUEST(온디맨드)는 트래픽 예측 불가 시 적합."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "dynamodb",
          "identifier": "lab-users-table"
        }
      ]
    }
  },

  // [서비스: DynamoDB]
  {
    "activity_id": "aws-dynamodb-create-table-002",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 4,
    "tags": { "area": "데이터베이스", "subarea": "DynamoDB", "unit": "복합 기본 키 테이블 생성" },
    "enabled": true,
    "front": {
      "prompt": "게시판 데이터 모델링 실습. DynamoDB 테이블 'lab-posts-table'을 파티션 키 'boardId'(문자열) + 정렬 키 'createdAt'(문자열)으로 생성하시오.",
      "provider": "aws",
      "service": "DynamoDB",
      "task": "DynamoDB 복합 키 테이블 생성",
      "checkpoints": [
        "--attribute-definitions에 boardId(S)와 createdAt(S) 두 속성 선언",
        "--key-schema에 HASH(boardId)와 RANGE(createdAt) 모두 지정",
        "--billing-mode PAY_PER_REQUEST 지정",
        "describe-table로 KeySchema 항목 두 개 확인"
      ],
      "cli_hint": "aws dynamodb create-table --table-name lab-posts-table --attribute-definitions AttributeName=boardId,AttributeType=S AttributeName=createdAt,AttributeType=S --key-schema AttributeName=boardId,KeyType=HASH AttributeName=createdAt,KeyType=RANGE --billing-mode PAY_PER_REQUEST --region ap-northeast-2 --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws dynamodb create-table --table-name lab-posts-table --attribute-definitions AttributeName=boardId,AttributeType=S AttributeName=createdAt,AttributeType=S --key-schema AttributeName=boardId,KeyType=HASH AttributeName=createdAt,KeyType=RANGE --billing-mode PAY_PER_REQUEST --region ap-northeast-2 --endpoint-url http://localhost:4566",
      "explanation": "복합 기본 키 = 파티션 키(HASH) + 정렬 키(RANGE). 같은 boardId 내 createdAt으로 시간순 정렬 조회 가능. 정렬 키가 없는 단순 기본 키 테이블과 달리 Query 시 시간 범위 필터 사용 가능."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "dynamodb",
          "identifier": "lab-posts-table"
        }
      ]
    }
  },

  // [서비스: SQS]
  {
    "activity_id": "aws-sqs-create-queue-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 3,
    "tags": { "area": "메시징", "subarea": "SQS", "unit": "큐 생성" },
    "enabled": true,
    "front": {
      "prompt": "비동기 메시지 처리의 기반인 SQS 큐를 만들어 봅니다. SQS 표준 큐 'lab-task-queue'를 생성하시오.",
      "provider": "aws",
      "service": "SQS",
      "task": "SQS 큐 생성",
      "checkpoints": [
        "create-queue 명령으로 'lab-task-queue' 생성",
        "list-queues 명령으로 큐 URL 확인",
        "get-queue-url 명령으로 큐 URL 조회 가능한지 확인"
      ],
      "cli_hint": "aws sqs create-queue --queue-name lab-task-queue --region ap-northeast-2 --endpoint-url http://localhost:4566\naws sqs list-queues --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws sqs create-queue --queue-name lab-task-queue --region ap-northeast-2 --endpoint-url http://localhost:4566",
      "explanation": "SQS 표준 큐는 최소 1회 전달을 보장하며 순서를 보장하지 않음. 순서가 중요하면 FIFO 큐 사용(--attributes FifoQueue=true, 큐명 .fifo 접미사 필수). LocalStack Hobby에서 SQS 표준 큐와 기본 FIFO 큐 모두 지원됨."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "sqs",
          "identifier": "lab-task-queue"
        }
      ]
    }
  },

  // [서비스: SQS]
  {
    "activity_id": "aws-sqs-create-dlq-001",
    "plugin_id": "aws",
    "type": "cloud-task",
    "weight": 4,
    "tags": { "area": "메시징", "subarea": "SQS", "unit": "데드레터 큐 설정" },
    "enabled": true,
    "front": {
      "prompt": "처리 실패 메시지를 격리하는 데드레터 큐(DLQ) 패턴을 실습합니다. 메인 큐 'lab-main-queue'와 데드레터 큐 'lab-dlq'를 생성하고, 메인 큐의 maxReceiveCount=3으로 DLQ를 연결하시오.",
      "provider": "aws",
      "service": "SQS",
      "task": "SQS DLQ 연결",
      "checkpoints": [
        "데드레터 큐 'lab-dlq' 먼저 생성",
        "get-queue-attributes로 'lab-dlq'의 QueueArn 확인",
        "메인 큐 'lab-main-queue' 생성",
        "set-queue-attributes로 RedrivePolicy(deadLetterTargetArn, maxReceiveCount=3) 설정",
        "get-queue-attributes로 RedrivePolicy 적용 확인"
      ],
      "cli_hint": "aws sqs create-queue --queue-name lab-dlq --endpoint-url http://localhost:4566\naws sqs create-queue --queue-name lab-main-queue --endpoint-url http://localhost:4566\n# DLQ ARN 조회 후:\naws sqs set-queue-attributes --queue-url http://localhost:4566/000000000000/lab-main-queue --attributes '{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"arn:aws:sqs:ap-northeast-2:000000000000:lab-dlq\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}' --endpoint-url http://localhost:4566"
    },
    "back": {
      "solution": "aws sqs create-queue --queue-name lab-dlq --region ap-northeast-2 --endpoint-url http://localhost:4566\naws sqs create-queue --queue-name lab-main-queue --region ap-northeast-2 --endpoint-url http://localhost:4566\naws sqs set-queue-attributes --queue-url http://localhost:4566/000000000000/lab-main-queue --attributes '{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"arn:aws:sqs:ap-northeast-2:000000000000:lab-dlq\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}' --endpoint-url http://localhost:4566",
      "explanation": "DLQ 패턴: 메시지 처리 실패가 maxReceiveCount 초과 시 자동으로 DLQ로 이동. 운영 알림·재처리에 활용. RedrivePolicy는 JSON-in-string 형식으로 전달해야 하는 점이 함정. LocalStack ARN 계정ID = 000000000000."
    },
    "grading": {
      "grader": "boto3",
      "checks": [
        {
          "type": "resource-exists",
          "service": "sqs",
          "identifier": "lab-dlq"
        },
        {
          "type": "resource-exists",
          "service": "sqs",
          "identifier": "lab-main-queue"
        },
        {
          "type": "config-equals",
          "service": "sqs",
          "identifier": "lab-main-queue",
          "expected": { "redrive_policy": { "maxReceiveCount": 3 } }
        }
      ]
    }
  }

];
