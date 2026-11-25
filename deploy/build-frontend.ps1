[CmdletBinding()]
param([string]$SshHost = 'cardgames-pi', [switch]$NoUpload)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-upload-common.ps1')
Invoke-PrebuiltUpload -Component frontend -SshHost $SshHost -NoUpload:$NoUpload
