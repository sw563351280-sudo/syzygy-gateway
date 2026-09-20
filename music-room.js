'use strict';

// Protocol reference: wuxiandudang-hash/ncm-listen-together (MIT).
// This adapter owns connectivity only; it never fetches or plays audio.
const { fail, id } = require('./music-provider');

function inviteFrom(messages, partner, now = Date.now()) {
    for (const message of messages) {
        if (!Number.isFinite(message.time) || now - message.time > 300000 || message.time > now + 30000) continue;
        try {
            const payload = typeof message.msg === 'string' ? JSON.parse(message.msg) : message.msg;
            const native = payload?.generalMsg?.nativeUrl;
            if (typeof native !== 'string' || !/listenTogether/i.test(native)) continue;
            const decoded = decodeURIComponent(decodeURIComponent(native));
            const roomId = decoded.match(/roomId=([^&]+)/)?.[1];
            const inviter = decoded.match(/inviterId=([^&]+)/)?.[1] || partner;
            if (roomId && /^[\w-]{1,128}$/.test(roomId) && String(inviter) === String(partner)) return { roomId, inviterId: partner };
        } catch { /* A malformed old card must not hide a newer valid invitation. */ }
    }
    return null;
}

function createRoom({ provider, update, getSession, interval = 12000 }) {
    let timer = null;
    let generation = 0;
    let busy = false;
    let armed = false;
    let roomId = getSession().mode === 'netease-room' ? getSession().roomId || null : null;
    let partner = null;
    let controller = null;
    let lastError = null;
    const rejected = new Set();
    async function poll() {
        if (!armed || busy) return;
        busy = true;
        const token = generation;
        controller = new AbortController();
        const current = () => armed && token === generation && getSession().mode === 'netease-room';
        const api = (route, args = {}) => provider.api(route, args, 'companion', controller.signal);
        try {
            if (!roomId) {
                const history = await api('/msg/private/history', { uid: partner, limit: 8 });
                provider.check(history);
                if (!current()) return;
                const invite = inviteFrom(history.msgs || history.data?.msgs || [], partner);
                if (!invite || rejected.has(invite.roomId)) return;
                const accepted = await api('/listentogether/accept', invite);
                if (!current()) return;
                if (accepted.code !== 200) { rejected.add(invite.roomId); throw fail('ROOM_REJECTED', '邀请可能已失效，请重新邀请', 409); }
                roomId = String(accepted.data?.roomInfo?.roomId || invite.roomId);
                update({ mode: 'netease-room', state: 'waiting', roomId, song: null, actor: 'unknown', updatedAt: Date.now() }, 'join');
            }
            const playlist = await api('/listentogether/sync/playlist/get', { roomId });
            if (!current()) return;
            const cmd = playlist.data?.playCommand;
            let selected = getSession().song;
            const sid = cmd?.targetSongId || cmd?.formerSongId;
            if (sid && String(sid) !== selected?.id) selected = await provider.detail(id(sid), controller.signal);
            if (!current()) return;
            const heartbeat = await api('/listentogether/heatbeat', {
                roomId, songId: selected?.id || '0', playStatus: cmd?.playStatus === 'PLAY', progress: Number(cmd?.progress || 0),
            });
            if (!current()) return;
            if (heartbeat.code === 488) {
                rejected.add(roomId);
                const endedRoom = roomId;
                roomId = null;
                armed = false;
                clearInterval(timer); timer = null;
                update({ mode: 'local', state: 'closed', song: null, roomId: null, owner: null, updatedAt: Date.now() }, 'room_end', { endedRoom });
                return;
            }
            provider.check(heartbeat);
            provider.check(playlist);
            lastError = null;
            const previous = getSession();
            const state = cmd?.playStatus === 'PLAY' ? 'play' : cmd?.playStatus === 'PAUSE' ? 'pause' : 'waiting';
            const changed = previous.song?.id !== selected?.id || previous.state !== state;
            // Every observed song change is recorded. Chattiness is a presentation
            // concern, not a reason to discard source-of-truth events.
            update({ mode: 'netease-room', state, song: selected, roomId, actor: 'unknown', updatedAt: Date.now(), error: null }, changed ? state : null);
        } catch (error) {
            if (current()) {
                lastError = error.code || 'ROOM_UNAVAILABLE';
                try { update({ ...getSession(), state: 'disconnected', error: lastError, updatedAt: Date.now() }, 'disconnect'); }
                catch { /* A busy/corrupt state store must not crash the poller. */ }
            }
        } finally { busy = false; }
    }
    async function stop() {
        generation++;
        armed = false;
        controller?.abort();
        clearInterval(timer); timer = null;
        const leaving = roomId;
        if (leaving) {
            lastError = 'LEAVING';
            // Retain the remote room ID on failure so the UI can retry explicitly.
            const result = await provider.api('/listentogether/end', { roomId: leaving }, 'companion');
            if (![200, 488].includes(result.code)) throw fail('LEAVE_FAILED', '退出房间未确认，请在网易云结束房间或重试', 502);
        }
        roomId = null; lastError = null;
    }
    function start(uid) {
        partner = id(uid);
        generation++;
        armed = true;
        clearInterval(timer);
        timer = setInterval(() => { void poll(); }, interval);
        timer.unref?.();
        void poll();
    }
    return { start, stop, poll, status: () => ({ armed, connected: Boolean(roomId) && !lastError, error: lastError }),
        dispose() { armed = false; generation++; controller?.abort(); clearInterval(timer); } };
}

module.exports = { createRoom, inviteFrom };
