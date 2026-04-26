/**
 * TealGrade · script.js
 *
 * Cinematic shadow-teal color grade filter PWA.
 *
 * Filter analysis (image_0 → image_6 → image_12):
 *   - Shadow zone (lum < ~0.4): Strong cyan/teal injection
 *       dR ≈ −42, dG ≈ +12, dB ≈ +52
 *   - Midtone zone (lum ~0.4–0.6): Moderate cool shift
 *       dR ≈ −30, dG ≈ +4, dB ≈ +28
 *   - Highlight zone (lum > ~0.6): Subtle cool tint
 *       dR ≈ −8, dG ≈ +2, dB ≈ +10
 *
 * All deltas linearly scaled by (intensity / 12).
 * Zone blending uses smooth luminance-based weights.
 */

'use strict';

// ──────────────────────────────────────────────────────
// PWA: Service Worker registration
// ──────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .catch(() => { /* offline install fail is non-fatal */ });
  });
}

// ──────────────────────────────────────────────────────
// DOM references
// ──────────────────────────────────────────────────────
const uploadZone        = document.getElementById('uploadZone');
const canvasWrapper     = document.getElementById('canvasWrapper');
const controls          = document.getElementById('controls');
const fileInput         = document.getElementById('fileInput');
const mainCanvas        = document.getElementById('mainCanvas');
const ctx               = mainCanvas.getContext('2d', { willReadFrequently: true });
const intensitySlider   = document.getElementById('intensitySlider');
const intensityDisplay  = document.getElementById('intensityDisplay');
const processingOverlay = document.getElementById('processingOverlay');
const saveBtn           = document.getElementById('saveBtn');
const resetBtn          = document.getElementById('resetBtn');
const newImageBtn       = document.getElementById('newImageBtn');
const presetBtns        = document.querySelectorAll('.preset-btn');
const toast             = document.getElementById('toast');

// ──────────────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────────────
let originalImageData = null;
let rafId = null;

// ──────────────────────────────────────────────────────
// Filter — LUT construction
// ──────────────────────────────────────────────────────

/**
 * Pre-compute per-luminance color delta LUTs for performance.
 * Building 3×256 Float32Arrays once per intensity change means
 * the inner render loop only needs a table lookup + clamp.
 *
 * @param {number} intensity – 0 to 12
 * @returns {{ dR: Float32Array, dG: Float32Array, dB: Float32Array }}
 */
function buildLUT(intensity) {
  const t = intensity / 12;             // normalize to [0, 1]
  const dR = new Float32Array(256);
  const dG = new Float32Array(256);
  const dB = new Float32Array(256);

  for (let li = 0; li < 256; li++) {
    const lum = li / 255;

    // Zone weights — sum to ≤ 1; smooth overlap for natural blending
    const shadowW = Math.max(0, 1 - lum * 2.5);          // 1 at 0, 0 at 0.4
    const highW   = Math.max(0, lum * 2.5 - 1.5);        // 0 at 0.6, 1 at 1
    const midW    = Math.max(0, 1 - shadowW - highW);     // bell in between

    // Delta coefficients at full intensity (intensity = 12)
    dR[li] = (shadowW * -42  +  midW * -30  +  highW *  -8) * t;
    dG[li] = (shadowW *  12  +  midW *   4  +  highW *   2) * t;
    dB[li] = (shadowW *  52  +  midW *  28  +  highW *  10) * t;
  }

  return { dR, dG, dB };
}

// ──────────────────────────────────────────────────────
// Filter — public API
// ──────────────────────────────────────────────────────

/**
 * Apply the teal color grade filter to a Canvas ImageData object.
 *
 * @param {ImageData} imageData – ImageData to mutate in-place.
 * @param {number}    intensity – 0 (no effect) → 12 (maximum effect).
 * @returns {ImageData} The same mutated ImageData.
 */
function applyFilter(imageData, intensity) {
  if (intensity === 0) return imageData;

  const { dR, dG, dB } = buildLUT(intensity);
  const data = imageData.data;
  const len  = data.length;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // alpha (data[i+3]) left untouched

    // Perceived luminance index — fast integer via bitwise OR
    const li = (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.5) | 0;

    data[i]     = r + dR[li] > 255 ? 255 : r + dR[li] < 0 ? 0 : (r + dR[li] + 0.5) | 0;
    data[i + 1] = g + dG[li] > 255 ? 255 : g + dG[li] < 0 ? 0 : (g + dG[li] + 0.5) | 0;
    data[i + 2] = b + dB[li] > 255 ? 255 : b + dB[li] < 0 ? 0 : (b + dB[li] + 0.5) | 0;
  }

  return imageData;
}

// ──────────────────────────────────────────────────────
// Render pipeline
// ──────────────────────────────────────────────────────

function renderFilter(intensity) {
  if (!originalImageData) return;

  // Clone original pixel buffer (avoid mutating source)
  const filtered = new ImageData(
    new Uint8ClampedArray(originalImageData.data),
    originalImageData.width,
    originalImageData.height
  );

  applyFilter(filtered, intensity);
  ctx.putImageData(filtered, 0, 0);
}

// ──────────────────────────────────────────────────────
// Image loading
// ──────────────────────────────────────────────────────

const MAX_DIMENSION = 2048; // cap for performance on older Safari

function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('画像ファイルを選択してください');
    return;
  }

  const url = URL.createObjectURL(file);
  const img  = new Image();

  img.onload = () => {
    URL.revokeObjectURL(url);

    // Downscale if necessary
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      const s = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }

    mainCanvas.width  = w;
    mainCanvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    // Cache original pixels
    originalImageData = ctx.getImageData(0, 0, w, h);

    // Reset controls
    setIntensity(0);

    // Reveal canvas UI
    uploadZone.hidden    = true;
    canvasWrapper.hidden = false;
    controls.hidden      = false;
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('画像の読み込みに失敗しました');
  };

  img.src = url;
}

// ──────────────────────────────────────────────────────
// Intensity helpers
// ──────────────────────────────────────────────────────

function setIntensity(val) {
  val = Math.max(0, Math.min(12, val));
  intensitySlider.value = val;
  updateSliderUI(val);
  renderFilter(val);
}

function updateSliderUI(val) {
  // Fill track
  const pct = (val / 12) * 100;
  intensitySlider.style.setProperty('--fill', pct + '%');

  // Numeric display
  const display = Number.isInteger(val) ? String(val) : val.toFixed(1);
  intensityDisplay.textContent = display;

  // ARIA
  intensitySlider.setAttribute('aria-valuenow', display);

  // Preset active state
  presetBtns.forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.value) === val);
  });
}

// ──────────────────────────────────────────────────────
// Event: Slider
// ──────────────────────────────────────────────────────

intensitySlider.addEventListener('input', () => {
  const val = parseFloat(intensitySlider.value);
  updateSliderUI(val);

  // Schedule render on next frame (debounce rapid drags)
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => renderFilter(val));
});

// ──────────────────────────────────────────────────────
// Event: Preset buttons
// ──────────────────────────────────────────────────────

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    setIntensity(parseFloat(btn.dataset.value));
  });
});

// ──────────────────────────────────────────────────────
// Event: Reset
// ──────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  setIntensity(0);
  if (originalImageData) ctx.putImageData(originalImageData, 0, 0);
});

// ──────────────────────────────────────────────────────
// Event: Save
// ──────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const ts   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const link = document.createElement('a');
  link.download = `tealgrade_${ts}.png`;
  link.href = mainCanvas.toDataURL('image/png');
  link.click();
  showToast('画像を保存しました ✓');
});

// ──────────────────────────────────────────────────────
// Event: New image
// ──────────────────────────────────────────────────────

newImageBtn.addEventListener('click', () => {
  originalImageData = null;
  mainCanvas.width  = 1;
  mainCanvas.height = 1;
  fileInput.value   = '';

  canvasWrapper.hidden = true;
  controls.hidden      = true;
  uploadZone.hidden    = false;
});

// ──────────────────────────────────────────────────────
// Event: File input
// ──────────────────────────────────────────────────────

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadImage(fileInput.files[0]);
});

// ──────────────────────────────────────────────────────
// Drag & Drop
// ──────────────────────────────────────────────────────

uploadZone.addEventListener('dragenter', (e) => { e.preventDefault(); });

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', (e) => {
  if (!uploadZone.contains(e.relatedTarget)) {
    uploadZone.classList.remove('drag-over');
  }
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadImage(file);
});

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

// ──────────────────────────────────────────────────────
// Toast
// ──────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
