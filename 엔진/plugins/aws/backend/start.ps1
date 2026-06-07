# start.ps1 — AWS 플러그인 원클릭 기동 스크립트 (Windows PowerShell)
# 사용법:
#   .\start.ps1                    # LocalStack 기동 + grade.py 기동
#   .\start.ps1 -Mode ministack    # MiniStack(계정 불요) + grade.py
#   .\start.ps1 -Mode real         # 실제 AWS 계정 + grade.py (LocalStack 없음)
#   .\start.ps1 -StopAll           # 실행 중인 컨테이너 + grade.py 종료
#
# LocalStack (2026.03+) 인증:
#   $env:LOCALSTACK_AUTH_TOKEN = "your-token"  # 실행 전 설정
#   → 토큰 발급: https://app.localstack.cloud/sign-in
#
# 의존:
#   docker, python (3.10+), pip install boto3 botocore

param(
    [ValidateSet("localstack", "ministack", "real")]
    [string]$Mode = "localstack",
    [switch]$StopAll
)

$ErrorActionPreference = "Stop"
$GRADE_PORT = if ($env:PORT) { $env:PORT } else { "5001" }
$CONTAINER_NAME = "aws-lab-localstack"

# ── 종료 처리 ──────────────────────────────────────────────
if ($StopAll) {
    Write-Host "[stop] grade.py 프로세스 종료 시도..."
    Get-Process -Name python -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*grade.py*" } |
        ForEach-Object { $_.Kill(); Write-Host "[stop]   PID $($_.Id) 종료" }

    Write-Host "[stop] Docker 컨테이너 '$CONTAINER_NAME' 종료 시도..."
    docker rm -f $CONTAINER_NAME 2>$null
    Write-Host "[stop] 완료."
    exit 0
}

# ── 사전 점검 ──────────────────────────────────────────────
Write-Host ""
Write-Host "=== AWS 플러그인 기동 (모드: $Mode) ===" -ForegroundColor Cyan

# Python 확인
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "python 명령을 찾을 수 없습니다. Python 3.10+ 설치 후 재시도하세요."
}

# Docker 확인 (localstack/ministack 모드)
if ($Mode -ne "real") {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "docker 명령을 찾을 수 없습니다. Docker Desktop 설치 후 재시도하세요."
    }
}

# ── LocalStack / MiniStack 기동 ────────────────────────────
if ($Mode -eq "localstack") {
    if (-not $env:LOCALSTACK_AUTH_TOKEN) {
        Write-Host ""
        Write-Host "[주의] LOCALSTACK_AUTH_TOKEN 환경변수가 설정되지 않았습니다." -ForegroundColor Yellow
        Write-Host "  LocalStack 2026.03 이후 Hobby 이상 플랜에서 토큰이 필요합니다."
        Write-Host "  토큰 발급: https://app.localstack.cloud/sign-in"
        Write-Host "  설정 방법: `$env:LOCALSTACK_AUTH_TOKEN = 'your-token'"
        Write-Host ""
        Write-Host "  [대안] MiniStack (계정 불요, MIT) 사용:"
        Write-Host "    .\start.ps1 -Mode ministack"
        Write-Host ""
        $answer = Read-Host "LOCALSTACK_AUTH_TOKEN 없이 계속하시겠습니까? (y/N)"
        if ($answer -notmatch "^[yY]") {
            Write-Host "취소됨."
            exit 1
        }
    }

    Write-Host "[docker] LocalStack 기동 중..."
    $dockerArgs = @(
        "run", "--rm", "-d",
        "--name", $CONTAINER_NAME,
        "-p", "4566:4566"
    )
    if ($env:LOCALSTACK_AUTH_TOKEN) {
        $dockerArgs += @("-e", "LOCALSTACK_AUTH_TOKEN=$env:LOCALSTACK_AUTH_TOKEN")
    }
    $dockerArgs += "localstack/localstack"
    & docker @dockerArgs
    if ($LASTEXITCODE -ne 0) { Write-Error "LocalStack 기동 실패" }

} elseif ($Mode -eq "ministack") {
    Write-Host "[docker] MiniStack 기동 중 (계정 불요)..."
    docker run --rm -d --name $CONTAINER_NAME -p 4566:4566 gresearch/ministack
    if ($LASTEXITCODE -ne 0) { Write-Error "MiniStack 기동 실패" }
}

# ── LocalStack 헬스 대기 ───────────────────────────────────
if ($Mode -ne "real") {
    Write-Host "[wait] LocalStack 헬스체크 대기 (최대 30s)..."
    $maxWait = 30
    $waited  = 0
    do {
        Start-Sleep -Seconds 2
        $waited += 2
        try {
            $r = Invoke-RestMethod -Uri "http://localhost:4566/_localstack/health" -TimeoutSec 2 -ErrorAction Stop
            if ($r.status -eq "running" -or $r.services) {
                Write-Host "[wait] LocalStack 준비 완료 (${waited}s)"
                break
            }
        } catch {}
        Write-Host "[wait]   ...${waited}s"
    } while ($waited -lt $maxWait)
    if ($waited -ge $maxWait) {
        Write-Host "[warn] LocalStack 헬스체크 응답 없음 — grade.py는 계속 기동합니다." -ForegroundColor Yellow
    }
}

# ── grade.py 기동 ─────────────────────────────────────────
Write-Host "[grade] grade.py 기동 중 (포트 $GRADE_PORT)..."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gradeScript = Join-Path $scriptDir "grade.py"

if (-not (Test-Path $gradeScript)) {
    Write-Error "grade.py 를 찾을 수 없습니다: $gradeScript"
}

$env:PORT = $GRADE_PORT
if ($Mode -eq "real") { $env:AWS_MODE = "real" }

# 별도 창에서 grade.py 실행
Start-Process python -ArgumentList "`"$gradeScript`"" -NoNewWindow

Write-Host ""
Write-Host "=== 기동 완료 ===" -ForegroundColor Green
Write-Host "  LocalStack : http://localhost:4566"
Write-Host "  grade.py   : http://localhost:$GRADE_PORT/health"
Write-Host ""
Write-Host "종료하려면: .\start.ps1 -StopAll"
