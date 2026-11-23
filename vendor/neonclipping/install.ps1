# NeonClipping one-click installer for Windows (PowerShell 5.1+, no admin needed).
# What it does: checks your PC, installs what is missing (Python, FFmpeg), downloads NeonClipping, builds a private
# Python environment, makes a desktop shortcut, starts the app and opens it in your browser.
# Everything lands in one folder (default: %LOCALAPPDATA%\NeonClipping). Delete that folder to uninstall.
# Plain text on purpose: you can read every line before you run it.
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'NeonClipping'),
    [string]$ZipUrl = 'https://github.com/iamajmeena/neonclipping/archive/refs/heads/main.zip',
    [string]$SourceDir = '',          # developers: copy the app from a local folder instead of downloading
    [switch]$NoStart,                 # install only, do not start the app
    [switch]$Yes,                     # answer "yes" to the optional questions (GPU libraries, Ollama)
    [switch]$SkipOptional,            # answer "no" to the optional questions
    [switch]$NoShortcut               # do not create the Desktop shortcut (testing)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'      # much faster downloads in Windows PowerShell
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Say($m)  { Write-Host "  $m" }
function Step($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }
function Ask($q) {
    if ($Yes) { return $true }
    if ($SkipOptional) { return $false }
    $a = Read-Host "  $q (y/n)"
    return ($a -match '^(y|Y|h|H)')
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Real-Python {
    # a working python 3.10 to 3.13 (3.14+ has no wheels for some packages yet) that is NOT the Microsoft Store stub
    $cands = @()
    foreach ($n in @('python', 'python3')) {
        $c = Get-Command $n -ErrorAction SilentlyContinue
        if ($c -and $c.Source -notmatch 'WindowsApps') { $cands += $c.Source }
    }
    $cands += @(Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object FullName)
    $cands += @(Get-ChildItem "$env:ProgramFiles\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object FullName)
    foreach ($p in $cands) {
        try {
            $v = & $p -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
            if ($LASTEXITCODE -eq 0 -and [version]$v -ge [version]'3.10' -and [version]$v -lt [version]'3.14') { return $p }
        } catch {}
    }
    return $null
}
function Download($url, $out) {
    Say "downloading $([IO.Path]::GetFileName($out)) ..."
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$log = Join-Path $InstallDir 'install.log'
try { Start-Transcript -Path $log -Append | Out-Null } catch {}

Write-Host ""
Write-Host "  NEONCLIPPING SETUP" -ForegroundColor Magenta
Write-Host "  Paste a link, get captioned 9:16 clips. Free, local, open-source. By Ajay K Meena"
Write-Host "  Install folder: $InstallDir"

try {
    # ---- 0. check the PC
    Step "Step 1/6 - Aapka computer check kar raha hoon"
    if (-not [Environment]::Is64BitOperatingSystem) { throw "Ye tool 64-bit Windows chahta hai." }
    $drive = (Get-Item $InstallDir).PSDrive
    $freeGB = [math]::Round($drive.Free / 1GB, 1)
    Say ("Windows: " + [Environment]::OSVersion.VersionString + " | free disk on " + $drive.Name + ": " + $freeGB + " GB")
    if ($freeGB -lt 6) { throw "Kam se kam 6 GB free disk chahiye (abhi $freeGB GB hai). Jagah banao aur dobara chalao." }
    $hasGpu = $false
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        $g = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null
        if ($LASTEXITCODE -eq 0 -and $g) { $hasGpu = $true; Say "NVIDIA GPU: $g" }
    }
    if (-not $hasGpu) { Say "NVIDIA GPU nahi mila: tool CPU pe chalega (thoda slow, par chalega)." }

    # ---- 1. python
    Step "Step 2/6 - Python"
    $py = Real-Python
    if ($py) { Ok "Python mil gaya: $py" }
    else {
        Say "Python nahi mila, install kar raha hoon (3 minute)..."
        $done = $false
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            try {
                & winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null
                Refresh-Path; $py = Real-Python; if ($py) { $done = $true }
            } catch {}
        }
        if (-not $done) {
            $installer = Join-Path $env:TEMP 'python-3.12-installer.exe'
            Download 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' $installer
            Start-Process -FilePath $installer -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0', 'Include_launcher=0' -Wait
            Refresh-Path; $py = Real-Python
        }
        if (-not $py) { throw "Python install nahi ho paya. python.org se Python 3.12 khud install karke ye file dobara chalao." }
        Ok "Python install ho gaya: $py"
    }

    # ---- 2. ffmpeg (portable copy inside the install folder, no PATH changes)
    Step "Step 3/6 - FFmpeg (video kaatne ke liye)"
    $ffbin = ''
    $ffOnPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue) -and (Get-Command ffprobe -ErrorAction SilentlyContinue)
    $ownFf = Join-Path $InstallDir 'ffmpeg\bin'
    if (Test-Path (Join-Path $ownFf 'ffmpeg.exe')) { $ffbin = $ownFf; Ok "FFmpeg pehle se is folder mein hai." }
    elseif ($ffOnPath) { Ok "FFmpeg computer pe pehle se hai." }
    else {
        $zip = Join-Path $env:TEMP 'ffmpeg-essentials.zip'
        Download 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' $zip
        $tmp = Join-Path $env:TEMP 'ffmpeg-unpack'
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $root = Get-ChildItem $tmp -Directory | Select-Object -First 1
        New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'ffmpeg') | Out-Null
        Copy-Item (Join-Path $root.FullName 'bin') (Join-Path $InstallDir 'ffmpeg') -Recurse -Force
        Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
        $ffbin = $ownFf; Ok "FFmpeg install ho gaya."
    }

    # ---- 2b. a JavaScript runtime: YouTube hides some video qualities and can block downloads without one (best effort)
    if (-not (Get-Command deno -ErrorAction SilentlyContinue) -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Say "Deno (YouTube ke liye chhota JavaScript runtime) install kar raha hoon..."
            try { & winget install -e --id DenoLand.Deno --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null; Refresh-Path } catch { Warn "Deno install nahi hua (koi baat nahi, kuch videos ki quality kam mil sakti hai)." }
        } else { Warn "winget nahi hai: agar YouTube quality kam aaye to deno.com se Deno install karo." }
    }

    # ---- 3. the app
    Step "Step 4/6 - NeonClipping app laa raha hoon"
    $app = Join-Path $InstallDir 'app'
    New-Item -ItemType Directory -Force -Path $app | Out-Null
    if ($SourceDir) {
        Get-ChildItem $SourceDir -Force | Where-Object { $_.Name -notin @('.venv', 'data', '__pycache__', '.git') } | ForEach-Object { Copy-Item $_.FullName $app -Recurse -Force }
    } else {
        $zip = Join-Path $env:TEMP 'neonclipping-main.zip'
        Download $ZipUrl $zip
        $tmp = Join-Path $env:TEMP 'neonclipping-unpack'
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $root = Get-ChildItem $tmp -Directory | Select-Object -First 1
        Get-ChildItem $root.FullName -Force | ForEach-Object { Copy-Item $_.FullName $app -Recurse -Force }
        Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path (Join-Path $app 'app.py'))) { throw "App files nahi mile (app.py missing). Internet check karo." }
    try {
        $sha = (Invoke-WebRequest -UseBasicParsing -Uri 'https://api.github.com/repos/iamajmeena/neonclipping/commits/main' -Headers @{ Accept = 'application/vnd.github.sha'; 'User-Agent' = 'NeonClipping-installer' } -TimeoutSec 10).Content
        if ($sha -is [byte[]]) { $sha = [Text.Encoding]::ASCII.GetString($sha) }
        $sha = ([string]$sha).Trim()
        if ($sha.Length -eq 40) { Set-Content -Path (Join-Path $app '.neon_version') -Value $sha -Encoding ASCII -NoNewline }
    } catch {}
    Ok "App files: $app"

    # ---- 4. private python environment
    Step "Step 5/6 - Packages install ho rahe hain (3-6 minute, chai pi lo)"
    $venvPy = Join-Path $app '.venv\Scripts\python.exe'
    if (-not (Test-Path $venvPy)) { & $py -m venv (Join-Path $app '.venv'); if ($LASTEXITCODE -ne 0) { throw "Virtual environment nahi bana." } }
    & $venvPy -m pip install --upgrade pip --quiet 2>$null
    & $venvPy -m pip install -r (Join-Path $app 'requirements.txt') --quiet
    if ($LASTEXITCODE -ne 0) { throw "Packages install fail hue. Internet check karo aur dobara chalao (ye file safe hai, dobara chalane se bas jo bacha hai wahi hoga)." }
    & $venvPy -c "import sys; sys.path.insert(0, r'$app'); import compat, fastapi, uvicorn, yt_dlp, numpy, cv2, faster_whisper, PIL; print('imports ok')"
    if ($LASTEXITCODE -ne 0) {
        # most common cause: the Microsoft Visual C++ runtime is missing (ctranslate2.dll could not be loaded)
        Warn "Packages import nahi hue. Microsoft Visual C++ runtime install karke dobara try kar raha hoon..."
        if (Get-Command winget -ErrorAction SilentlyContinue) { & winget install -e --id Microsoft.VCRedist.2015+.x64 --silent --accept-package-agreements --accept-source-agreements | Out-Null }
        else { $vc = Join-Path $env:TEMP 'vc_redist.x64.exe'; Download 'https://aka.ms/vs/17/release/vc_redist.x64.exe' $vc; Start-Process $vc -ArgumentList '/install','/quiet','/norestart' -Wait }
        & $venvPy -c "import sys; sys.path.insert(0, r'$app'); import compat, fastapi, uvicorn, yt_dlp, numpy, cv2, faster_whisper, PIL; print('imports ok')"
        if ($LASTEXITCODE -ne 0) { throw "Packages import nahi ho rahe. Windows restart karke setup dobara chalao; phir bhi na chale to install.log GitHub issue me daalo." }
    }
    Ok "Packages ready."

    # ---- optional extras
    Step "Optional extras (pehle puchta hoon)"
    if ($hasGpu -and (Ask "NVIDIA GPU libraries (~1.2 GB) lagaun? Isse bina-captions wali videos (Twitch/MP4) ke captions tez bante hain")) {
        & $venvPy -m pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*" --quiet
        if ($LASTEXITCODE -eq 0) { Ok "GPU libraries lag gayi." } else { Warn "GPU libraries nahi lagi (koi baat nahi, CPU chalega)." }
    }
    $hasOllama = [bool](Get-Command ollama -ErrorAction SilentlyContinue)
    $wantModel = $false
    if (-not $hasOllama) {
        if (Ask "AI titles aur behtar clip chunne ke liye Ollama + llama3.2:3b (~2.5 GB) lagaun?") {
            if (Get-Command winget -ErrorAction SilentlyContinue) {
                & winget install -e --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements | Out-Null
                Refresh-Path
            } else { Warn "winget nahi hai: ollama.com se Ollama khud install karo, phir: ollama pull llama3.2:3b" }
            $hasOllama = [bool](Get-Command ollama -ErrorAction SilentlyContinue)
            $wantModel = $true
        } else { Say "Ollama nahi liya: app chalega, bas titles/hooks simple rahenge (baad mein bhi laga sakte ho)." }
    } else {
        $have = (& ollama list 2>$null) -join "`n"
        if ($have -match 'llama3\.2:3b') { Ok "Ollama aur AI model pehle se hai." }
        elseif (Ask "Ollama mil gaya. AI model llama3.2:3b (~2 GB) utaarun?") { $wantModel = $true }
    }
    if ($wantModel -and $hasOllama) {
        try { & ollama pull llama3.2:3b; Ok "AI model ready." } catch { Warn "Model nahi utra. Baad mein chalao: ollama pull llama3.2:3b" }
    }

    # ---- start script + desktop shortcut
    Step "Step 6/6 - Shortcut aur start"
    $startBat = Join-Path $InstallDir 'Start-NeonClipping.bat'
    $pathLine = if ($ffbin) { "set `"PATH=$ffbin;%PATH%`"" } else { 'rem FFmpeg already on PATH' }
    $bat = @(
        '@echo off',
        'title NeonClipping (band karne ke liye ye window band karo)',
        'if not defined NEONCLIPPING_PORT set NEONCLIPPING_PORT=8770',
        $pathLine,
        'powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%NEONCLIPPING_PORT%/healthz -TimeoutSec 2 | Out-Null; exit 0}catch{exit 1}"',
        'if %errorlevel%==0 (',
        '  start "" http://127.0.0.1:%NEONCLIPPING_PORT%',
        '  exit /b 0',
        ')',
        "cd /d `"$app`"",
        'start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:$env:NEONCLIPPING_PORT/healthz -TimeoutSec 2 | Out-Null; Start-Process http://127.0.0.1:$env:NEONCLIPPING_PORT; break}catch{Start-Sleep 1}}"',
        "`"$venvPy`" app.py"
    )
    Set-Content -Path $startBat -Value $bat -Encoding ASCII
    # same start script with the phone remote switched on (listens on the home network, PIN required; see README)
    $phoneBat = Join-Path $InstallDir 'Start-NeonClipping-Phone.bat'
    Set-Content -Path $phoneBat -Value (@($bat[0], $bat[1], 'set NEONCLIPPING_LAN=1') + $bat[2..($bat.Count - 1)]) -Encoding ASCII
    if (-not $NoShortcut) { try {
        $desk = [Environment]::GetFolderPath('Desktop')
        $sh = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'NeonClipping.lnk'))
        $sh.TargetPath = $startBat; $sh.WorkingDirectory = $InstallDir; $sh.Description = 'NeonClipping - captioned 9:16 clips'; $sh.Save()
        $sh2 = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'NeonClipping (phone access).lnk'))
        $sh2.TargetPath = $phoneBat; $sh2.WorkingDirectory = $InstallDir; $sh2.Description = 'NeonClipping with phone remote (same Wi-Fi, PIN)'; $sh2.Save()
        Ok "Desktop pe 'NeonClipping' shortcut ban gaya."
        Ok "Desktop pe 'NeonClipping (phone access)' shortcut bhi ban gaya: phone se live clipping control karne ke liye."
    } catch { Warn "Desktop shortcut nahi ban paya. Start file: $startBat" } }

    Stop-Transcript | Out-Null
    Write-Host ""
    Write-Host "  SETUP COMPLETE" -ForegroundColor Green
    if ($NoShortcut) { Write-Host "  Agli baar: $startBat pe double-click karo, browser mein khul jayega (http://127.0.0.1:8770)." }
    else { Write-Host "  Agli baar: Desktop pe 'NeonClipping' pe double-click karo, browser mein khul jayega (http://127.0.0.1:8770)." }
    Write-Host "  Use: 1) video link paste karo  2) 'Make clips' dabao  3) clip dekho aur 'Download MP4' dabao."
    Write-Host $(if ($NoShortcut) { "  Uninstall: $InstallDir folder delete kar do." } else { "  Uninstall: $InstallDir folder aur Desktop shortcut delete kar do." })
    if (-not $NoStart) {
        Say "App start ho raha hai..."
        $env:Path = $(if ($ffbin) { "$ffbin;" } else { '' }) + $env:Path
        Start-Process -FilePath $startBat -WindowStyle Minimized
        Write-Host "  Browser kuch second mein khul jayega. Agar nahi khula: http://127.0.0.1:8770"
    }
} catch {
    try { Stop-Transcript | Out-Null } catch {}
    Write-Host ""
    Write-Host "  SETUP FAIL HUA" -ForegroundColor Red
    Write-Host "  Wajah: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Log file: $log"
    Write-Host "  Madad: ye log aur error kisi AI agent (Claude/ChatGPT) ko dikhao, ya GitHub pe issue kholo: github.com/iamajmeena/neonclipping"
    exit 1
}
