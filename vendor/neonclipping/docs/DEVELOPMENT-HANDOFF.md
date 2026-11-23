# Native layout and saved-edit update — 19 November 2026

NeonClipping keeps its own neon interface and independent engine. Competitor reference applications are not required, started or linked by the product.

## Shipped changes

- `layouts.py`: eleven native layouts, shared preview/export geometry, circular camera mask and layout-aware text placement.
- `/layouts`: supplies geometry to both creation and saved-edit pickers.
- `reedit.py`: open a saved clip and apply edits to one clip or saved clips from the same source URL. Saved source, clip ranges and each clip's own word list are reused. No download, highlight selection or ASR runs in this path.
- `app.py`: persists final word timings, source URL and generation batch. The library hides superseded exports but previous files remain available locally.
- `app.js`: Edit clip in the library and generated results; eleven-layout picker and speaker size inside the saved editor; one/video apply controls. Removed a preset-triggered duplicate animation loop and fixed explicit layout selection overriding the no-camera preset.
- `previews.py`: frame collection remains loading until all four frames are published. This prevents a fast cached import from stopping the browser poll after only one or two frames.
- UI palette is protected against browser auto-dark color overrides; layout cards show actual geometry instead of placeholder symbols.

## Verification

Source: https://www.youtube.com/watch?v=6E2cBXFCDyQ (796.9 seconds).

- All eleven layouts and all five caption styles rendered to 1080×1920 with audio and passed full decoding.
- Real browser import, presets, saved layout, editable English transcript, individual export, library editing and all eleven saved-edit layout choices exercised.
- Fast mode produced four clips in 210.9 seconds. A Deep/Best-caption run produced one clip in 168.8 seconds. These separate runs use different options and are not a quality comparison or guaranteed speed.
- Seven existing clips were updated in 119.58 seconds; exact per-clip sources, ranges and words stayed unchanged, all seven MP4s decoded.
- An integration check hard-failed download, transcription and moment discovery if invoked; two real saved clips still edited successfully.
- Four portable regression tests cover per-clip transcript preservation in a batch, validation before any export, missing-source errors and bounded layout geometry.
- GPU encoding was NVENC. This does not mean CPU filtering, source decoding or all model stages are GPU accelerated.

Run `python -m unittest discover -s tests -v` and `node --check app.js`.

## Limits and next work

Changing burned-in subtitles or framing requires encoding the final MP4 again. It does not require re-running upstream analysis. Keep original sources in `data/`. Legacy SRT recovery approximates word timing when exact saved words are unavailable.

Video-wide apply snapshots currently saved clips. Clips still being generated are excluded. It preserves each clip's title/hook/transcript; an edited word list applies only to the opened clip. Timeline and language changes use a separate trim/transcription workflow. Revisions are not currently an automatic disk-cleanup system.

Do not claim complete competitor parity. Native durable queues, automatic speaker tracking, edit chat, dubbing/translation, publishing and cloud/mobile hosting remain separate work. Current generation count is capped at twelve, not forty. Scores and action heuristics are not a measured probability of going viral or a trained GTA event classifier.

Do not restart a server while an import, generation, transcription, export or saved-edit batch is running. A restart can interrupt it; previous successful exports remain on disk.
