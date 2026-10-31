// Content Tracker — frontend (vanilla JS)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  projects: [],
  project: null,
  info: {},
  filter: 'all',
  search: '',
  user: lsGet('ct.user') || '',
  pendingRender: false,
  lastFiles: new Map(),
};

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ---------- api ----------
async function api(method, url, body) {
  const opts = { method, headers: { 'x-user': state.user || 'onbekend' } };
  if (body !== undefined) {
    if (typeof body === 'string') { opts.headers['Content-Type'] = 'text/csv'; opts.body = body; }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
const P = () => `/api/projects/${state.project.id}`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- helpers ----------
const verNum = (v) => { const m = /(\d+)/.exec(v || ''); return m ? +m[1] : 0; };
const verStr = (n) => (n > 0 ? 'v' + String(n).padStart(2, '0') : '');
const isBehind = (f) => verNum(f.dropboxVersion) > verNum(f.serverVersion);
function stClass(status) {
  const s = (status || '').toUpperCase();
  if (s === 'TO DO') return 'st-todo';
  if (s === 'UPDATED' || s === 'DONE') return 'st-ok';
  if (s === 'EXTRA CUE') return 'st-extra';
  if (s === 'NO NEED') return 'st-none';
  return 'st-progress';
}
// Resolve "TAC_201_Lines_vXX" to the current version name
const resolvedName = (f) => {
  const v = f.dropboxVersion || f.serverVersion;
  return v ? f.name.replace(/([_\-\s])v?xx$/i, `$1${v}`) : f.name;
};
const slash = (p) => String(p || '').replace(/\\/g, '/');

function dropboxUrl(f) {
  const base = slash(state.project.paths?.dropboxWeb || '').replace(/\/+$/, '');
  if (!base) return null;
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  if (f.dropboxPath) {
    const rel = slash(f.dropboxPath);
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const file = rel.split('/').pop();
    return `https://www.dropbox.com/home${enc(base + (dir ? '/' + dir : ''))}?preview=${encodeURIComponent(file)}`;
  }
  return `https://www.dropbox.com/home${enc(base)}`;
}

// ---------- loading ----------
async function loadProjects(selectId) {
  state.projects = await api('GET', '/api/projects');
  const sel = $('#projectSelect');
  sel.innerHTML = state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const id = selectId || lsGet('ct.project');
  const pick = state.projects.find((p) => p.id === id) || state.projects[0];
  if (pick) { sel.value = pick.id; await loadProject(pick.id); }
  else { state.project = null; render(); }
}

async function loadProject(id) {
  const p = await api('GET', `/api/projects/${id}`);
  state.project = p;
  lsSet('ct.project', id);
  scheduleRender();
}

function scheduleRender() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('#main') && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) {
    state.pendingRender = true;
    return;
  }
  render();
}
document.addEventListener('focusout', () => {
  setTimeout(() => { if (state.pendingRender) { state.pendingRender = false; scheduleRender(); } }, 50);
});

// ---------- rendering ----------
function render() {
  const p = state.project;
  const main = $('#main');
  $('#btnUser').textContent = state.user ? `👤 ${state.user}` : '👤 naam';
  const hasP = !!p;
  ['#bar', '#meta'].forEach((s) => $(s).classList.toggle('hidden', !hasP));
  ['#btnSettings', '#btnScan', '#btnLog', '#projectSelect'].forEach((s) => ($(s).disabled = !hasP));
  if (!p) {
    main.innerHTML = `<div class="empty"><h2>Nog geen projecten</h2>
      <p>Importeer je bestaande Google Sheet of begin leeg.</p>
      <div class="actions"><button onclick="openImport()">Importeer sheet</button>
      <button class="ghost" onclick="newProject()">Leeg project</button></div></div>`;
    return;
  }

  // datalists
  $('#dlScreens').innerHTML = p.screens.map((s) => `<option value="${esc(s.name)}">`).join('');
  $('#dlKinds').innerHTML = (p.kinds || []).map((k) => `<option value="${esc(k)}">`).join('');
  const masks = [...new Set(p.files.map((f) => f.camMask).filter(Boolean))].sort();
  $('#dlMasks').innerHTML = masks.map((m) => `<option value="${esc(m)}">`).join('');

  // stats
  const files = p.files;
  const n = (fn) => files.filter(fn).length;
  $('#stats').innerHTML = `
    <div class="stat"><b>${files.length}</b>files</div>
    <div class="stat todo"><b>${n((f) => f.status === 'TO DO')}</b>to do</div>
    <div class="stat behind"><b>${n(isBehind)}</b>nieuw op Dropbox</div>
    <div class="stat ok"><b>${n((f) => f.dropboxVersion && !isBehind(f) && f.status !== 'TO DO')}</b>op server</div>`;

  // meta
  const scan = p.lastScan ? `laatste scan ${new Date(p.lastScan.at).toLocaleString('nl-NL')}` : 'nog niet gescand';
  $('#meta').innerHTML = `<span>${p.fps} fps</span>` +
    p.screens.map((s) => `<span><b>${esc(s.name)}</b> ${s.width}×${s.height}</span>`).join('') +
    `<span class="spacer"></span><span>${scan}</span>`;

  // filter
  const q = state.search.toLowerCase();
  const match = (f, s) => {
    if (state.filter === 'todo' && f.status !== 'TO DO') return false;
    if (state.filter === 'behind' && !isBehind(f)) return false;
    if (state.filter === 'open' && (f.status === 'UPDATED' || f.status === 'NO NEED') && !isBehind(f)) return false;
    if (q && ![f.name, f.description, f.comments, f.screen, s.name, f.camMask].join(' ').toLowerCase().includes(q)) return false;
    return true;
  };
  const filtering = state.filter !== 'all' || q;

  const statusOpts = (cur) => {
    const list = p.statuses.includes(cur) || !cur ? p.statuses : [...p.statuses, cur];
    return list.map((s) => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('');
  };

  let html = '';
  for (const s of p.sections) {
    const all = files.filter((f) => f.sectionId === s.id);
    const shown = all.filter((f) => match(f, s));
    if (filtering && !shown.length) continue;
    const secStatus = s.status
      ? `<select class="status sec-status ${stClass(s.status)}" data-sec="status">${statusOpts(s.status)}<option value="">—</option></select>` : '';
    html += `<div class="section" data-sid="${s.id}">
      <div class="sec-head">
        <input class="sec-name" data-sec="name" value="${esc(s.name)}" />
        ${secStatus}
        <input class="sec-note" data-sec="note" value="${esc(s.note)}" placeholder="notitie…" />
        <span class="count">${all.length} file${all.length === 1 ? '' : 's'}</span>
        <div class="tools">
          ${s.status ? '' : '<button class="ghost" data-act="sec-nostatus" title="Song-status (bv. NO NEED)">status</button>'}
          <button class="ghost" data-act="sec-up" title="Omhoog">↑</button>
          <button class="ghost" data-act="sec-down" title="Omlaag">↓</button>
          <button class="ghost" data-act="sec-add" title="Song eronder toevoegen">+ song</button>
          <button class="ghost danger" data-act="sec-del" title="Song verwijderen">✕</button>
        </div>
      </div>`;
    if (shown.length) {
      html += `<table><colgroup>
        <col style="width:21%"><col style="width:7.5%"><col style="width:6%"><col style="width:14%"><col style="width:13%">
        <col style="width:9%"><col style="width:8.5%"><col style="width:7%"><col style="width:6%"><col style="width:8%"></colgroup>
        <thead><tr><th>Content file</th><th>Scherm</th><th>Type</th><th>Wat is het</th><th>Comments</th>
        <th>Dropbox</th><th>Status</th><th>Server</th><th>Cam mask</th><th style="text-align:right">Lokaal</th></tr></thead><tbody>`;
      for (const f of shown) html += rowHtml(f, statusOpts);
      html += `</tbody></table>`;
    }
    html += `<div class="addrow"><button class="ghost" data-act="file-add">+ file</button></div></div>`;
  }
  if (!p.sections.length) html = `<div class="empty"><p>Nog geen songs.</p><button data-act="sec-first">+ Eerste song</button></div>`;
  else if (!html) html = `<div class="empty"><p>Niets gevonden voor dit filter.</p></div>`;
  html += `<div class="addrow"><button class="ghost" data-act="sec-last">+ song onderaan</button></div>`;
  main.innerHTML = html;

  // flash rows that changed since last render
  for (const f of files) {
    const prev = state.lastFiles.get(f.id);
    if (prev && prev !== f.updatedAt) $(`tr[data-fid="${f.id}"]`)?.classList.add('flash');
    state.lastFiles.set(f.id, f.updatedAt);
  }

  renderLog();
}

function rowHtml(f, statusOpts) {
  const behind = isBehind(f);
  const dbx = dropboxUrl(f);
  const canOpen = state.info.canOpen;
  const title = `${resolvedName(f)}\nlaatst gewijzigd door ${f.updatedBy || '?'} · ${f.updatedAt ? new Date(f.updatedAt).toLocaleString('nl-NL') : ''}`;
  return `<tr class="row ${stClass(f.status)} ${behind ? 'behind' : ''}" data-fid="${f.id}">
    <td class="name"><input data-f="name" value="${esc(f.name)}" title="${esc(title)}" placeholder="Naam_001_Omschrijving_vXX" /></td>
    <td><input data-f="screen" list="dlScreens" value="${esc(f.screen)}" /></td>
    <td><input data-f="kind" list="dlKinds" value="${esc(f.kind)}" /></td>
    <td><input data-f="description" value="${esc(f.description)}" /></td>
    <td><input data-f="comments" value="${esc(f.comments)}" /></td>
    <td><div class="ver">
      <input data-f="dropboxVersion" value="${esc(f.dropboxVersion)}" placeholder="—" title="Versie op Dropbox" />
      <button data-act="dbx-up" title="Nieuwe versie geüpload (+1)">+1</button>
      ${dbx ? `<a href="${dbx}" target="_blank" rel="noopener" title="${f.dropboxPath ? 'Open in Dropbox: ' + esc(slash(f.dropboxPath)) : 'Open Dropbox map'}">${f.dropboxPath ? '↗' : '⌂'}</a>` : ''}
    </div></td>
    <td><select class="status ${stClass(f.status)}" data-f="status">${statusOpts(f.status)}</select></td>
    <td><div class="ver">
      <input data-f="serverVersion" value="${esc(f.serverVersion)}" placeholder="—" title="Versie op de server" />
      ${behind ? `<button class="pull" data-act="loaded" title="Gedownload en ingeladen: zet server op ${esc(f.dropboxVersion)}">⇩</button>` : ''}
    </div></td>
    <td><input data-f="camMask" list="dlMasks" value="${esc(f.camMask)}" title="${esc(f.camNote)}" /></td>
    <td><div class="links">
      ${f.localPath ? `<button class="found" data-act="${canOpen ? 'open' : 'copy'}" title="${esc(f.localPath)}\n${canOpen ? 'Klik: toon in Verkenner · Shift+klik: kopieer pad' : 'Klik: kopieer pad'}">📁</button>` : ''}
      <div class="rowmenu">
        <button data-act="file-up" title="Omhoog">↑</button>
        <button data-act="file-down" title="Omlaag">↓</button>
        <button data-act="file-dup" title="Dupliceer (volgende nummer)">⧉</button>
        <button class="del" data-act="file-del" title="Verwijder">✕</button>
      </div>
    </div></td>
  </tr>`;
}

function renderLog() {
  const log = state.project?.log || [];
  $('#logList').innerHTML = log.map((l) => `<li><div class="when">${new Date(l.at).toLocaleString('nl-NL')}</div>
    <span class="who">${esc(l.user)}</span> ${esc(l.action)} ${l.target ? `<span class="tgt">${esc(l.target)}</span>` : ''}</li>`).join('')
    || '<li class="when">Nog geen activiteit</li>';
}

// ---------- editing ----------
const main = $('#main');

main.addEventListener('change', async (e) => {
  const el = e.target;
  const sid = el.closest('.section')?.dataset.sid;
  try {
    if (el.dataset.f) {
      const fid = el.closest('tr').dataset.fid;
      let v = el.value.trim();
      if (/Version$/.test(el.dataset.f) && v) v = verStr(verNum(v));
      const f = state.project.files.find((x) => x.id === fid);
      const upd = await api('PATCH', `${P()}/files/${fid}`, { [el.dataset.f]: v });
      Object.assign(f, upd);
      state.lastFiles.set(fid, f.updatedAt);
    } else if (el.dataset.sec && sid) {
      const s = state.project.sections.find((x) => x.id === sid);
      Object.assign(s, await api('PATCH', `${P()}/sections/${sid}`, { [el.dataset.sec]: el.value.trim() }));
    }
    if (el.tagName === 'SELECT') render();
  } catch (err) { toast('Opslaan mislukt: ' + err.message); }
});

main.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
  if (e.key === 'Escape' && e.target.tagName === 'INPUT') { e.target.value = e.target.defaultValue; e.target.blur(); }
});

main.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const sid = btn.closest('.section')?.dataset.sid;
  const fid = btn.closest('tr')?.dataset.fid;
  const f = fid && state.project.files.find((x) => x.id === fid);
  try {
    switch (act) {
      case 'file-add': {
        const sibling = state.project.files.filter((x) => x.sectionId === sid).pop();
        await api('POST', `${P()}/files`, { sectionId: sid, ...(sibling ? { screen: sibling.screen, kind: sibling.kind, name: nextName(sibling.name) } : {}) });
        break;
      }
      case 'file-dup':
        await api('POST', `${P()}/files`, { ...f, id: undefined, afterId: f.id, name: nextName(f.name), dropboxVersion: '', serverVersion: '', status: state.project.statuses[0] });
        break;
      case 'file-del':
        if (confirm(`"${f.name || 'deze file'}" verwijderen?`)) await api('DELETE', `${P()}/files/${fid}`);
        break;
      case 'file-up': await api('PATCH', `${P()}/files/${fid}`, { move: -1 }); break;
      case 'file-down': await api('PATCH', `${P()}/files/${fid}`, { move: 1 }); break;
      case 'dbx-up':
        await api('PATCH', `${P()}/files/${fid}`, { dropboxVersion: verStr(verNum(f.dropboxVersion) + 1), status: 'UPDATED' });
        break;
      case 'loaded':
        await api('PATCH', `${P()}/files/${fid}`, { serverVersion: f.dropboxVersion });
        break;
      case 'open':
        if (e.shiftKey) { copy(f.localPath); break; }
        await api('POST', '/api/open', { projectId: state.project.id, path: f.localPath });
        break;
      case 'copy': copy(f.localPath); break;
      case 'sec-up': await api('PATCH', `${P()}/sections/${sid}`, { move: -1 }); break;
      case 'sec-down': await api('PATCH', `${P()}/sections/${sid}`, { move: 1 }); break;
      case 'sec-nostatus': await api('PATCH', `${P()}/sections/${sid}`, { status: 'NO NEED' }); break;
      case 'sec-add': case 'sec-first': case 'sec-last': {
        const name = prompt('Naam van de song');
        if (name) await api('POST', `${P()}/sections`, { name, afterId: act === 'sec-add' ? sid : undefined });
        break;
      }
      case 'sec-del': {
        const s = state.project.sections.find((x) => x.id === sid);
        const cnt = state.project.files.filter((x) => x.sectionId === sid).length;
        if (confirm(`Song "${s.name}"${cnt ? ` en ${cnt} files` : ''} verwijderen?`)) await api('DELETE', `${P()}/sections/${sid}`);
        break;
      }
    }
    await loadProject(state.project.id);
  } catch (err) { toast(err.message); }
});

// "TAC_201_Lines_vXX" -> "TAC_202_Lines_vXX" (bumps the last 3-digit number)
function nextName(name) {
  if (!name) return '';
  const m = /^(.*?_)(\d{3})(_.*)$/.exec(name);
  if (!m) return name;
  return m[1] + String(+m[2] + 1).padStart(m[2].length, '0') + m[3];
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Pad gekopieerd'), () => prompt('Kopieer pad:', text));
}

// ---------- top bar ----------
$('#projectSelect').addEventListener('change', (e) => loadProject(e.target.value));
$('#search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.filter = b.dataset.f;
  $$('#filters button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
$('#btnLog').addEventListener('click', () => $('#logPanel').classList.toggle('hidden'));
$('[data-close]').addEventListener('click', () => $('#logPanel').classList.add('hidden'));
$('#btnUser').addEventListener('click', askUser);
$('#btnScan').addEventListener('click', async () => {
  const p = state.project;
  if (!p.paths.dropboxLocal && !p.paths.local) { toast('Stel eerst de mappen in bij Instellingen'); openSettings(); return; }
  $('#btnScan').disabled = true;
  try {
    const r = await api('POST', `${P()}/scan`);
    const part = (x, label) => (x ? (x.ok ? `${label}: ${x.files} bestanden` : `${label}: map niet gevonden`) : null);
    toast([part(r.dropbox, 'Dropbox'), part(r.local, 'Server'), `${r.changed} wijzigingen`].filter(Boolean).join(' · '));
    await loadProject(p.id);
  } catch (err) { toast(err.message); }
  $('#btnScan').disabled = false;
});
$('#btnNew').addEventListener('click', () => newProject());
$('#btnImport').addEventListener('click', () => openImport());

async function newProject() {
  const name = prompt('Naam van het project');
  if (!name) return;
  const p = await api('POST', '/api/projects', { name });
  await loadProjects(p.id);
  openSettings();
}

// ---------- settings ----------
function openSettings() {
  const p = state.project;
  const f = $('#formSettings');
  f.name.value = p.name;
  f.fps.value = p.fps;
  f.kinds.value = (p.kinds || []).join(', ');
  f.statuses.value = p.statuses.join(', ');
  f.screens.value = p.screens.map((s) => `${s.name} ${s.width}x${s.height}`).join('\n');
  f.dropboxWeb.value = p.paths.dropboxWeb || '';
  f.dropboxLocal.value = p.paths.dropboxLocal || '';
  f.local.value = p.paths.local || '';
  $('#lnkExport').href = `${P()}/export.csv`;
  $('#dlgSettings').showModal();
}
$('#btnSettings').addEventListener('click', openSettings);
$('#dlgSettings').addEventListener('close', async () => {
  if ($('#dlgSettings').returnValue !== 'ok') return;
  const f = $('#formSettings');
  const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const screens = f.screens.value.split('\n').map((l) => {
    const m = /^(.+?)\s+(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(l.trim());
    return m && { name: m[1].trim(), width: +m[2], height: +m[3] };
  }).filter(Boolean);
  try {
    await api('PATCH', P(), {
      name: f.name.value.trim(), fps: +f.fps.value || 50, kinds: list(f.kinds.value), statuses: list(f.statuses.value),
      screens, paths: { dropboxWeb: f.dropboxWeb.value.trim(), dropboxLocal: f.dropboxLocal.value.trim(), local: f.local.value.trim() },
    });
    await loadProjects(state.project.id);
    toast('Instellingen opgeslagen');
  } catch (err) { toast(err.message); }
});
$('#btnDeleteProject').addEventListener('click', async () => {
  const p = state.project;
  if (prompt(`Typ de projectnaam om "${p.name}" definitief te verwijderen`) !== p.name) return;
  await api('DELETE', P());
  $('#dlgSettings').close();
  await loadProjects();
});

// ---------- import ----------
function openImport() { $('#formImport').reset(); $('#dlgImport').showModal(); }
window.openImport = openImport;
window.newProject = newProject;
$('#dlgImport').addEventListener('close', async () => {
  if ($('#dlgImport').returnValue !== 'ok') return;
  const f = $('#formImport');
  let csv = f.csv.value;
  if (f.file.files[0]) csv = await f.file.files[0].text();
  if (!csv.trim()) return toast('Geen CSV gekozen');
  try {
    const p = await api('POST', `/api/import?name=${encodeURIComponent(f.name.value.trim())}`, csv);
    await loadProjects(p.id);
    toast(`${p.files.length} files geïmporteerd`);
    openSettings();
  } catch (err) { toast('Import mislukt: ' + err.message); }
});

// ---------- user ----------
function askUser() {
  $('#formUser').user.value = state.user;
  $('#dlgUser').showModal();
}
$('#dlgUser').addEventListener('close', () => {
  const v = $('#formUser').user.value.trim();
  if (v) { state.user = v; lsSet('ct.user', v); render(); }
});

// ---------- live updates ----------
function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => $('#live').classList.add('on');
  es.onerror = () => $('#live').classList.remove('on');
  es.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type !== 'change') return;
    if (state.project && msg.projectId === state.project.id) {
      await loadProject(state.project.id).catch(() => loadProjects());
    } else {
      const ids = (await api('GET', '/api/projects')).map((p) => p.id).join();
      if (ids !== state.projects.map((p) => p.id).join()) loadProjects(state.project?.id);
    }
  };
}

// ---------- boot ----------
(async () => {
  state.info = await api('GET', '/api/info').catch(() => ({}));
  await loadProjects();
  connect();
  if (!state.user) askUser();
})();
