# WorkBuddy Plus Windows 注入引导：安装 / 卸载 / 状态查询
# 原理见 hooks/win-asar-bootstrap.js —— 往 app.asar.unpacked 里 better-sqlite3 的
# 入口文件头部插入一段引导代码，主进程与 daemon 启动时都会加载它。
param(
  [Parameter(Mandatory = $true)][ValidateSet('install', 'restore', 'status')][string]$Action,
  [string]$WorkBuddyDir = ''
)

$ErrorActionPreference = 'Stop'
$START = '/* WBP-BOOTSTRAP-START'
$END = '/* WBP-BOOTSTRAP-END */'
$HooksDir = Join-Path $env:USERPROFILE '.workbuddy\hooks'
$SnippetPath = Join-Path $HooksDir 'win-asar-bootstrap.js'

# 定位 WorkBuddy 安装目录：先查运行中进程，再扫常见位置
function Resolve-WorkBuddyDir {
  param([string]$Hint)
  if ($Hint -and (Test-Path $Hint)) { return $Hint }
  try {
    $exe = Get-Process WorkBuddy -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty Path
    if ($exe) { return (Split-Path $exe -Parent) }
  } catch { }
  $cands = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy'),
    (Join-Path $env:LOCALAPPDATA 'Programs\workbuddy'),
    (Join-Path $env:ProgramFiles 'WorkBuddy')
  )
  foreach ($d in 'C', 'D', 'E', 'F', 'G') { $cands += "${d}:\WorkBuddy" }
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Get-TargetFile {
  param([string]$Dir)
  return (Join-Path $Dir 'resources\app.asar.unpacked\node_modules\better-sqlite3\lib\index.js')
}

function Read-Utf8 {
  param([string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}

$dir = Resolve-WorkBuddyDir -Hint $WorkBuddyDir
if (-not $dir) { Write-Output 'ERROR: WorkBuddy install dir not found'; exit 1 }
$target = Get-TargetFile -Dir $dir
if (-not (Test-Path $target)) { Write-Output "ERROR: target file not found: $target"; exit 1 }

$content = Read-Utf8 -Path $target
$installed = $content.Contains($START)

switch ($Action) {
  'status' {
    Write-Output "WorkBuddyDir=$dir"
    Write-Output "TargetFile=$target"
    Write-Output "Installed=$installed"
  }
  'install' {
    if ($installed) { Write-Output 'OK: already installed'; exit 0 }
    if (-not (Test-Path $SnippetPath)) { Write-Output "ERROR: snippet not found: $SnippetPath"; exit 1 }
    $snippet = (Read-Utf8 -Path $SnippetPath).TrimEnd("`r", "`n")
    Write-Utf8NoBom -Path $target -Content ($snippet + "`r`n" + $content)
    # 回读校验：确保引导块确实写进去且文件仍可读
    $after = Read-Utf8 -Path $target
    if (-not $after.Contains($START)) { Write-Output 'ERROR: verify failed'; exit 1 }
    Write-Output 'OK: installed'
  }
  'restore' {
    if (-not $installed) { Write-Output 'OK: not installed, nothing to restore'; exit 0 }
    $si = $content.IndexOf($START)
    $ei = $content.IndexOf($END)
    if ($ei -lt 0) { Write-Output 'ERROR: END marker missing, restore aborted'; exit 1 }
    $rest = $content.Substring($ei + $END.Length).TrimStart("`r", "`n")
    Write-Utf8NoBom -Path $target -Content $rest
    $after = Read-Utf8 -Path $target
    if ($after.Contains($START)) { Write-Output 'ERROR: verify failed'; exit 1 }
    Write-Output 'OK: restored'
  }
}
