'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
function plain(value) {
    return String(value || '').replace(/<(think|thinking|SAVE_MEMORY|MOOD_SNAPSHOT)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/⟦ts:[^⟧]*⟧/g, '').replace(/<[^>]*>/g, '').replace(/[*#_`]/g, '').trim();
}
function newest(rows, date) { return [...rows].sort((a, b) => String(date(b) || '').localeCompare(String(date(a) || '')))[0]; }
function homeSnapshot({ now = new Date(), pages = [], todos = [], diaries = [], photos = [], messages = [], music = null, calendarAvailable = true, starOrbit = null }) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const days = Math.max(0, Math.floor((Date.parse(date) - Date.parse('2025-04-20')) / 86400000));
    const key = d => String(d || '').split('-').map(x => Number(x)).join('-');
    const today = pages.find(p => key(p.date) === key(date));
    const note = newest(pages.filter(p => plain(p.shenwang_note)), p => key(p.date).split('-').map(x => x.padStart(2, '0')).join('-'));
    const message = [...messages].reverse().find(m => m.role === 'assistant' && plain(m.content));
    // Never open sealed private journals. Read an existing calendar note or visible chat.
    const letter = note ? { text: plain(note.shenwang_note), date: note.date, source: '日历留言' }
        : message ? { text: plain(message.content), date: message.fullTime || message.time || '', source: '最近的对话' } : null;
    const diary = newest(diaries.filter(d => !['mood_snapshot', 'daily_flow'].includes(d.type) && (d.text || d.title)), d => d.datetime || d.date);
    const photo = newest(photos, p => p.created_at || p.date);
    const lastPlay = [...(music?.events || [])].reverse().find(e => ['play', 'resume', 'finish'].includes(e.type) && e.song);
    const playing = ['play', 'resume'].includes(music?.session?.state) && now.getTime() - music.session.updatedAt < 45000;
    const song = playing ? music.session.song : lastPlay?.song;
    return { date, days, nextMilestone: (Math.floor(days / 100) + 1) * 100,
        todos: todos.filter(t => !t.done), calendarAvailable,
        schedules: calendarAvailable && Array.isArray(today?.schedules) ? today.schedules.filter(s => s && typeof s.text === 'string') : [],
        letter, diary: note ? { title: plain(note.title || note.shenwang_note).split('\n')[0].slice(0, 18), date: note.date } : diary ? { title: plain(diary.title || diary.text).split('\n')[0].slice(0, 18), date: diary.date || diary.datetime } : null,
        photo: photo ? { title: plain(photo.title || photo.description || '海边的留影').slice(0, 24), date: photo.date } : null,
        music: song ? { name: song.name, artist: song.artist, at: playing ? music.session.updatedAt : lastPlay.at, playing } : null,
        musicAvailable: music !== null,
        starOrbit };
}
function createHomeSea({ directory, snapshot, clock = () => new Date() }) {
    const file = path.join(directory, 'home_signals.json');
    function read() {
        try { const rows = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(rows)) throw Error('Invalid signals'); return rows; }
        catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    }
    function record(id) {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw Object.assign(Error('无效的心意记录'), { status: 400 });
        const rows = read(), existing = rows.find(r => r.id === id);
        if (existing) return existing;
        const at = clock().toISOString();
        if (rows.length && Date.parse(at) - Date.parse(rows.at(-1).at) < 1500) throw Object.assign(Error('稍等一会，再把心意送来'), { status: 429 });
        const event = { id, type: 'miss-you', at };
        const temp = file + '.tmp';
        fs.writeFileSync(temp, JSON.stringify([...rows, event].slice(-200)), { mode: 0o600 });
        fs.renameSync(temp, file);
        return event;
    }
    function context() {
        try {
            const latest = read().at(-1);
            if (!latest || clock().getTime() - Date.parse(latest.at) > 86400000) return '';
            return `\n【首页的小小心意】江鱼在 ${latest.at} 点击了“想他了”。这是真实点击记录，可以自然回应；它不是一条聊天消息，也不代表你已回复。\n`;
        } catch { return ''; }
    }
    const router = express.Router();
    router.get('/summary', async (_req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json(await snapshot()); } catch { res.status(503).json({ error: '海边的消息暂时没同步好，请稍后重试' }); }
    });
    router.post('/miss-you', (req, res) => {
        try { res.json({ ok: true, event: record(req.body?.id) }); }
        catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : '心意暂时没有送达，请重试' }); }
    });
    return { router, record, context };
}
module.exports = { homeSnapshot, createHomeSea, plain };
