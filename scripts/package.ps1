$ErrorActionPreference = 'Stop'
$taskWorkspace = (Resolve-Path '.').Path
$taskOutput = Join-Path $taskWorkspace 'outputs'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskStage = Join-Path $taskWorkspace ('work\submission-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $taskStage -Force | Out-Null
$taskItems = @('src','server','shared','tests','scripts','docs','deploy','dist','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','Dockerfile','compose.yaml','railway.json','start-local.cmd','.env.example','.gitignore','.dockerignore','.prettierrc.json','.prettierignore','README.md')
foreach ($taskItem in $taskItems) { Copy-Item -LiteralPath (Join-Path $taskWorkspace $taskItem) -Destination $taskStage -Recurse }
$taskStageOutput = Join-Path $taskStage 'outputs'
New-Item -ItemType Directory -Path $taskStageOutput -Force | Out-Null
foreach ($taskDeliverable in @('v2-demo.webm','v2-preview-home.png','v2-preview-plan.png','v2-preview-research.png','v2-preview-mobile.png','v2-preview-mobile-top.png','v2-preview-harness.png','v2-preview-evidence.png','v2-preview-counter-source.png','v2-preview-question.png','v2-test-result.txt','v2-build-result.txt','v2-mysql-test-result.json','v2-smoke-result.json','v2-browser-test-result.json','v2-a11y.json','v2-sample-bundle.json','v2-bundle-verification.json','v2-acceptance.json','V2_DELIVERY.md','PUBLIC_DELIVERY.md','public-smoke-result.json','public-restart-result.json','public-resilience-result.json','public-deployment.json','public-browser-result.json','public-home.jpg','public-research.jpg','public-evidence.jpg','public-repository.jpg')) { $taskFile=Join-Path $taskOutput $taskDeliverable; if (Test-Path -LiteralPath $taskFile) { Copy-Item -LiteralPath $taskFile -Destination $taskStageOutput } }
$taskArchive = Join-Path $taskOutput 'investment-x-buddy-v2.zip'
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $taskStage -Force | Select-Object -ExpandProperty FullName) -DestinationPath $taskArchive -Force
$taskSize = (Get-Item -LiteralPath $taskArchive).Length
if ($taskSize -gt 30MB) { throw "Submission archive exceeds 30MB: $taskSize bytes" }
$taskDigest=(Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLower()
Set-Content -LiteralPath ($taskArchive + '.sha256.txt') -Value ($taskDigest + '  investment-x-buddy-v2.zip') -Encoding ASCII
Write-Output "Created $taskArchive ($([Math]::Round($taskSize/1MB,2)) MB). Secrets, dependencies and runtime databases excluded."
