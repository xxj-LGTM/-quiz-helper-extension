@echo off
setlocal
set "DEST=%PUBLIC%\QuizHelper\extension"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo 没找到 Edge。
  pause
  exit /b 1
)
if not exist "%DEST%\manifest.json" (
  echo 插件目录不存在，请先运行 install-to-browser.cmd
  pause
  exit /b 1
)
tasklist /FI "IMAGENAME eq msedge.exe" 2>nul | findstr /I "msedge.exe" >nul
if not errorlevel 1 (
  echo Edge 已经在运行，参数不会生效。
  echo 请先完全退出 Edge 再运行本文件。
  pause
  exit /b 0
)
start "" "%EDGE%" --load-extension="%DEST%"
