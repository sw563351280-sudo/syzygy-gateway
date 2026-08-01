const fs = require('fs');
const s = fs.readFileSync(__dirname + '/server.js', 'utf8');
if (s.includes('tagLower.includes(textLower)')) console.log('isTagMatch: FIXED (bidirectional)');
else console.log('isTagMatch: OLD (one-way only)');
