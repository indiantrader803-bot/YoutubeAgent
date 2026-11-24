"""
NeonClipping Autonomous Multi-Clip Engine & Viral Highlight Clipper
Integrates:
- vendor/neonclipping/highlights.py (Optical flow Farneback + Loudness Jump + 2-4kHz shout spike detection)
- vendor/neonclipping/curation.py & styling.py (Hook framing, ASS neon glowing subtitles, rounded badges)
- Multi-query discovery (Gaming, Popular Streamers, Viral Trending, GTA 6)
- 9:16 Vertical Shorts Rendering (1080x1920) with blurred cinematic backdrop + glowing headline & burnt neon captions
- Multi-clip generator: extracts 2-5 high-converting shorts per source stream/video.
"""

import sys
import os
import json
import argparse
import subprocess
import random
from pathlib import Path

# Add vendor/neonclipping to path
ROOT_DIR = Path(__file__).resolve().parent.parent
VENDOR_NEON = ROOT_DIR / "vendor" / "neonclipping"
if str(VENDOR_NEON) not in sys.path:
    sys.path.insert(0, str(VENDOR_NEON))

try:
    import highlights
    import curation
    import styling
    NEON_AVAILABLE = True
except Exception as e:
    print(f"[NeonClipper] Warning: Could not import native neonclipping modules: {e}", file=sys.stderr)
    NEON_AVAILABLE = False

POPULAR_SEARCH_TOPICS = [
    # Top Streamers & Gaming Highlights
    "GTA 6 gameplay highlights funny moments",
    "Speed funny moments stream highlights",
    "Kai Cenat funniest moments stream",
    "GTA 5 RP funny moments",
    "MrBeast challenge insane moments",
    "Gaming wins and fails compilation 2025",
    "Sidemen funny clips shorts",
    "Jynxzi funny clutch moments"
]

def run_cmd(cmd, check=True):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(cmd)}\n{p.stderr}")
    return p

def search_popular_videos(query=None, limit=12):
    search_q = query or random.choice(POPULAR_SEARCH_TOPICS)
    print(f"[NeonClipper] Searching YouTube for popular videos: '{search_q}'...", file=sys.stderr)
    
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        "--default-search", f"ytsearch{limit}",
        search_q,
        "--dump-json",
        "--no-playlist",
        "--no-update",
        "--ignore-errors"
    ]
    p = run_cmd(cmd, check=False)
    lines = [line.strip() for line in p.stdout.strip().split("\n") if line.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"No candidate videos found for query '{search_q}'.")
    
    candidates = []
    for line in lines:
        try:
            info = json.loads(line)
            duration = info.get("duration", 0)
            # Find quality source videos between 90 seconds and 3600 seconds
            if 90 <= duration <= 3600:
                candidates.append(info)
        except Exception:
            continue
            
    if not candidates and lines:
        candidates.append(json.loads(lines[0]))
        
    print(f"[NeonClipper] Found {len(candidates)} viable candidates.", file=sys.stderr)
    return candidates

def download_video_stream(webpage_url, out_temp_path):
    print(f"[NeonClipper] Downloading stream: {webpage_url}...", file=sys.stderr)
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        "-f", "best[height<=720]/bestvideo[height<=720]+bestaudio/best",
        "--no-update",
        "--force-overwrites",
        "-o", out_temp_path,
        webpage_url
    ]
    run_cmd(cmd, check=True)
    
    if not os.path.exists(out_temp_path):
        # Check if downloaded with different container
        parent = Path(out_temp_path).parent
        stem = Path(out_temp_path).stem
        matches = list(parent.glob(f"{stem}.*"))
        if matches:
            return str(matches[0])
        raise FileNotFoundError(f"Source video file not found after download: {out_temp_path}")
    return out_temp_path

def get_media_duration(file_path):
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path
    ]
    p = run_cmd(cmd, check=True)
    return float(p.stdout.strip())

def find_best_highlights(source_file, duration, clip_count=2, clip_length=35):
    """
    Leverage neonclipping's optical flow motion + audio loudness jump to find peak action
    """
    print(f"[NeonClipper] Analyzing {duration:.1f}s video for top {clip_count} moments...", file=sys.stderr)
    if NEON_AVAILABLE:
        try:
            # Run signal-based optical flow + audio peak detection
            ranked = highlights.rank(source_file, duration, count=clip_count, length=clip_length, motion_on=True)
            if ranked:
                print(f"[NeonClipper] highlights.rank() identified {len(ranked)} peaks: {[c['reason'] for c in ranked]}", file=sys.stderr)
                return ranked
        except Exception as err:
            print(f"[NeonClipper] highlights.rank() fallback: {err}", file=sys.stderr)

    # Heuristic fallback if OpenCV optical flow fails or times out
    segments = []
    # Take moments from 20%, 50%, and 75% into the video
    fractions = [0.25, 0.50, 0.75]
    for i in range(min(clip_count, len(fractions))):
        st = max(5.0, min(duration * fractions[i], duration - clip_length - 5.0))
        segments.append({
            "start": round(st, 2),
            "end": round(st + clip_length, 2),
            "title": f"Action Highlight {i+1}",
            "score": 85 - (i * 5),
            "reason": "Dynamic activity window"
        })
    return segments

def generate_neon_ass_subtitles(ass_path, hook_title, duration):
    """
    Create stylish ASS subtitle with neon glow and high-contrast badges
    """
    header = """[Script Info]
Title: NeonClipping Automated Subtitle
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TitleHook,Impact,64,&H0000FFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,0,8,40,40,240,1
Style: SubBadge,Arial,42,&H00FFFFFF,&H00000000,&H000000FF,&HB0000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    # Format timestamps
    m, s = divmod(duration, 60)
    end_stamp = f"0:{int(m):02d}:{s:05.2f}"
    
    clean_hook = hook_title.upper().replace("{", "").replace("}", "")
    events = [
        f"Dialogue: 0,0:00:00.00,{end_stamp},TitleHook,,0,0,0,,{{\\fad(200,200)\\blur2}}{clean_hook}",
        f"Dialogue: 0,0:00:00.50,{end_stamp},SubBadge,,0,0,0,,{{\\fad(300,300)}}🔥 WATCH TILL END 🔥"
    ]
    
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header + "\n".join(events) + "\n")
    return ass_path

def render_vertical_clip(source_video, start_time, duration, out_path, hook_title):
    out_dir = Path(out_path).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    ass_path = str(out_dir / f"sub_{Path(out_path).stem}.ass")
    generate_neon_ass_subtitles(ass_path, hook_title, duration)
    
    # Path escaping for FFmpeg subtitle filter
    ass_escaped = ass_path.replace("\\", "/").replace(":", "\\:")
    
    filter_complex = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:6[bg];"
        "[0:v]scale=1080:-2[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2[comp];"
        f"[comp]subtitles='{ass_escaped}'[v]"
    )
    
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_time),
        "-i", source_video,
        "-t", str(duration),
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "21",
        "-c:a", "aac",
        "-b:a", "128k",
        out_path
    ]
    
    print(f"[NeonClipper] Rendering clip: {start_time}s -> {start_time+duration}s to {out_path}...", file=sys.stderr)
    run_cmd(cmd, check=True)
    return out_path

def build_hook_title(base_title, creator_name, reason=""):
    # Generate scroll-stopping title based on curation hook formulas
    prefixes = ["WAIT FOR IT!", "HE REALLY DID THIS?!", "NO WAY THIS HAPPENED!", "BRO WENT INSANE!", "INSTANT REGRET?!"]
    prefix = random.choice(prefixes)
    
    clean_creator = creator_name.replace(" - Topic", "").strip() if creator_name else "Streamer"
    title = f"{prefix} {clean_creator} #Shorts"
    if len(title) > 95:
        title = title[:92] + "..."
    return title

def main():
    parser = argparse.ArgumentParser(description="NeonClipping Multi-Clip Automation Pipeline")
    parser.add_argument("--query", type=str, default=None, help="Search query")
    parser.add_argument("--url", type=str, default=None, help="Direct video URL")
    parser.add_argument("--clips", type=int, default=2, help="Number of clips to generate")
    parser.add_argument("--duration", type=int, default=35, help="Duration per clip (seconds)")
    parser.add_argument("--outdir", type=str, default="temp", help="Output directory")
    args = parser.parse_args()
    
    out_dir = Path(args.outdir)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        if args.url:
            # Direct target
            target = {"webpage_url": args.url, "title": "Stream Highlight", "uploader": "Top Creator"}
        else:
            candidates = search_popular_videos(args.query, limit=10)
            target = random.choice(candidates)
            
        source_url = target.get("webpage_url") or target.get("url")
        uploader = target.get("uploader", "Streamer")
        orig_title = target.get("title", "Popular Stream")
        
        # Download stream locally
        raw_source = str(out_dir / f"neon_raw_{abs(hash(source_url)) % 100000}.mp4")
        actual_source = download_video_stream(source_url, raw_source)
        
        # Measure true media duration
        tot_duration = get_media_duration(actual_source)
        
        # Find highlight segments
        highlights_list = find_best_highlights(actual_source, tot_duration, clip_count=args.clips, clip_length=args.duration)
        
        rendered_clips = []
        for idx, hl in enumerate(highlights_list):
            st = hl["start"]
            clip_dur = min(args.duration, hl["end"] - st)
            clip_name = f"neon_short_{int(st)}_{idx+1}.mp4"
            out_clip_path = str(out_dir / clip_name)
            
            hook = build_hook_title(orig_title, uploader, hl.get("reason", ""))
            render_vertical_clip(actual_source, st, clip_dur, out_clip_path, hook)
            
            rendered_clips.append({
                "clip_index": idx + 1,
                "title": hook,
                "description": f"Best viral moments from {uploader}! 🔥\n\nOriginal video: {orig_title}\nSource: {source_url}\n\n#Shorts #Gaming #StreamerHighlights #Viral #Trending",
                "tags": ["Shorts", "Gaming", "FunnyMoments", "Streamer", "ViralShorts", "Highlights", "GTA", "Trending"],
                "video_path": os.path.abspath(out_clip_path),
                "duration": clip_dur,
                "source_url": source_url,
                "uploader": uploader,
                "score": hl.get("score", 90),
                "reason": hl.get("reason", "Activity Spike")
            })
            
        # Clean up source raw video to preserve disk
        try:
            if os.path.exists(actual_source):
                os.remove(actual_source)
        except Exception:
            pass
            
        # Emit final JSON
        output_payload = {
            "success": True,
            "clips_count": len(rendered_clips),
            "clips": rendered_clips
        }
        print(json.dumps(output_payload))
        
    except Exception as e:
        err_payload = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(err_payload))
        sys.exit(1)

if __name__ == "__main__":
    main()
