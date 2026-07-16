param(
  [string]$EnvPath = "E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main\.env",
  [string]$OutputDir = $PSScriptRoot,
  [switch]$UseFallback
)

$ErrorActionPreference = "Stop"

function Read-DotEnv([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $map[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
  return $map
}

function Get-ResponseText($Response) {
  if ($Response.output_text) { return [string]$Response.output_text }
  $texts = @()
  foreach ($item in @($Response.output)) {
    foreach ($content in @($item.content)) {
      if ($content.text) { $texts += [string]$content.text }
    }
  }
  if ($texts.Count -eq 0) { throw "Response did not contain output text." }
  return ($texts -join "`n")
}

function Invoke-AgentBrain([string]$Instructions, [string]$InputText, [string]$Name) {
  $payload = @{
    model = $script:model
    instructions = $Instructions
    input = $InputText
    reasoning = @{ effort = "low" }
    max_output_tokens = 2200
  }
  $body = $payload | ConvertTo-Json -Depth 30
  $response = Invoke-RestMethod -Uri $script:endpoint -Method Post -Headers @{ Authorization = "Bearer $script:apiKey" } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 300
  $safe = $response | ConvertTo-Json -Depth 50
  Set-Content -LiteralPath (Join-Path $OutputDir "$Name-response.json") -Value $safe -Encoding utf8
  $text = Get-ResponseText $response
  Set-Content -LiteralPath (Join-Path $OutputDir "$Name-output.txt") -Value $text -Encoding utf8
  return $text
}

$envMap = Read-DotEnv $EnvPath
$apiKeyName = if ($UseFallback) { 'AGENT_BRAIN_FALLBACK_API_KEY' } else { 'AGENT_BRAIN_API_KEY' }
$baseUrlName = if ($UseFallback) { 'AGENT_BRAIN_FALLBACK_BASE_URL' } else { 'AGENT_BRAIN_BASE_URL' }
$modelName = if ($UseFallback) { 'AGENT_BRAIN_FALLBACK_MODEL' } else { 'AGENT_BRAIN_MODEL' }
$apiKey = $envMap[$apiKeyName]
$baseUrl = $envMap[$baseUrlName].TrimEnd('/')
$model = $envMap[$modelName]
if (-not $apiKey -or -not $baseUrl -or -not $model) { throw "Agent Brain configuration is incomplete." }
$endpoint = if ($baseUrl -match '/v1$') { "$baseUrl/responses" } else { "$baseUrl/v1/responses" }

$lesson = @'
课题：人教版小学一年级数学《1～5的认识》。
交付切片：只设计 3 页，用于比较工作流提示效果，不生成最终 PPTX。
教学范围：学生观察数量为 1～5 的事物，建立数量与数字的初步对应；不得提前进入比大小、序数、分合或加减法。
页面任务：第1页建立“数字博物馆标签消失”的悬念；第2页让学生观察并说出点数方法；第3页用一组对象和点子建立数量表征，但不一次性公布全部答案。
受众：一年级学生；教室投影；16:9。
'@

$baselineInstructions = @'
你是小学数学 PPT 设计助手。请把输入转成逐页四层 PPT 设计稿。每页写清底图、元素、文字、排版，并提供教学动作。输出可供教师审阅的完整方案。
'@

$optimizedInstructions = @'
你是小学课堂 PPT Director。先用一句话定义传播任务和三页累计叙事，再为每页输出可执行 PageSpec。每页只能有一个 narrative_job 和一个教学动作；先定一个大主视觉，再补最少文字、数字和提示。生成图不得承担中文、公式或精确数量；精确数学对象必须标为本地可编辑层。禁止卡片墙、平均多列布局、教案搬屏和泛化栏目标题。每页写 page_id、takeaway_title、student_action、primary_visual_brief、visible_text_budget、local_math_layers、layout_constraints、transition、acceptance_checks。最后自检页面是否形成悬念、观察、表征的累计推进。
'@

$baseline = Invoke-AgentBrain $baselineInstructions $lesson "llm-baseline"
$optimized = Invoke-AgentBrain $optimizedInstructions $lesson "llm-optimized"

$criticInstructions = @'
你是独立 PPT 工作流 Critic。盲评方案 A 与 B，不猜测它们的来源。分别按 0-4 分评价：学习叙事、单页教学动作、主视觉解释力、投影可读性、数学准确性、页面推进、可执行性。必须引用具体文本证据，指出最大失败风险，并给出 100 分加权总分。最后选择更适合进入真实 PPTX 生成的方案。只返回 JSON。
'@
$baselineReviewExcerpt = if ($baseline.Length -gt 6500) { $baseline.Substring(0, 6500) } else { $baseline }
$optimizedReviewExcerpt = if ($optimized.Length -gt 6500) { $optimized.Substring(0, 6500) } else { $optimized }
$criticInput = "方案 A：`n$baselineReviewExcerpt`n`n方案 B：`n$optimizedReviewExcerpt"
$critic = Invoke-AgentBrain $criticInstructions $criticInput "llm-blind-review"

$manifest = [ordered]@{
  executedAt = (Get-Date).ToString('o')
  model = $model
  providerRoute = if ($UseFallback) { 'fallback' } else { 'primary' }
  endpoint = ($endpoint -replace 'https?://([^/]+).*', '$1/[redacted-path]')
  secretsWritten = $false
  outputs = @('llm-baseline-output.txt', 'llm-optimized-output.txt', 'llm-blind-review-output.txt')
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDir 'llm-experiment-manifest.json') -Encoding utf8
Write-Output ($manifest | ConvertTo-Json -Depth 10)
