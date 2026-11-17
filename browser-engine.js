// In-browser converters. Everything here runs on the device itself (desktop
// browser, phone or tablet) using bundled JavaScript libraries - no network.
// Each converter: async (files: File[], opts) => [{ name, blob }]
/* global PDFLib, pdfjsLib, XLSX, mammoth, JSZip, html2pdf */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const BrowserEngine = (() => {
  const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;

  const stem = (name) => name.replace(/\.[^.]+$/, '');
  const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
  const out = (name, blob) => ({ name, blob });
  const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  async function loadPdfJs(file, opts) {
    const data = new Uint8Array(await file.arrayBuffer());
    try {
      // isEvalSupported:false blocks the font-code-injection flaw in older pdf.js (CVE-2024-4367)
      return await pdfjsLib.getDocument({ data, password: opts.password || undefined, isEvalSupported: false }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('This PDF is password-protected. Enter its password in Options.');
      throw e;
    }
  }
  async function loadPdfLib(file) {
    try {
      return await PDFDocument.load(await file.arrayBuffer());
    } catch (e) {
      if (/encrypt/i.test(String(e))) throw new Error('This PDF is password-protected. Remove the password first (needs the desktop engine).');
      throw e;
    }
  }

  // "1-3, 5" -> [[1,2,3],[5]] (1-based). Validates against pageCount.
  function parseRanges(text, pageCount) {
    const groups = [];
    for (const part of String(text || '').split(',').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) throw new Error(`"${part}" is not a valid page range.`);
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b > pageCount || a > b) throw new Error(`Range "${part}" is outside 1-${pageCount}.`);
      const g = [];
      for (let i = a; i <= b; i++) g.push(i);
      groups.push(g);
    }
    return groups;
  }

  async function zipIfMany(items, zipName) {
    if (items.length <= 1) return items;
    const zip = new JSZip();
    items.forEach(i => zip.file(i.name, i.blob));
    return [out(zipName, await zip.generateAsync({ type: 'blob' }))];
  }

  const canvasToBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

  async function renderPage(pdf, n, dpi) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, width: page.view[2] - page.view[0], height: page.view[3] - page.view[1] };
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = url; });
      return img;
    } catch {
      throw new Error(`Your browser can't read ${file.name}. HEIC/TIFF images need the desktop engine.`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  // Text lines of a page, with x positions, from pdf.js
  async function pageLines(page) {
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim());
    const lines = [];
    for (const it of items) {
      const y = it.transform[5], x = it.transform[4];
      let line = lines.find(l => Math.abs(l.y - y) < Math.max(2, (it.height || 10) * 0.4));
      if (!line) lines.push(line = { y, items: [] });
      line.items.push({ x, w: it.width, str: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    return lines;
  }

  // ---------- minimal .docx writer (paragraphs only) ----------
  const xmlEsc = s => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  async function makeDocx(paragraphs) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const body = paragraphs.map(p => p === '\f'
      ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      : `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join('');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  // ---------- HTML -> PDF via html2pdf (image-based pages) ----------
  async function htmlToPdfBlob(html) {
    // html2pdf clones the element it is given, so the element itself must not be
    // positioned off-screen (the clone would render blank). Hide a holder instead.
    const box = document.createElement('div');
    box.className = 'render-holder';
    const page = document.createElement('div');
    page.className = 'render-page';
    page.innerHTML = html;
    box.appendChild(page);
    document.body.appendChild(box);
    try {
      return await html2pdf().set({
        // scrollX/Y 0: without them html2canvas offsets by the page scroll and renders a blank page
        // whenever the user has scrolled (which is always the case when pressing Convert)
        margin: 12, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] },
      }).from(page).outputPdf('blob');
    } finally {
      box.remove();
    }
  }

  const each = (fn) => async (files, opts) => (await Promise.all(files.map(f => fn(f, opts)))).flat();

  const T = {};

  // ---- PDF organise
  T['merge-pdf'] = async (files) => {
    const merged = await PDFDocument.create();
    for (const f of files) {
      const src = await loadPdfLib(f);
      (await merged.copyPages(src, src.getPageIndices())).forEach(p => merged.addPage(p));
    }
    return [out('merged.pdf', pdfBlob(await merged.save()))];
  };

  T['split-pdf'] = each(async (f, opts) => {
    const src = await loadPdfLib(f);
    const n = src.getPageCount();
    const groups = opts.ranges && opts.ranges.trim()
      ? parseRanges(opts.ranges, n)
      : src.getPageIndices().map(i => [i + 1]);
    const parts = [];
    for (const g of groups) {
      const doc = await PDFDocument.create();
      (await doc.copyPages(src, g.map(i => i - 1))).forEach(p => doc.addPage(p));
      const label = g.length > 1 ? `${g[0]}-${g[g.length - 1]}` : `${g[0]}`;
      parts.push(out(`${stem(f.name)}-p${label}.pdf`, pdfBlob(await doc.save())));
    }
    return zipIfMany(parts, `${stem(f.name)}-split.zip`);
  });

  T['extract-pages'] = each(async (f, opts) => {
    const src = await loadPdfLib(f);
    if (!opts.pages || !opts.pages.trim()) throw new Error('Type the pages to keep in Options, e.g. 1-3, 5.');
    const order = parseRanges(opts.pages, src.getPageCount()).flat();
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, order.map(i => i - 1))).forEach(p => doc.addPage(p));
    return [out(`${stem(f.name)}-pages.pdf`, pdfBlob(await doc.save()))];
  });

  T['rotate-pdf'] = each(async (f, opts) => {
    const doc = await loadPdfLib(f);
    const by = +(opts.angle || 90);
    doc.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + by) % 360)));
    return [out(`${stem(f.name)}-rotated.pdf`, pdfBlob(await doc.save()))];
  });

  T['watermark-pdf'] = each(async (f, opts) => {
    const doc = await loadPdfLib(f);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const text = (opts.text || 'CONFIDENTIAL').replace(/[^\x20-\x7E]/g, '?');
    for (const p of doc.getPages()) {
      const { width, height } = p.getSize();
      const size = Math.min(width, height) / Math.max(6, text.length * 0.6);
      const tw = font.widthOfTextAtSize(text, size);
      const a = Math.PI / 4;
      p.drawText(text, {
        x: width / 2 - (tw / 2) * Math.cos(a), y: height / 2 - (tw / 2) * Math.sin(a), size, font,
        color: rgb(0.85, 0.1, 0.1), opacity: 0.25, rotate: degrees(45),
      });
    }
    return [out(`${stem(f.name)}-watermarked.pdf`, pdfBlob(await doc.save()))];
  });

  T['page-numbers'] = each(async (f) => {
    const doc = await loadPdfLib(f);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      const { width } = p.getSize();
      const label = `${i + 1} / ${pages.length}`;
      p.drawText(label, { x: width / 2 - font.widthOfTextAtSize(label, 10) / 2, y: 20, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    });
    return [out(`${stem(f.name)}-numbered.pdf`, pdfBlob(await doc.save()))];
  });

  T['compress-pdf'] = each(async (f, opts) => {
    const { dpi, q } = { low: { dpi: 150, q: 0.8 }, medium: { dpi: 110, q: 0.65 }, high: { dpi: 72, q: 0.45 } }[opts.level || 'medium'];
    const pdf = await loadPdfJs(f, opts);
    const doc = await PDFDocument.create();
    for (let n = 1; n <= pdf.numPages; n++) {
      const { canvas, width, height } = await renderPage(pdf, n, dpi);
      const jpg = await doc.embedJpg(await (await canvasToBlob(canvas, 'image/jpeg', q)).arrayBuffer());
      doc.addPage([width, height]).drawImage(jpg, { x: 0, y: 0, width, height });
    }
    const bytes = await doc.save();
    // never hand back something bigger than the original
    const blob = bytes.length < f.size ? pdfBlob(bytes) : f;
    return [out(`${stem(f.name)}-compressed.pdf`, blob)];
  });

  // ---- PDF -> other
  const pdfToImages = (mime, ext) => each(async (f, opts) => {
    const pdf = await loadPdfJs(f, opts);
    const dpi = +(opts.dpi || 150);
    const imgs = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const { canvas } = await renderPage(pdf, n, dpi);
      imgs.push(out(`${stem(f.name)}${pdf.numPages > 1 ? `-page${n}` : ''}.${ext}`, await canvasToBlob(canvas, mime, 0.92)));
    }
    return zipIfMany(imgs, `${stem(f.name)}-${ext}.zip`);
  });
  T['pdf-to-jpg'] = pdfToImages('image/jpeg', 'jpg');
  T['pdf-to-png'] = pdfToImages('image/png', 'png');

  T['pdf-to-text'] = each(async (f, opts) => {
    const pdf = await loadPdfJs(f, opts);
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const lines = await pageLines(await pdf.getPage(n));
      pages.push(lines.map(l => l.items.map(i => i.str).join(' ')).join('\n'));
    }
    return [out(`${stem(f.name)}.txt`, new Blob([pages.join('\n\n')], { type: 'text/plain' }))];
  });

  T['pdf-to-word'] = each(async (f, opts) => {
    const pdf = await loadPdfJs(f, opts);
    const paras = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const lines = await pageLines(await pdf.getPage(n));
      // join lines into paragraphs when the vertical gap is small
      let cur = '', lastY = null;
      for (const l of lines) {
        const text = l.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (lastY !== null && lastY - l.y > 22) { if (cur) paras.push(cur); cur = ''; }
        cur = cur ? (cur.endsWith('-') ? cur.slice(0, -1) + text : cur + ' ' + text) : text;
        lastY = l.y;
      }
      if (cur) paras.push(cur);
      if (n < pdf.numPages) paras.push('\f');
    }
    return [out(`${stem(f.name)}.docx`, await makeDocx(paras))];
  });

  T['pdf-to-excel'] = each(async (f, opts) => {
    const pdf = await loadPdfJs(f, opts);
    const wb = XLSX.utils.book_new();
    for (let n = 1; n <= pdf.numPages; n++) {
      const lines = await pageLines(await pdf.getPage(n));
      // a new cell starts wherever there is a wide horizontal gap
      const rows = lines.map(l => {
        const cells = [];
        let prevEnd = null;
        for (const it of l.items) {
          if (prevEnd === null || it.x - prevEnd > 12) cells.push(it.str.trim());
          else cells[cells.length - 1] += (it.x - prevEnd > 1 ? ' ' : '') + it.str.trim();
          prevEnd = it.x + it.w;
        }
        return cells.map(c => (/^-?[\d,]+(\.\d+)?$/.test(c) ? +c.replace(/,/g, '') : c));
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Page ${n}`);
    }
    return [out(`${stem(f.name)}.xlsx`, new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: XLSX_MIME }))];
  });

  // ---- To PDF
  T['images-to-pdf'] = async (files) => {
    const doc = await PDFDocument.create();
    for (const f of files) {
      const e = extOf(f.name);
      const buf = await f.arrayBuffer();
      let img;
      if (e === 'jpg' || e === 'jpeg') img = await doc.embedJpg(buf);
      else if (e === 'png') img = await doc.embedPng(buf);
      else {
        const el = await loadImage(f);
        const c = document.createElement('canvas');
        c.width = el.naturalWidth; c.height = el.naturalHeight;
        c.getContext('2d').drawImage(el, 0, 0);
        img = await doc.embedPng(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
      }
      const w = img.width * 0.75, h = img.height * 0.75; // 96 dpi -> points
      doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    const name = files.length > 1 ? 'images.pdf' : `${stem(files[0].name)}.pdf`;
    return [out(name, pdfBlob(await doc.save()))];
  };

  T['txt-to-pdf'] = each(async (f) => {
    const text = (await f.text()).replace(/\t/g, '    ').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, '?');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = 11, lh = 15, margin = 56, W = 595, H = 842, maxW = W - margin * 2;
    let page = doc.addPage([W, H]), y = H - margin;
    const newLine = () => { y -= lh; if (y < margin) { page = doc.addPage([W, H]); y = H - margin; } };
    for (const raw of text.split(/\r?\n/)) {
      let line = '';
      for (const word of raw.split(' ')) {
        const tryLine = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(tryLine, size) > maxW && line) {
          page.drawText(line, { x: margin, y, size, font }); newLine(); line = word;
        } else line = tryLine;
      }
      page.drawText(line, { x: margin, y, size, font }); newLine();
    }
    return [out(`${stem(f.name)}.pdf`, pdfBlob(await doc.save()))];
  });

  T['word-to-pdf'] = each(async (f) => {
    if (extOf(f.name) === 'txt') return T['txt-to-pdf']([f]);
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
    return [out(`${stem(f.name)}.pdf`, await htmlToPdfBlob(value))];
  });

  T['html-to-pdf'] = each(async (f) => {
    const doc = new DOMParser().parseFromString(await f.text(), 'text/html');
    doc.querySelectorAll('script').forEach(s => s.remove());
    const styles = [...doc.querySelectorAll('style')].map(s => s.outerHTML).join('');
    return [out(`${stem(f.name)}.pdf`, await htmlToPdfBlob(styles + doc.body.innerHTML))];
  });

  async function readWorkbook(f) {
    const e = extOf(f.name);
    return e === 'csv' ? XLSX.read(await f.text(), { type: 'string' }) : XLSX.read(await f.arrayBuffer(), { type: 'array' });
  }

  T['excel-to-pdf'] = each(async (f) => {
    const wb = await readWorkbook(f);
    const html = wb.SheetNames.map((n, i) =>
      `<h3 ${i ? 'style="page-break-before:always"' : ''}>${xmlEsc(n)}</h3>` +
      XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })).join('');
    return [out(`${stem(f.name)}.pdf`, await htmlToPdfBlob(html))];
  });

  // ---- Office formats
  T['to-xlsx'] = each(async (f) => {
    const wb = await readWorkbook(f);
    return [out(`${stem(f.name)}.xlsx`, new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: XLSX_MIME }))];
  });

  T['excel-to-csv'] = each(async (f) => {
    const wb = await readWorkbook(f);
    const items = wb.SheetNames.map(n => out(
      wb.SheetNames.length > 1 ? `${stem(f.name)}-${n}.csv` : `${stem(f.name)}.csv`,
      new Blob(['﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[n])], { type: 'text/csv' })));
    return zipIfMany(items, `${stem(f.name)}-csv.zip`);
  });

  T['word-to-html'] = each(async (f) => {
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
    const html = `<!doctype html><meta charset="utf-8"><title>${xmlEsc(stem(f.name))}</title><body style="font-family:sans-serif;max-width:800px;margin:auto">${value}</body>`;
    return [out(`${stem(f.name)}.html`, new Blob([html], { type: 'text/html' }))];
  });

  T['word-to-txt'] = each(async (f) => {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
    return [out(`${stem(f.name)}.txt`, new Blob([value], { type: 'text/plain' }))];
  });

  T['word-to-excel'] = each(async (f) => {
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
    const dom = new DOMParser().parseFromString(value, 'text/html');
    const wb = XLSX.utils.book_new();
    const tables = [...dom.querySelectorAll('table')];
    tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t), `Table ${i + 1}`));
    if (!tables.length) {
      const rows = [...dom.body.children].map(e => [e.textContent.trim()]).filter(r => r[0]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Text');
    }
    return [out(`${stem(f.name)}.xlsx`, new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: XLSX_MIME }))];
  });

  // ---- Images
  const imageTo = (mime, ext) => each(async (f) => {
    const img = await loadImage(f);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (ext === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0);
    const blob = await canvasToBlob(c, mime, 0.92);
    if (!blob || blob.type !== mime) throw new Error(`This browser can't create ${ext.toUpperCase()} images.`);
    return [out(`${stem(f.name)}.${ext}`, blob)];
  });
  T['to-jpg'] = imageTo('image/jpeg', 'jpg');
  T['to-png'] = imageTo('image/png', 'png');
  T['to-webp'] = imageTo('image/webp', 'webp');

  return { run: (id, files, opts) => T[id](files, opts || {}), has: (id) => id in T, parseRanges };
})();
