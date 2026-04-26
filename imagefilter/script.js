/**
 * TealGrade · script.js
 *
 * Multi-filter image grading PWA.
 * Filters are defined in the FILTERS array — add new entries to extend the UI.
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
// Filter definitions
// Add new filters here — the UI is built automatically.
// Each filter must implement apply(imageData, value): ImageData.
// ──────────────────────────────────────────────────────

/**
 * Build per-luminance color delta LUTs for the teal grade filter.
 * @param {number} intensity 0–12
 */
function buildTealLUT(intensity) {
  const t  = intensity / 12;
  const dR = new Float32Array(256);
  const dG = new Float32Array(256);
  const dB = new Float32Array(256);

  for (let li = 0; li < 256; li++) {
    const lum     = li / 255;
    const shadowW = Math.max(0, 1 - lum * 2.5);
    const highW   = Math.max(0, lum * 2.5 - 1.5);
    const midW    = Math.max(0, 1 - shadowW - highW);

    dR[li] = (shadowW * -42 + midW * -30 + highW *  -8) * t;
    dG[li] = (shadowW *  12 + midW *   4 + highW *   2) * t;
    dB[li] = (shadowW *  52 + midW *  28 + highW *  10) * t;
  }

  return { dR, dG, dB };
}

const FILTERS = [
  {
    id:           'teal',
    name:         'TEAL GRADE',
    paramLabel:   'TEAL INTENSITY',
    min:          0,
    max:          12,
    step:         0.1,
    defaultValue: 0,
    presets: [
      { label: 'OFF', value: 0  },
      { label: '4',   value: 4  },
      { label: '8',   value: 8  },
      { label: 'MAX', value: 12 },
    ],
    apply(imageData, intensity) {
      if (intensity === 0) return imageData;
      const { dR, dG, dB } = buildTealLUT(intensity);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r  = data[i], g = data[i + 1], b = data[i + 2];
        const li = (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.5) | 0;
        data[i]     = r + dR[li] > 255 ? 255 : r + dR[li] < 0 ? 0 : (r + dR[li] + 0.5) | 0;
        data[i + 1] = g + dG[li] > 255 ? 255 : g + dG[li] < 0 ? 0 : (g + dG[li] + 0.5) | 0;
        data[i + 2] = b + dB[li] > 255 ? 255 : b + dB[li] < 0 ? 0 : (b + dB[li] + 0.5) | 0;
      }
      return imageData;
    },
  },
  // ── Add new filters below ──────────────────────────
  // {
  //   id: 'sepia',
  //   name: 'SEPIA',
  //   paramLabel: 'SEPIA INTENSITY',
  //   min: 0, max: 10, step: 0.1, defaultValue: 0,
  //   presets: [{ label: 'OFF', value: 0 }, { label: 'MAX', value: 10 }],
  //   apply(imageData, value) { /* ... */ return imageData; },
  // },
];

// ──────────────────────────────────────────────────────
// DOM references
// ──────────────────────────────────────────────────────
const uploadZone        = document.getElementById('uploadZone');
const canvasWrapper     = document.getElementById('canvasWrapper');
const controls          = document.getElementById('controls');
const fileInput         = document.getElementById('fileInput');
const mainCanvas        = document.getElementById('mainCanvas');
const ctx               = mainCanvas.getContext('2d', { willReadFrequently: true });
const processingOverlay = document.getElementById('processingOverlay');
const saveBtn           = document.getElementById('saveBtn');
const resetBtn          = document.getElementById('resetBtn');
const newImageBtn       = document.getElementById('newImageBtn');
const filterTabsEl      = document.getElementById('filterTabs');
const paramLabelEl      = document.getElementById('paramLabel');
const intensitySlider   = document.getElementById('intensitySlider');
const intensityDisplay  = document.getElementById('intensityDisplay');
const presetRowEl       = document.getElementById('presetRow');
const sliderTicksEl     = document.getElementById('sliderTicks');
const toast             = document.getElementById('toast');

// ──────────────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────────────
let originalImageData = null;
let rafId             = null;
let activeFilterIndex = 0;
let filterValues      = FILTERS.map(f => f.defaultValue); // one value per filter

// ──────────────────────────────────────────────────────
// Build filter-selector tabs
// ──────────────────────────────────────────────────────
function buildFilterTabs() {
  filterTabsEl.innerHTML = '';
  FILTERS.forEach((filter, idx) => {
    const btn = document.createElement('button');
    btn.className   = 'filter-tab';
    btn.textContent = filter.name;
    btn.setAttribute('aria-pressed', idx === activeFilterIndex ? 'true' : 'false');
    btn.addEventListener('click', () => selectFilter(idx));
    filterTabsEl.appendChild(btn);
  });
}

function selectFilter(idx) {
  activeFilterIndex = idx;
  const filter = FILTERS[idx];

  // Update tab active states
  filterTabsEl.querySelectorAll('.filter-tab').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
    btn.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
  });

  // Update slider for this filter's range
  paramLabelEl.textContent      = filter.paramLabel;
  intensitySlider.min           = filter.min;
  intensitySlider.max           = filter.max;
  intensitySlider.step          = filter.step;
  intensitySlider.setAttribute('aria-valuemin', filter.min);
  intensitySlider.setAttribute('aria-valuemax', filter.max);

  // Update slider ticks
  const tickCount = 5;
  sliderTicksEl.innerHTML = '';
  for (let i = 0; i < tickCount; i++) {
    const span = document.createElement('span');
    const v = filter.min + (filter.max - filter.min) * (i / (tickCount - 1));
    span.textContent = Number.isInteger(v) ? String(v) : v.toFixed(1);
    sliderTicksEl.appendChild(span);
  }

  // Rebuild preset buttons
  presetRowEl.innerHTML = '';
  filter.presets.forEach(preset => {
    const btn = document.createElement('button');
    btn.className          = 'preset-btn';
    btn.textContent        = preset.label;
    btn.dataset.value      = preset.value;
    btn.addEventListener('click', () => setValue(preset.value));
    presetRowEl.appendChild(btn);
  });

  // Restore saved value for this filter
  setValue(filterValues[idx]);
}

// ──────────────────────────────────────────────────────
// Render pipeline
// ──────────────────────────────────────────────────────
function renderAll() {
  if (!originalImageData) return;

  const filtered = new ImageData(
    new Uint8ClampedArray(originalImageData.data),
    originalImageData.width,
    originalImageData.height
  );

  // Apply every filter in order with its stored value
  FILTERS.forEach((filter, idx) => {
    filter.apply(filtered, filterValues[idx]);
  });

  ctx.putImageData(filtered, 0, 0);
}

// ──────────────────────────────────────────────────────
// Value helpers
// ──────────────────────────────────────────────────────
function setValue(val) {
  const filter = FILTERS[activeFilterIndex];
  val = Math.max(filter.min, Math.min(filter.max, val));
  filterValues[activeFilterIndex] = val;

  intensitySlider.value = val;
  updateSliderUI(val);
  renderAll();
}

function updateSliderUI(val) {
  const filter = FILTERS[activeFilterIndex];
  const range  = filter.max - filter.min;
  const pct    = ((val - filter.min) / range) * 100;
  intensitySlider.style.setProperty('--fill', pct + '%');

  const display = Number.isInteger(val) ? String(val) : val.toFixed(1);
  intensityDisplay.textContent = display;
  intensitySlider.setAttribute('aria-valuenow', display);

  presetRowEl.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.value) === val);
  });
}

// ──────────────────────────────────────────────────────
// Image loading
// ──────────────────────────────────────────────────────
const MAX_DIMENSION = 2048;

function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('画像ファイルを選択してください');
    return;
  }

  const url = URL.createObjectURL(file);
  const img  = new Image();

  img.onload = () => {
    URL.revokeObjectURL(url);

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

    originalImageData = ctx.getImageData(0, 0, w, h);

    // Reset all filter values to their defaults
    filterValues = FILTERS.map(f => f.defaultValue);
    selectFilter(0);

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
// Event: Slider
// ──────────────────────────────────────────────────────
intensitySlider.addEventListener('input', () => {
  const val = parseFloat(intensitySlider.value);
  filterValues[activeFilterIndex] = val;
  updateSliderUI(val);

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => renderAll());
});

// ──────────────────────────────────────────────────────
// Event: Reset
// ──────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  setValue(FILTERS[activeFilterIndex].defaultValue);
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

// Open file picker on upload zone click.
// Ignore clicks that originate from the file-picker label itself
// to avoid opening the dialog twice (label native + programmatic).
uploadZone.addEventListener('click', (e) => {
  if (e.target.closest('label')) return;
  fileInput.click();
});

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

// ──────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────
buildFilterTabs();
