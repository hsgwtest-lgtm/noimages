# ◈ TealGrade

> Cinematic shadow-teal color grade filter · PWA · iOS Safari compatible

A Progressive Web App that applies a **cinematic teal color grade** to your photos — fully client-side using the HTML5 Canvas API, with no uploads to any server.

---

## Filter Analysis

The filter reproduces a **shadow-lift teal grade** commonly used in cinematic photography:

| Zone | Luminance | ΔR | ΔG | ΔB | Effect |
|---|---|---|---|---|---|
| Shadows | 0 – 0.4 | −42 | +12 | +52 | Strong teal/cyan injection |
| Midtones | 0.4 – 0.6 | −30 | +4 | +28 | Cool cast on neutral tones |
| Highlights | 0.6 – 1.0 | −8 | +2 | +10 | Subtle cool tint |

Values are linearly scaled by `intensity / 12` and blended via smooth luminance-based zone weights.

---

## Files

```
teal-grade/
├── index.html          ← App shell
├── styles.css          ← UI (dark editorial, teal accents)
├── script.js           ← Filter logic + PWA behaviour
├── manifest.json       ← PWA manifest
├── sw.js               ← Service worker (offline support)
├── icon-192.png        ← App icon (generated)
├── icon-512.png        ← App icon (generated)
└── generate-icons.py   ← Icon generator (run once, stdlib only)
```

---

## Setup

### 1. Generate icons (if not already present)

```bash
python3 generate-icons.py
```

### 2. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "init: TealGrade PWA"
gh repo create teal-grade --public --push --source=.
# Enable GitHub Pages → Settings → Pages → Branch: main / root
```

Your app will be live at `https://<username>.github.io/teal-grade/`

---

## Add to Home Screen (iOS Safari)

1. Open the GitHub Pages URL in Safari
2. Tap the Share button → **"ホーム画面に追加"**
3. The app runs fullscreen, offline-capable

---

## Usage

| Action | Description |
|---|---|
| 画像を選択 / ドロップ | Upload a photo (PNG, JPG, WEBP) |
| TEAL INTENSITY slider | Adjust filter from 0 (off) to 12 (max) |
| Preset buttons | Jump to 0 / 4 / 8 / MAX |
| 保存 | Download the filtered image as PNG |
| リセット | Return slider to 0 |
| ← 別の画像を選択 | Load a new photo |

---

## Technical Notes

- **Canvas 2D API** — no WebGL dependency, works on all modern browsers
- **LUT-based rendering** — 3×256 Float32Arrays precomputed per slider change; inner loop is a single table lookup + branch-free clamp
- **`willReadFrequently: true`** — hint to browser for optimized `getImageData` path
- **Original pixels preserved** — reapplied fresh on every slider event; no cumulative rounding error
- **Max dimension: 2048px** — auto-downscales very large images for Safari performance
