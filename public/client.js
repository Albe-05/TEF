
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');

const result = document.getElementById('result');
const songTextEl = document.getElementById('songText');
const startSecEl = document.getElementById('startSec');
const downloadUrlEl = document.getElementById('downloadUrl');
const contactSheetImg = document.getElementById('contactSheet');
const selectedTrackEl = document.getElementById('selectedTrack');

let selectedFile = null;

// Accessibility and single-file-dialog behavior
dropzone.setAttribute('tabindex', '0');
dropzone.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0];
  processBtn.disabled = !selectedFile;
  statusEl.textContent = selectedFile ? `Selected: ${selectedFile.name}` : '';
});

['dragenter','dragover'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('ring-2', 'ring-glow2/50');
  });
});
['dragleave','drop'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('ring-2', 'ring-glow2/50');
  });
});
dropzone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files && files[0]) {
    fileInput.files = files;
    fileInput.dispatchEvent(new Event('change'));
  }
});

dropzone.addEventListener('click', (e) => {
  if (e.target !== fileInput) fileInput.click();
});

processBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  result.classList.add('hidden');
  statusEl.textContent = 'Uploading and processing…';
  progressEl.classList.remove('hidden');
  progressBar.style.width = '0%';
  processBtn.disabled = true;

  try {
    const fd = new FormData();
    fd.append('video', selectedFile);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/process');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
      }
    });

    const data = await new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (err) { reject(err); }
        } else {
          reject(new Error(xhr.responseText || 'Server error'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    });

    statusEl.textContent = 'Done!';
    songTextEl.textContent = data.song_artist || '(unknown)';
    startSecEl.textContent = data.start_seconds;
    downloadUrlEl.href = data.download_url;
    selectedTrackEl.textContent = data.selected_track || '(n/a)';
    contactSheetImg.src = data.contact_sheet_url;
    result.classList.remove('hidden');
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error: ' + (err.message || err);
  } finally {
    processBtn.disabled = false;
    progressEl.classList.add('hidden');
    progressBar.style.width = '0%';
  }
});

// --- Footer rating widget ---
const ratingGroup = document.getElementById('ratingGroup');
const ratingStatus = document.getElementById('ratingStatus');
const submitRatingBtn = document.getElementById('submitRating');
let selectedRating = null;

function ratingButtons() {
  return Array.from((ratingGroup || {}).querySelectorAll?.('.rate') || []);
}

if (ratingGroup && submitRatingBtn) {
  ratingGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.rate');
    if (!btn) return;
    selectedRating = parseInt(btn.dataset.v, 10);
    ratingButtons().forEach(b => b.classList.remove('ring-2', 'ring-offset-2', 'ring-glow2'));
    btn.classList.add('ring-2', 'ring-offset-2', 'ring-glow2');
  });

  submitRatingBtn.addEventListener('click', async () => {
    if (!(selectedRating >= 1 && selectedRating <= 5)) {
      ratingStatus.textContent = 'Please choose a rating from 1 to 5.';
      return;
    }
    try {
      const res = await fetch('/api/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: selectedRating })
      });
      if (!res.ok) throw new Error(await res.text());
      ratingStatus.textContent = 'Thanks for your feedback!';
      submitRatingBtn.disabled = true;
    } catch (err) {
      ratingStatus.textContent = 'Error submitting rating: ' + (err.message || err);
    }
  });
}
