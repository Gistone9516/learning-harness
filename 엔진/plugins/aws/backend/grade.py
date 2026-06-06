"""
grade.py — AWS 플러그인 boto3 채점 백엔드 (스캐폴드)
런타임규격 §3 conform.

엔드포인트:
  GET  /health  → {"status": "ok"}
  POST /grade   → {"passed":N, "total":N, "details":[...]}

실행:
  python grade.py                   # 기본 포트 5001, LocalStack 모드
  AWS_MODE=real python grade.py     # 실제 AWS 계정 사용 (LocalStack 비활성)
  PORT=5002 python grade.py         # 포트 변경

의존:
  pip install boto3 botocore
"""

import json
import os
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

import boto3
from botocore.exceptions import ClientError

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────

PORT = int(os.environ.get("PORT", 5001))
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")

# AWS_MODE=real 이면 실제 AWS (endpoint_url=None)
# 기본: LocalStack (endpoint_url=http://localhost:4566)
_aws_mode = os.environ.get("AWS_MODE", "localstack").lower()
LOCALSTACK_ENDPOINT = (
    None if _aws_mode == "real"
    else os.environ.get("LOCALSTACK_ENDPOINT", "http://localhost:4566")
)

# LocalStack 더미 키 (실제 AWS 모드에서는 환경변수/~/.aws/credentials 사용)
_LOCALSTACK_KEY_ID     = "test"
_LOCALSTACK_SECRET_KEY = "test"


# ─────────────────────────────────────────────
# boto3 클라이언트 팩토리
# ─────────────────────────────────────────────

def make_client(service: str):
    """서비스명(boto3 client name)으로 클라이언트 생성.

    LocalStack 모드: endpoint_url + 더미 키 주입
    실제 AWS 모드 : endpoint_url=None → boto3가 ~/.aws/credentials / 환경변수 사용
    """
    kwargs: dict = {"region_name": AWS_REGION}
    if LOCALSTACK_ENDPOINT:
        kwargs["endpoint_url"]          = LOCALSTACK_ENDPOINT
        kwargs["aws_access_key_id"]     = _LOCALSTACK_KEY_ID
        kwargs["aws_secret_access_key"] = _LOCALSTACK_SECRET_KEY
    return boto3.client(service, **kwargs)


# ─────────────────────────────────────────────
# check 핸들러: resource-exists
# ─────────────────────────────────────────────

def _resource_exists(service: str, identifier: str) -> tuple[bool, str]:
    """boto3 로 리소스 존재 여부 확인. 서비스별 패턴 구현.

    지원: s3, ec2, lambda, iam, dynamodb
    미지원 서비스는 False + 안내 메시지 반환.
    """
    client = make_client(service)
    try:
        if service == "s3":
            client.head_bucket(Bucket=identifier)
            return True, f"버킷 '{identifier}' 존재함"

        elif service == "ec2":
            resp = client.describe_instances(InstanceIds=[identifier])
            reservations = resp.get("Reservations", [])
            if reservations:
                state = (
                    reservations[0]["Instances"][0]
                    .get("State", {})
                    .get("Name", "unknown")
                )
                return True, f"EC2 인스턴스 '{identifier}' 존재함 (상태: {state})"
            return False, f"EC2 인스턴스 '{identifier}' 없음"

        elif service == "lambda":
            client.get_function(FunctionName=identifier)
            return True, f"Lambda 함수 '{identifier}' 존재함"

        elif service == "iam":
            # identifier = 역할 이름 (RoleName)
            client.get_role(RoleName=identifier)
            return True, f"IAM 역할 '{identifier}' 존재함"

        elif service == "dynamodb":
            client.describe_table(TableName=identifier)
            return True, f"DynamoDB 테이블 '{identifier}' 존재함"

        else:
            return False, f"resource-exists: 미지원 서비스 '{service}'"

    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg  = exc.response["Error"].get("Message", "")
        return False, f"리소스 없음 (오류코드: {code} — {msg})"


# ─────────────────────────────────────────────
# check 핸들러: config-equals
# ─────────────────────────────────────────────

def _config_equals(service: str, identifier: str, expected) -> tuple[bool, str]:
    """boto3 로 리소스 속성 조회 후 expected 와 비교.

    expected 형식: {"attribute_path": "expected_value"}
      - attribute_path: dot-notation으로 boto3 응답 dict 내 경로
        예: "VersioningConfiguration.Status" → resp["VersioningConfiguration"]["Status"]
      - 단일 값 비교만 지원 (dict 1-key 권장; multi-key 시 AND 조건).

    서비스별 조회 API:
      s3       → identifier=버킷명, attribute_path=BucketVersioning.Status 등
      dynamodb → identifier=테이블명, attribute_path=Table.BillingModeSummary.BillingMode 등
      lambda   → identifier=함수명, attribute_path=Configuration.Runtime 등
      ec2      → 인스턴스 태그/상태 조회 (InstanceId 기준)
      iam      → identifier=역할명, attribute_path=Role.AssumeRolePolicyDocument 등
    """
    if not isinstance(expected, dict) or len(expected) == 0:
        return False, "config-equals: expected 는 {attribute_path: value} dict 이어야 함"

    client = make_client(service)
    try:
        actual_root = _fetch_resource_config(client, service, identifier)
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        return False, f"속성 조회 실패 (오류코드: {code})"
    except NotImplementedError as exc:
        return False, str(exc)

    results = []
    all_ok  = True
    for attr_path, exp_val in expected.items():
        actual_val = _get_nested(actual_root, attr_path)
        ok = actual_val == exp_val
        if not ok:
            all_ok = False
        results.append(
            f"{attr_path}: 기대={exp_val!r}, 실제={actual_val!r} → {'✓' if ok else '✗'}"
        )

    summary = " | ".join(results)
    if all_ok:
        return True, f"'{identifier}' 속성 일치 — {summary}"
    return False, f"'{identifier}' 속성 불일치 — {summary}"


def _fetch_resource_config(client, service: str, identifier: str) -> dict:
    """서비스별 describe/get API 호출 → 응답 dict 반환."""
    if service == "s3":
        # 예: attribute_path = "BucketVersioning.Status"
        # S3는 속성마다 API가 달라 복합 dict 로 묶어 반환
        versioning = {}
        acl        = {}
        try:
            versioning = client.get_bucket_versioning(Bucket=identifier)
            versioning.pop("ResponseMetadata", None)
        except ClientError:
            pass
        try:
            acl = client.get_bucket_acl(Bucket=identifier)
            acl.pop("ResponseMetadata", None)
        except ClientError:
            pass
        return {
            "BucketVersioning": versioning,
            "BucketAcl":        acl,
        }

    elif service == "dynamodb":
        resp = client.describe_table(TableName=identifier)
        resp.pop("ResponseMetadata", None)
        return resp  # resp["Table"]["..."]

    elif service == "lambda":
        resp = client.get_function(FunctionName=identifier)
        resp.pop("ResponseMetadata", None)
        return resp  # resp["Configuration"]["Runtime"] 등

    elif service == "ec2":
        resp = client.describe_instances(InstanceIds=[identifier])
        resp.pop("ResponseMetadata", None)
        return resp

    elif service == "iam":
        resp = client.get_role(RoleName=identifier)
        resp.pop("ResponseMetadata", None)
        return resp  # resp["Role"]["Arn"] 등

    else:
        raise NotImplementedError(f"config-equals: 미지원 서비스 '{service}'")


def _get_nested(d: dict, dot_path: str):
    """dot-notation 경로로 중첩 dict 값 추출. 없으면 None."""
    parts = dot_path.split(".")
    cur   = d
    for part in parts:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


# ─────────────────────────────────────────────
# 채점 엔진
# ─────────────────────────────────────────────

def run_checks(checks: list) -> dict:
    """checks 배열 순회 → 각 결과 수집 → {passed, total, details} 반환."""
    details = []
    passed  = 0

    for idx, check in enumerate(checks):
        check_type = check.get("type")
        service    = check.get("service", "")
        identifier = check.get("identifier", "")

        try:
            if check_type == "resource-exists":
                ok, message = _resource_exists(service, identifier)

            elif check_type == "config-equals":
                expected = check.get("expected")
                ok, message = _config_equals(service, identifier, expected)

            else:
                ok      = False
                message = f"알 수 없는 check type: '{check_type}'"

        except Exception:  # noqa: BLE001 — 채점 오류가 서버 전체를 멈추지 않도록
            ok      = False
            message = f"채점 중 예외 발생: {traceback.format_exc(limit=3)}"

        if ok:
            passed += 1

        details.append({
            "check_index": idx,
            "type":        check_type,
            "service":     service,
            "identifier":  identifier,
            "ok":          ok,
            "message":     message,
        })

    return {"passed": passed, "total": len(checks), "details": details}


# ─────────────────────────────────────────────
# HTTP 핸들러
# ─────────────────────────────────────────────

class GradeHandler(BaseHTTPRequestHandler):

    # ── 공통 헬퍼 ──────────────────────────────

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",  "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        """CORS: 브라우저 프론트엔드(file:// 포함)에서 호출 허용."""
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _read_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    # ── OPTIONS (preflight) ─────────────────────

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    # ── GET /health ─────────────────────────────

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
        else:
            self._send_json(404, {"error": "not found"})

    # ── POST /grade ─────────────────────────────

    def do_POST(self):  # noqa: N802
        if self.path != "/grade":
            self._send_json(404, {"error": "not found"})
            return

        body = self._read_body()
        if body is None:
            self._send_json(400, {"error": "invalid JSON"})
            return

        activity_id = body.get("activity_id", "")
        checks      = body.get("checks")

        if not isinstance(checks, list) or len(checks) == 0:
            self._send_json(400, {
                "error": "'checks' 필드가 없거나 빈 배열입니다.",
                "activity_id": activity_id,
            })
            return

        result = run_checks(checks)
        result["activity_id"] = activity_id
        self._send_json(200, result)

    # ── 로그 억제 (원하면 주석 해제) ────────────

    def log_message(self, fmt, *args):  # noqa: N802
        # 기본 access 로그 유지 (stderr)
        super().log_message(fmt, *args)


# ─────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────

if __name__ == "__main__":
    mode_label = (
        f"LocalStack ({LOCALSTACK_ENDPOINT})"
        if LOCALSTACK_ENDPOINT
        else f"실제 AWS ({AWS_REGION})"
    )
    print(f"[grade.py] 채점 백엔드 시작 — 포트 {PORT}, 모드: {mode_label}")
    print(f"[grade.py] GET  http://localhost:{PORT}/health")
    print(f"[grade.py] POST http://localhost:{PORT}/grade")
    print(f"[grade.py] Ctrl+C 로 종료")

    server = HTTPServer(("0.0.0.0", PORT), GradeHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[grade.py] 종료")
        server.server_close()
