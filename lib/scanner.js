// Scan a folder tree and find the highest version of each content file.
// "TAC_201_Lines_vXX" matches TAC_201_Lines_v01.mov, TAC_201_Lines_v3.mp4, tac_201_lines_V02.png ...
const fs = require('fs');
const path = require('path');
const { verNum, verStr } = require('./util');

const MAX_DEPTH = 8;
const MAX_FILES = 50000;

function walk(root) {
  const out = [];
  const stack = [[root, 0]];
  while (stack.length && out.length < MAX_FILES) {
    const [dir, depth] = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) stack.push([full, depth + 1]);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

// Base name without the version token: "TAC_201_Lines_vXX" -> "tac_201_lines"
function baseKey(name) {
  return String(name)
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_\-\s]+v?(xx|\d+)$/i, '')
    .toLowerCase();
}

function index(root) {
  const map = new Map(); // baseKey -> { version, path }
  if (!root || !fs.existsSync(root)) return { ok: false, map, count: 0 };
  const files = walk(root);
  for (const full of files) {
    const stem = path.basename(full).replace(/\.[^.]+$/, '');
    const m = /^(.*?)[_\-\s]+v(\d+)$/i.exec(stem);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const v = parseInt(m[2], 10);
    const prev = map.get(key);
    if (!prev || v > prev.version) map.set(key, { version: v, path: full });
  }
  return { ok: true, map, count: files.length };
}

function lookup(idx, fileName) {
  const hit = idx.map.get(baseKey(fileName));
  return hit ? { version: verStr(hit.version), path: hit.path } : null;
}

module.exports = { index, lookup, baseKey, verNum };
