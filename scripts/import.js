// CLI import: node scripts/import.js "Project naam" pad/naar/sheet.csv
// (server mag niet tegelijk draaien — of gebruik "Importeer sheet" in de webinterface)
const fs = require('fs');
const path = require('path');
const Store = require('../lib/store');
const { importSheet } = require('../lib/csv-import');
const { uid } = require('../lib/util');

const [name, file] = process.argv.slice(2);
if (!name || !file) { console.log('Gebruik: node scripts/import.js "Project naam" sheet.csv'); process.exit(1); }
const store = new Store(path.resolve(__dirname, '..', process.env.DATA_FILE || 'data/data.json'));
const parsed = importSheet(fs.readFileSync(file, 'utf8'));
store.data.projects.push({
  id: uid(), name, fps: parsed.fps || 50,
  screens: parsed.screens, statuses: ['TO DO', 'IN PROGRESS', 'UPDATED', 'EXTRA CUE', 'NO NEED'],
  kinds: ['LOOP', 'LINEAR', 'STILL', 'NOTCH'],
  paths: { dropboxWeb: '', dropboxLocal: '', local: '' },
  sections: parsed.sections, files: parsed.files, lastScan: null, createdAt: new Date().toISOString(),
});
store.flush();
console.log(`Geïmporteerd: ${parsed.sections.length} songs, ${parsed.files.length} files, screens: ${parsed.screens.map((s) => s.name).join(', ')}`);
