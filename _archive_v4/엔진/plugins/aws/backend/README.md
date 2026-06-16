# AWS 플러그인 채점 백엔드

boto3로 LocalStack(Docker) 또는 실제 AWS 계정의 리소스 상태를 확인해 채점 결과를 반환하는 로컬 HTTP 서버.

---

## 사전 준비

### 1. Python 패키지 설치

```bash
pip install boto3 botocore
```

Python 3.10 이상 권장 (`tuple[bool,str]` 타입 힌트 사용).

---

## 옵션 A — LocalStack (권장, 무료·오프라인)

### 1-1. Docker로 LocalStack 실행

```bash
docker run --rm -p 4566:4566 localstack/localstack
```

- Community 에디션 기준 지원 서비스: S3, EC2, Lambda, IAM, DynamoDB, SQS, SNS 등.
- Pro 전용 서비스(EKS, ElastiCache 등)는 별도 라이선스 필요.
- 컨테이너 종료 시 데이터 초기화됨 (영속화: `-v "$PWD/localstack-data:/var/lib/localstack"` 추가).

### 1-2. LocalStack 용 AWS CLI 프로필 설정 (선택)

```bash
aws configure --profile localstack
# AWS Access Key ID:     test
# AWS Secret Access Key: test
# Default region:        ap-northeast-2
# Default output format: json
```

이후 CLI 명령에 `--profile localstack --endpoint-url http://localhost:4566` 추가.

### 1-3. grade.py 실행 (LocalStack 모드 — 기본값)

```bash
python grade.py
# [grade.py] 채점 백엔드 시작 — 포트 5001, 모드: LocalStack (http://localhost:4566)
```

---

## 옵션 B — 실제 AWS 계정

### 2-1. AWS credentials 설정

```bash
aws configure
# AWS Access Key ID:     <본인 액세스 키>
# AWS Secret Access Key: <본인 시크릿 키>
# Default region:        ap-northeast-2
# Default output format: json
```

또는 환경변수:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=ap-northeast-2
```

> 주의: 실제 AWS 리소스 생성 시 비용이 발생할 수 있음.

### 2-2. grade.py 실행 (실제 AWS 모드)

```bash
AWS_MODE=real python grade.py
# [grade.py] 채점 백엔드 시작 — 포트 5001, 모드: 실제 AWS (ap-northeast-2)
```

---

## 환경변수 요약

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `5001` | 서버 포트 |
| `AWS_MODE` | `localstack` | `localstack` 또는 `real` |
| `AWS_REGION` | `ap-northeast-2` | 리전 |
| `LOCALSTACK_ENDPOINT` | `http://localhost:4566` | LocalStack 엔드포인트 (AWS_MODE=localstack 일 때만 적용) |

---

## 엔드포인트

### GET /health

헬스체크. 플러그인 셸이 부트 시 3초 타임아웃으로 호출.

```bash
curl http://localhost:5001/health
# {"status": "ok"}
```

### POST /grade

채점 요청. `checks` 배열은 ActivitySpec의 `grading.checks` 와 동일 구조.

```bash
curl -X POST http://localhost:5001/grade \
  -H "Content-Type: application/json" \
  -d '{
    "activity_id": "aws-s3-create-bucket-001",
    "checks": [
      {
        "type": "resource-exists",
        "service": "s3",
        "identifier": "my-practice-bucket-2026"
      }
    ]
  }'
```

**응답 예시 (통과)**:
```json
{
  "passed": 1,
  "total": 1,
  "activity_id": "aws-s3-create-bucket-001",
  "details": [
    {
      "check_index": 0,
      "type": "resource-exists",
      "service": "s3",
      "identifier": "my-practice-bucket-2026",
      "ok": true,
      "message": "버킷 'my-practice-bucket-2026' 존재함"
    }
  ]
}
```

---

## check 타입별 동작

### resource-exists

리소스 존재 여부만 확인.

| service | identifier | 내부 API |
|---|---|---|
| `s3` | 버킷명 | `head_bucket` |
| `ec2` | 인스턴스 ID | `describe_instances` |
| `lambda` | 함수명 | `get_function` |
| `iam` | 역할명 | `get_role` |
| `dynamodb` | 테이블명 | `describe_table` |

### config-equals

리소스의 속성값이 기대값과 일치하는지 확인.

`expected` 형식: `{"dot.path": "expected_value"}` — boto3 응답 dict에서 dot-notation으로 경로 지정.

예시 (S3 버전 관리 활성화 확인):
```json
{
  "type": "config-equals",
  "service": "s3",
  "identifier": "my-bucket",
  "expected": {
    "BucketVersioning.Status": "Enabled"
  }
}
```

예시 (Lambda 런타임 확인):
```json
{
  "type": "config-equals",
  "service": "lambda",
  "identifier": "my-function",
  "expected": {
    "Configuration.Runtime": "python3.12"
  }
}
```

---

## LocalStack 동작 확인 (빠른 테스트)

```bash
# LocalStack 실행 중 상태에서
aws --endpoint-url http://localhost:4566 \
    s3api create-bucket \
    --bucket my-practice-bucket-2026 \
    --region ap-northeast-2 \
    --create-bucket-configuration LocationConstraint=ap-northeast-2

# 채점 요청
curl -X POST http://localhost:5001/grade \
  -H "Content-Type: application/json" \
  -d '{"activity_id":"test","checks":[{"type":"resource-exists","service":"s3","identifier":"my-practice-bucket-2026"}]}'
# 기대 응답: {"passed":1,"total":1,...}
```

---

## 백엔드 미연결 시 (graceful)

플러그인 셸이 `/health` 에 연결 실패하면 자동으로 오프라인 모드로 전환:

- "검증" 버튼 비활성화
- 과제 설명·checkpoints·cli_hint·풀이 보기는 정상 열람 가능
- ScoreResult: `{ verdict: "pending", score_raw: 0, grader_id: "external" }`

연결 복구 후 페이지 새로고침하면 채점 가능.

---

## requirements.txt

```
boto3>=1.34
botocore>=1.34
```
