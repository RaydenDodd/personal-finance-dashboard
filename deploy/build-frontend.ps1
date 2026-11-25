[CmdletBinding()]
param([string]$SshHost = 'cardgames-pi', [switch]$NoUpload, [switch]$FullTests, [string]$TestPattern, [string]$TestBase)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-upload-common.ps1')
Invoke-PrebuiltUpload -Component frontend -SshHost $SshHost -NoUpload:$NoUpload -FullTests:$FullTests -TestPattern $TestPattern -TestBase $TestBase
