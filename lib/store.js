// Tiny JSON-file store with atomic writes and a backup per day.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.dir = path.dirname(file);
    fs.mkdirSync(this.dir, { recursive: true });
    this.data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { projects: [], log: [] };
    this.data.log ||= [];
    this.rev = 0;
    this._timer = null;
  }

  project(id) {
    return this.data.projects.find((p) => p.id === id);
  }

  log(entry) {
    this.data.log.unshift({ at: new Date().toISOString(), ...entry });
    this.data.log.length = Math.min(this.data.log.length, 500);
  }

  save() {
    this.rev++;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    const json = JSON.stringify(this.data, null, 2);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, this.file);
    const day = new Date().toISOString().slice(0, 10);
    const backupDir = path.join(this.dir, 'backups');
    const backup = path.join(backupDir, `data-${day}.json`);
    if (!fs.existsSync(backup)) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(backup, json);
    }
  }
}

module.exports = Store;
