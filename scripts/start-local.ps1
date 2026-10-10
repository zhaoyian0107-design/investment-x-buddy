param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceUrl = 'http://127.0.0.1:3000'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath 'E:\node.js\node.exe') { 'E:\node.js\node.exe' } else { throw 'Node.js 24 or later is required.' }
$nodeVersion = & $nodeExecutable --version
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw "Node.js 24 or later is required. Current version: $nodeVersion" }
try { $health = Invoke-RestMethod "$serviceUrl/api/health" -TimeoutSec 2 } catch { $health = $null }
if (-not ($health.ok -eq $true -and $health.version -eq '2.0.0')) {
  if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) { throw 'Port 3000 is occupied. No process was stopped.' }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\tsx'))) { throw 'Run npm.cmd ci in the project folder first.' }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) { throw 'Run npm.cmd run build in the project folder first.' }
  $workPath = Join-Path $projectRoot 'work'
  New-Item -ItemType Directory -Path $workPath -Force | Out-Null
  $env:PORT = '3000'
  $env:HOST = '127.0.0.1'
  $serviceProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('--import', 'tsx', 'server/index.ts', '--production') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workPath 'local-service-3000.stdout.log') -RedirectStandardError (Join-Path $workPath 'local-service-3000.stderr.log') -PassThru
  $serviceProcess.Id | Set-Content -LiteralPath (Join-Path $workPath 'local-service-3000.pid')
  $health = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { $health = Invoke-RestMethod "$serviceUrl/api/health" -TimeoutSec 2; if ($health.ok -eq $true -and $health.version -eq '2.0.0') { break } } catch { }
    if ($serviceProcess.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not ($health.ok -eq $true -and $health.version -eq '2.0.0')) { throw "Service startup failed. Check the logs in $workPath" }
}
Write-Host "Investment X Buddy is ready: $serviceUrl"
if (-not $NoBrowser) { Start-Process $serviceUrl }
