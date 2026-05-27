// p0b_reset_pinned.js — 将所有条目 pinned 重置为 false
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILES = ['long_term_memories.json', 'deep_archive.json', 'roleplay_archives.json'];

let grandTotal = 0, totalReset = 0;

for (const file of FILES) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) continue;
  const mems = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  let reset = 0;
  for (const m of mems) {
    if (m.pinned === true) {
      m.pinned = false;
      reset++;
    }
  }
  fs.writeFileSync(fp, JSON.stringify(mems, null, 2), 'utf-8');
  console.log(`${file}: ${mems.length}条, 重置pinned ${reset}条`);
  grandTotal += mems.length;
  totalReset += reset;
}

console.log(`\nReset ${totalReset} entries from pinned=true to pinned=false. Total: ${grandTotal}.`);
