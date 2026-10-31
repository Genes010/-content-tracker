const crypto = require('crypto');

const uid = () => crypto.randomBytes(6).toString('hex');

// "v03" / "V3" / "3" -> 3, empty -> 0
const verNum = (v) => {
  const m = /(\d+)/.exec(String(v || ''));
  return m ? parseInt(m[1], 10) : 0;
};
const verStr = (n) => (n > 0 ? 'v' + String(n).padStart(2, '0') : '');

module.exports = { uid, verNum, verStr };
