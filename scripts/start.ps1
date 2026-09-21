$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 4182
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    $nodePath = (Get-Command node.exe).Source
    Start-Process -FilePath $nodePath -ArgumentList @('--experimental-wasm-modules', '--import', 'tsx', 'server/index.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'data/server.log') -RedirectStandardError (Join-Path $projectRoot 'data/server-error.log') | Out-Null
    Write-Output 'Ootle Surveys is starting at http://127.0.0.1:4182'
} else {
    Write-Output 'Port 4182 is already listening. Verify that it is Ootle Surveys before entering your access code.'
}
Write-Output ('Organizer access code: ' + (Join-Path $projectRoot 'data/admin-access.txt'))
