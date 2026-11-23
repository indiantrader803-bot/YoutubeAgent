# NeonClipping launcher (Windows). Creates .venv on first run, starts the app, opens the browser.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path .venv/Scripts/python.exe)) {
    python -m venv .venv
    .venv/Scripts/python.exe -m pip install -r requirements.txt
}
if (-not $env:NEONCLIPPING_PORT) {
    $port = 8770
    $busy = Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue
    if ($busy) { $port = 8771 }
    $env:NEONCLIPPING_PORT = "$port"
}
Start-Process "http://127.0.0.1:$env:NEONCLIPPING_PORT"
.venv/Scripts/python.exe app.py
