# Shared Windows build and upload implementation.
function Invoke-PrebuiltUpload {
    param([Parameter(Mandatory)][ValidateSet('frontend','backend')][string]$Component, [string]$SshHost = 'cardgames-pi', [switch]$NoUpload)
    $ErrorActionPreference = 'Stop'
    $root = Split-Path -Parent $PSScriptRoot
    Push-Location -LiteralPath $root
    $transcriptStarted = $false
    $log = $null
    try {
        $logDir = Join-Path $root 'private/deploy-logs'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $log = Join-Path $logDir ("build-$Component-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID + '.log')
        Start-Transcript -Path $log | Out-Null
        $transcriptStarted = $true
        Write-Host "Build log: $log"
        Set-PSDebug -Trace 1
        function Invoke-Checked {
            param([string]$Command, [string[]]$Arguments)
            Write-Host ("> " + $Command + " " + ($Arguments -join ' ')) -ForegroundColor Cyan
            & $Command @Arguments
            if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
        }
        $changes = & git status --porcelain --untracked-files=no
        if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Commit or stash tracked changes before building.' }
        Invoke-Checked git @('fetch','origin','dev')
        $commit = & git rev-parse HEAD
        if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot resolve HEAD.' }
        $remote = & git rev-parse origin/dev
        if ($LASTEXITCODE -ne 0 -or $remote -ne $commit) { throw 'Pull dev first; HEAD must match origin/dev.' }
        if (-not (Test-Path -LiteralPath 'node_modules')) { throw 'Run npm ci at the repository root first.' }
        if ($Component -eq 'backend') {
            Invoke-Checked npm.cmd @('run','typecheck','-w','packages/backend')
            Invoke-Checked npm.cmd @('run','test:lint-rules','-w','packages/backend')
            # Avoid Windows Jest's rootDir/extglob discovery issue and fail on zero tests.
            Invoke-Checked npm.cmd @('run','test:unit','-w','packages/backend','--','--testMatch','**/*.unit.ts','--passWithNoTests=false','--runInBand')
        } else {
            Invoke-Checked npm.cmd @('run','test:unit','-w','packages/frontend','--','--run')
        }
        Invoke-Checked npm.cmd @('run','build','-w',"packages/$Component")
        $after = & git status --porcelain --untracked-files=no
        if ($LASTEXITCODE -ne 0 -or $after) { throw 'Tracked files changed during build; review before packaging.' }
        $afterCommit = & git rev-parse HEAD
        if ($LASTEXITCODE -ne 0 -or $afterCommit -ne $commit) { throw 'HEAD changed during build.' }
        $name = "$Component-$commit"
        $artifact = Join-Path $root "private/$name"
        if (Test-Path -LiteralPath $artifact) { Remove-Item -LiteralPath $artifact -Recurse -Force }
        $dist = Join-Path $artifact "$Component-dist"
        New-Item -ItemType Directory -Path $dist -Force | Out-Null
        $required = if ($Component -eq 'backend') { 'app.js' } else { 'index.html' }
        if (-not (Test-Path -LiteralPath "packages/$Component/dist/$required")) { throw "Build output missing $required." }
        Copy-Item "packages/$Component/dist/*" $dist -Recurse -Force
        if ($Component -eq 'backend') {
            $migrations = Join-Path $artifact 'migrations'
            New-Item -ItemType Directory -Path $migrations -Force | Out-Null
            Copy-Item 'packages/backend/src/migrations/*' $migrations -Recurse -Force
            Copy-Item 'package-lock.json' (Join-Path $artifact 'package-lock.json') -Force
        } else {
            Copy-Item 'packages/frontend/nginx.conf' (Join-Path $artifact 'nginx.conf') -Force
            $entry = Get-Content 'self-hosting/frontend/docker-entrypoint.sh' -Raw
            [IO.File]::WriteAllText((Join-Path $artifact 'docker-entrypoint.sh'), $entry.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
        }
        [IO.File]::WriteAllText((Join-Path $artifact 'source-commit.txt'), $commit, [Text.UTF8Encoding]::new($false))
        if (-not $NoUpload) {
            $stage = "$name-upload-$([Guid]::NewGuid().ToString('N'))"
            Invoke-Checked ssh.exe @($SshHost, "mkdir -p ~/personal-finance-dashboard/private/$stage")
            Invoke-Checked scp.exe @('-r', $artifact, "${SshHost}:personal-finance-dashboard/private/$stage/")
            Invoke-Checked ssh.exe @($SshHost, "cd ~/personal-finance-dashboard/private && if test -e $name; then echo 'Artifact already exists; reuse it or remove it only when not deploying.' >&2; exit 1; fi; mv -T $stage/$name $name && rmdir $stage")
            Write-Host "Uploaded private/$name"
        }
        Write-Host "Built $Component at $commit"
        Set-PSDebug -Off
        if ($NoUpload) {
            Write-Host "PASS: $Component tests and build succeeded. Local package only; upload before deploying." -ForegroundColor Green
        } else {
            Write-Host "PASS: $Component tests, build and upload succeeded. Ready to deploy on the Pi." -ForegroundColor Green
            Write-Host "On the Pi: sh deploy/deploy-$Component.sh"
        }
    } catch {
        Set-PSDebug -Off
        Write-Host "FAIL: $Component build/upload failed. DO NOT PROCEED." -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        throw
    } finally {
        Set-PSDebug -Off
        if ($log) { Write-Host "Log: $log" }
        if ($transcriptStarted) { Stop-Transcript | Out-Null }
        Pop-Location
    }
}
