# NeonClipping test report

Generated 2026-11-20 09:47 by tests/make_report.py from tests/report.json.

**292 of 292 checks pass.**

## Problems found by the tests and fixed

| # | Found | Fix |
|---|---|---|
| 1 | Caption grouping lost a whole caption group and repeated the last one whenever a single trailing word was merged (visible in the MrBeast style: 'TEST OH MY GOD' missing). Python stored `groups[-2] += groups.pop()` into the wrong list entry. Found by looking at the rendered frames, not by the pass/fail checks. | captions.group_words pops first, then appends; new unit tests check every word appears exactly once in order over 500 random word streams. |
| 2 | POST /make with min_len longer than max_len silently started a job. | Rejected with HTTP 400 and a clear message; NaN / infinite lengths also rejected. |
| 3 | Caption accuracy defaulted to 'Accurate (turbo)'. You wanted Fast by default. | UI select and the API default are Fast now. |
| 4 | Make failed with 'Cannot load the vocabulary from the model directory': the turbo speech model folder had only model.bin (half-finished download). | Missing small files downloaded; captions._turbo_spec() now requires a complete snapshot and repairs an incomplete one itself. |
| 5 | Result cards (Make clips / Live) kept pointing at old clips after 'apply to all'; Live cards had no Edit button; Edit on an old card used a replaced clip. | Cards follow the newest file, Live cards got Edit clip, the server resolves old ids to the newest version. |
| 6 | The creator list was stored as data/creators.json, which the library and editor read as a clip record (library would have returned 500). | Stored as data/creators.store; counting code ignores non-record files. |
| 7 | Stop then 'Check now' on a creator restarted recording at once. | Stop settles a 30-minute pause first; Check now no longer cancels it; Auto off/on resumes immediately; the chip shows the pause. |
| 8 | Hindi Whisper loops ('chal chal chal chal ...') and stray accented / non-Latin junk ('funcao', 'nosga') ended up in Hinglish captions. | Words said more than 3 times in a row are cut back to 3; Hinglish captions are folded to plain ASCII letters. Unit-tested. |
| 9 | My clips with 100+ clips requested metadata for every video at once. | Videos load only when they scroll near the screen (IntersectionObserver). |
| 10 | An unattended (auto) live recording could grow without limit. | 3-hour cap per session, stop below 8 GB free disk, recording deleted after the last clip is cut. |
| 11 | install.ps1 printed the Desktop-shortcut message even with -NoShortcut. | Message follows the option; script is still ASCII-only and parses. |
| 12 | Browser could keep an old app.js after a fix. | Asset version in index.html bumped on every change. |
| 13 | Facecam detection by border alone picked GTA's minimap (a static bordered panel) instead of the webcam. | Candidates are verified with a small local face detector (YuNet, MIT, 230 KB): the webcam is the box that holds a face; the minimap never does. |
| 14 | Corner-only search missed webcams that float on the left or right side (Carry's stream) and boxes that were only the face inside a framed webcam. | Search any rectangle whose four sides are static lines or the frame edge, keep nested boxes and upgrade to the enclosing framed webcam. Checked by drawing the boxes on real frames. |
| 15 | X-post templates hid the video: the card was drawn by the caption layer on top of the clip. | Card shapes are drawn on the background in a first pass, the clip is overlaid, text goes on top. |
| 16 | Rounded corners (geq on every frame) made template and background renders 3x slower (17-31 s for an 8 s clip). | A cached mask image and alphamerge: 5-12 s. |
| 17 | Music bed test failed to show the rise because the voice dominated the level. | Measured on a source without audio (also tests the music-only path): the bed rises from quiet to 9x louder. |
| 18 | The chat-hype meter stayed at 100% on a very fast chat because the 'usual speed' counted the empty buckets from before the session started. | Baseline uses only buckets since the session began; an absolute scale is used in the first half minute. Unit-tested (busy chat at its normal speed shows about 25%). |
| 19 | Stream titles came back as mojibake (UTF-8 read as the Windows code page) and emoji would have been burned into the hook. | Title decoded as UTF-8; emoji and symbols removed; verified on a real stream: the hook shows PLAYING GTA 6 FOR THE FIRST TIME in the clip. |
| 20 | Streamlink 8 prints that --twitch-disable-ads is deprecated and will be removed (it would then break live clipping). | The flag is no longer passed. |
| 21 | My installer test created two Desktop shortcuts pointing at a scratch folder. | Removed; tests that run the installer now always pass -NoShortcut. |
| 22 | Fast mode still ran the local speech model on every Hindi clip (slow, and wrong on loud game audio) although YouTube's own captions were already downloaded. | Fast uses YouTube captions for every language (Hindi transliterated to Hinglish); the local model only runs for Accurate / Best or when no captions exist. 2-hour Hindi video Make: 197 s, captions checked by eye. |
| 23 | YouTube writes nukta letters as one precomposed character, which the Hinglish converter dropped (kapde became kapn, padega became paga). | Split into letter + nukta first; unit-tested. |
| 24 | The local Accurate (turbo) captions were bad (you saw it too). | The option is gone. YouTube captions are the default for everything; Best Hindi (large-v3) is the only local model left, and only when chosen. Old API values 'accurate' map to YouTube captions. |

## Page, API and input validation  (34/34)

| Result | Check | Evidence |
|---|---|---|
| PASS | index.html served | 19444 |
| PASS | every $("id") used by app.js exists in index.html | missing: [] |
| PASS | app.js syntax (node --check) |  |
| PASS | GET /assets/app.js |  |
| PASS | GET /assets/style.css |  |
| PASS | GET /library |  |
| PASS | GET /donate |  |
| PASS | GET /feedback/summary |  |
| PASS | GET /live-active |  |
| PASS | GET /creators |  |
| PASS | GET /layouts |  |
| PASS | /layouts returns 11 layouts with geometry | 11 |
| PASS | /layouts rejects bad speaker size |  |
| PASS | donate links are https only | {'razorpay': 'https://rzp.io/rzp/JN41CpW'} |
| PASS | /make without link or id -> 4xx |  |
| PASS | /make with bad count -> 400 |  |
| PASS | /export unknown source -> 400 |  |
| PASS | /export rejects bad layout |  |
| PASS | /export rejects bad caption style |  |
| PASS | /export rejects end before start |  |
| PASS | /export rejects clip > 10 min |  |
| PASS | /export rejects caption_y out of range |  |
| PASS | /export rejects NaN crop |  |
| PASS | /transcribe rejects unknown language |  |
| PASS | /upload rejects a file that is not a video | {"detail":"Choose a playable video file."} |
| PASS | /live/start rejects junk |  |
| PASS | /live/start rejects YouTube link without id |  |
| PASS | /live/<unknown> -> 404 |  |
| PASS | /status/<unknown> not 500 |  |
| PASS | /make/<unknown> not 500 |  |
| PASS | /media path traversal blocked |  |
| PASS | /text path traversal blocked |  |
| PASS | /clips/<bad>/edit -> 4xx |  |
| PASS | /clips/reedit rejects unknown change key |  |

## Rendering: 11 layouts x 5 caption styles x positions  (22/22)

| Result | Check | Evidence |
|---|---|---|
| PASS | render layout stack (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout bottom (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout blur (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout fill (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout game (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout pip_tl (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout pip_tr (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout pip_bl (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout pip_br (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout circle (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render layout side (gta captions) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render caption style gta (blur layout) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render caption style bold (blur layout) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render caption style clean (blur layout) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render caption style hormozi (blur layout) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render caption style mrbeast (blur layout) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render without captions | words=0 |
| PASS | render caption position top (caption_y=600) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render caption position bottom (caption_y=1700) | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | render speaker size 0.2 / 0.5 |  |
| PASS | render accepts unicode hook (Hinglish)  | 1080x1920 h264/aac 6.0s enc=h264_nvenc words=12 |
| PASS | SRT downloadable for a captioned clip | 1e20c48bff184f92852a73fa60aac3fb |

## Editing saved clips (one / all clips of a video)  (12/12)

| Result | Check | Evidence |
|---|---|---|
| PASS | edit panel data for a saved clip | 3 |
| PASS | apply style=bold to ONLY this clip | 1 clips,  |
| PASS | only the chosen clip changed | ['bold', 'gta', 'gta'] |
| PASS | apply layout+style to ALL clips of the video | 3 clips,  |
| PASS | all 3 clips changed, each kept its own title/hook | [('circle', 'hormozi', 'T0'), ('circle', 'hormozi', 'T1'), ('circle', 'hormozi', 'T2')] |
| PASS | stale (old) clip id still edits the newest version | 3f04937b |
| PASS | apply captions OFF to all | 3 clips,  |
| PASS | apply speaker size + caption position to all | 3 clips,  |
| PASS | apply new cam/game boxes to all | 3 clips,  |
| PASS | reedit rejects invalid layout |  |
| PASS | reedit rejects invalid caption style |  |
| PASS | library shows exactly 3 live clips of the batch (no duplicates) | 3 |

## Make clips: sources, modes, languages, errors  (20/20)

| Result | Check | Evidence |
|---|---|---|
| PASS | Make 2-hour Hindi video, Best Hindi (large-v3), Hinglish captions | 1 clips in 562s, all 1080x1920 h264/aac, titles+scores+captions OK |
| PASS | error: nonexistent YouTube id | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | error: not a video URL | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | error: live stream link is refused with a clear message | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | error: min_len > max_len | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 132s English video: mode=fast, accurate=fast, language=, style=gta, layout=blur | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 132s English video: mode=deep, accurate=accurate, language=en, style=bold, layout=stack | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 132s English video: mode=fast, accurate=accurate, language=hinglish, style=clean, layout=fill | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 132s English video: mode=deep, accurate=fast, language=hi, style=hormozi, layout=circle | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 132s English video: mode=fast, accurate=fast, language=en, style=mrbeast, layout=side | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 13-min English (audio-first path), default Fast | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 2-hour Hindi video, Fast, Hinglish captions | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 2-hour Hindi video, Accurate (turbo), Hinglish captions | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 90-s music trailer (no speech) still returns clips | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make from an uploaded/local file | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make from a Twitch VOD | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make count=1 short range 10-20 s | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make count=6 on a short video returns what exists | full run, tests/out/run_make.log (every clip checked: 1080x1920 h264/aac, duration range, titles, scores, caption style, no Devanagari in Hi |
| PASS | Make 2-hour Hindi video, Fast: YouTube captions, Hinglish, 197 s (was 237 s with the local model) | 3 clips, 1080x1920 h264/aac, no Devanagari left, caption_source=YouTube captions |
| PASS | old "accurate" value maps to YouTube captions: 132 s video in 36 s, same words as Fast | caption_source=YouTube captions for accurate and fast |

## Style extras: templates, background card, watermark, credit, outro, music  (26/26)

| Result | Check | Evidence |
|---|---|---|
| PASS | upload image asset | {'id': 'd9a016db21244eab8ea9ec0bc8c72d5a', 'kind': 'image', 'name': 'logo.png'} |
| PASS | upload audio asset | {'id': '57a37fe903254a40b8f32176b286012b', 'kind': 'audio', 'name': 'bed.mp3'} |
| PASS | upload rejects a non-media file | {'error': '{"detail":"Allowed image files: .png, .jpg, .jpeg, .webp"}', 'status': 400} |
| PASS | upload rejects unknown kind |  |
| PASS | template x_light | 1080x1920 h264/aac 8.0s |
| PASS | template x_dark | 1080x1920 h264/aac 8.0s |
| PASS | template tiktok_hook | 1080x1920 h264/aac 8.0s |
| PASS | template breaking_news | 1080x1920 h264/aac 8.0s |
| PASS | template rejects unknown name |  |
| PASS | background card blur + padding + rounded corners | 1080x1920 h264/aac 8.0s |
| PASS | background card color + padding + rounded corners | 1080x1920 h264/aac 8.0s |
| PASS | background card gradient + padding + rounded corners | 1080x1920 h264/aac 8.0s |
| PASS | background image + dim + blur | 1080x1920 h264/aac 8.0s |
| PASS | background image without upload is refused |  |
| PASS | bad colour refused |  |
| PASS | watermark tl | 1080x1920 h264/aac 8.0s |
| PASS | watermark tr | 1080x1920 h264/aac 8.0s |
| PASS | watermark bl | 1080x1920 h264/aac 8.0s |
| PASS | watermark br | 1080x1920 h264/aac 8.0s |
| PASS | credit line | 1080x1920 h264/aac 8.0s |
| PASS | outro ribbon in the last 3 s | 1080x1920 h264/aac 8.0s |
| PASS | music bed (source without audio) starts quiet and rises to its peak | bed -41.1 dB at start -> -24.8 dB at the end (peak 9x louder), audio=aac, 8.0s |
| PASS | music mixed under a voice (source with audio): aac, right length | 1080x1920 h264/aac 8.0s |
| PASS | music without upload is refused |  |
| PASS | everything together (template off): card + watermark + credit + outro + music | 1080x1920 h264/aac 9.0s |
| PASS | template + watermark + music together | 1080x1920 h264/aac 9.0s |

## Caption animations, SRT/ASS import, facecam finder, AI parts, Make with moments  (31/31)

| Result | Check | Evidence |
|---|---|---|
| PASS | caption animation highlight | 1080x1920 8.0s words=12 |
| PASS | caption animation pop_in | 1080x1920 8.0s words=12 |
| PASS | caption animation pop_in_line | 1080x1920 8.0s words=12 |
| PASS | caption animation one_by_one | 1080x1920 8.0s words=12 |
| PASS | caption animation build_up | 1080x1920 8.0s words=12 |
| PASS | caption animation full_line | 1080x1920 8.0s words=12 |
| PASS | caption animation with clean style | 1080x1920 8.0s words=12 |
| PASS | unknown caption animation is refused |  |
| PASS | SRT import gives words relative to the clip | [{'start': 1.0, 'end': 2.071, 'text': 'imported'}, {'start': 2.071, 'end': 3.024, 'text': 'caption'}] |
| PASS | imported words render as captions | 1080x1920 10.0s words=7 |
| PASS | SRT outside the clip is refused with a clear message | {'detail': 'No caption lines fall inside this clip. Check the clip start and end.'} |
| PASS | garbage caption file is refused |  |
| PASS | facecam endpoint answers for saved sources | 8 sources checked |
| PASS | a webcam is found on at least one real stream, inside the frame, with a sensible size | [('f024ac', {'x': 0.0372, 'y': 0.4227, 'w': 0.1661, 'h': 0.188}, 0.99), ('8964af', {'x': 0.8279, 'y': 0.0171, 'w': 0.163, 'h': 0.3102}, 1.0) |
| PASS | facecam on the GTA stream with a top-right webcam is in the top-right area | [{'x': 0.8029, 'y': 0.1116, 'w': 0.188, 'h': 0.2102}] |
| PASS | facecam unknown id is refused |  |
| PASS | footage without a webcam answers "no facecam" with a reason | {'found': False, 'confidence': 0.0, 'game_motion': 0.3, 'reason': 'no rectangle with a steady border holds a face, and no face sits in the s |
| PASS | AI parts: 2-hour video split into the requested 5 parts | 5 |
| PASS | AI parts: every part has lines and a complete prompt | [('00:00:00 - 00:25:30', 86, 14623), ('00:25:30 - 00:51:00', 87, 15994), ('00:51:00 - 01:16:30', 89, 18883), ('01:16:30 - 01:42:00', 93, 208 |
| PASS | AI parts: part prompts stay small enough to paste (< 60k characters) | 20839 |
| PASS | AI parts: the first prompt contains real transcript text with timestamps | 8] भाग इन्होंने मुझे देख लिया। ओ तेरी चुप चुप चुप बदमाशी नहीं बेटे अंदर आ चुका हूं। ओह वेट मैं डोनी तक पहुंच गया हूं। लेट्स गो डोनी बच जा। अ |
| PASS | AI parts: not a link is refused |  |
| PASS | AI parts: unreadable video is refused with a message | {'detail': 'Could not read that video: ERROR: [youtube] zzzzzzzzzzz: This video is unavailable'} |
| PASS | AI answers: JSON from a chatbot becomes moments | {'moments': [{'start': 310.0, 'end': 355.0, 'title': 'Plane crash', 'hook': 'bhai plane gir gaya', 'start_label': '00:05:10', 'end_label': ' |
| PASS | AI answers: nothing usable is refused |  |
| PASS | Make refuses an empty moments list |  |
| PASS | Make from pasted moments (+ template, credit, auto facecam on a video without webcam) | 2 clips [40, 42] s, engine=AI answer, facecam={'found': False, 'confidence': 0.0, 'method': None, 'cam': None, 'reason': 'no rectangle with  |
| PASS | moments clips keep their own titles | ['First pick', 'Second pick'] |
| PASS | auto facecam reported "not found" cleanly when there is no webcam | {'found': False, 'confidence': 0.0, 'method': None, 'cam': None, 'reason': 'no rectangle with a steady border holds a face, and no face sits |
| PASS | edit ALL clips of a video: template + caption animation | 2 clips updated to tiktok_hook + build_up |
| PASS | Make with "find my facecam": the detected webcam box is used for every clip | facecam={'found': True, 'confidence': 1.0, 'method': 'border+face', 'cam': {'x': 0.831, 'y': 0.0171, 'w': 0.1599, 'h': 0.3102}, 'reason': No |

## Live clipping on a real stream  (17/17)

| Result | Check | Evidence |
|---|---|---|
| PASS | clip-now on unknown session -> 404 |  |
| PASS | start live clipping | {'live': '01117990e8704f8eac77bf8cbb15ed0d'} |
| PASS | second start while running is refused with a clear message | {'detail': 'A live session is already running. Stop it first.'} |
| PASS | /live-active returns the running session |  |
| PASS | recording starts and elapsed time counts up | {'status': 'recording', 'elapsed': 20, 'stage': 'Recording and watching chat'} |
| PASS | chat reader connected (read-only) | connected (read-only) |
| PASS | chat messages are being counted (>0 in the last windows) | chat_now=13 baseline=0.4 |
| PASS | Clip now accepted | 200 |
| PASS | live clip is produced without error | {'cut': 4.6, 'captions': 8.1, 'score': 0.7, 'render': 8.1} |
| PASS | live clip is 1080x1920 h264/aac, about 30 s | {'w': 1080, 'h': 1920, 'vcodec': 'h264', 'acodec': 'aac', 'dur': 30.004667} |
| PASS | live clip has title, viral score and axes | {'title': 'Hot Take Shower Time with Lee', 'viral': 55, 'axes': {'energy': 75, 'action': None, 'words': 14, 'ai': 80, 'chat': None}} |
| PASS | live clip is editable (edit panel data) | 200 |
| PASS | live clip can be re-edited (style -> bold) |  |
| PASS | live clip appears in My clips exactly once | 1 |
| PASS | stop ends the session | stopped |
| PASS | /live-active is empty after stop |  |
| PASS | start works again after stop | {'live': 'd93371cbe55d461ab65524861e7f8edb'} |

## Phone remote over the real Wi-Fi address: PIN gate, PC-only routes, live clipping from the phone  (34/34)

| Result | Check | Evidence |
|---|---|---|
| PASS | server is reachable on the Wi-Fi address (listens on 0.0.0.0 in phone mode) | 192.168.1.2 |
| PASS | PC status shows the Wi-Fi URL and a 6-digit PIN | ['http://192.168.1.2:8792/m', 'http://172.22.112.1:8792/m'] |
| PASS | phone page loads without the PIN |  |
| PASS | phone without PIN: GET /library -> 401 |  |
| PASS | phone without PIN: GET /live-active -> 401 |  |
| PASS | phone without PIN: GET /creators -> 401 |  |
| PASS | phone without PIN: GET /media/x -> 401 |  |
| PASS | phone without PIN: GET /make/x -> 401 |  |
| PASS | phone cannot read /phone/status (PIN stays on the PC) |  |
| PASS | wrong PIN -> 401 |  |
| PASS | right PIN -> 200 and a cookie |  |
| PASS | phone with PIN: GET /library -> 200 |  |
| PASS | phone with PIN: GET /live-active -> 200 |  |
| PASS | phone with PIN: GET /creators -> 200 |  |
| PASS | phone with PIN: POST /upload stays PC-only (403) |  |
| PASS | phone with PIN: POST /upload-asset stays PC-only (403) |  |
| PASS | phone with PIN: GET /queue stays PC-only (403) |  |
| PASS | phone with PIN: POST /facecam/detect stays PC-only (403) |  |
| PASS | phone with PIN: POST /ai/parts stays PC-only (403) |  |
| PASS | phone with PIN: POST /export stays PC-only (403) |  |
| PASS | phone with PIN: GET /layouts stays PC-only (403) |  |
| PASS | phone with PIN: POST /phone/newpin stays PC-only (403) |  |
| PASS | the PC itself needs no PIN |  |
| PASS | start live clipping from the phone (10 s preset, captions off, hook from the stream title) | {'live': 'd46356f34a0942f0b7be1f165b619c12'} |
| PASS | state carries hype, comments in 30 s, label and the stream title | {'hype': 100, 'msgs30': 193, 'hype_label': 'peak viral hype', 'title': 'PLAYING GTA 6 FOR THE FIRST TIME'} |
| PASS | stream title has no emoji and no mojibake | PLAYING GTA 6 FOR THE FIRST TIME |
| PASS | hype meter is a percentage between 0 and 100 | 100 |
| PASS | Clip now with 10 s accepted | 200 |
| PASS | phone clip is made without error | {'cut': 2.3, 'captions': 0.0, 'score': 0.1, 'render': 2.8} |
| PASS | phone can download the clip: 1080x1920 h264/aac and about 10 s | {'w': 1080, 'h': 1920, 'vcodec': 'h264', 'acodec': 'aac', 'dur': 8.677333} |
| PASS | captions off: no caption words burned in | 0 |
| PASS | hook text is the stream title | PLAYING GTA 6 FOR THE FIRST TIME |
| PASS | stop from the phone ends the session |  |
| PASS | after 5 wrong PINs the address is locked, even for the right PIN |  |

## Creator list  (21/21)

| Result | Check | Evidence |
|---|---|---|
| PASS | parse "kaicenat" | {'platform': 'twitch', 'ref': 'kaicenat', 'url': 'https://twitch.tv/kaicenat', 'name': 'kaicenat'} |
| PASS | parse "https://www.twitch.tv/xQc" | {'platform': 'twitch', 'ref': 'xqc', 'url': 'https://twitch.tv/xqc', 'name': 'xqc'} |
| PASS | parse "@pokimane" | {'platform': 'twitch', 'ref': 'pokimane', 'url': 'https://twitch.tv/pokimane', 'name': 'pokimane'} |
| PASS | parse "youtube.com/@IShowSpeed" | {'platform': 'youtube', 'ref': '@IShowSpeed', 'url': 'https://www.youtube.com/@IShowSpeed', 'name': 'IShowSpeed'} |
| PASS | parse "https://www.youtube.com/channel/UCWsDFcI" | {'platform': 'youtube', 'ref': 'channel/UCWsDFcIhY2DBi3GB5uykGXA', 'url': 'https://www.youtube.com/channel/UCWsDFcIhY2DBi3GB5uykGXA', 'name' |
| PASS | reject "" | rejected |
| PASS | reject "ab" | rejected |
| PASS | reject "https://youtu.be/abc" | rejected |
| PASS | reject "hello world" | rejected |
| PASS | reject "xxxxxxxxxxxxxxxxxxxx" | rejected |
| PASS | add offline creator | {'id': '0f056c2ef395'} |
| PASS | duplicate add rejected |  |
| PASS | bad add rejected |  |
| PASS | check now reports offline/online | {'live': True} |
| PASS | auto toggle off/on persists |  |
| PASS | save layout |  |
| PASS | library not broken by creators store (no .json in data) |  |
| PASS | remove |  |
| PASS | unknown creator -> 404 |  |
| PASS | detect live Twitch channel (any of 5 big ones) | ['kaicenat', 'xqc'] |
| PASS | offline/nonexistent channel -> not live, no crash |  |

## Star ratings and learning  (11/11)

| Result | Check | Evidence |
|---|---|---|
| PASS | summary readable | {'ratings': 2, 'weights': {'loud': 0.17, 'shout': 0.13, 'words': 0.2, 'motion': 0.17, 'flash': 0.08, 'strobe': 0.04, 'cuts': 0.03, 'llm': 0. |
| PASS | after 10 ratings the weights are fitted | {'ratings': 12, 'fitted': True, 'alpha': 0.2} |
| PASS | weights sum to 1 and stay positive | 1.0 |
| PASS | private summary starts empty |  |
| PASS | rating 5 accepted |  |
| PASS | rating 0 / 6 / text rejected |  |
| PASS | unknown clip rejected |  |
| PASS | repeated ratings count as one moment | {'ratings': 1, 'weights': {'loud': 0.17, 'shout': 0.13, 'words': 0.2, 'motion': 0.17, 'flash': 0.08, 'strobe': 0.04, 'cuts': 0.03, 'llm': 0. |
| PASS | eight varied distinct moments fit preferences | {'ratings': 8, 'weights': {'loud': 0.1428, 'shout': 0.1092, 'words': 0.2232, 'motion': 0.1301, 'flash': 0.0672, 'strobe': 0.0336, 'cuts': 0. |
| PASS | weights remain positive and normalized | {'loud': 0.1428, 'shout': 0.1092, 'words': 0.2232, 'motion': 0.1301, 'flash': 0.0672, 'strobe': 0.0336, 'cuts': 0.0252, 'llm': 0.1512, 'chat |
| PASS | revisions retain one training identity | {'ratings': 8, 'weights': {'loud': 0.1434, 'shout': 0.1097, 'words': 0.2202, 'motion': 0.1302, 'flash': 0.0675, 'strobe': 0.0337, 'cuts': 0. |

## Browser UI  (19/19)

| Result | Check | Evidence |
|---|---|---|
| PASS | 4 presets each become active when clicked | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | all 5 caption-style buttons become active | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | 11 layout cards render and all are clickable | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | default caption accuracy is Fast | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | default mode is Fast | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | every accuracy option selectable (fast/accurate/best) | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | every language option selectable (auto/en/hi/hinglish) | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | Editor / My clips views both open | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | safe-zone toggle on/off | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | Creators and Live panels present | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | page loads with no JS errors (only stale ERR_CONNECTION_REFUSED from a server restart) | checked in the browser pane (30 in-page assertions, 0 failed) |
| PASS | My clips with 108 clips defers video loading (only ~6 near the screen requested metadata) | 102 deferred, first visible clip playable (readyState 4) |
| PASS | Creators: add offline creator, row, status chip, feed, remove | seen in the browser pane (xqc), screenshot checked |
| PASS | Edit stale card -> newest clip; Apply to all 4 clips; both cards follow | 28.5 s, library 4/4 updated |
| PASS | Style panel, AI panel, caption animation select, SRT import, Find my facecam button all present (25 in-page assertions) | browser pane, 0 failed; style options off by default leave exports unchanged; Reset turns everything off |
| PASS | AI answers pasted in the page become tickable moments; SRT file through the real input fills the word editor | browser pane |
| PASS | Keyboard shortcuts I / O / Space trim and play | browser pane: I set start 12.34, O set end, Space toggled play |
| PASS | Live panel: clip length, hook source, captions switch, hype bar, phone box; options reach /live/start and Clip now (14 in-page checks) | browser pane, main app and phone-mode app |
| PASS | Phone page in a 375x812 viewport over the Wi-Fi address: PIN screen, wrong PIN message, auto-login by cookie, start, hype meter, Clip now, clip card, save link | browser pane |

## One-click installer  (4/4)

| Result | Check | Evidence |
|---|---|---|
| PASS | install.ps1 into an empty folder from local source (-Yes -SkipOptional -NoShortcut -NoStart) | exit 0, 78 s, "imports ok" |
| PASS | installed copy starts via Start-NeonClipping.bat on port 8791 | /healthz, /library, / (12 KB), /layouts (11) all OK; stopped cleanly |
| PASS | install.ps1 is ASCII only and parses with the PowerShell parser | 13 KB, 0 parse errors |
| PASS | installer writes Start-NeonClipping-Phone.bat (sets NEONCLIPPING_LAN=1) and a second shortcut; still ASCII and parses | real install into a scratch folder, exit 0 |

## Unit tests  (2/2)

| Result | Check | Evidence |
|---|---|---|
| PASS | 14 unit tests: chat-spike rule, target parsing, caption grouping (500 random streams), re-edit | python -m unittest tests.test_live tests.test_captions tests.test_reedit -> OK |
| PASS | 77 unit tests across the project (adds phone gate, hype meter, stream title) | python -m unittest discover -s tests -> OK |

## Website, links, release, editorsgurukul  (39/39)

| Result | Check | Evidence |
|---|---|---|
| PASS | https://iamajmeena.github.io/neonclipping/ loads | 200 19525 bytes |
| PASS | https://iamajmeena.github.io/neonclipping/ has title, download button, demo video |  |
| PASS | link https://github.com/iamajmeena/neonclipping | 200 |
| PASS | link https://github.com/iamajmeena/neonclipping/releases/latest/download/NeonClipping-Setup.bat | 200 |
| PASS | link https://iamajmeena.github.io/neonclipping/NEONCLIPPING-AGENT-SETUP-PROMPT.txt | 200 |
| PASS | link https://iamajmeena.github.io/neonclipping/NeonClipping-Guide-EN-HI.pdf | 200 |
| PASS | link https://iamajmeena.github.io/neonclipping/demo-poster.jpg | 200 |
| PASS | link https://iamajmeena.github.io/neonclipping/demo.mp4 | 200 |
| PASS | link https://iamajmeena.github.io/neonclipping/neonclipping-ui.jpg | 200 |
| PASS | link https://rzp.io/rzp/JN41CpW | 200 |
| PASS | https://iamajmeena.github.io/neonclipping/ no leftover github.io / edtrust names |  |
| PASS | https://editorsgurukul.com/neonclipping/ loads | 200 19960 bytes |
| PASS | https://editorsgurukul.com/neonclipping/ has title, download button, demo video |  |
| PASS | link https://editorsgurukul.com/ | 200 |
| PASS | link https://editorsgurukul.com/neonclipping/NEONCLIPPING-AGENT-SETUP-PROMPT.txt | 200 |
| PASS | link https://editorsgurukul.com/neonclipping/NeonClipping-Guide-EN-HI.pdf | 200 |
| PASS | link https://editorsgurukul.com/neonclipping/demo-poster.jpg | 200 |
| PASS | link https://editorsgurukul.com/neonclipping/demo.mp4 | 200 |
| PASS | link https://editorsgurukul.com/neonclipping/neonclipping-ui.jpg | 200 |
| PASS | link https://github.com/iamajmeena/neonclipping | 200 |
| PASS | link https://github.com/iamajmeena/neonclipping/releases/latest/download/NeonClipping-Setup.bat | 200 |
| PASS | link https://rzp.io/rzp/JN41CpW | 200 |
| PASS | link https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d873017920 | 200 |
| PASS | https://editorsgurukul.com/neonclipping/ no leftover github.io / edtrust names |  |
| PASS | both site copies carry the same content (only the back link and line endings differ) | 19446 vs 19880 bytes |
| PASS | release asset NeonClipping-Setup.bat | ['NEONCLIPPING-AGENT-SETUP-PROMPT.txt', 'NeonClipping-Guide-EN-HI.pdf', 'NeonClipping-Setup.bat', 'install.ps1', 'install.sh'] |
| PASS | release asset install.ps1 | ['NEONCLIPPING-AGENT-SETUP-PROMPT.txt', 'NeonClipping-Guide-EN-HI.pdf', 'NeonClipping-Setup.bat', 'install.ps1', 'install.sh'] |
| PASS | release asset install.sh | ['NEONCLIPPING-AGENT-SETUP-PROMPT.txt', 'NeonClipping-Guide-EN-HI.pdf', 'NeonClipping-Setup.bat', 'install.ps1', 'install.sh'] |
| PASS | release asset NeonClipping-Guide-EN-HI.pdf | ['NEONCLIPPING-AGENT-SETUP-PROMPT.txt', 'NeonClipping-Guide-EN-HI.pdf', 'NeonClipping-Setup.bat', 'install.ps1', 'install.sh'] |
| PASS | release asset NEONCLIPPING-AGENT-SETUP-PROMPT.txt | ['NEONCLIPPING-AGENT-SETUP-PROMPT.txt', 'NeonClipping-Guide-EN-HI.pdf', 'NeonClipping-Setup.bat', 'install.ps1', 'install.sh'] |
| PASS | one-click download URL resolves | 200 |
| PASS | raw install.ps1 reachable (the .bat downloads it when run alone) | 200 |
| PASS | install.ps1 is ASCII only (no encoding surprises in PowerShell 5.1) |  |
| PASS | guide PDF is a PDF with pages | 963080 |
| PASS | agent prompt has the 9 steps + simple-Hindi explanation + stop rules | 8091 |
| PASS | https://editorsgurukul.com/free-resources lists NeonClipping | 200 |
| PASS | https://editorsgurukul.com/free-websites/ lists NeonClipping | 200 |
| PASS | https://editorsgurukul.com/free-websites/neonclipping/ lists NeonClipping | 200 |
| PASS | sitemap lists /neonclipping/ |  |
