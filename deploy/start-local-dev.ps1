# Uses the existing Pi backend through an encrypted SSH tunnel; no local DB needed.
[CmdletBinding()]
param([string]$SshHost = 'cardgames-pi', [int]$FrontendPort = 8110, [int]$TunnelPort = 8095)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodeDirectory = 'C:\Program Files\nodejs'
$gitBash = 'C:\Program Files\Git\bin\bash.exe'
if (Test-Path -LiteralPath $nodeDirectory) { $env:Path = "$nodeDirectory;$env:Path" }
if (Test-Path -LiteralPath $gitBash) { $env:npm_config_script_shell = $gitBash }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Install Node.js (see .nvmrc) first.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules'))) { throw 'Run npm ci at the repository root first (use Git Bash on Windows).' }
$ownedTunnel = $null
try {
  if (-not (Get-NetTCPConnection -State Listen -LocalPort $TunnelPort -ErrorAction SilentlyContinue)) {
    $ownedTunnel = Start-Process -FilePath 'ssh.exe' -ArgumentList @('-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-L', "${TunnelPort}:192.168.0.32:8095", $SshHost) -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    if ($ownedTunnel.HasExited) { throw 'SSH tunnel failed. Verify the existing SSH alias and Pi service.' }
  }
  $env:VITE_APP_API_HTTP = "http://localhost:$TunnelPort"
  $env:VITE_APP_API_VER = '/api/v1'
  $env:PORT = [string]$FrontendPort
  $env:HOST = '127.0.0.1'
  Push-Location -LiteralPath $projectDirectory
  try { & npm.cmd -w packages/frontend run dev -- --host 127.0.0.1 } finally { Pop-Location }
} finally {
  if ($ownedTunnel -and -not $ownedTunnel.HasExited) { $ownedTunnel.Kill() }
}
