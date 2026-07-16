param(
  [string]$EnvPath = "E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main\.env",
  [string]$OutputDir = (Join-Path $PSScriptRoot 'video'),
  [switch]$ResumeCompleted
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir | Out-Null }

function Read-DotEnv([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $map[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
  return $map
}

function Get-Value($Value, $Default) {
  if ($null -ne $Value -and [string]$Value -ne '') { return $Value }
  return $Default
}

function Find-TaskId($Payload) {
  foreach ($candidate in @($Payload.id, $Payload.task_id, $Payload.taskId, $Payload.data.id, $Payload.data.task_id, $Payload.data.taskId)) {
    if ($candidate) { return [string]$candidate }
  }
  throw 'missing_video_task_id'
}

function Find-ResultUrl($Payload) {
  $candidates = @($Payload.video_url, $Payload.url, $Payload.result_url, $Payload.data.video_url, $Payload.data.url, $Payload.data.result_url, $Payload.data.first_video_url, $Payload.result.video_url, $Payload.result.url, $Payload.results[0], $Payload.result_data.urls[0])
  foreach ($candidate in $candidates) { if ($candidate) { return [string]$candidate } }
  throw 'missing_video_result_url'
}

$envMap = Read-DotEnv $EnvPath
$apiKey = Get-Value $envMap['EVOLINK_VIDEO_API_KEY'] $envMap['EVOLINK_API_KEY']
$baseUrl = (Get-Value $envMap['EVOLINK_VIDEO_BASE_URL'] (Get-Value $envMap['EVOLINK_BASE_URL'] 'https://api.evolink.ai')).TrimEnd('/')
$model = Get-Value $envMap['EVOLINK_VIDEO_MODEL'] (Get-Value $envMap['VIDEO_MODEL'] 'grok-imagine-text-to-video-beta')
$duration = [int](Get-Value $envMap['EVOLINK_VIDEO_DURATION_SECONDS'] (Get-Value $envMap['VIDEO_DURATION_SECONDS'] '6'))
$quality = Get-Value $envMap['EVOLINK_VIDEO_QUALITY'] (Get-Value $envMap['VIDEO_QUALITY'] '480p')
$mode = Get-Value $envMap['EVOLINK_VIDEO_STYLE_MODE'] (Get-Value $envMap['VIDEO_STYLE_MODE'] 'normal')
$aspectRatio = Get-Value $envMap['EVOLINK_VIDEO_ASPECT_RATIO'] (Get-Value $envMap['VIDEO_ASPECT_RATIO'] '16:9')
if (-not $apiKey) { throw 'missing_video_api_key' }

$prompt = @'
Shot ID: opening_hook_01. Six-second continuous cinematic shot for a first-grade classroom intro video.
Subject: a curious seven-year-old child in a mustard-yellow jacket inside a handcrafted paper-cut museum hall.
Action: a sudden warm breeze lifts a trail of blank paper exhibit labels from the displays; the child notices, turns, and follows them with visible surprise.
Context: bright ivory museum interior with lake-blue floor path and sunflower-yellow accents, playful picture-book paper texture, no classroom and no presentation screen.
Framing and camera: begin as a wide child-eye-level establishing shot; smooth forward dolly follows the flying paper trail toward a glowing empty exhibition arch on the right; maintain a strong diagonal depth path and keep the child's full body readable.
Start state: quiet hall, child entering from lower left, blank papers resting near exhibits.
End state: papers curve toward the glowing arch, child stops and looks up, clear unresolved mystery.
Motion: papers flutter with varied arcs, jacket and leaves respond subtly to the breeze, no static hold longer than half a second.
Style and lighting: premium children's picture-book, handcrafted layered paper, warm diffuse daylight, crisp silhouettes, classroom projection readability.
No dialogue and no on-screen text. No letters, numbers, signage, subtitles, logos, watermark, card grid, five-column layout, dashboard, repeated display boxes, distorted hands, extra limbs, duplicate child, dark horror mood, camera shake, abrupt cuts, answer reveal, or mathematical explanation.
'@

$request = [ordered]@{
  model = $model
  prompt = $prompt
  duration = $duration
  quality = $quality
  mode = $mode
  aspect_ratio = $aspectRatio
}
$request | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDir 'request-sanitized.json') -Encoding utf8

$completedPath = Join-Path $OutputDir 'completed-response.json'
if ($ResumeCompleted) {
  if (-not (Test-Path $completedPath)) { throw 'completed_response_missing' }
  $completed = Get-Content -Raw $completedPath | ConvertFrom-Json
} else {
  $submitUrl = if ($baseUrl -match '/v1$') { "$baseUrl/videos/generations" } elseif ($baseUrl -match '/v1/videos/generations$') { $baseUrl } else { "$baseUrl/v1/videos/generations" }
  $submit = Invoke-RestMethod -Uri $submitUrl -Method Post -Headers @{ Authorization = "Bearer $apiKey" } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Depth 10))) -TimeoutSec 120
  $submit | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $OutputDir 'submit-response.json') -Encoding utf8
  $taskId = Find-TaskId $submit

  $queryBase = $baseUrl -replace '/v1/videos/generations$', '' -replace '/v1$', ''
  $queryUrl = "$queryBase/v1/tasks/$([Uri]::EscapeDataString($taskId))"
  $completed = $null
  for ($attempt = 1; $attempt -le 90; $attempt++) {
    Start-Sleep -Seconds 5
    $statusPayload = Invoke-RestMethod -Uri $queryUrl -Method Get -Headers @{ Authorization = "Bearer $apiKey"; Accept = 'application/json' } -TimeoutSec 120
    $status = [string](Get-Value $statusPayload.status (Get-Value $statusPayload.state (Get-Value $statusPayload.data.status $statusPayload.data.state)))
    if ($status.ToLowerInvariant() -in @('completed','complete','success','succeeded')) { $completed = $statusPayload; break }
    if ($status.ToLowerInvariant() -in @('failed','failure','error','cancelled','canceled')) { throw "video_task_failed:$status" }
  }
  if (-not $completed) { throw 'video_task_timeout' }
  $completed | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $completedPath -Encoding utf8
}
$videoUrl = Find-ResultUrl $completed
$outputPath = Join-Path $OutputDir 'optimized-opening-hook.mp4'
Invoke-WebRequest -Uri $videoUrl -OutFile $outputPath -TimeoutSec 300

$result = [ordered]@{
  executedAt = (Get-Date).ToString('o')
  model = $model
  durationRequested = $duration
  quality = $quality
  aspectRatio = $aspectRatio
  file = 'optimized-opening-hook.mp4'
  bytes = (Get-Item -LiteralPath $outputPath).Length
  secretsWritten = $false
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDir 'experiment-manifest.json') -Encoding utf8
Write-Output ($result | ConvertTo-Json -Depth 10)
