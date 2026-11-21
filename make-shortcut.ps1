$ErrorActionPreference = 'Stop'
$edge = ''
$candidates = @()
if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe') }
if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe') }
if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe') }
foreach ($p in $candidates) { if (Test-Path $p) { $edge = $p; break } }
if (-not $edge) { Write-Output 'EDGE_NOT_FOUND'; exit 1 }

$dest = Join-Path $env:PUBLIC 'QuizHelper\extension'
$desk = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desk '题目助手 Edge.lnk'

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnkPath)
$s.TargetPath = $edge
$s.Arguments = '--load-extension="' + $dest + '"'
$s.WorkingDirectory = Split-Path $edge
$s.IconLocation = $edge + ',0'
$s.Description = 'Edge 浏览器（已加载题目助手插件）'
$s.Save()
Write-Output ('SHORTCUT_OK ' + $lnkPath)
