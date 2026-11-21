@echo off
setlocal
set "SRC=%~dp0quiz-helper-extension"
set "BASE=%PUBLIC%\QuizHelper"
set "DEST=%BASE%\extension"

echo.
echo  ============================================
echo    题目助手 · 自动安装
echo  ============================================
echo.

if not exist "%SRC%\manifest.json" (
  echo  [X] 没找到扩展目录：%SRC%
  echo      请把本文件放在 quiz-helper-extension 的同一层再运行。
  pause
  exit /b 1
)

echo  [1/3] 复制插件到固定目录（以后移动本文件夹也不影响）...
if not exist "%BASE%" mkdir "%BASE%"
robocopy "%SRC%" "%DEST%" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo  [X] 复制失败，请检查权限。
  pause
  exit /b 1
)
echo        完成：%DEST%

echo  [2/3] 在桌面创建启动快捷方式...
copy /y "%~dp0make-shortcut.ps1" "%BASE%\make-shortcut.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%BASE%\make-shortcut.ps1"

echo  [3/3] 启动浏览器并加载插件...
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo  [!] 没找到 Edge。如果你用 Chrome，打开 chrome://extensions
  echo      开启开发者模式 ^> 加载已解压的扩展程序，选择：
  echo      %DEST%
  pause
  exit /b 0
)

tasklist /FI "IMAGENAME eq msedge.exe" 2>nul | findstr /I "msedge.exe" >nul
if not errorlevel 1 (
  echo.
  echo  [!] Edge 正在运行，命令行参数不会生效。
  echo      请先完全退出 Edge（关掉所有窗口），再双击桌面的「题目助手 Edge」。
  echo.
  pause
  exit /b 0
)

start "" "%EDGE%" --load-extension="%DEST%" "https://www.bing.com"

echo.
echo  完成！Edge 已启动并加载插件。
echo  · 任意题库网页右下角会出现蓝色「题」按钮
echo  · 选中题目文字后按 Alt+Q 直接解答
echo  · 以后请用桌面的「题目助手 Edge」启动（普通图标不带插件）
echo.
echo  想永久安装（不依赖快捷方式）：打开 edge://extensions
echo  开启「开发人员模式」^>「加载解压缩的扩展」^> 选择：
echo      %DEST%
echo.
pause
