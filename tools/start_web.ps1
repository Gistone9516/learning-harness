# Start a web subject: build the kit bundle, then the AI/state server and the host page.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File <kit>\tools\start_web.ps1 -Subject "<subject folder>"
#
# Kept pure ASCII on purpose: PowerShell 5.1 reads a BOM-less script as the ANSI code page, so any
# non-ASCII path must arrive as a parameter, never be written into this file.
# Ctrl+C stops both servers; this script stops whatever it started.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Subject,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$kit = Split-Path -Parent $PSScriptRoot
$subjectDir = (Resolve-Path -LiteralPath $Subject).Path
$started = @()

function Read-DotEnv([string]$path) {
    $vals = @{}
    if (Test-Path -LiteralPath $path) {
        foreach ($line in [System.IO.File]::ReadAllLines($path)) {
            $t = $line.Trim()
            if (-not $t -or $t.StartsWith('#') -or -not $t.Contains('=')) { continue }
            $i = $t.IndexOf('=')
            $vals[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
        }
    }
    return $vals
}

function Stop-Started {
    foreach ($p in $started) {
        if ($p -and -not $p.HasExited) {
            Write-Host "[start] stopping pid $($p.Id)"
            try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
        }
    }
}

try {
    $envFile = Join-Path $subjectDir '.env'
    if (-not (Test-Path -LiteralPath $envFile)) { throw ".env not found in the subject folder. Copy .env.example to .env and set AI_SERVER_TOKEN." }
    $cfg = Read-DotEnv $envFile
    if (-not $cfg['AI_SERVER_TOKEN']) { throw "AI_SERVER_TOKEN is empty in the subject .env." }
    $aiPort = if ($cfg['AI_SERVER_PORT']) { $cfg['AI_SERVER_PORT'] } else { '8765' }
    $hostPort = if ($cfg['HOST_PORT']) { $cfg['HOST_PORT'] } else { '8080' }
    if (-not (Test-Path -LiteralPath (Join-Path $subjectDir 'host\local.config.js'))) {
        Write-Warning "host/local.config.js is missing. Copy host/local.config.example.js and set the same token."
    }

    $stateRoot = Join-Path $subjectDir 'state'
    if (-not (Test-Path -LiteralPath $stateRoot)) { New-Item -ItemType Directory -Path $stateRoot | Out-Null }

    # npm.cmd, never a bare `& npm`: the npm.ps1 shim drops the first character of its arguments when
    # invoked through the call operator (Unknown command: "pm"). Measured with npm 10.9.3.
    if (-not $SkipBuild) {
        $webDir = Join-Path $kit 'web'
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        Write-Host "[start] building kit bundle"
        Push-Location $webDir
        try { & $npm run build | Out-Null; if ($LASTEXITCODE -ne 0) { throw "bundle build failed ($LASTEXITCODE)" } } finally { Pop-Location }
    }

    Write-Host "[start] ai_server + state on http://127.0.0.1:$aiPort"
    $aiServer = Start-Process -FilePath 'python' `
        -ArgumentList @('"' + (Join-Path $kit 'bot\ai_server.py') + '"', '"' + $stateRoot + '"') `
        -WorkingDirectory $subjectDir -PassThru -NoNewWindow
    $started += $aiServer

    Write-Host "[start] host page on http://127.0.0.1:$hostPort"
    $hostServer = Start-Process -FilePath 'python' `
        -ArgumentList @('"' + (Join-Path $kit 'tools\serve_host.py') + '"', '--subject', '"' + $subjectDir + '"', '--port', $hostPort) `
        -WorkingDirectory $subjectDir -PassThru -NoNewWindow
    $started += $hostServer

    Write-Host "[start] ready. Open http://127.0.0.1:$hostPort  (Ctrl+C to stop)"
    while ($true) {
        Start-Sleep -Seconds 1
        foreach ($p in $started) {
            if ($p.HasExited) { throw "process $($p.Id) exited with code $($p.ExitCode)" }
        }
    }
}
finally {
    Stop-Started
}
