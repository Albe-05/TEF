# TEF project

Gemini wrapper that returns `"song - artist"` and a `start_seconds`. That string is passed to `main.py`, which downloads the MP3 under `assets/`. Which then is inserted in place of the video track.

## Flow

1. Upload a video.
2. Captures 9 frames → contact sheet.
3. Ask **gemini-2.5-flash** for:
    ```json
    { "song_artist": "Song Title - Artist Name", "start_seconds": 00 }
    ```
4. Call `python3 main.py "Song Title - Artist Name"`
5. Downloads the mp3 form youtube → prints its filename under `assets/`.
6. Trim the MP3 from `start_seconds` and mux onto the video.
7. Return a downloadable video and show the contact sheet + song info.

## Cleanup

-   Deletes files older than **1 hour** in `uploads/`, `frames/`, `outputs/`, `assets/` (on request + every 10 minutes).

## ENV

The projects to work properly requires the following environmental variables:

-   GOOGLE_API_KEY
-   PYTHON_BIN
-   PORT

## Requirements

-   Node 18+
-   ffmpeg + ffprobe installed and on PATH
-   Python 3
