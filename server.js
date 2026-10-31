// Content Tracker — shared tracker for show content between content maker and media server.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const express = require('express');

const Store = require('./lib/store');
const scanner = require('./lib/scanner');
const { importSheet } = require('./lib/csv-import');
const { uid, verNum } = require('./lib/util');

// ---------- config ----------
const cfgFile = path.join(__dirname, 'config.json');
const fileCfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
const CFG = {
  port: +(process.env.PORT || fileCfg.port || 3080),
  password: process.env.APP_PASSWORD ?? fileCfg.password ?? '',
  dataFile: path.resolve(__dirname, process.env.DATA_FILE || fileCfg.dataFile || 'data/data.json'),
  // Allow "open in Explorer/Finder" for requests from other machines than the server itself
  allowRemoteOpen: !!(process.env.ALLOW_REMOTE_OPEN || fileCfg.allowRemoteOpen),
  autoScanMinutes: +(process.env.AUTO_SCAN_MINUTES || fileCfg.autoScanMinutes || 0),
};

const store = new Store(CFG.dataFile);
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

// ---------- auth (optional shared password, HTTP Basic) ----------
if (CFG.password) {
  app.use((req, res, next) => {
    const h = req.headers.authorization || '';
    const [, b64] = h.split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass === CFG.password) return next();
    res.set('WWW-Authenticate', 'Basic realm="Content Tracker"').status(401).send('Login vereist');
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ---------- live updates (SSE) ----------
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'hello', rev: store.rev })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});
function broadcast(projectId, extra = {}) {
  const msg = `data: ${JSON.stringify({ type: 'change', projectId, rev: store.rev, ...extra })}\n\n`;
  for (const c of clients) c.write(msg);
}
function commit(projectId, logEntry) {
  if (logEntry) store.log({ projectId, ...logEntry });
  store.save();
  broadcast(projectId);
}

const who = (req) => String(req.get('x-user') || 'onbekend').slice(0, 40);
const DEFAULT_STATUSES = ['TO DO', 'IN PROGRESS', 'UPDATED', 'EXTRA CUE', 'NO NEED'];
const DEFAULT_KINDS = ['LOOP', 'LINEAR', 'STILL', 'NOTCH'];

function newProject(body = {}) {
  return {
    id: uid(),
    name: body.name || 'Nieuw project',
    fps: body.fps || 50,
    screens: body.screens || [{ name: 'FULL', width: 1920, height: 1080 }],
    statuses: DEFAULT_STATUSES,
    kinds: DEFAULT_KINDS,
    paths: { dropboxWeb: '', dropboxLocal: '', local: '' },
    sections: [],
    files: [],
    lastScan: null,
    createdAt: new Date().toISOString(),
  };
}

function getProject(req, res) {
  const p = store.project(req.params.pid);
  if (!p) res.status(404).json({ error: 'Project niet gevonden' });
  return p;
}

// ---------- projects ----------
app.get('/api/info', (req, res) => {
  res.json({ host: os.hostname(), platform: process.platform, canOpen: canOpen(req), rev: store.rev });
});

app.get('/api/projects', (req, res) => {
  res.json(
    store.data.projects.map((p) => ({
      id: p.id, name: p.name, files: p.files.length,
      todo: p.files.filter((f) => f.status === 'TO DO').length,
      behind: p.files.filter(isBehind).length,
    }))
  );
});

app.post('/api/projects', (req, res) => {
  const p = newProject(req.body);
  store.data.projects.push(p);
  commit(p.id, { user: who(req), action: 'project aangemaakt', target: p.name });
  res.json(p);
});

app.get('/api/projects/:pid', (req, res) => {
  const p = getProject(req, res);
  if (p) res.json({ ...p, log: store.data.log.filter((l) => l.projectId === p.id).slice(0, 100) });
});

app.patch('/api/projects/:pid', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  for (const k of ['name', 'fps', 'screens', 'statuses', 'kinds']) if (k in req.body) p[k] = req.body[k];
  if (req.body.paths) p.paths = { ...p.paths, ...req.body.paths };
  commit(p.id, { user: who(req), action: 'instellingen gewijzigd', target: p.name });
  res.json(p);
});

app.delete('/api/projects/:pid', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  store.data.projects = store.data.projects.filter((x) => x !== p);
  commit(p.id, { user: who(req), action: 'project verwijderd', target: p.name });
  res.json({ ok: true });
});

// Import a sheet CSV — creates a new project, or replaces content of an existing one (?replace=1)
app.post('/api/import', (req, res) => {
  try {
    const csv = typeof req.body === 'string' ? req.body : req.body.csv;
    const parsed = importSheet(csv);
    const p = newProject({
      name: req.query.name || 'Geïmporteerd project',
      fps: parsed.fps || 50,
      screens: parsed.screens.length ? parsed.screens : undefined,
    });
    p.sections = parsed.sections;
    p.files = parsed.files;
    store.data.projects.push(p);
    commit(p.id, { user: who(req), action: `sheet geïmporteerd (${p.files.length} files)`, target: p.name });
    res.json(p);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- sections (songs) ----------
app.post('/api/projects/:pid/sections', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const s = { id: uid(), name: req.body.name || 'Nieuwe song', note: '', status: '' };
  const after = p.sections.findIndex((x) => x.id === req.body.afterId);
  p.sections.splice(after >= 0 ? after + 1 : p.sections.length, 0, s);
  commit(p.id, { user: who(req), action: 'song toegevoegd', target: s.name });
  res.json(s);
});

app.patch('/api/projects/:pid/sections/:sid', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const s = p.sections.find((x) => x.id === req.params.sid);
  if (!s) return res.status(404).json({ error: 'Song niet gevonden' });
  for (const k of ['name', 'note', 'status']) if (k in req.body) s[k] = req.body[k];
  if ('move' in req.body) {
    const i = p.sections.indexOf(s);
    const j = Math.max(0, Math.min(p.sections.length - 1, i + Math.sign(req.body.move)));
    p.sections.splice(i, 1);
    p.sections.splice(j, 0, s);
  }
  commit(p.id, { user: who(req), action: 'song gewijzigd', target: s.name });
  res.json(s);
});

app.delete('/api/projects/:pid/sections/:sid', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const s = p.sections.find((x) => x.id === req.params.sid);
  if (!s) return res.status(404).end();
  p.sections = p.sections.filter((x) => x !== s);
  p.files = p.files.filter((f) => f.sectionId !== s.id);
  commit(p.id, { user: who(req), action: 'song verwijderd', target: s.name });
  res.json({ ok: true });
});

// ---------- files ----------
const FILE_FIELDS = ['name', 'screen', 'kind', 'description', 'comments', 'dropboxVersion', 'status',
  'serverVersion', 'camMask', 'camNote', 'sectionId'];

function isBehind(f) {
  return verNum(f.dropboxVersion) > verNum(f.serverVersion);
}

app.post('/api/projects/:pid/files', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const f = {
    id: uid(), sectionId: req.body.sectionId, name: '', screen: '', kind: '', description: '',
    comments: '', dropboxVersion: '', status: 'TO DO', serverVersion: '', camMask: '', camNote: '',
  };
  for (const k of FILE_FIELDS) if (k in req.body) f[k] = req.body[k];
  f.updatedAt = new Date().toISOString();
  f.updatedBy = who(req);
  const after = p.files.findIndex((x) => x.id === req.body.afterId);
  if (after >= 0) p.files.splice(after + 1, 0, f);
  else {
    // append after the last file of this section
    let last = -1;
    p.files.forEach((x, i) => { if (x.sectionId === f.sectionId) last = i; });
    p.files.splice(last >= 0 ? last + 1 : p.files.length, 0, f);
  }
  commit(p.id, { user: who(req), action: 'file toegevoegd', target: f.name || '(nieuw)' });
  res.json(f);
});

app.patch('/api/projects/:pid/files/:fid', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const f = p.files.find((x) => x.id === req.params.fid);
  if (!f) return res.status(404).json({ error: 'File niet gevonden' });
  const changes = [];
  for (const k of FILE_FIELDS) {
    if (k in req.body && req.body[k] !== f[k]) {
      changes.push(`${k}: ${f[k] || '–'} → ${req.body[k] || '–'}`);
      f[k] = req.body[k];
    }
  }
  if ('move' in req.body) {
    // swap with the neighbouring file in the same song
    const siblings = p.files.filter((x) => x.sectionId === f.sectionId);
    const other = siblings[siblings.indexOf(f) + Math.sign(req.body.move)];
    if (other) {
      const a = p.files.indexOf(f), b = p.files.indexOf(other);
      [p.files[a], p.files[b]] = [p.files[b], p.files[a]];
    }
  }
  if (!changes.length && !('move' in req.body)) return res.json(f);
  f.updatedAt = new Date().toISOString();
  f.updatedBy = who(req);
  commit(p.id, changes.length ? { user: who(req), action: changes.join(', '), target: f.name } : null);
  res.json(f);
});

app.delete('/api/projects/:pid/files/:fid', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const f = p.files.find((x) => x.id === req.params.fid);
  if (!f) return res.status(404).end();
  p.files = p.files.filter((x) => x !== f);
  commit(p.id, { user: who(req), action: 'file verwijderd', target: f.name });
  res.json({ ok: true });
});

// ---------- folder scan ----------
function scanProject(p, user = 'scan') {
  const result = { dropbox: null, local: null, changed: 0 };
  const db = p.paths.dropboxLocal ? scanner.index(p.paths.dropboxLocal) : null;
  const lo = p.paths.local ? scanner.index(p.paths.local) : null;
  if (db) result.dropbox = { ok: db.ok, files: db.count };
  if (lo) result.local = { ok: lo.ok, files: lo.count };

  for (const f of p.files) {
    if (!f.name) continue;
    const snap = () => JSON.stringify([f.dropboxVersion, f.serverVersion, f.dropboxPath || "", f.localPath || ""]);
    const before = snap();
    if (db?.ok) {
      const hit = scanner.lookup(db, f.name);
      f.dropboxPath = hit ? path.relative(p.paths.dropboxLocal, hit.path) : '';
      if (hit) f.dropboxVersion = hit.version;
    }
    if (lo?.ok) {
      const hit = scanner.lookup(lo, f.name);
      f.localPath = hit ? hit.path : '';
      if (hit) f.serverVersion = hit.version;
    }
    if (before !== snap()) {
      result.changed++;
      f.updatedAt = new Date().toISOString();
      f.updatedBy = user;
    }
  }
  p.lastScan = { at: new Date().toISOString(), ...result };
  return result;
}

app.post('/api/projects/:pid/scan', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const r = scanProject(p, who(req));
  commit(p.id, { user: who(req), action: `mappen gescand (${r.changed} wijzigingen)`, target: p.name });
  res.json(r);
});

if (CFG.autoScanMinutes > 0) {
  setInterval(() => {
    for (const p of store.data.projects) {
      if (!p.paths.dropboxLocal && !p.paths.local) continue;
      const r = scanProject(p, 'auto-scan');
      if (r.changed) commit(p.id, { user: 'auto-scan', action: `${r.changed} wijzigingen gevonden`, target: p.name });
    }
  }, CFG.autoScanMinutes * 60000);
}

// ---------- open in Explorer / Finder (only on the server machine) ----------
function isLocalReq(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function canOpen(req) {
  return isLocalReq(req) || CFG.allowRemoteOpen;
}

app.post('/api/open', (req, res) => {
  if (!canOpen(req)) return res.status(403).json({ error: 'Openen kan alleen op de server zelf' });
  const p = store.project(req.body.projectId);
  if (!p) return res.status(404).json({ error: 'Project niet gevonden' });
  let target = req.body.path ? path.resolve(req.body.path) : '';
  const roots = [p.paths.local, p.paths.dropboxLocal].filter(Boolean).map((r) => path.resolve(r));
  if (!target || !roots.some((r) => target === r || target.startsWith(r + path.sep))) {
    return res.status(400).json({ error: 'Pad valt buiten de ingestelde mappen' });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Pad bestaat niet (meer)' });
  const isDir = fs.statSync(target).isDirectory();
  if (process.platform === 'win32') {
    execFile('explorer.exe', isDir ? [target] : [`/select,${target}`]);
  } else if (process.platform === 'darwin') {
    execFile('open', isDir ? [target] : ['-R', target]);
  } else {
    execFile('xdg-open', [isDir ? target : path.dirname(target)]);
  }
  res.json({ ok: true });
});

// ---------- export ----------
app.get('/api/projects/:pid/export.csv', (req, res) => {
  const p = getProject(req, res);
  if (!p) return;
  const esc = (v) => (/[",\n]/.test(v || '') ? `"${String(v).replace(/"/g, '""')}"` : v || '');
  const lines = [['Song', 'Content File Name', 'Screen', 'Type', 'What it is', 'Comments', 'on Dropbox',
    'Status', 'on Server', 'Cam Mask', 'Cam Note'].join(',')];
  for (const s of p.sections) {
    const files = p.files.filter((f) => f.sectionId === s.id);
    if (!files.length) lines.push([esc(s.name), '', '', '', '', esc(s.note), '', esc(s.status)].join(','));
    files.forEach((f, i) => {
      lines.push([i === 0 ? esc(s.name) : '', f.name, f.screen, f.kind, f.description, f.comments,
        f.dropboxVersion, f.status, f.serverVersion, f.camMask, f.camNote].map(esc).join(','));
    });
  }
  res.set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${p.name.replace(/[^\w\- ]/g, '')}.csv"`)
    .send('﻿' + lines.join('\n'));
});

app.listen(CFG.port, () => {
  console.log(`Content Tracker draait op http://localhost:${CFG.port}`);
  if (!CFG.password) console.log('Let op: geen wachtwoord ingesteld (APP_PASSWORD).');
});

process.on('SIGINT', () => { store.flush(); process.exit(0); });
