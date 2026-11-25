[CmdletBinding()]
param([string]$SshHost = 'cardgames-pi', [switch]$NoUpload, [switch]$Test, [switch]$FullTests, [switch]$TraceCommands, [string]$TestPattern, [string]$TestBase)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-upload-common.ps1')
Invoke-PrebuiltUpload -Component frontend -SshHost $SshHost -NoUpload:$NoUpload -Test:$Test -FullTests:$FullTests -TraceCommands:$TraceCommands -TestPattern $TestPattern -TestBase $TestBase
