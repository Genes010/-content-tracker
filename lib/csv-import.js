// Import a setlist/content sheet (Google Sheets CSV export) into a project.
// Expected column layout (same as the DIR26 sheet):
//  B Song | C Content File Name | D File Use (screen) | E File Use (type) | F What it is
//  G Comments | I on Dropbox | J Status | K on Server | L Cam mask | M Cam mask note
// The rows above the header may contain fps and screen resolutions (cols M-R).

const { uid } = require('./util');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const t = (v) => (v || '').trim();
const normVer = (v) => {
  const m = /v?(\d+)/i.exec(t(v));
  return m ? 'v' + String(parseInt(m[1], 10)).padStart(2, '0') : '';
};

function importSheet(csvText) {
  const rows = parseCsv(csvText);
  const headerIdx = rows.findIndex((r) => r.some((c) => /content file name/i.test(c)));
  if (headerIdx < 0) throw new Error('Kolom "Content File Name" niet gevonden');
  const header = rows[headerIdx].map((c) => t(c).toLowerCase());
  const col = (re, from = 0) => header.findIndex((h, i) => i >= from && re.test(h));

  const C = {
    song: col(/^song$/),
    name: col(/content file name/),
    screen: col(/file use/),
    description: col(/what it is/),
    comments: col(/comments/),
    dropbox: col(/on dropbox/),
    status: col(/^status$/),
    server: col(/on server/),
    mask: col(/cam feed/),
  };
  C.kind = col(/file use/, C.screen + 1);
  C.maskNote = C.mask + 1;

  // Settings block: fps and "NAME | W x H" pairs anywhere above/at header to the right of mask cols
  let fps = null;
  const screens = [];
  for (let r = 0; r <= headerIdx; r++) {
    const row = rows[r];
    for (let i = C.maskNote; i < row.length; i++) {
      const v = t(row[i]);
      const f = /^(\d+(?:\.\d+)?)\s*fps$/i.exec(v);
      if (f) fps = parseFloat(f[1]);
      const res = /^(\d+)\s*x\s*(\d+)$/i.exec(t(row[i + 1]));
      if (v && !f && res && !/^\d/.test(v)) {
        screens.push({ name: v.replace(/\s*\+\s*/g, '+'), width: +res[1], height: +res[2] });
      }
    }
  }

  const sections = [];
  const files = [];
  let current = null;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (i) => (i >= 0 ? t(row[i]) : '');
    const song = get(C.song);
    const name = get(C.name);
    const isSongTitle = /^\d|^common/i.test(song) || (song && !current);
    if (song && isSongTitle) {
      current = { id: uid(), name: song, note: '', status: '' };
      sections.push(current);
    } else if (song && current) {
      // A remark written in the song column (e.g. "RE RENDER ALL WITH WHITE BG")
      current.note = [current.note, song].filter(Boolean).join(' · ');
    }
    if (!current) continue;

    if (name) {
      files.push({
        id: uid(),
        sectionId: current.id,
        name,
        screen: get(C.screen),
        kind: get(C.kind),
        description: get(C.description),
        comments: get(C.comments),
        dropboxVersion: normVer(get(C.dropbox)),
        status: get(C.status) || 'TO DO',
        serverVersion: normVer(get(C.server)),
        camMask: get(C.mask),
        camNote: get(C.maskNote),
        updatedAt: new Date().toISOString(),
        updatedBy: 'import',
      });
    } else {
      // Row without file name: song-level info
      const st = get(C.status);
      if (st && st !== 'UPDATED') current.status = st;
      const extra = [get(C.comments), [get(C.mask), get(C.maskNote)].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' · ');
      if (extra) current.note = [current.note, extra].filter(Boolean).join(' · ');
    }
  }
  return { fps, screens, sections, files };
}

module.exports = { parseCsv, importSheet, normVer };
