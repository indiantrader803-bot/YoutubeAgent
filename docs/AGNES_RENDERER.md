# Agnes Video Generator — vendored renderer

`vendor/agnes-video-generator` is the MIT-licensed
[agnes-video-generator](https://github.com/lcy362/agnes-video-generator) repo,
integrated as a **free real-render engine** for the daily pipeline:
text → multi-scene AI video with Edge-TTS narration and burned-in subtitles,
in every content-matrix language (en/hi/es/pt/ar/id).

## How it fits

- `utils/agnes-video-client.js` — REST client (`/api/tasks/manuscript` → poll → `/api/video/{id}`).
- `utils/ai-video-generator.js` — engine order: OpenMontage → Storytime → **Agnes** → Pexels/FFmpeg chain → placeholder.
- `schedules/daily-automation.js` — `ensureAgnesService()` boots the local service when `AGNES_API_KEY` is set.

A placeholder/simulated result is **never** uploaded; if no real mp4 is produced
the run escalates (Telegram + non-zero exit) instead of silently skipping —
the permanent fix for the "workflow green but nothing published" failure mode.

## Enable it (one free key, no GPU)

1. Get a key at <https://platform.agnes-ai.com> and put it in `.env` as
   `AGNES_API_KEY=` (and/or the GitHub repo secret of the same name).
2. One-time install (Python 3.10+ required):
   `node scripts/setup-agnes.js`
3. Status check: `node scripts/agnes-status.js`

Without a key the pipeline behaves exactly as before (FFmpeg chain).

## Notes

- `resource/fonts/` (74 MB CJK subtitle fonts) and `.venv/` are gitignored;
  `scripts/setup-agnes.js` works without them, and renders fall back cleanly.
- On GitHub Actions the renderer stays dormant unless you also add a Python
  setup step; the FFmpeg chain renders there as before.
