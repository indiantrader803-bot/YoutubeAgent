#!/usr/bin/env bash
# NeonClipping launcher (Linux/macOS). Creates .venv on first run, then starts the app on http://127.0.0.1:8770
cd "$(dirname "$0")"
# prefer a Python the packages support (3.10-3.13); the newest one often has no wheels yet
PY=python3; for c in python3.12 python3.11 python3.13 python3.10; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
[ -d .venv ] || { "$PY" -m venv .venv && .venv/bin/pip install -r requirements.txt; }
exec .venv/bin/python app.py
