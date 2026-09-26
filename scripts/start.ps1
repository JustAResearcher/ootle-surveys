$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = if ($env:SURVEY_PORT) { [int]$env:SURVEY_PORT } else { 4182 }
$dataRoot = if ($env:SURVEY_DATA_DIR) { $env:SURVEY_DATA_DIR } else { Join-Path $projectRoot 'data' }
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
if ([int]((& node --version).TrimStart('v').Split('.')[0]) -lt 24) { throw 'Ootle Surveys requires Node.js 24 or newer.' }
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'The application build failed.' }
} finally { Pop-Location }
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    $nodePath = (Get-Command node.exe).Source
    Start-Process -FilePath $nodePath -ArgumentList @('--experimental-wasm-modules', '--import', 'tsx', 'server/index.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataRoot 'server.log') -RedirectStandardError (Join-Path $dataRoot 'server-error.log') | Out-Null
    Write-Output "Ootle Surveys is starting at http://127.0.0.1:$port"
} else {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health"
    if ($health.app -ne 'ootle-surveys') { throw "Port $port belongs to another application." }
    Write-Output "Ootle Surveys is already running at http://127.0.0.1:$port"
}
Write-Output ('Organizer access code file: ' + (Join-Path $dataRoot 'admin-access.txt'))
