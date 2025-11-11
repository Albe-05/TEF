
import { GoogleGenerativeAI } from '@google/generative-ai';
import { spawn } from 'child_process';
import 'dotenv/config';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DEBUG = (process.env.DEBUG || 'false').toLowerCase() === 'true';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));
app.use('/frames', express.static(path.join(__dirname, 'frames')));

const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');
const framesDir = path.join(__dirname, 'frames');
const assetsDir = path.join(__dirname, 'assets');
const pythonBin = process.env.PYTHON_BIN || 'python3';

for (const d of [uploadsDir, outputsDir, framesDir, assetsDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function log(...args) { if (DEBUG) console.log('[debug]', ...args); }

// at top (near other dirs)
const dataDir = path.join(__dirname, 'data');
const counterCsvPath = path.join(dataDir, 'counter.csv');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function ensureCounterCsv() {
  // Header for append-only log
  if (!fs.existsSync(counterCsvPath)) {
    fs.writeFileSync(counterCsvPath, 'processed_count,timestamp\n');
  } else {
    // If legacy format "processed_count\n0\n" exists, keep it; we'll start appending timestamped rows
    const txt = fs.readFileSync(counterCsvPath, 'utf8');
    if (!/^processed_count/.test(txt)) {
      fs.writeFileSync(counterCsvPath, 'processed_count,timestamp\n');
    }
  }
}
function isoNow() { return new Date().toISOString(); }
function readCounter() {
  try {
    const lines = fs.readFileSync(counterCsvPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    // If legacy 2-line format, last line is "0"; if log format, last line is "N,<iso>"
    if (lines.length <= 1) return 0; // only header
    const last = lines[lines.length - 1];
    const n = parseInt(last.split(',')[0], 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
function appendCounterRow(n) {
  fs.appendFileSync(counterCsvPath, `${n},${isoNow()}\n`);
}
function incrementCounter() {
  ensureCounterCsv();
  const n = readCounter() + 1;
  appendCounterRow(n);
  return n;
}
// initialize on boot
ensureCounterCsv();

// rating
const ratingCsvPath = path.join(dataDir, 'ratings.csv');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function ensureRatingCsv() {
  if (!fs.existsSync(ratingCsvPath)) {
    fs.writeFileSync(ratingCsvPath, 'timestamp,rating\n');
  }
}
function appendRating(rating) {
  ensureRatingCsv();
  fs.appendFileSync(ratingCsvPath, `${isoNow()},${rating}\n`);
}
ensureRatingCsv();


// Cleanup: delete files older than 1 hour, run also every 10 minutes
const ONE_HOUR = 60 * 60 * 1000;
function deleteOldFiles(dir, maxAgeMs = ONE_HOUR) {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > maxAgeMs) {
          fs.unlinkSync(p);
          log('Deleted old file:', p);
        }
      } catch { }
    }
  } catch { }
}
setInterval(() => { try { deleteOldFiles(uploadsDir); deleteOldFiles(framesDir); deleteOldFiles(outputsDir); deleteOldFiles(assetsDir);} catch { } }, 10 * 60 * 1000);

async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      try { resolve(metadata.format.duration); }
      catch (e) { reject(e); }
    });
  });
}

async function extractFrameAt(filePath, timestampSec, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .seekInput(timestampSec)
      .frames(1)
      .outputOptions(['-q:v 2'])
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .run();
  });
}

/* async function makeContactSheet(frames, outPath) {
  const resized = await Promise.all(frames.map(async fp => {
    return sharp(fp).resize(640, 360, { fit: 'cover' }).toBuffer();
  }));
  const blank = sharp({
    create: { width: 1280, height: 720, channels: 3, background: { r: 0, g: 0, b: 0 } }
  });
  const composites = [
    { input: resized[0], left: 0, top: 0 },
    { input: resized[1], left: 640, top: 0 },
    { input: resized[2], left: 0, top: 360 },
    { input: resized[3], left: 640, top: 360 },
  ];
  await blank.composite(composites).png().toFile(outPath);
  return outPath;
} */

async function makeContactSheet(frames, outPath) {
  const cols = 3, rows = 3;
  const cellW = 640, cellH = 360;                 // each thumbnail 16:9
  const sheetW = cols * cellW, sheetH = rows * cellH; // 1920x1080 final PNG

  const resized = await Promise.all(
    frames.map(fp => sharp(fp).resize(cellW, cellH, { fit: 'cover' }).toBuffer())
  );

  const composites = resized.map((buf, idx) => ({
    input: buf,
    left: (idx % cols) * cellW,
    top: Math.floor(idx / cols) * cellH,
  }));

  await sharp({
    create: {
      width: sheetW,
      height: sheetH,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    }
  }).composite(composites).png().toFile(outPath);

  return outPath;
}


function base64FromFile(p) {
  const data = fs.readFileSync(p);
  return data.toString('base64');
}

async function askGeminiForSong(imagePath) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in .env');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `You are a music-savvy assistant. Look at this image (a 3x3 contact sheet of frames from a video).\n\n
Return JSON ONLY (no backticks, no commentary) with: {\n
  \"song_artist\": string,  // Format EXACTLY: "Song Title - Artist Name" (single hyphen with spaces).\n
  \"start_seconds\": number // Integer seconds to begin playback (>= 0).\n
}\n
Constraints:\n
- The song must be real (music), not podcasts/interviews/livestreams.\n
- Use Title Case for both song and artist.\n
Example: { \"song_artist\": \"Blinding Lights - The Weeknd\", \"start_seconds\": 42 }`;

  const img = base64FromFile(imagePath);
  const result = await model.generateContent([
    { inlineData: { mimeType: 'image/png', data: img } },
    { text: prompt }
  ]);
  const text = result.response.text().trim();
  log('Gemini raw response:', text);

  function tryParseJson(t) {
    try { return JSON.parse(t); } catch { }
    const m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { } }
    return null;
  }
  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed.start_seconds !== 'number' || !parsed.song_artist) {
    return { song_artist: 'Unknown - Unknown', start_seconds: 0 };
  }
  // Normalize song_artist a bit
  const sa = String(parsed.song_artist).trim();
  return { song_artist: sa, start_seconds: Math.max(0, Math.floor(parsed.start_seconds)) };
}

async function callPythonSelector(songArtistStr) {
  return new Promise((resolve, reject) => {
    const ps = spawn(pythonBin, [path.join(__dirname, 'main.py'), songArtistStr], { cwd: __dirname });
    let out = '', err = '';
    ps.stdout.on('data', d => out += d.toString());
    ps.stderr.on('data', d => err += d.toString());
    ps.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`Python exited with code ${code}, ${err}`));
    });
  });
}

async function muxAudioOntoVideo({ videoPath, audioPath, startSeconds, outPath }) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioPath).inputOptions([`-ss ${Math.max(0, Math.floor(startSeconds))}`])
      .input(videoPath)
      .outputOptions([
        '-map 1:v:0',
        '-map 0:a:0',
        '-c:v copy',
        '-c:a aac',
        '-shortest',
        '-movflags +faststart'
      ])
      .on('start', c => log('ffmpeg:', c))
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

// Multer: only video upload
const storage = multer.diskStorage({
  destination: (_req, file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/process', upload.single('video'), async (req, res) => {
  try {
    // Cleanup old files
    try { deleteOldFiles(uploadsDir); deleteOldFiles(framesDir); deleteOldFiles(outputsDir); deleteOldFiles(assetsDir); } catch { }

    const vidFile = req.file;
    if (!vidFile) return res.status(400).send('Missing video file.');

    const id = uuidv4();
    const workPrefix = path.join(framesDir, id);
    
    const contactPath = path.join(framesDir, `${id}-contact.png`);
    const outVideoPath = path.join(outputsDir, `${id}.mp4`);

    const N = 9;
    
    // Duration & timestamps
    const duration = await getVideoDuration(vidFile.path);
    if (!duration || !isFinite(duration) || duration <= 0) throw new Error('Could not read video duration.');

    // 9 frame paths
    const framePaths = Array.from({ length: N }, (_, i) => `${workPrefix}-frame${i + 1}.png`);

    // 9 equidistant timestamps: 1/10 .. 9/10 of duration (avoid first/last black frames)
    const times = Array.from({ length: N }, (_, i) =>
      Math.max(0, Math.min(duration - 0.1, duration * ((i + 1) / (N + 1))))
    );

    // Extract all 9 frames
    for (let i = 0; i < N; i++) {
      await extractFrameAt(vidFile.path, times[i], framePaths[i]);
    }

    // Build 3x3 contact sheet
    await makeContactSheet(framePaths, contactPath);



    

    // Ask Gemini for song string + start
    const { song_artist, start_seconds } = await askGeminiForSong(contactPath);
    log('Gemini parsed:', { song_artist, start_seconds });

    // Call Python selector with the "Song - Artist" string
    const selectedTrackName = await callPythonSelector(song_artist || '');
    if (!selectedTrackName) return res.status(400).send('Python selector did not return a track filename.');
    const audioPath = path.join(assetsDir, selectedTrackName);
    if (!fs.existsSync(audioPath)) return res.status(400).send(`Selected track not found: assets/${selectedTrackName}`);

    // Mux
    await muxAudioOntoVideo({
      videoPath: vidFile.path,
      audioPath,
      startSeconds: Number.isFinite(start_seconds) ? start_seconds : 0,
      outPath: outVideoPath
    });

    // in /api/process, right AFTER successful mux and BEFORE res.json(...)
    const processed_count = incrementCounter();
    

    res.json({
      processed_count,
      song_artist,
      start_seconds: Number.isFinite(start_seconds) ? start_seconds : 0,
      selected_track: selectedTrackName,
      download_url: `/outputs/${path.basename(outVideoPath)}`,
      contact_sheet_url: `/frames/${path.basename(contactPath)}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(err?.message || 'Processing failed.');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

app.post('/api/rating', (req, res) => {
  try {
    const rating = parseInt(req.body?.rating, 10);
    if (!(rating >= 1 && rating <= 5)) {
      return res.status(400).send('Rating must be an integer 1..5');
    }
    appendRating(rating);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to record rating');
  }
});
