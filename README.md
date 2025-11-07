
# TEF project

Gemini now returns `"song - artist"` and a `start_seconds`. That string is passed to `main.py`, which chooses the MP3 under `assets/`. All YouTube logic removed.

## Flow
1) Upload a video.
2) Capture frames at 20/40/60/80% → contact sheet.
3) Ask **gemini-2.5-flash** for:
   ```json
   {"song_artist":"Song Title - Artist Name","start_seconds":42}
   ```
4) Call `python3 main.py "Song Title - Artist Name"` → prints an MP3 filename under `assets/`.
5) Trim the MP3 from `start_seconds` and mux onto the video.
6) Return a downloadable video and show the contact sheet + song info.

## Put your MP3s
- Drop them in `assets/`.
- Edit `main.py` mapping to map normalized `"song - artist"` strings → filenames.

## Cleanup
- Deletes files older than **1 hour** in `uploads/`, `frames/`, `outputs/`, `assets/` (on request + every 10 minutes).

## Requirements
- Node 18+
- ffmpeg + ffprobe installed and on PATH
- Python 3
