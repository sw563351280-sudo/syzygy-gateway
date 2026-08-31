'use strict';

// 使用方式：node scripts/read_journal.js <密钥>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const passphrase = process.argv[2];
if (!passphrase) {
    console.log('需要密钥。');
    process.exit(1);
}

const journalFile = path.join(__dirname, '..', 'data', 'private_journal.enc');
if (!fs.existsSync(journalFile)) {
    console.log('日记本还是空的。');
    process.exit(0);
}

const key = crypto.createHash('sha256').update(passphrase).digest();
const lines = fs.readFileSync(journalFile, 'utf8').split(/\r?\n/).filter(Boolean);

for (const line of lines) {
    try {
        const { iv, tag, data } = JSON.parse(line);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        const entry = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
        console.log(entry + '\n');
    } catch (_) {
        console.log('[解密失败] 密钥不对或记录损坏');
    }
}
