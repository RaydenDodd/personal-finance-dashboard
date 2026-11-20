$ErrorActionPreference = 'Stop'
$sourceDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$targetDirectory = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MoneyMatter\ADPCompanion'))
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
if ($sourceDirectory -ne $targetDirectory) {
  New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  foreach ($relativeDirectory in @('scripts','node_modules','extension')) {
    Copy-Item -LiteralPath (Join-Path $sourceDirectory $relativeDirectory) -Destination $targetDirectory -Recurse -Force
  }
}
$configuration = Get-Content -LiteralPath (Join-Path $targetDirectory 'scripts\adp-companion\config.json') -Raw | ConvertFrom-Json
if ($configuration.extensionId -notmatch '^[a-p]{32}$' -or $configuration.hostName -ne 'com.moneymatter.adp_companion') { throw 'Invalid companion identity' }
$launcherPath = Join-Path $targetDirectory 'launch.cmd'
$hostScript = Join-Path $targetDirectory 'scripts\adp-companion\native-host.mjs'
$launcher = "@echo off`r`n`"$nodeExecutable`" `"$hostScript`" %*`r`n"
[IO.File]::WriteAllText($launcherPath,$launcher,[Text.Encoding]::ASCII)
$manifest = @{ name=$configuration.hostName;description='MoneyMatter temporary ADP browser';path=$launcherPath;type='stdio';allowed_origins=@("chrome-extension://$($configuration.extensionId)/") }
$manifestPath = Join-Path $targetDirectory 'native-host.json'
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
foreach ($browser in @('Microsoft\Edge','Google\Chrome')) {
  $registryPath = "HKCU:\Software\$browser\NativeMessagingHosts\$($configuration.hostName)"
  New-Item -Path $registryPath -Force | Out-Null
  Set-Item -Path $registryPath -Value $manifestPath
}
Write-Output 'Installed the current-user native companion. No background service was installed.'
Write-Output "Load this unpacked extension in Edge or Chrome: $(Join-Path $targetDirectory 'extension')"
