import contextlib
import os
import sys
from pathlib import Path

import yt_dlp

os.environ["PYTHONIOENCODING"] = "utf-8"

if not os.path.exists("python.log"):
    # Create the file
    with open("python.log", "w") as f:
        f.write("")  # optionally write something


# FIXME: remove this in production
def writer(s):
    with open("python.log", "a", encoding="utf-8") as f:
        try:
            f.write(s + "\n")
        except UnicodeEncodeError:
            f.write("UnicodeEncodeError\n")


class _SilentLogger:
    def debug(self, msg):
        writer(msg)

    def warning(self, msg):
        writer(msg)

    def error(self, msg):
        # Suppress errors to keep no-output requirement; exit code will signal failure.
        writer(msg)


def youtubeCookies():

    COOKIE_PATH = "/etc/secrets/youtube_cookies.txt"

    if os.path.exists(COOKIE_PATH):
        writer('youtube cookies in env')
        return COOKIE_PATH
    else:
        return None


def download_song(query: str) -> str:
    script_dir = Path(__file__).resolve().parent
    assets_dir = script_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "logger": _SilentLogger(),
        "noplaylist": True,
        "overwrites": True,
        "format": "bestaudio/best",
        "outtmpl": str(assets_dir / "%(title)s.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        # We'll pass an explicit ytsearch1: URL, but this is a safe default too.
        "default_search": "ytsearch1",
        "prefer_ffmpeg": True,
        "cachedir": False,
        # Retry the site extraction itself (helps for transient signature/player issues)
        "extractor_retries": 5,
        # Retry network requests (the actual media download)
        "retries": 5,
        # If the stream is fragmented (HLS/DASH), retry fragment fetches too
        "fragment_retries": 5,
        # Optional: wait a bit between retries to avoid rate limits
        "retry_sleep": 2,  # seconds
        # safe filenames
        "restrictfilenames": True,
    }

    cookies_path = youtubeCookies()
    if cookies_path:
        ydl_opts["cookiefile"] = cookies_path

    # Build a search URL that returns the single best match.
    search_url = f"ytsearch1:{query}"

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # type: ignore
        # Silence any library/ffmpeg output completely.
        with open(os.devnull, "w") as devnull, contextlib.redirect_stdout(
            devnull
        ), contextlib.redirect_stderr(devnull):
            info = ydl.extract_info(search_url, download=True)

        # Try to get the final post-processed filepath directly.
        filepath = None
        if isinstance(info, dict):
            # When ytsearch1 still returns a playlist-like dict with 'entries'
            candidate_dicts = []
            if "entries" in info and info["entries"]:
                candidate_dicts.append(info["entries"][0])
            candidate_dicts.append(info)  # also try the top-level dict

            for d in candidate_dicts:
                rd_list = d.get("requested_downloads") or []
                if rd_list:
                    rd0 = rd_list[0]
                    filepath = rd0.get("filepath") or rd0.get("filename")
                    if filepath:
                        break

            if not filepath:
                # Fallback: use prepare_filename and swap extension to .mp3
                # (works because postprocessing set the final codec)
                try:
                    filename = ydl.prepare_filename(info)
                except Exception:
                    # If prepare_filename fails on the top dict, try first entry
                    if "entries" in info and info["entries"]:
                        filename = ydl.prepare_filename(info["entries"][0])
                    else:
                        raise
                base, _ = os.path.splitext(filename)
                filepath = base + ".mp3"

        if not filepath:
            # Shouldn't happen, but guard anyway.
            raise RuntimeError("Failed to determine output file path.")

        return Path(filepath).name  # Print only the filename, not the full path.


def main():
    if len(sys.argv) < 2:
        print("track.mp3")
        raise SystemExit(0)

    song_name = sys.argv[1].strip().lower()

    try:
        filename = download_song(song_name)
        # REQUIREMENT: only output at the end, and only the filename.
        print(filename)
    except Exception as e:
        # No output on failure; exit code signals error.
        writer(str(e))
        writer(str(e.args))
        writer(str(e.with_traceback(None)))

        print(str(e))
        print(str(e.args))
        print(str(e.with_traceback(None)))
        sys.exit(1)


if __name__ == "__main__":
    main()
