@echo off
setlocal
rem ============================================================================
rem  BladeOS POS launcher for Windows tills (Licon and other all-in-one terminals)
rem
rem  1. Change BLADEOS_URL below to your BladeOS address.
rem  2. Change PRIMARY_WIDTH to the main screen's width in pixels
rem     (Settings > Display > Display resolution, e.g. 1366 or 1920).
rem  3. Double-click this file. To start BladeOS when Windows starts, run:
rem        BladeOS-POS.bat install
rem
rem  It opens the till full screen with silent receipt printing (to the Windows
rem  default printer) and the customer screen on the second monitor.
rem ============================================================================
set "BLADEOS_URL=https://YOUR-APP.up.railway.app"
set "PRIMARY_WIDTH=1366"
set "PROFILE=%LOCALAPPDATA%\BladeOS-POS"

if /i "%~1"=="install" (
  copy /y "%~f0" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BladeOS-POS.bat" >nul
  echo BladeOS POS will now start when Windows starts.
  pause
  exit /b 0
)

set "BROWSER="
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
  if not defined BROWSER if exist %%B set "BROWSER=%%~B"
)
if not defined BROWSER (
  echo Google Chrome or Microsoft Edge was not found. Install Chrome, then run this again.
  pause
  exit /b 1
)

rem A separate browser profile for the till, so the print setting always applies.
rem Main till screen: full screen, receipts print straight to the default printer.
start "" "%BROWSER%" --user-data-dir="%PROFILE%" --kiosk-printing --no-first-run --no-default-browser-check --disable-features=Translate --start-fullscreen --app="%BLADEOS_URL%/#pos"

rem Give the till a moment, then open the customer screen on the second monitor.
timeout /t 5 /nobreak >nul
start "" "%BROWSER%" --user-data-dir="%PROFILE%" --app="%BLADEOS_URL%/#customer-display" --window-position=%PRIMARY_WIDTH%,0 --start-fullscreen
endlocal
