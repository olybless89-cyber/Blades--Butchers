// The till's desktop icon: a small Windows setup file, downloaded from the account menu ("Desktop icon").
// Running it (no admin rights needed):
//   • finds Chrome (or Edge), downloads the BladeOS icon,
//   • finds the receipt printer Windows knows (Licon LP100 and other 80/58 mm thermal printers) and makes it
//     the default printer — kiosk printing prints on the default printer, with no dialog,
//   • looks for the barcode scanner (it types like a keyboard, so there's nothing to install),
//   • puts "BladeOS POS" on the desktop and Start menu (and, if asked, opens it at start-up). The icon starts the
//     browser full screen in its own profile with --kiosk-printing, straight on the POS, and opens the customer
//     screen on the second monitor when there is one (same as pos-setup/BladeOS-POS.bat, with nothing to edit).
// The file is a .cmd with the PowerShell part after a marker line, so it's one download with no length limits.

const PS = String.raw`
$ErrorActionPreference = 'Continue'
$base = $env:BLADEOS_BASE
$dir = Join-Path $env:LOCALAPPDATA 'BladeOS'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host ''
Write-Host '  BladeOS till setup' -ForegroundColor Yellow
Write-Host '  Puts a BladeOS POS icon on this computer and gets the receipt printer ready.'
Write-Host ''

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "\${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "\${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$browser = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $browser) {
  Write-Host '  Google Chrome or Microsoft Edge is needed. Install Google Chrome, then run this file again.' -ForegroundColor Red
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}
Write-Host "  [OK] Browser: $browser"

$ico = Join-Path $dir 'bladeos.ico'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "$base/icons/bladeos.ico" -OutFile $ico
} catch { }
if (-not (Test-Path -LiteralPath $ico)) { $ico = "$browser,0" }

$pattern = 'LP100|LP-100|Licon|POS[- ]?80|POS[- ]?58|Receipt|Thermal|80 ?mm|58 ?mm|XP-|Xprinter|TM-T'
$receipt = @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue) |
  Where-Object { $_.Name -match $pattern -or $_.DriverName -match $pattern } | Select-Object -First 1
if ($receipt) {
  New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows' -Name LegacyDefaultPrinterMode -Value 1 -PropertyType DWord -Force | Out-Null
  Invoke-CimMethod -InputObject $receipt -MethodName SetDefaultPrinter | Out-Null
  Write-Host "  [OK] Receipt printer: $($receipt.Name) - now the default printer"
} else {
  Write-Host '  [i]  No receipt printer driver in Windows. That is fine: BladeOS can use the LP100 directly over USB.' -ForegroundColor Cyan
  Write-Host '       On the till, open POS > Devices > Find printer once.' -ForegroundColor Cyan
}

$scanner = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match 'barcode|scanner|honeywell|zebra|symbol|datalogic|newland|netum|licon' -and $_.Class -match 'Keyboard|HIDClass|Ports' } |
  Select-Object -First 1
if ($scanner) { Write-Host "  [OK] Barcode scanner: $($scanner.FriendlyName)" }
else { Write-Host '  [OK] Barcode scanner: nothing to install - it types like a keyboard. BladeOS spots it on the first scan.' }

# The till launcher: POS full screen with silent printing, and the customer screen on the second monitor if there is one.
$launcher = Join-Path $dir 'BladeOS-POS.ps1'
$launcherCode = @'
$cfg = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'till.json') -Raw | ConvertFrom-Json
$q = [char]34
$common = @('--user-data-dir=' + $q + (Join-Path $PSScriptRoot 'profile') + $q, '--no-first-run', '--no-default-browser-check', '--disable-features=Translate')
Start-Process -FilePath $cfg.browser -ArgumentList ($common + @('--kiosk-printing', '--start-fullscreen', ('--app=' + $cfg.base + '/#pos')))
Add-Type -AssemblyName System.Windows.Forms
$second = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
if ($second) {
  Start-Sleep -Seconds 5
  Start-Process -FilePath $cfg.browser -ArgumentList ($common + @(('--app=' + $cfg.base + '/#customer-display'), ('--window-position=' + $second.Bounds.X + ',' + $second.Bounds.Y), '--start-fullscreen'))
}
'@
Set-Content -LiteralPath $launcher -Value $launcherCode -Encoding ASCII
@{ browser = $browser; base = $base } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dir 'till.json') -Encoding ASCII

$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $ps)) { $ps = 'powershell.exe' }
$launch = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + [char]34 + $launcher + [char]34
$ws = New-Object -ComObject WScript.Shell
function Add-Icon([string]$folder) {
  if (-not $folder) { return }
  $s = $ws.CreateShortcut((Join-Path $folder 'BladeOS POS.lnk'))
  $s.TargetPath = $ps
  $s.Arguments = $launch
  $s.WorkingDirectory = $dir
  $s.WindowStyle = 7
  $s.IconLocation = $ico
  $s.Description = 'BladeOS POS - Blades and Butchers'
  $s.Save()
}
Add-Icon ([Environment]::GetFolderPath('Desktop'))
Add-Icon ([Environment]::GetFolderPath('Programs'))
Write-Host '  [OK] "BladeOS POS" icon added to the desktop and the Start menu'
$a = Read-Host '  Open BladeOS automatically when this computer starts? (Y/N)'
if ($a -match '^[Yy]') { Add-Icon ([Environment]::GetFolderPath('Startup')); Write-Host '  [OK] BladeOS will open at start-up' }

Write-Host ''
Write-Host '  Done. Opening BladeOS - sign in once. (Alt+F4 closes the till window.)' -ForegroundColor Green
Start-Process -FilePath $ps -ArgumentList $launch -WindowStyle Hidden
Start-Sleep -Seconds 3
`.replace(/\\\$\{/g, "${");

/** The public address tills open. Set PUBLIC_URL for a custom domain. */
export function publicBase(req) {
  const e = process.env;
  const set = (e.PUBLIC_URL || (e.RAILWAY_PUBLIC_DOMAIN ? `https://${e.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/+$/, "");
  return set || `${req.protocol}://${req.get("host")}`;
}

export function tillSetupCmd(base) {
  const safe = String(base).replace(/[^A-Za-z0-9:/._-]/g, "");     // nothing cmd could treat as a command
  const lines = [
    "@echo off",
    "setlocal",
    "title BladeOS till setup",
    `set "BLADEOS_BASE=${safe}"`,
    'set "BLADEOS_SELF=%~f0"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -LiteralPath $env:BLADEOS_SELF -Raw; $m = '::' + ' POWERSHELL'; $i = $t.IndexOf($m); $j = $t.IndexOf([char]10, $i); Invoke-Expression $t.Substring($j + 1)"`,
    "exit /b",
    ":: POWERSHELL (everything below runs in PowerShell)",
    ...PS.trim().split("\n"),
  ];
  return lines.join("\r\n") + "\r\n";
}

export function tillRoutes(app) {
  app.get("/downloads/BladeOS-Till-Setup.cmd", (req, res) => {
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="BladeOS-Till-Setup.cmd"',
      "Cache-Control": "no-store",
    }).send(tillSetupCmd(publicBase(req)));
  });
}
