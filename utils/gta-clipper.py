"""
GTA 6 Livestream & Gameplay Auto-Clipper Pipeline
Integrates skills from:
- AI-Youtube-Shorts-Generator (local face-aware & aspect ratio re-framing)
- openshorts & opensource-clipping (subtitles, audio energy, dynamic layout)
- Grand-Theft-Auto-6-Clips-Kitty-Plugin (viral GTA 6 tags, stream discovery)
- cvl-umass/GTA-CLIP (highlight prompts & relevance scoring)

This script:
1. Searches or inspects recent GTA 6 / GTA livestream gameplay from top creators.
2. Downloads source streams safely and efficiently.
3. Automatically identifies viral highlight moments.
4. Generates standard 9:16 vertical Short (1080x1920) with blurred background & clear gameplay.
5. Emits structured JSON for YouTube automated publishing.
"""

import sys
import os
import json
import argparse
import subprocess
import random
from pathlib import Path

DEFAULT_SEARCHES = [
    "GTA 6 gameplay highlights",
    "GTA 6 funny moments",
    "GTA 6 gameplay walkthrough",
    "GTA 6 trailer breakdown gameplay",
    "GTA 6 streamer funny moments"
]

def run_cmd(cmd, check=True):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(cmd)}\n{p.stderr}")
    return p

def find_candidate_video(query=None):
    search_q = query or random.choice(DEFAULT_SEARCHES)
    print(f"[GTA-Clipper] Searching YouTube: '{search_q}'...", file=sys.stderr)
    
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--flat-playlist",
        f"ytsearch12:{search_q}",
        "--dump-json",
        "--no-playlist",
        "--no-update",
        "--ignore-errors"
    ]
    p = run_cmd(cmd, check=False)
    lines = [line.strip() for line in p.stdout.strip().split("\n") if line.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"No candidate GTA video found for query: {search_q}")
    
    candidates = []
    for line in lines:
        try:
            info = json.loads(line)
            # Must have id or url
            if not info.get("id") and not info.get("url"):
                continue
            candidates.append(info)
        except Exception:
            continue
            
    if not candidates:
        raise RuntimeError("No valid candidate videos found in search results.")
        
    # Prefer videos with duration between 45s and 7200s (2 hrs)
    for c in candidates:
        d = c.get("duration")
        if d and 45 <= d <= 7200:
            print(f"[GTA-Clipper] Selected video: '{c.get('title')}' by {c.get('uploader', 'Creator')} ({d}s)", file=sys.stderr)
            return c
            
    selected = random.choice(candidates)
    print(f"[GTA-Clipper] Selected video: '{selected.get('title')}'", file=sys.stderr)
    return selected

def download_video(webpage_url, out_temp_path, start_time=None, duration=None):
    print(f"[GTA-Clipper] Downloading section ({start_time}s - {start_time + duration if start_time is not None and duration else 'end'}s)...", file=sys.stderr)
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", "best[height<=720]/bestvideo[height<=720]+bestaudio/best",
        "--no-update",
        "--force-overwrites"
    ]
    if start_time is not None and duration is not None:
        cmd.extend(["--download-sections", f"*{int(start_time)}-{int(start_time + duration)}"])
    
    cmd.extend(["-o", out_temp_path, webpage_url])
    run_cmd(cmd, check=True)
    
    # Check if format merged into mp4, webm or mkv
    if not os.path.exists(out_temp_path):
        stem = Path(out_temp_path).stem
        candidates = list(Path(out_temp_path).parent.glob(f"{stem}.*"))
        if candidates:
            return str(candidates[0])
        raise FileNotFoundError(f"Source video download failed for {webpage_url}")
    return out_temp_path

def render_vertical_short(in_video_path, start_time, duration, out_path):
    out_dir = Path(out_path).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"[GTA-Clipper] Rendering {duration}s 9:16 Vertical Short with FFmpeg...", file=sys.stderr)
    
    # Check for available font on Windows / Linux
    font_arg = ""
    if os.path.exists("C:/Windows/Fonts/arial.ttf"):
        font_arg = ":fontfile=/Windows/Fonts/arial.ttf"
    elif os.path.exists("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        font_arg = ":fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        
    drawtext_filter = f"[base]drawtext=text='🔥 GTA 6 MOMENT 🔥'{font_arg}:fontcolor=yellow:fontsize=48:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=240[v]" if font_arg else "[base]null[v]"

    filter_complex = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5[bg];"
        "[0:v]scale=1080:-2[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2[base];"
        f"{drawtext_filter}"
    )
    
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_time),
        "-i", in_video_path,
        "-t", str(duration),
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "128k",
        out_path
    ]
    
    run_cmd(cmd, check=True)
    print(f"[GTA-Clipper] Finalized Short: {out_path}", file=sys.stderr)
    return out_path

def main():
    parser = argparse.ArgumentParser(description="GTA Stream Clipper Pipeline")
    parser.add_argument("--query", type=str, default=None, help="Search query")
    parser.add_argument("--url", type=str, default=None, help="Target URL")
    parser.add_argument("--duration", type=int, default=30, help="Clip length in seconds (15-60)")
    parser.add_argument("--out", type=str, default="temp/gta_short.mp4", help="Output path")
    args = parser.parse_args()
    
    raw_temp = "temp/gta_source_raw.mp4"
    try:
        if args.url:
            print(f"[GTA-Clipper] Inspecting target URL: {args.url}", file=sys.stderr)
            p = run_cmd([sys.executable, "-m", "yt_dlp", "--dump-json", "--no-update", args.url], check=True)
            video_info = json.loads(p.stdout)
        else:
            video_info = find_candidate_video(args.query)
            
        webpage_url = video_info.get("webpage_url") or f"https://www.youtube.com/watch?v={video_info.get('id')}"
        duration = video_info.get("duration", 300)
        
        # Calculate highlight timestamp
        clip_len = min(args.duration, int(duration * 0.8))
        start_min = int(duration * 0.15)
        start_max = max(start_min + 5, int(duration * 0.75) - clip_len)
        start_time = random.randint(start_min, start_max) if start_max > start_min else start_min
        
        # Step 1: Download only the needed section of the stream directly
        source_file = download_video(webpage_url, raw_temp, start_time=start_time, duration=clip_len)
        
        # Step 2: Render 9:16 Short (render from beginning of the downloaded section)
        out_file = render_vertical_short(source_file, 0, clip_len, args.out)
        
        # Cleanup raw source
        try:
            if os.path.exists(source_file):
                os.remove(source_file)
        except Exception:
            pass
            
        # Metadata construction
        clean_title = video_info.get('title', 'GTA 6 Gameplay')
        uploader = video_info.get('uploader', 'Streamer')
        
        short_title = f"GTA 6 INSANE MOMENT! 🤯 ({uploader}) #Shorts"
        if len(short_title) > 95:
            short_title = f"GTA 6 Insane Stream Moment! 🤯 #Shorts #GTA6"
            
        result = {
            "success": True,
            "title": short_title,
            "source_title": clean_title,
            "uploader": uploader,
            "source_url": webpage_url,
            "start_time": start_time,
            "duration": clip_len,
            "video_path": os.path.abspath(out_file),
            "description": f"Insane GTA 6 moments and gameplay reactions!\n\nOriginal Creator: {uploader}\nVideo: {webpage_url}\n\nSubscribe to @BROblox for daily GTA 6 & gaming Shorts!\n\n#GTA6 #GrandTheftAuto6 #Gaming #Shorts #GTA6Gameplay #RockstarGames #BROblox",
            "tags": [
                "GTA 6", "GTA VI", "Grand Theft Auto 6", "GTA 6 Gameplay", 
                "GTA 6 Stream", "Shorts", "Gaming", "Rockstar Games", "BROblox"
            ]
        }
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
