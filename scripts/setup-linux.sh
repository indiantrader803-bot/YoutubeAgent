#!/usr/bin/env bash
echo "=================================================="
echo "        YoutubeAgent Linux Environment Setup      "
echo "=================================================="

if ! command -v python3 &> /dev/null; then
    echo "[!] Python3 not found. Please install python3 & python3-venv using your package manager."
else
    echo "[✓] Python3 detected."
    if [ ! -d ".venv" ]; then
        echo "[+] Creating isolated Python virtual environment (.venv)..."
        python3 -m venv .venv
    fi
    echo "[+] Installing/Updating open-source AI dependencies (Kokoro, Piper, Whisper)..."
    ./.venv/bin/pip install --upgrade pip
    ./.venv/bin/pip install kokoro-onnx openai-whisper soundfile numpy torch
fi

echo "[+] Installing Node.js dependencies..."
npm install

echo "=================================================="
echo "[✓] Setup complete! Run 'npm run doctor' to verify."
echo "=================================================="
