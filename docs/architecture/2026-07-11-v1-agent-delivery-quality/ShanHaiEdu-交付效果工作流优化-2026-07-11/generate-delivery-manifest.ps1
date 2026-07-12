param([string]$Root = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $Root 'delivery-manifest.json'
$files = Get-ChildItem -LiteralPath $Root -Recurse -File |
  Where-Object { $_.FullName -ne $manifestPath } |
  Sort-Object FullName

$entries = foreach ($file in $files) {
  $relative = [System.IO.Path]::GetRelativePath($Root, $file.FullName).Replace('\', '/')
  [ordered]@{
    path = $relative
    bytes = $file.Length
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  }
}

$manifest = [ordered]@{
  schemaVersion = '1.0'
  generatedAt = (Get-Date).ToString('o')
  root = (Resolve-Path -LiteralPath $Root).Path
  fileCount = @($entries).Count
  files = @($entries)
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Manifest written: $manifestPath"
Write-Output "Files hashed: $(@($entries).Count)"
