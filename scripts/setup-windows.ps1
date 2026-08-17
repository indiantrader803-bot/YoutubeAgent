# Windows Automated Environment Setup for YoutubeAgent
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "      YoutubeAgent Windows Environment Setup      " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Check Python installation
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "[!] Python is not found in PATH. Please install Python 3.10+ from python.org" -ForegroundColor Yellow
} else {
    Write-Host "[✓] Python detected: $($python.Source)" -ForegroundColor Green
    
    if (-not (Test-Path ".venv")) {
        Write-Host "[+] Creating isolated Python virtual environment (.venv)..." -ForegroundColor Yellow
        python -m venv .venv
    }
    
    Write-Host "[+] Installing/Updating open-source AI dependencies (Kokoro, Piper, Whisper)..." -ForegroundColor Yellow
    & .\.venv\Scripts\pip.exe install --upgrade pip
    & .\.venv\Scripts\pip.exe install kokoro-onnx openai-whisper soundfile numpy torch --extra-index-url https://download.pytorch.org/whl/cu121
}

# 2. Check Node & npm dependencies
Write-Host "[+] Checking Node.js and Remotion dependencies..." -ForegroundColor Yellow
npm install

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "[✓] Setup complete! Run 'npm run doctor' to verify." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
