// Catalogue of every conversion the app knows about.
//   from     : accepted input extensions
//   engine   : true if the desktop engine (Python + LibreOffice) implements it
//   browser  : 'good' | 'basic' | null  — quality of the in-browser fallback
//              (the in-browser version also works on phones / tablets)
//   browserFrom: optional narrower list of inputs the browser version can read
//   multi    : true if all selected files are combined into one output
//   options  : extra fields shown under "Options"
const WORD = ['docx', 'doc', 'odt', 'rtf'];
const EXCEL = ['xlsx', 'xls', 'ods', 'csv'];
const PPT = ['pptx', 'ppt', 'odp'];
const IMG = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
const IMG_EXTRA = ['heic', 'heif', 'tif', 'tiff'];

const PDF_PASSWORD = { id: 'password', label: 'Current PDF password (only if it has one)', type: 'password' };

const TOOLS = [
  // ---- Office -> PDF
  { id: 'word-to-pdf', group: 'Convert to PDF', label: 'Word → PDF', to: 'pdf', from: [...WORD, 'txt'], engine: true, browser: 'basic', browserFrom: ['docx', 'txt'],
    note: 'In-browser version keeps text, headings, lists, tables and images but not exact page layout.' },
  { id: 'excel-to-pdf', group: 'Convert to PDF', label: 'Excel → PDF', to: 'pdf', from: EXCEL, engine: true, browser: 'basic',
    note: 'In-browser version prints cell values as plain tables (no colours/charts).' },
  { id: 'ppt-to-pdf', group: 'Convert to PDF', label: 'PowerPoint → PDF', to: 'pdf', from: PPT, engine: true, browser: null },
  { id: 'html-to-pdf', group: 'Convert to PDF', label: 'Web page (HTML) → PDF', to: 'pdf', from: ['html', 'htm'], engine: true, browser: 'basic' },
  { id: 'txt-to-pdf', group: 'Convert to PDF', label: 'Text → PDF', to: 'pdf', from: ['txt', 'md'], engine: false, browser: 'good' },
  { id: 'images-to-pdf', group: 'Convert to PDF', label: 'Images → PDF', to: 'pdf', from: [...IMG, ...IMG_EXTRA], engine: true, browser: 'good', browserFrom: IMG, multi: true,
    note: 'All selected images become pages of one PDF, in the order shown.' },

  // ---- PDF -> other
  { id: 'pdf-to-word', group: 'Convert from PDF', label: 'PDF → Word', to: 'docx', from: ['pdf'], engine: true, browser: 'basic', options: [PDF_PASSWORD],
    note: 'In-browser version extracts the text into paragraphs only; layout, tables and images are lost.' },
  { id: 'pdf-to-excel', group: 'Convert from PDF', label: 'PDF → Excel', to: 'xlsx', from: ['pdf'], engine: true, browser: 'basic', options: [PDF_PASSWORD],
    note: 'Works best on PDFs with real (not scanned) tables. In-browser version guesses columns from text positions.' },
  { id: 'pdf-to-ppt', group: 'Convert from PDF', label: 'PDF → PowerPoint', to: 'pptx', from: ['pdf'], engine: true, browser: null, options: [PDF_PASSWORD],
    note: 'Each page becomes a slide (as a picture), like most online converters do.' },
  { id: 'pdf-to-jpg', group: 'Convert from PDF', label: 'PDF → JPG images', to: 'jpg', from: ['pdf'], engine: true, browser: 'good',
    options: [{ id: 'dpi', label: 'Resolution (DPI)', type: 'select', choices: ['150', '96', '200', '300'] }, PDF_PASSWORD] },
  { id: 'pdf-to-png', group: 'Convert from PDF', label: 'PDF → PNG images', to: 'png', from: ['pdf'], engine: true, browser: 'good',
    options: [{ id: 'dpi', label: 'Resolution (DPI)', type: 'select', choices: ['150', '96', '200', '300'] }, PDF_PASSWORD] },
  { id: 'pdf-to-text', group: 'Convert from PDF', label: 'PDF → Text', to: 'txt', from: ['pdf'], engine: true, browser: 'good', options: [PDF_PASSWORD] },

  // ---- Organise / optimise PDF
  { id: 'merge-pdf', group: 'Organise PDF', label: 'Merge PDFs into one', to: 'pdf', from: ['pdf'], engine: false, browser: 'good', multi: true, minFiles: 2,
    note: 'Pages are joined in the order the files are listed. Use ↑ ↓ to reorder.' },
  { id: 'split-pdf', group: 'Organise PDF', label: 'Split PDF', to: 'pdf', from: ['pdf'], engine: false, browser: 'good',
    options: [{ id: 'ranges', label: 'Page ranges, e.g. 1-3, 5, 8-10 (blank = every page separately)', type: 'text' }] },
  { id: 'extract-pages', group: 'Organise PDF', label: 'Extract / reorder pages', to: 'pdf', from: ['pdf'], engine: false, browser: 'good',
    options: [{ id: 'pages', label: 'Pages to keep, in order, e.g. 3, 1-2, 5', type: 'text' }] },
  { id: 'rotate-pdf', group: 'Organise PDF', label: 'Rotate PDF', to: 'pdf', from: ['pdf'], engine: false, browser: 'good',
    options: [{ id: 'angle', label: 'Rotate by', type: 'select', choices: ['90', '180', '270'] }] },
  { id: 'compress-pdf', group: 'Optimise PDF', label: 'Compress PDF', to: 'pdf', from: ['pdf'], engine: true, browser: 'basic',
    options: [{ id: 'level', label: 'Compression', type: 'select', choices: ['medium', 'low', 'high'] }, PDF_PASSWORD],
    note: 'In-browser version turns every page into a picture (text no longer selectable). The desktop engine keeps text and only shrinks images.' },
  { id: 'watermark-pdf', group: 'Edit PDF', label: 'Add watermark', to: 'pdf', from: ['pdf'], engine: false, browser: 'good',
    options: [{ id: 'text', label: 'Watermark text', type: 'text', value: 'CONFIDENTIAL' }] },
  { id: 'page-numbers', group: 'Edit PDF', label: 'Add page numbers', to: 'pdf', from: ['pdf'], engine: false, browser: 'good' },
  { id: 'protect-pdf', group: 'PDF security', label: 'Protect PDF with password', to: 'pdf', from: ['pdf'], engine: true, browser: null,
    options: [{ id: 'new_password', label: 'New password', type: 'password' }] },
  { id: 'unlock-pdf', group: 'PDF security', label: 'Remove PDF password', to: 'pdf', from: ['pdf'], engine: true, browser: null,
    options: [PDF_PASSWORD], note: 'You must know the current password.' },

  // ---- Office <-> Office
  { id: 'word-to-excel', group: 'Office formats', label: 'Word → Excel (tables)', to: 'xlsx', from: WORD, engine: true, browser: 'basic', browserFrom: ['docx'],
    note: 'Each table in the document becomes a sheet. Without tables, each paragraph becomes a row.' },
  { id: 'word-to-txt', group: 'Office formats', label: 'Word → Text', to: 'txt', from: WORD, engine: true, browser: 'good', browserFrom: ['docx'] },
  { id: 'word-to-html', group: 'Office formats', label: 'Word → Web page (HTML)', to: 'html', from: ['docx'], engine: false, browser: 'good' },
  { id: 'to-docx', group: 'Office formats', label: 'Convert to Word (.docx)', to: 'docx', from: ['doc', 'odt', 'rtf', 'txt', 'html', 'htm'], engine: true, browser: null },
  { id: 'to-odt', group: 'Office formats', label: 'Convert to OpenDocument Text (.odt)', to: 'odt', from: ['docx', 'doc', 'rtf'], engine: true, browser: null },
  { id: 'to-xlsx', group: 'Office formats', label: 'Convert to Excel (.xlsx)', to: 'xlsx', from: ['xls', 'ods', 'csv'], engine: true, browser: 'good',
    note: 'In-browser version keeps values and formulas but not cell styling.' },
  { id: 'excel-to-csv', group: 'Office formats', label: 'Excel → CSV', to: 'csv', from: ['xlsx', 'xls', 'ods'], engine: false, browser: 'good',
    note: 'One CSV per sheet (zipped if there are several sheets).' },
  { id: 'to-ods', group: 'Office formats', label: 'Convert to OpenDocument Sheet (.ods)', to: 'ods', from: ['xlsx', 'xls', 'csv'], engine: true, browser: null },
  { id: 'to-pptx', group: 'Office formats', label: 'Convert to PowerPoint (.pptx)', to: 'pptx', from: ['ppt', 'odp'], engine: true, browser: null },
  { id: 'to-odp', group: 'Office formats', label: 'Convert to OpenDocument Slides (.odp)', to: 'odp', from: ['pptx', 'ppt'], engine: true, browser: null },
  { id: 'office-to-jpg', group: 'Office formats', label: 'Slides / pages → JPG images', to: 'jpg', from: [...PPT, ...WORD], engine: true, browser: null },

  // ---- Images
  { id: 'photo-resize', group: 'Image tools', label: 'Resize / visa & passport photo', to: 'jpg', from: [...IMG, ...IMG_EXTRA], engine: false, browser: 'good',
    browserFrom: IMG, editor: 'photo', maxFiles: 1, featured: true,
    note: 'Presets follow commonly published rules. Always double-check the official website. The app can\'t judge background, lighting or expression.' },
  { id: 'to-jpg', group: 'Images', label: 'Convert to JPG', to: 'jpg', from: [...IMG, ...IMG_EXTRA].filter(e => e !== 'jpg' && e !== 'jpeg'), engine: true, browser: 'good', browserFrom: IMG },
  { id: 'to-png', group: 'Images', label: 'Convert to PNG', to: 'png', from: [...IMG, ...IMG_EXTRA].filter(e => e !== 'png'), engine: true, browser: 'good', browserFrom: IMG },
  { id: 'to-webp', group: 'Images', label: 'Convert to WebP', to: 'webp', from: [...IMG, ...IMG_EXTRA].filter(e => e !== 'webp'), engine: true, browser: 'good', browserFrom: IMG },
  { id: 'to-tiff', group: 'Images', label: 'Convert to TIFF', to: 'tiff', from: [...IMG, 'heic', 'heif'], engine: true, browser: null },
  { id: 'to-bmp', group: 'Images', label: 'Convert to BMP', to: 'bmp', from: [...IMG, ...IMG_EXTRA].filter(e => e !== 'bmp'), engine: true, browser: null },
  { id: 'to-gif', group: 'Images', label: 'Convert to GIF', to: 'gif', from: [...IMG, ...IMG_EXTRA].filter(e => e !== 'gif'), engine: true, browser: null },
];

// Things online converters offer that this app deliberately does NOT fake.
const NOT_SUPPORTED = [
  'OCR (making scanned PDFs searchable) — needs an OCR engine such as Tesseract',
  'Editing PDF text, e-signatures, redaction, PDF/A archiving, comparing PDFs, translation',
  'Audio / video / e-book conversion',
];

if (typeof module !== 'undefined') module.exports = { TOOLS, NOT_SUPPORTED };
