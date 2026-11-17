/* global TOOLS, NOT_SUPPORTED, BrowserEngine */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { files: [], engine: null, toolId: null, results: [], wheelSig: null };
  const WHEEL_GROUPS = ['Convert to PDF', 'Convert from PDF', 'Office formats', 'Images'];
  const IDLE_FORMATS = ['PDF', 'DOCX', 'XLSX', 'PPTX', 'JPG', 'PNG', 'HEIC', 'WEBP'];
  const SVG = 'http://www.w3.org/2000/svg';
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LOCK_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1.5" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
  const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const pr = new Intl.PluralRules('en');
  const plural = (n, one, many = one + 's') => `${n} ${pr.select(n) === 'one' ? one : many}`;
  // file names differ at the end ("report-v12-final.pdf"), so truncate in the middle
  const midTrunc = (s, max) => {
    if (s.length <= max) return s;
    const keep = max - 1, tail = Math.min(12, Math.floor(keep / 2));
    return s.slice(0, keep - tail) + '…' + s.slice(-tail);
  };

  // ---------- desktop engine detection ----------
  async function detectEngine() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const r = await fetch('api/info', { cache: 'no-store' });
        if (r.ok) state.engine = await r.json();
      } catch { /* browser-only */ }
    }
    const m = $('mode');
    if (state.engine) {
      m.className = 'mode glass engine';
      m.textContent = state.engine.libreoffice ? 'Desktop engine · full quality' : 'Desktop engine · no LibreOffice';
      m.title = state.engine.libreoffice ? 'All conversions available.' : 'Install LibreOffice to enable Word/Excel/PowerPoint → PDF.';
    } else {
      m.className = 'mode glass browser';
      m.textContent = 'On-device mode';
      m.title = 'Running without the desktop engine (e.g. on a phone). Some conversions are basic or unavailable.';
    }
  }

  // How can this tool run for the current files? -> {how:'engine'|'browser'|null, quality, reason}
  function plan(tool, files) {
    const exts = files.map(f => extOf(f.name));
    const engineOK = !!(state.engine && state.engine.tools.includes(tool.id) &&
      // Word->Excel from .doc/.odt/.rtf converts through LibreOffice first
      !(tool.id === 'word-to-excel' && !state.engine.libreoffice && exts.some(e => e !== 'docx')));
    // the photo editor reads JPG/PNG/WebP/GIF/BMP itself; HEIC works where the browser decodes it (Safari)
    // or via the desktop engine; TIFF only via the desktop engine
    const editorFrom = tool.editor ? [...tool.browserFrom, 'heic', 'heif', ...(state.engine ? ['tif', 'tiff'] : [])] : null;
    const browserOK = !!(tool.browser && (tool.editor || BrowserEngine.has(tool.id)) &&
      exts.every(e => (editorFrom || tool.browserFrom || tool.from).includes(e)));
    if (engineOK) return { how: 'engine', quality: 'best' };
    if (browserOK) return { how: 'browser', quality: tool.browser };
    let reason;
    if (state.engine && tool.engine && !state.engine.libreoffice) reason = 'needs LibreOffice installed on this computer';
    else if (tool.engine) reason = 'needs the desktop app (Windows / macOS)';
    else reason = 'not possible for this file type here';
    return { how: null, reason };
  }

  function applicableTools() {
    const exts = state.files.map(f => extOf(f.name));
    return TOOLS.filter(t => exts.length && exts.every(e => t.from.includes(e)) && !(t.minFiles && state.files.length < t.minFiles) && !(t.maxFiles && state.files.length > t.maxFiles));
  }

  // Split applicable tools into wheel segments (one per target format) and action pills.
  function layout() {
    const segs = new Map(), pills = [], blocked = [];
    for (const t of applicableTools()) {
      const p = plan(t, state.files);
      if (!p.how) blocked.push({ t, p });
      if (WHEEL_GROUPS.includes(t.group)) {
        const prev = segs.get(t.to);
        if (!prev || (!prev.p.how && p.how)) segs.set(t.to, { t, p });
      } else pills.push({ t, p });
    }
    pills.sort((a, b) => (b.t.featured ? 1 : 0) - (a.t.featured ? 1 : 0));
    return { segs: [...segs.values()], pills, blocked };
  }

  // ---------- wheel ----------
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  function sector(r1, r2, a0, a1) {
    const [x0, y0] = polar(r2, a0), [x1, y1] = polar(r2, a1), [x2, y2] = polar(r1, a1), [x3, y3] = polar(r1, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0},${y0}A${r2},${r2} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r1},${r1} 0 ${large} 0 ${x3},${y3}Z`;
  }
  const el = (tag, attrs) => { const e = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; };

  // Rebuilt only when the set of formats changes (new files) — never on a selection click.
  function renderWheel(segs) {
    const sig = segs.length ? segs.map(s => `${s.t.id}:${s.p.how}:${s.p.quality}`).join('|') : 'idle';
    if (sig === state.wheelSig) return;
    const animate = state.wheelSig !== null; // not on first paint
    state.wheelSig = sig;
    const svg = $('wheel');
    svg.innerHTML = '';
    svg.appendChild(el('circle', { class: 'rim', r: 198 }));
    const items = segs.length ? segs : IDLE_FORMATS.map(f => ({ idle: f }));
    const n = Math.max(items.length, 3);
    const R1 = 100, R2 = 190, start = -Math.PI / 2 - Math.PI / n;
    items.forEach((it, i) => {
      const a0 = start + (i * 2 * Math.PI) / n, a1 = start + ((i + 1) * 2 * Math.PI) / n;
      const g = el('g', { class: 'seg' });
      g.appendChild(el('path', { d: sector(R1, R2, a0 + 0.012, a1 - 0.012) }));
      const [tx, ty] = polar((R1 + R2) / 2, (a0 + a1) / 2);
      const label = el('text', { x: tx, y: ty - (it.idle ? 0 : 6) });
      label.textContent = it.idle || it.t.to.toUpperCase();
      g.appendChild(label);
      if (it.idle) {
        g.classList.add('idle');
        g.setAttribute('aria-hidden', 'true');
      } else {
        g.dataset.tool = it.t.id;
        const title = el('title');
        title.textContent = it.p.how ? it.t.label : `${it.t.label} — ${it.p.reason}`;
        g.appendChild(title);
        if (it.p.how) {
          const sub = el('text', { x: tx, y: ty + 12, class: 'sub' });
          sub.textContent = it.p.quality === 'basic' ? 'basic' : it.p.quality === 'best' ? 'best quality' : 'on-device';
          g.appendChild(sub);
          g.classList.add('live');
          g.setAttribute('tabindex', '0');
          g.setAttribute('role', 'button');
          g.setAttribute('aria-label', `${it.t.label}${it.p.quality === 'basic' ? ' (basic quality)' : ''}`);
        } else {
          // drawn lock + "Desktop only" instead of an emoji (renders the same on every OS)
          const lock = el('g', { class: 'lock', transform: `translate(${tx - 4.5} ${ty + 6})` });
          lock.appendChild(el('rect', { x: 0, y: 3.5, width: 9, height: 6.5, rx: 1.5 }));
          lock.appendChild(el('path', { d: 'M2.3 3.5V2.4a2.2 2.2 0 0 1 4.4 0v1.1' }));
          g.appendChild(lock);
          g.classList.add('off');
          g.setAttribute('role', 'img');
          g.setAttribute('aria-label', `${it.t.label} — unavailable: ${it.p.reason}`);
        }
      }
      svg.appendChild(g);
      // occasional event (new file dropped): quick staggered entrance, opacity-only if reduced motion
      if (animate) {
        g.animate(reducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 260, delay: i * 28 + (i % 2) * 6, easing: EASE_OUT, fill: 'backwards' });
      }
    });
  }

  function syncSelection() {
    document.querySelectorAll('.seg[data-tool]').forEach(g => g.classList.toggle('on', g.dataset.tool === state.toolId));
    document.querySelectorAll('.pill[data-tool]').forEach(p => p.setAttribute('aria-pressed', p.dataset.tool === state.toolId));
  }

  // ---------- rendering ----------
  function render() {
    const { segs, pills, blocked } = layout();
    if (state.toolId && ![...segs, ...pills].some(s => s.t.id === state.toolId && s.p.how)) state.toolId = null;
    renderWheel(state.files.length ? segs : []);

    // hub
    const n = state.files.length;
    const exts = [...new Set(state.files.map(f => extOf(f.name)))];
    const total = state.files.reduce((a, f) => a + f.size, 0);
    $('hub-icon').textContent = n ? exts.slice(0, 2).join('/').toUpperCase() : '';
    const touch = matchMedia('(pointer: coarse)').matches;
    $('hub-text').innerHTML = !n ? (touch ? 'Choose a file<small>tap here</small>' : 'Drop a file<small>or click to browse</small>')
      : n === 1 ? `${esc(midTrunc(state.files[0].name, 26))}<small>${fmtSize(total)} · add more</small>`
        : `${plural(n, 'file')}<small>${fmtSize(total)} · add more</small>`;
    $('hub').title = n === 1 ? state.files[0].name : '';
    $('hub').setAttribute('aria-label', n ? 'Add more files' : 'Browse files');

    const anyUsable = segs.some(s => s.p.how) || pills.some(s => s.p.how);
    $('hint').textContent = !n ? `${touch ? 'Open' : 'Drop'} any PDF, Word, Excel, PowerPoint or image. Files never leave this device.`
      : anyUsable ? 'Pick a format — or drag your file onto one.'
        : `Nothing can convert ${exts.map(e => '.' + e).join(' + ')} files here${n > 1 ? ' together. Try one type at a time' : ''}.`;

    // chips
    $('files').innerHTML = state.files.map((f, i) => `
      <li class="chip" draggable="true" data-index="${i}" title="${esc(f.name)} — drag onto a format to convert">
        <span class="ext">${esc(extOf(f.name))}</span><span class="name">${esc(midTrunc(f.name, 30))}</span>
        ${n > 1 ? `<button data-up="${i}" aria-label="Move ${esc(f.name)} earlier" ${i === 0 ? 'disabled' : ''}>←</button>
          <button data-down="${i}" aria-label="Move ${esc(f.name)} later" ${i === n - 1 ? 'disabled' : ''}>→</button>` : ''}
        <button data-remove="${i}" aria-label="Remove ${esc(f.name)}">✕</button>
      </li>`).join('');

    // action pills (merge, split, compress, …)
    $('actions').innerHTML = pills.map(({ t, p }) =>
      `<button class="pill${p.how ? '' : ' off'}${t.featured ? ' featured' : ''}" data-tool="${t.id}" aria-pressed="false"
        ${p.how ? '' : `aria-disabled="true" title="${esc(p.reason)}"`}>${p.how ? '' : LOCK_SVG}${esc(t.label)}${p.quality === 'basic' ? ' · basic' : ''}</button>`).join('');

    $('unavailable').hidden = !blocked.length;
    $('unavailable-list').innerHTML = blocked.map(({ t, p }) => `<li><b>${esc(t.label)}</b> — ${esc(p.reason)}</li>`).join('');
    $('clear').hidden = !n;
    syncSelection();
    renderPanel();
  }

  function showPanel(show) {
    const panel = $('panel');
    if (show && panel.hidden) {
      panel.hidden = false;
      panel.animate(reducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(8px) scale(0.99)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: EASE_OUT });
    } else if (!show) panel.hidden = true;
  }

  function renderPanel() {
    const tool = TOOLS.find(t => t.id === state.toolId);
    showPanel(!!tool);
    if (!tool) return;
    const p = plan(tool, state.files);
    $('tool-title').textContent = tool.label;
    const b = $('tool-badge');
    b.className = `badge ${p.quality}`;
    b.textContent = p.quality === 'best' ? 'Best quality' : p.quality === 'good' ? 'On-device' : 'Basic quality';
    b.title = p.quality === 'best' ? 'Uses the desktop engine' : 'Runs entirely in this browser';
    const notes = [];
    if (tool.note && (p.how === 'browser' || tool.multi || /You must/.test(tool.note))) notes.push(tool.note);
    if (tool.multi) notes.push(`${plural(state.files.length, 'file')} → 1 ${tool.to.toUpperCase()}.`);
    else if (state.files.length > 1) notes.push(`Each of the ${state.files.length} files is converted separately.`);
    $('tool-note').textContent = notes.join(' ');
    if (tool.editor === 'photo') {
      if (state.editorFor !== state.files[0]) {
        state.editorFor = state.files[0];
        PhotoTool.mount($('options'), state.files[0], state.engine).catch(e => {
          state.editorFor = null; $('options').innerHTML = ''; setStatus(e.message || String(e), true);
        });
      }
      setConvertLabel();
      return;
    }
    state.editorFor = null;
    $('options').innerHTML = (tool.options || []).map(o => o.type === 'select'
      ? `<label>${esc(o.label)}<select data-opt="${o.id}">${o.choices.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>`
      : `<label>${esc(o.label)}<input data-opt="${o.id}" type="${o.type}" value="${esc(o.value || '')}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go"></label>`).join('');
    setConvertLabel();
  }

  function setConvertLabel(busy) {
    const tool = TOOLS.find(t => t.id === state.toolId);
    const btn = $('convert');
    btn.classList.toggle('busy', !!busy);
    btn.disabled = !!busy;
    btn.querySelector('.label').textContent = busy ? 'Converting…'
      : tool && tool.editor ? 'Create photo'
      : `Convert${tool && state.files.length > 1 && !tool.multi ? ` ${state.files.length} files` : ''}`;
  }

  function setStatus(msg, isError) {
    $('status').textContent = msg;
    $('status').className = 'status' + (isError ? ' error' : '');
  }

  function renderResults() {
    const canShare = !!android || !!(navigator.canShare && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    $('results').innerHTML = state.results.map((r, i) => `
      <li><span class="check">${CHECK_SVG}</span><span class="name">${esc(r.name)}</span><span class="size">${fmtSize(r.blob.size)}</span>
        ${android ? `<button class="btn primary small" data-save="${i}">${r.savedUri ? 'Open' : 'Save'}</button>`
          : `<a class="btn primary small" href="${r.url}" download="${esc(r.name)}">Save</a>`}
        ${canShare ? `<button class="btn small" data-share="${i}">Share</button>` : ''}
      </li>`).join('');
    [...$('results').children].forEach((li, i) => li.animate(reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
    { duration: 240, delay: Math.min(i, 6) * 40, easing: EASE_OUT, fill: 'backwards' }));
  }

  // ---------- actions ----------
  function clearResults() {
    state.results.forEach(r => URL.revokeObjectURL(r.url));
    state.results = [];
    renderResults();
    setStatus('');
  }

  // ---------- Android app bridge (only present inside the Android app) ----------
  const android = window.AndroidBridge || null;
  const blobToB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const b64ToFile = (b64, name, type) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type });
  };
  // iPhone HEIC photos: Android decodes them natively, so convert to JPG on arrival
  async function normaliseForAndroid(files) {
    if (!android) return files;
    return Promise.all(files.map(async (f) => {
      if (!['heic', 'heif'].includes(extOf(f.name))) return f;
      const jpg = android.heicToJpeg(await blobToB64(f));
      return jpg ? b64ToFile(jpg, f.name.replace(/\.[^.]+$/, '') + '.jpg', 'image/jpeg') : f;
    }));
  }
  // files sent from other apps via Android's "Share" menu
  window.receiveSharedFiles = (items) => addFiles(items.map(i => b64ToFile(i.b64, i.name, i.type)));

  function addFiles(list) {
    const incoming = [...list].filter(f => f.size > 0);
    if (!incoming.length) return undefined;
    // only HEIC inside the Android app needs an async conversion; everything else is added at once
    if (android && incoming.some(f => ['heic', 'heif'].includes(extOf(f.name)))) {
      return normaliseForAndroid(incoming).then(addConverted);
    }
    return addConverted(incoming);
  }

  function addConverted(incoming) {
    state.files.push(...incoming);
    state.toolId = null;
    clearResults();
    render();
  }

  function selectTool(id, { autoConvert } = {}) {
    const tool = TOOLS.find(t => t.id === id);
    if (!tool || !plan(tool, state.files).how) return;
    const changed = state.toolId !== id;
    state.toolId = id;
    if (changed) clearResults();
    syncSelection();
    renderPanel();
    $('panel').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    // dragging a file onto a format converts straight away, unless the tool needs typed input
    const needsInput = (tool.options || []).some(o => o.type !== 'select' && !o.value && o.id !== 'password' && o.id !== 'ranges');
    if (autoConvert && !needsInput) convert();
    else if (needsInput) $('options').querySelector('input')?.focus({ preventScroll: true });
  }

  async function runEngine(tool, files, opts) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f, f.name));
    Object.entries(opts).forEach(([k, v]) => fd.append(k, v));
    const r = await fetch(`api/convert/${tool.id}`, { method: 'POST', body: fd });
    if (!r.ok) {
      let msg = `Conversion failed (${r.status}).`;
      try { msg = (await r.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const name = decodeURIComponent(r.headers.get('X-Filename') || `converted.${tool.to}`);
    return [{ name, blob: await r.blob() }];
  }

  async function convert() {
    const tool = TOOLS.find(t => t.id === state.toolId);
    if (!tool || $('convert').disabled) return;
    const p = plan(tool, state.files);
    const opts = {};
    document.querySelectorAll('[data-opt]').forEach(e => { if (e.value !== '') opts[e.dataset.opt] = e.value; });
    setConvertLabel(true);
    const started = performance.now();
    try {
      let results = [];
      const run = (files) => p.how === 'engine' ? runEngine(tool, files, opts) : BrowserEngine.run(tool.id, files, opts);
      if (tool.editor === 'photo') {
        setStatus('Creating photo…');
        results = await PhotoTool.exportFiles();
      } else if (tool.multi) {
        setStatus(`Working on ${plural(state.files.length, 'file')}…`);
        results = await run(state.files);
      } else {
        for (let i = 0; i < state.files.length; i++) {
          const f = state.files[i];
          setStatus(state.files.length > 1 ? `File ${i + 1} of ${state.files.length}: ${midTrunc(f.name, 40)}` : midTrunc(f.name, 48));
          results.push(...await run([f]));
        }
      }
      clearResults();
      state.results = results.map(r => ({ ...r, url: URL.createObjectURL(r.blob) }));
      renderResults();
      const secs = (performance.now() - started) / 1000;
      setStatus(`Done${secs >= 0.1 ? ` in ${secs.toFixed(1)} s` : ""}. Press Save to keep the file.`);
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), true);
    } finally {
      setConvertLabel(false);
    }
  }

  // ---------- wiring ----------
  const input = $('file'), wrap = $('wheel-wrap');
  let draggingChip = false;
  $('hub').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });

  // files from the computer: drop anywhere on the page
  let dragDepth = 0;
  document.addEventListener('dragenter', () => { if (!draggingChip) { dragDepth++; wrap.classList.add('over'); } });
  document.addEventListener('dragleave', () => { if (!draggingChip && --dragDepth <= 0) { dragDepth = 0; wrap.classList.remove('over'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; wrap.classList.remove('over');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  // a loaded file chip dragged onto a wheel segment / pill = convert to that format
  $('files').addEventListener('dragstart', (e) => { draggingChip = true; e.dataTransfer.setData('text/plain', 'chip'); e.dataTransfer.effectAllowed = 'copy'; });
  $('files').addEventListener('dragend', () => { draggingChip = false; document.querySelectorAll('.drop-target').forEach(s => s.classList.remove('drop-target')); });
  const targetOf = (e) => e.target.closest && e.target.closest('.seg.live, .pill:not(.off)');
  for (const zone of [$('wheel'), $('actions')]) {
    zone.addEventListener('dragover', (e) => {
      const t = targetOf(e);
      document.querySelectorAll('.drop-target').forEach(s => s !== t && s.classList.remove('drop-target'));
      if (draggingChip && t) { e.preventDefault(); t.classList.add('drop-target'); }
    });
    zone.addEventListener('drop', (e) => {
      const t = targetOf(e);
      if (draggingChip && t) {
        e.preventDefault(); e.stopPropagation(); draggingChip = false;
        t.classList.remove('drop-target');
        selectTool(t.dataset.tool, { autoConvert: true });
      }
    });
  }

  $('wheel').addEventListener('click', (e) => {
    const t = targetOf(e);
    if (t) selectTool(t.dataset.tool);
    else if (!state.files.length) input.click(); // empty wheel: anywhere opens Browse
  });
  $('wheel').addEventListener('keydown', (e) => {
    const t = targetOf(e);
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectTool(t.dataset.tool); }
  });
  $('actions').addEventListener('click', (e) => { const t = targetOf(e); if (t) selectTool(t.dataset.tool); });
  $('options').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    if (e.target.closest('.ph-custom')) { e.target.blur(); return; } // apply the size first
    convert();
  });

  $('files').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const f = state.files;
    if (b.dataset.remove) f.splice(+b.dataset.remove, 1);
    if (b.dataset.up) { const i = +b.dataset.up; [f[i - 1], f[i]] = [f[i], f[i - 1]]; }
    if (b.dataset.down) { const i = +b.dataset.down; [f[i + 1], f[i]] = [f[i], f[i + 1]]; }
    clearResults(); render();
  });
  $('clear').addEventListener('click', () => { state.files = []; state.toolId = null; clearResults(); render(); });
  $('convert').addEventListener('click', convert);
  $('results').addEventListener('click', async (e) => {
    const sv = e.target.closest('[data-save]');
    if (sv && android) {
      const r = state.results[+sv.dataset.save];
      const mime = r.blob.type || 'application/octet-stream';
      if (r.savedUri) { android.openFile(r.savedUri, mime); return; }
      sv.disabled = true;
      r.savedUri = android.saveFile(r.name, mime, await blobToB64(r.blob)) || null;
      sv.disabled = false;
      if (r.savedUri) { sv.textContent = 'Open'; setStatus('Saved to Downloads › Offline Converter.'); }
      return;
    }
    const b = e.target.closest('[data-share]'); if (!b) return;
    const r = state.results[+b.dataset.share];
    if (android) {
      const mime = r.blob.type || 'application/octet-stream';
      if (r.savedUri) android.shareUri(r.savedUri, mime, r.name); // reuse the saved copy, no duplicate
      else r.savedUri = android.shareFile(r.name, mime, await blobToB64(r.blob)) || null;
      renderResults();
      return;
    }
    const file = new File([r.blob], r.name, { type: r.blob.type || 'application/octet-stream' });
    try { await navigator.share({ files: [file] }); } catch { /* user cancelled */ }
  });
  $('not-supported').innerHTML = NOT_SUPPORTED.map(s => `<li>${esc(s)}</li>`).join('');

  // offline cache (only works when served over http(s))
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !android) { // the Android app bundles its files
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.ConverterApp = { state, plan, layout, addFiles, selectTool, convert }; // for testing
  render();
  detectEngine().then(render);
})();
