// Photo tool: resize/crop an image to an exact pixel size and file-size limit
// (visa / passport / ID photos, form uploads). Runs fully on the device.
/* exported PhotoTool */
const PhotoTool = (() => {
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const MAX_SRC = 5000; // cap the working copy of huge photos (memory on phones)

  // Commonly published requirements. Always double-check the official site.
  const PRESETS = [
    { id: 'us-visa', label: 'US visa / passport — online (600×600 px, max 240 KB)', w: 600, h: 600, maxKB: 240, fmt: 'jpg', guide: 'square' },
    { id: 'india-evisa', label: 'India e-Visa (square 600×600 px, 10 KB – 1 MB)', w: 600, h: 600, minKB: 10, maxKB: 1000, fmt: 'jpg', guide: 'square' },
    { id: 'china-visa', label: 'China visa — online (354×472 px, 40–120 KB)', w: 354, h: 472, minKB: 40, maxKB: 120, fmt: 'jpg', guide: 'tall' },
    { id: 'print-35x45', label: 'Print 35×45 mm (UK, EU / Schengen, Australia, Pakistan …)', mm: [35, 45], dpi: 300, fmt: 'jpg', guide: 'tall', print: true },
    { id: 'print-2x2', label: 'Print 2×2 in / 51×51 mm (US, India …)', inch: [2, 2], dpi: 300, fmt: 'jpg', guide: 'square', print: true },
    { id: 'custom', label: 'Custom size…' },
  ];

  let s = null; // current editor state

  const $ = (sel) => s.root.querySelector(sel);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtKB = (b) => b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(2)} MB`;
  const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  // ---------- loading ----------
  async function loadSource(file, engine) {
    let blob = file;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let img;
    try {
      img = await decode(blob);
    } catch (e) {
      // iPhone HEIC / TIFF: the desktop engine converts it to JPG first (Safari can usually decode HEIC itself)
      if (engine && engine.tools.includes('to-jpg') && ['heic', 'heif', 'tif', 'tiff'].includes(ext)) {
        const fd = new FormData();
        fd.append('files', file, file.name);
        const r = await fetch('api/convert/to-jpg', { method: 'POST', body: fd });
        if (!r.ok) throw new Error('Could not read this photo.');
        img = await decode(await r.blob());
      } else {
        throw new Error(`This browser can't open ${file.name}. Use JPG/PNG, or the desktop app for HEIC/TIFF.`);
      }
    }
    const k = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height); // EXIF rotation is applied by the browser
    return c;
  }
  async function decode(blob) {
    const url = URL.createObjectURL(blob);
    try {
      // onload rather than img.decode(): decode() can stall in webviews that aren't painting
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = url; });
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  // ---------- target size ----------
  function target() {
    const p = PRESETS.find(x => x.id === s.preset);
    if (p.id !== 'custom') {
      const dpi = p.dpi || 300;
      const [w, h] = p.mm ? p.mm.map(v => Math.round(v / 25.4 * dpi)) : p.inch ? p.inch.map(v => Math.round(v * dpi)) : [p.w, p.h];
      return { w, h, dpi, maxKB: p.maxKB, minKB: p.minKB, fmt: p.fmt, mode: 'crop', guide: p.guide, print: !!p.print,
        physical: p.mm ? `${p.mm[0]}×${p.mm[1]} mm` : p.inch ? `${p.inch[0]}×${p.inch[1]} in` : null };
    }
    const c = s.custom;
    const unit = c.unit, dpi = +c.dpi || 300;
    const toPx = (v) => unit === 'px' ? Math.round(v) : unit === 'mm' ? Math.round(v / 25.4 * dpi) : Math.round(v * dpi);
    let w = +c.w > 0 ? toPx(+c.w) : 0, h = +c.h > 0 ? toPx(+c.h) : 0;
    const W = s.src.width, H = s.src.height;
    let mode = c.mode;
    if (!w && !h) { w = W; h = H; mode = 'keep'; }
    else if (!h) { h = Math.round(w * H / W); mode = 'keep'; }   // one side given: keep proportions
    else if (!w) { w = Math.round(h * W / H); mode = 'keep'; }
    w = clamp(w, 1, 12000); h = clamp(h, 1, 12000);
    return { w, h, dpi, maxKB: +c.maxKB || null, minKB: null, fmt: c.fmt, mode, guide: null, print: unit !== 'px',
      physical: unit !== 'px' && c.w && c.h ? `${c.w}×${c.h} ${unit}` : null };
  }

  // ---------- view (pan / zoom) ----------
  // Size of the crop frame on screen. While the panel is hidden it measures 0×0; dividing by that
  // used to turn the crop position into NaN and export a blank white photo, so fall back to the
  // last real size instead.
  function frameSize() {
    const r = $('.ph-stage').getBoundingClientRect();
    if (r.width > 0 && r.height > 0) s.frame = { fw: r.width, fh: r.height };
    return s.frame || { fw: 1, fh: s.t ? s.t.h / s.t.w : 1 };
  }
  function baseScale(fw, fh, t) {
    const W = s.src.width, H = s.src.height;
    return t.mode === 'crop' ? Math.max(fw / W, fh / H) : Math.min(fw / W, fh / H);
  }
  function clampView(t) {
    if (t.mode !== 'crop') { s.z = 1; s.cx = s.src.width / 2; s.cy = s.src.height / 2; return; }
    const { fw, fh } = frameSize();
    const k = baseScale(fw, fh, t) * s.z;
    const cw = fw / k, ch = fh / k;
    if (!Number.isFinite(s.cx) || !Number.isFinite(s.cy) || !Number.isFinite(s.z)) { s.z = 1; s.cx = s.src.width / 2; s.cy = s.src.height / 2; }
    s.cx = clamp(s.cx, cw / 2, s.src.width - cw / 2);
    s.cy = clamp(s.cy, ch / 2, s.src.height - ch / 2);
  }
  function paint() {
    const t = s.t;
    clampView(t);
    const { fw, fh } = frameSize();
    const k = baseScale(fw, fh, t) * s.z;
    s.src.style.transform = `translate(${fw / 2 - s.cx * k}px, ${fh / 2 - s.cy * k}px) scale(${k})`;
    $('.ph-zoom input').value = s.z;
  }
  // crop rectangle in source pixels
  function cropRect(t) {
    const { fw, fh } = frameSize();
    const k = baseScale(fw, fh, t) * s.z;
    return { sx: s.cx - fw / 2 / k, sy: s.cy - fh / 2 / k, sw: fw / k, sh: fh / k };
  }

  // ---------- rendering + encoding ----------
  // high-quality downscale: halve repeatedly, then a final resize
  function drawScaled(src, sx, sy, sw, sh, outW, outH) {
    let cur = src, cx = sx, cy = sy, cw = sw, ch = sh;
    while (cw / outW > 2 && ch / outH > 2) {
      const t = document.createElement('canvas');
      t.width = Math.max(1, Math.round(cw / 2)); t.height = Math.max(1, Math.round(ch / 2));
      const g = t.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(cur, cx, cy, cw, ch, 0, 0, t.width, t.height);
      cur = t; cx = 0; cy = 0; cw = t.width; ch = t.height;
    }
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const g = out.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, outW, outH);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, cx, cy, cw, ch, 0, 0, outW, outH);
    return out;
  }

  function renderOutput(t) {
    const W = s.src.width, H = s.src.height;
    if (t.mode === 'crop') {
      const r = cropRect(t);
      return { canvas: drawScaled(s.src, r.sx, r.sy, r.sw, r.sh, t.w, t.h), upscale: Math.max(t.w / r.sw, t.h / r.sh) };
    }
    if (t.mode === 'keep') return { canvas: drawScaled(s.src, 0, 0, W, H, t.w, t.h), upscale: t.w / W };
    // fit whole image inside, white border
    const k = Math.min(t.w / W, t.h / H), dw = Math.round(W * k), dh = Math.round(H * k);
    const inner = drawScaled(s.src, 0, 0, W, H, dw, dh);
    const out = document.createElement('canvas');
    out.width = t.w; out.height = t.h;
    const g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, t.w, t.h);
    g.drawImage(inner, Math.round((t.w - dw) / 2), Math.round((t.h - dh) / 2));
    return { canvas: out, upscale: k };
  }

  const toBlob = (c, mime, q) => new Promise(r => c.toBlob(r, mime, q));

  // Best quality that fits under maxKB (binary search on JPEG/WebP quality)
  async function encode(canvas, t) {
    const mime = MIME[t.fmt] || 'image/jpeg';
    if (t.fmt === 'png') return { blob: await toBlob(canvas, mime), q: null };
    const max = t.maxKB ? t.maxKB * 1024 : Infinity;
    let best = await toBlob(canvas, mime, 0.92), q = 0.92;
    if (best.size > max) {
      let lo = 0.2, hi = 0.92; best = null;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        const b = await toBlob(canvas, mime, mid);
        if (b.size <= max) { best = b; q = mid; lo = mid; } else hi = mid;
      }
      if (!best) { best = await toBlob(canvas, mime, 0.2); q = 0.2; }
    } else if (t.minKB && best.size < t.minKB * 1024) {
      // some portals (e.g. China) set a minimum file size: raise quality before giving up
      for (const hq of [0.97, 1]) {
        const b = await toBlob(canvas, mime, hq);
        if (b.size <= max) { best = b; q = hq; }
        if (b.size >= t.minKB * 1024) break;
      }
    }
    if (t.fmt === 'jpg') best = await setJpegDpi(best, t.dpi);
    return { blob: best, q };
  }

  // write the DPI into the JPEG header so it prints at the right physical size
  async function setJpegDpi(blob, dpi) {
    const b = new Uint8Array(await blob.arrayBuffer());
    if (b[0] !== 0xFF || b[1] !== 0xD8) return blob;
    const isJfif = b[2] === 0xFF && b[3] === 0xE0 && String.fromCharCode(...b.slice(6, 11)) === 'JFIF\0';
    if (isJfif) {
      b[13] = 1; b[14] = dpi >> 8; b[15] = dpi & 255; b[16] = dpi >> 8; b[17] = dpi & 255;
      return new Blob([b], { type: 'image/jpeg' });
    }
    const app0 = new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
    return new Blob([b.slice(0, 2), app0, b.slice(2)], { type: 'image/jpeg' });
  }

  // 4×6 in print sheet (300 DPI) with as many copies as fit, plus light cut lines
  async function makeSheet(photo, t) {
    const SW = 1200, SH = 1800;
    const pw = Math.round(t.w * 300 / t.dpi), ph = Math.round(t.h * 300 / t.dpi);
    const fit = (margin, gap) => {
      const cols = Math.max(1, Math.floor((SW - 2 * margin + gap) / (pw + gap)));
      const rows = Math.max(1, Math.floor((SH - 2 * margin + gap) / (ph + gap)));
      return { cols, rows, gap };
    };
    // comfortable spacing for cutting, unless edge-to-edge fits more copies (2×2 in → 6 on 4×6 in)
    const roomy = fit(36, 24), tight = fit(0, 0);
    const { cols, rows, gap } = tight.cols * tight.rows > roomy.cols * roomy.rows ? tight : roomy;
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, SW, SH);
    const ox = Math.round((SW - (cols * pw + (cols - 1) * gap)) / 2), oy = Math.round((SH - (rows * ph + (rows - 1) * gap)) / 2);
    g.strokeStyle = '#c8c8c8'; g.lineWidth = 1;
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const x = ox + col * (pw + gap), y = oy + r * (ph + gap);
      g.drawImage(photo, x, y, pw, ph);
      g.strokeRect(x - 0.5, y - 0.5, pw + 1, ph + 1);
    }
    const blob = await setJpegDpi(await toBlob(c, 'image/jpeg', 0.95), 300);
    return { blob, count: rows * cols };
  }

  // ---------- live checklist ----------
  let encodeTimer = 0, encodeSeq = 0;
  function scheduleCheck(delay = 180) {
    clearTimeout(encodeTimer);
    encodeTimer = setTimeout(runCheck, delay);
  }
  async function runCheck() {
    const seq = ++encodeSeq;
    const t = s.t;
    const { canvas, upscale } = renderOutput(t);
    const { blob, q } = await encode(canvas, t);
    if (seq !== encodeSeq) return; // a newer change superseded this one
    s.last = { canvas, blob, t };
    const items = [];
    items.push([true, `${t.w} × ${t.h} px${t.physical ? ` (${t.physical} at ${t.dpi} DPI)` : ''}`]);
    const kb = blob.size / 1024;
    if (t.maxKB && kb > t.maxKB) items.push([false, `${fmtKB(blob.size)} — still over the ${t.maxKB} KB limit even at low quality. Choose a smaller size.`]);
    else if (t.minKB && kb < t.minKB) items.push([false, `${fmtKB(blob.size)} — under the ${t.minKB} KB minimum even at top quality. This photo has too little detail; use the original camera photo, not a screenshot or compressed copy.`]);
    else items.push([true, `${fmtKB(blob.size)}${t.maxKB ? ` (limit ${t.minKB ? t.minKB + '–' : ''}${t.maxKB} KB)` : ''}${q && q < 0.9 ? ` · quality ${Math.round(q * 100)}%` : ''}`]);
    items.push([true, `${t.fmt.toUpperCase()} file`]);
    if (upscale > 1.15) items.push([false, `Photo is being enlarged ${upscale.toFixed(1)}× — it may look blurry. Zoom out or use a larger photo.`]);
    $('.ph-checks').innerHTML = items.map(([ok, txt]) =>
      `<li class="${ok ? 'ok' : 'bad'}"><span aria-hidden="true">${ok ? '✓' : '!'}</span>${txt.replace(/</g, '&lt;')}</li>`).join('');
  }

  // ---------- UI ----------
  function guideSvg(kind) {
    if (!kind) return '';
    // head-size guides: ~50–69 % of the height for 2×2 in, ~70–80 % for 35×45 mm
    const [ry, cy] = kind === 'square' ? [29, 46] : [35, 46];
    return `<svg class="ph-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <ellipse cx="50" cy="${cy}" rx="${ry * 0.74}" ry="${ry}" />
      <line x1="25" x2="75" y1="${cy - ry * 0.12}" y2="${cy - ry * 0.12}" /></svg>`;
  }

  function customFields() {
    const c = s.custom;
    const opt = (v, cur, label = v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    return `
      <div class="ph-row">
        <label>Width<input data-c="w" inputmode="decimal" value="${c.w}" placeholder="auto"></label>
        <label>Height<input data-c="h" inputmode="decimal" value="${c.h}" placeholder="auto"></label>
        <label>Unit<select data-c="unit">${opt('px', c.unit)}${opt('mm', c.unit)}${opt('in', c.unit, 'inches')}</select></label>
        <label class="${c.unit === 'px' ? 'dim' : ''}">DPI<input data-c="dpi" inputmode="numeric" value="${c.dpi}"></label>
        <label>Max file size (KB)<input data-c="maxKB" inputmode="numeric" value="${c.maxKB}" placeholder="no limit"></label>
        <label>Format<select data-c="fmt">${opt('jpg', c.fmt, 'JPG')}${opt('png', c.fmt, 'PNG')}${opt('webp', c.fmt, 'WebP')}</select></label>
      </div>
      <label>When the shape differs<select data-c="mode">${opt('crop', c.mode, 'Crop to fill (drag to position)')}${opt('fit', c.mode, 'Keep whole photo, add white border')}</select></label>
      <p class="ph-hint">Fill in only the width or only the height to keep the photo's proportions.</p>`;
  }

  function build() {
    s.root.innerHTML = `
      <label>Requirement<select class="ph-preset">${PRESETS.map(p => `<option value="${p.id}"${p.id === s.preset ? ' selected' : ''}>${p.label}</option>`).join('')}</select></label>
      <div class="ph-custom"></div>
      <div class="ph-stage" tabindex="0" aria-label="Photo crop area. Drag or use arrow keys to move, plus and minus to zoom."></div>
      <div class="ph-zoom">
        <button type="button" class="btn small" data-z="-1" aria-label="Zoom out">−</button>
        <input type="range" min="1" max="6" step="0.01" aria-label="Zoom">
        <button type="button" class="btn small" data-z="1" aria-label="Zoom in">+</button>
        <button type="button" class="btn small" data-rot aria-label="Rotate 90 degrees">⟳</button>
      </div>
      <p class="ph-hint ph-tip"></p>
      <label class="ph-check"><input type="checkbox" class="ph-sheet"> Also make a 4×6 in print sheet (several copies to print at a photo shop)</label>
      <ul class="ph-checks" aria-live="polite"></ul>`;
    $('.ph-stage').appendChild(s.src);
    s.src.className = 'ph-src';
    wire();
    applyTarget(true);
  }

  function applyTarget(resetView) {
    s.t = target();
    const t = s.t;
    $('.ph-custom').innerHTML = s.preset === 'custom' ? customFields() : '';
    const stage = $('.ph-stage');
    stage.style.aspectRatio = `${t.w} / ${t.h}`;
    s.ratio = t.h / t.w;
    sizeStage();
    stage.classList.toggle('pannable', t.mode === 'crop');
    stage.querySelector('.ph-guide')?.remove();
    stage.insertAdjacentHTML('beforeend', guideSvg(t.guide));
    $('.ph-zoom').hidden = t.mode !== 'crop';
    $('.ph-tip').textContent = t.mode === 'crop'
      ? (t.guide ? 'Drag to position, pinch or scroll to zoom. Fit the head inside the oval, eyes near the line.' : 'Drag to position, pinch or scroll to zoom.')
      : 'The whole photo is kept.';
    $('.ph-check').hidden = !t.print;
    if (resetView) { s.z = 1; s.cx = s.src.width / 2; s.cy = s.src.height / 2; }
    requestAnimationFrame(() => { paint(); scheduleCheck(0); });
  }

  // older Android WebViews (Chrome < 88) lack aspect-ratio: size the crop frame from its width instead
  const hasAspect = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('aspect-ratio', '1 / 1');
  function sizeStage() {
    if (hasAspect || !s) return;
    const stage = $('.ph-stage');
    stage.style.height = `${Math.round(stage.getBoundingClientRect().width * s.ratio)}px`;
  }

  function wire() {
    const stage = $('.ph-stage');
    $('.ph-preset').addEventListener('change', (e) => { s.preset = e.target.value; applyTarget(true); });
    $('.ph-custom').addEventListener('change', (e) => {
      const k = e.target.dataset.c; if (!k) return;
      s.custom[k] = e.target.value;
      applyTarget(k === 'w' || k === 'h' || k === 'mode' || k === 'unit');
    });
    $('.ph-zoom').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.z) { s.z = clamp(s.z * (b.dataset.z > 0 ? 1.15 : 1 / 1.15), 1, 6); paint(); scheduleCheck(); }
      if (b.hasAttribute('data-rot')) rotate();
    });
    $('.ph-zoom input').addEventListener('input', (e) => { s.z = +e.target.value; paint(); scheduleCheck(); });

    // drag (1 finger / mouse) and pinch (2 fingers) — tracks the pointer 1:1, no easing while dragging
    const pts = new Map();
    let pinch0 = 0, z0 = 1;
    stage.addEventListener('pointerdown', (e) => {
      if (s.t.mode !== 'crop') return;
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); z0 = s.z; }
      stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const { fw, fh } = frameSize();
      const k = baseScale(fw, fh, s.t) * s.z;
      if (pts.size === 1) { s.cx -= (e.clientX - p.x) / k; s.cy -= (e.clientY - p.y) / k; }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; s.z = clamp(z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch0, 1, 6); }
      paint();
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (!pts.size) { stage.classList.remove('dragging'); scheduleCheck(); }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (e) => {
      if (s.t.mode !== 'crop') return;
      e.preventDefault();
      s.z = clamp(s.z * Math.exp(-e.deltaY * 0.0015), 1, 6); paint(); scheduleCheck(250);
    }, { passive: false });
    stage.addEventListener('keydown', (e) => {
      if (s.t.mode !== 'crop') return;
      const step = 0.02 * Math.min(s.src.width, s.src.height) / s.z;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) { s.cx += moves[e.key][0]; s.cy += moves[e.key][1]; }
      else if (e.key === '+' || e.key === '=') s.z = clamp(s.z * 1.1, 1, 6);
      else if (e.key === '-') s.z = clamp(s.z / 1.1, 1, 6);
      else return;
      e.preventDefault(); paint(); scheduleCheck();
    });
    s.ro = new ResizeObserver(() => { sizeStage(); paint(); });
    s.ro.observe(stage);
  }

  function rotate() {
    const c = document.createElement('canvas');
    c.width = s.src.height; c.height = s.src.width;
    const g = c.getContext('2d');
    g.translate(c.width, 0); g.rotate(Math.PI / 2);
    g.drawImage(s.src, 0, 0);
    c.className = 'ph-src';
    s.src.replaceWith(c);
    s.src = c;
    c.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT });
    applyTarget(true);
  }

  // ---------- public ----------
  async function mount(root, file, engine) {
    if (s && s.ro) s.ro.disconnect();
    root.innerHTML = '<p class="ph-hint">Opening photo…</p>';
    const src = await loadSource(file, engine);
    s = {
      root, file, src, preset: s?.preset || 'us-visa', z: 1, cx: 0, cy: 0, t: null, last: null,
      custom: s?.custom || { w: '', h: '', unit: 'px', dpi: '300', maxKB: '', fmt: 'jpg', mode: 'crop' },
    };
    build();
  }

  async function exportFiles() {
    if (!s) throw new Error('Open a photo first.');
    clearTimeout(encodeTimer);
    await runCheck();
    const { blob, t, canvas } = s.last;
    const stem = s.file.name.replace(/\.[^.]+$/, '');
    const out = [{ name: `${stem}-${t.w}x${t.h}.${t.fmt}`, blob }];
    if (t.print && $('.ph-sheet').checked) {
      const sheet = await makeSheet(canvas, t);
      out.push({ name: `${stem}-print-sheet-4x6in-${sheet.count}-copies.jpg`, blob: sheet.blob });
    }
    return out;
  }

  return { mount, exportFiles, PRESETS, _state: () => s };
})();
