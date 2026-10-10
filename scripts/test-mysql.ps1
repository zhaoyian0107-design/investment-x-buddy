param([string]$MySqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin', [int]$DatabasePort = 0)
$ErrorActionPreference = 'Stop'
$taskWorkspace = (Resolve-Path '.').Path
$taskServer = Join-Path $MySqlBin 'mysqld.exe'
$taskClient = Join-Path $MySqlBin 'mysql.exe'
if (!(Test-Path -LiteralPath $taskServer)) { throw 'MySQL server binary not found. Pass -MySqlBin to an installed MySQL 8 server bin directory.' }
if ($DatabasePort -eq 0) { $taskPortPicker = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0); $taskPortPicker.Start(); $DatabasePort=$taskPortPicker.LocalEndpoint.Port; $taskPortPicker.Stop() }
$taskData = Join-Path $taskWorkspace ('work\mysql-test-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
$taskData = (Resolve-Path -LiteralPath $taskData).Path
if (!$taskData.StartsWith($taskWorkspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test data directory is outside the workspace.' }
& $taskServer --no-defaults --initialize-insecure "--basedir=$($MySqlBin.Substring(0,$MySqlBin.Length-4))" "--datadir=$taskData" --console
if ($LASTEXITCODE -ne 0) { throw 'Could not initialize isolated MySQL test instance.' }
$taskInitSql = Join-Path $taskData 'test-init.sql'
@"
CREATE DATABASE buddy_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'buddy_test'@'127.0.0.1' IDENTIFIED BY 'isolated_test_only';
GRANT ALL PRIVILEGES ON buddy_test.* TO 'buddy_test'@'127.0.0.1';
"@ | Set-Content -LiteralPath $taskInitSql -Encoding ASCII
$taskMysqlProcess = Start-Process -FilePath $taskServer -ArgumentList @('--no-defaults', "--datadir=`"$taskData`"", "--init-file=`"$taskInitSql`"", "--port=$DatabasePort", '--bind-address=127.0.0.1', '--mysqlx=OFF', '--skip-name-resolve', '--console') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskData 'stdout.log') -RedirectStandardError (Join-Path $taskData 'stderr.log')
try {
  $taskReady = $false
  for ($taskAttempt=0; $taskAttempt -lt 100; $taskAttempt++) {
    $taskConnection = New-Object System.Net.Sockets.TcpClient
    try { $taskConnection.Connect('127.0.0.1', $DatabasePort); $taskReady = $true; break } catch { Start-Sleep -Milliseconds 200 } finally { $taskConnection.Dispose() }
  }
  if (!$taskReady) { throw 'MySQL test instance did not start. Check work/mysql-test-*/stderr.log.' }
  $env:MYSQL_TEST_URL = "mysql://buddy_test:isolated_test_only@127.0.0.1:$DatabasePort/buddy_test"
  node --import tsx scripts/mysql-smoke.ts
  if ($LASTEXITCODE -ne 0) { throw 'MySQL integration tests failed.' }
} finally {
  Remove-Item Env:MYSQL_TEST_URL -ErrorAction SilentlyContinue
  $taskOwnedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskMysqlProcess.Id)" -ErrorAction SilentlyContinue
  if ($taskOwnedProcess -and $taskOwnedProcess.CommandLine -and $taskOwnedProcess.CommandLine.Contains($taskData) -and $taskOwnedProcess.ExecutablePath -eq $taskServer) { Stop-Process -Id $taskOwnedProcess.ProcessId -Force }
}
