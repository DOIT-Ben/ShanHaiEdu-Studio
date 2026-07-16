param([string]$Root = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$python = Get-Command python -ErrorAction Stop

$pairs = @(
  @('node-contracts-v2.json', 'node-contracts-v2.schema.json'),
  @('examples/delivery-strategy.example.json', 'delivery-strategy.schema.json'),
  @('examples/ppt-director-response.example.json', 'ppt-director-response.schema.json'),
  @('examples/page-spec.example.json', 'page-spec.schema.json'),
  @('examples/shot-spec.example.json', 'shot-spec.schema.json'),
  @('examples/review-finding.example.json', 'review-finding.schema.json'),
  @('examples/agent-decision-envelope.example.json', 'agent-decision-envelope.schema.json'),
  @('examples/tool-observation-v2.example.json', 'tool-observation-v2.schema.json')
)

foreach ($pair in $pairs) {
  $instance = Join-Path $Root $pair[0]
  & $python.Source (Join-Path $Root 'validate_json_schema.py') $Root $pair[0] $pair[1]
  if ($LASTEXITCODE -ne 0) { throw "Schema validation failed: $instance" }
}

$registry = Get-Content -Raw (Join-Path $Root 'node-contracts-v2.json') | ConvertFrom-Json
$ids = @($registry.contracts.id)
$duplicates = $ids | Group-Object | Where-Object Count -gt 1 | Select-Object -ExpandProperty Name
if ($duplicates) { throw "Duplicate contract ids: $($duplicates -join ', ')" }

$allowedTerminals = @('delivered')
$missing = foreach ($contract in $registry.contracts) {
  foreach ($next in $contract.recommendedNext) {
    if ($next -notin $ids -and $next -notin $allowedTerminals) { "$($contract.id) -> $next" }
  }
}
if ($missing) { throw "Unknown recommendedNext targets: $($missing -join '; ')" }

Write-Output "Contract ids: $($ids.Count), unique: $(@($ids | Sort-Object -Unique).Count)"
Write-Output 'Advisory reference integrity: VALID'
