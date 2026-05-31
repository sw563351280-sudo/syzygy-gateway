// 将 transcript_buffer.json 中未归档的消息归档到当月 transcript 文件
// 部署时由 deploy.yml 调用，防止未满6轮的消息丢失

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const bufFile = path.join(DATA_DIR, 'transcript_buffer.json');

if (!fs.existsSync(bufFile)) {
    console.log('📜 没有 buffer 文件，跳过归档');
    process.exit(0);
}

let buf;
try {
    buf = JSON.parse(fs.readFileSync(bufFile, 'utf8'));
} catch (e) {
    console.log('📜 buffer 文件损坏，跳过');
    process.exit(0);
}

if (!buf.messages || buf.messages.length === 0) {
    console.log('📜 buffer 为空，跳过归档');
    fs.unlinkSync(bufFile);
    process.exit(0);
}

if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

const content = buf.messages.map(m => {
    const d = m.time ? new Date(m.time) : new Date();
    return '[' + (d.getMonth() + 1) + '月' + d.getDate() + '日] ' + (m.role === 'user' ? '江鱼' : '沈望') + ': ' + m.content;
}).join('\n');

const firstUser = buf.messages.find(m => m.role === 'user');
const firstAi = buf.messages.find(m => m.role === 'assistant');
const chunk = {
    id: 'tx_buf_' + Date.now().toString(36),
    timestamp: buf.started_at || new Date().toISOString(),
    end_time: new Date().toISOString(),
    platform: 'web',
    topic_boundary: false,
    messages: buf.messages,
    chunk_summary: ((firstUser && firstUser.content || '').substring(0, 30) + ' → ' + (firstAi && firstAi.content || '').substring(0, 30)).trim(),
    content: content,
    tags: [],
    expires_at: null
};

const d = new Date();
const monthFile = path.join(TRANSCRIPTS_DIR, d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '.json');

let existing = [];
try {
    existing = JSON.parse(fs.readFileSync(monthFile, 'utf8'));
} catch (e) {}

existing.push(chunk);
fs.writeFileSync(monthFile, JSON.stringify(existing, null, 2), 'utf8');
fs.unlinkSync(bufFile);

console.log('📜 buffer 已归档: ' + chunk.id + ' (' + buf.messages.length + '条消息) → ' + path.basename(monthFile));
