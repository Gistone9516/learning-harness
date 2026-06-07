#!/usr/bin/env bash
# start.sh — AWS 플러그인 원클릭 기동 스크립트 (macOS / Linux)
# 사용법:
#   ./start.sh                     # LocalStack 기동 + grade.py 기동
#   ./start.sh --mode ministack    # MiniStack(계정 불요) + grade.py
#   ./start.sh --mode real         # 실제 AWS 계정 + grade.py (LocalStack 없음)
#   ./start.sh --stop              # 실행 중인 컨테이너 + grade.py 종료
#
# LocalStack (2026.03+) 인증:
#   export LOCALSTACK_AUTH_TOKEN="your-token"   # 실행 전 설정
#   → 토큰 발급: https://app.localstack.cloud/sign-in
#
# 의존: docker, python3 (3.10+), pip install boto3 botocore

set -euo pipefail

MODE="${MODE:-localstack}"
GRADE_PORT="${PORT:-5001}"
CONTAINER_NAME="aws-lab-localstack"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GRADE_SCRIPT="$SCRIPT_DIR/grade.py"
GRADE_PID_FILE="/tmp/aws-lab-grade.pid"

# ── 인수 파싱 ──────────────────────────────────────────────
STOP=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode) MODE="$2"; shift 2 ;;
        --stop) STOP=true; shift ;;
        *) echo "알 수 없는 옵션: $1"; exit 1 ;;
    esac
done

# ── 색상 ───────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

# ── 종료 처리 ──────────────────────────────────────────────
if $STOP; then
    echo "[stop] grade.py 종료..."
    if [[ -f "$GRADE_PID_FILE" ]]; then
        PID=$(cat "$GRADE_PID_FILE")
        kill "$PID" 2>/dev/null && echo "[stop]   PID $PID 종료" || echo "[stop]   이미 종료됨"
        rm -f "$GRADE_PID_FILE"
    else
        pkill -f "grade.py" 2>/dev/null || echo "[stop]   grade.py 프로세스 없음"
    fi
    echo "[stop] Docker 컨테이너 '$CONTAINER_NAME' 종료..."
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || echo "[stop]   컨테이너 없음"
    echo "[stop] 완료."
    exit 0
fi

# ── 사전 점검 ──────────────────────────────────────────────
echo ""
echo -e "${CYAN}=== AWS 플러그인 기동 (모드: $MODE) ===${NC}"

command -v python3 >/dev/null 2>&1 || { echo -e "${RED}python3 을 찾을 수 없습니다. Python 3.10+ 설치 후 재시도하세요.${NC}"; exit 1; }

if [[ "$MODE" != "real" ]]; then
    command -v docker >/dev/null 2>&1 || { echo -e "${RED}docker 를 찾을 수 없습니다. Docker 설치 후 재시도하세요.${NC}"; exit 1; }
fi

if [[ ! -f "$GRADE_SCRIPT" ]]; then
    echo -e "${RED}grade.py 를 찾을 수 없습니다: $GRADE_SCRIPT${NC}"; exit 1
fi

# ── LocalStack / MiniStack 기동 ────────────────────────────
if [[ "$MODE" == "localstack" ]]; then
    if [[ -z "${LOCALSTACK_AUTH_TOKEN:-}" ]]; then
        echo ""
        echo -e "${YELLOW}[주의] LOCALSTACK_AUTH_TOKEN 환경변수가 설정되지 않았습니다.${NC}"
        echo "  LocalStack 2026.03 이후 Hobby 이상 플랜에서 토큰이 필요합니다."
        echo "  토큰 발급: https://app.localstack.cloud/sign-in"
        echo "  설정 방법: export LOCALSTACK_AUTH_TOKEN='your-token'"
        echo ""
        echo "  [대안] MiniStack (계정 불요, MIT):"
        echo "    ./start.sh --mode ministack"
        echo ""
        read -r -p "토큰 없이 계속하시겠습니까? (y/N) " answer
        if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
            echo "취소됨."; exit 1
        fi
    fi

    echo "[docker] LocalStack 기동 중..."
    DOCKER_ARGS=(run --rm -d --name "$CONTAINER_NAME" -p 4566:4566)
    if [[ -n "${LOCALSTACK_AUTH_TOKEN:-}" ]]; then
        DOCKER_ARGS+=(-e "LOCALSTACK_AUTH_TOKEN=$LOCALSTACK_AUTH_TOKEN")
    fi
    DOCKER_ARGS+=(localstack/localstack)
    docker "${DOCKER_ARGS[@]}"

elif [[ "$MODE" == "ministack" ]]; then
    echo "[docker] MiniStack 기동 중 (계정 불요)..."
    docker run --rm -d --name "$CONTAINER_NAME" -p 4566:4566 gresearch/ministack
fi

# ── LocalStack 헬스 대기 ───────────────────────────────────
if [[ "$MODE" != "real" ]]; then
    echo "[wait] LocalStack 헬스체크 대기 (최대 30s)..."
    MAX_WAIT=30; WAITED=0
    while [[ $WAITED -lt $MAX_WAIT ]]; do
        sleep 2; WAITED=$((WAITED + 2))
        if curl -sf "http://localhost:4566/_localstack/health" >/dev/null 2>&1; then
            echo "[wait] LocalStack 준비 완료 (${WAITED}s)"; break
        fi
        echo "[wait]   ...${WAITED}s"
    done
    if [[ $WAITED -ge $MAX_WAIT ]]; then
        echo -e "${YELLOW}[warn] LocalStack 헬스체크 응답 없음 — grade.py는 계속 기동합니다.${NC}"
    fi
fi

# ── grade.py 기동 ─────────────────────────────────────────
echo "[grade] grade.py 기동 중 (포트 $GRADE_PORT)..."
export PORT="$GRADE_PORT"
if [[ "$MODE" == "real" ]]; then export AWS_MODE="real"; fi

nohup python3 "$GRADE_SCRIPT" > /tmp/aws-lab-grade.log 2>&1 &
GRADE_PID=$!
echo $GRADE_PID > "$GRADE_PID_FILE"

echo ""
echo -e "${GREEN}=== 기동 완료 ===${NC}"
echo "  LocalStack : http://localhost:4566"
echo "  grade.py   : http://localhost:$GRADE_PORT/health  (PID: $GRADE_PID)"
echo "  grade 로그 : tail -f /tmp/aws-lab-grade.log"
echo ""
echo "종료하려면: ./start.sh --stop"
