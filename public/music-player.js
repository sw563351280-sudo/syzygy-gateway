/* Shared music surface. The audio element lives outside all page sections. */
(() => {
    'use strict';
    if (window.SyzygyMusic) return;
    const host = document.createElement('div');
    host.id = 'syzygy-music';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <link rel="stylesheet" href="/music-player.css?v=3">
      <button part="launcher" class="launcher" aria-label="打开一起听歌">♫ <span>一起听</span></button>
      <div class="music-shell panel" hidden>
        <header><div><small>WINDOWSIDE RECORDS</small><h2>耳机分你一只。</h2></div><button data-action="settings-toggle" class="settings-button" aria-label="打开音乐设置">⚙</button></header>
        <p class="notice" role="status" aria-live="polite"></p>
        <section class="record-stage" aria-label="正在播放">
          <button class="record-button" data-action="open-lyrics" aria-label="点击唱片查看歌词">
            <span class="turntable"><span class="record"><img class="cover" alt="专辑封面" hidden><span class="record-label"></span><span class="record-hole"></span></span><span class="tonearm" aria-hidden="true"></span></span>
          </button>
          <div class="now"><strong class="song-name">还没有选择歌曲</strong><p class="artist">你先选。不选我就塞一首给你。</p><small class="state"></small><small class="shared-state"></small></div>
          <label class="seek-label"><span class="time">0:00 / 0:00</span><input class="seek" type="range" min="0" max="100" value="0" aria-label="播放进度"></label>
          <div class="transport"><button data-action="previous" aria-label="上一首">⏮</button><button data-action="toggle" aria-label="播放或暂停">▶</button><button data-action="next" aria-label="下一首">⏭</button></div>
        </section>
        <nav aria-label="音乐内容"><button data-tab="search" class="active">搜歌</button><button data-tab="queue">队列</button><button data-tab="playlists">歌单</button><button data-tab="daily">今日私选</button></nav>
        <div class="pane" data-pane="search"><form class="search"><input name="q" maxlength="200" placeholder="歌名 / 歌手" aria-label="搜索歌曲" required><button>搜索</button></form><div class="search-results"></div><h3>沈望点的歌</h3><div class="offers"><p class="empty">在聊天里说“陪我听首歌”。</p></div></div>
        <div class="pane" data-pane="queue" hidden><div class="row"><h3>当前队列</h3><button data-action="restore-lane" hidden>返回原队列</button><button data-action="clear-queue">清空</button></div><div class="queue-list"></div></div>
        <div class="pane" data-pane="playlists" hidden><div class="library-tools"><h3>我的歌单</h3><button data-action="playlist-import-toggle" aria-expanded="false">⊕</button></div><form class="import" hidden><input name="value" placeholder="网易云歌单 ID 或完整链接" aria-label="导入歌单" required><button>导入</button></form><button data-action="my-playlists">读取我的歌单</button><div class="library"></div></div>
        <div class="pane" data-pane="daily" hidden><div class="row"><h3>今日私选</h3><button data-action="refresh-daily">换一批</button><button data-action="play-daily">播放全部</button></div><p class="daily-note"></p><div class="daily-list"></div></div>
      </div>
      <section class="lyrics-view" hidden aria-label="歌词"><header><button data-action="close-lyrics" aria-label="返回唱片机">←</button><strong class="lyrics-title"></strong><span></span></header><pre class="lyrics">选一首歌后查看歌词。</pre></section>
      <section class="settings-drawer" hidden aria-label="音乐设置"><header><strong>设置</strong><button data-action="settings-toggle" aria-label="关闭音乐设置">×</button></header><div class="mode"><button data-mode="local">小屋播放器</button><button data-mode="netease-room">网易云一起听</button></div><div class="preferences"><label>音量<input class="volume" type="range" min="0" max="1" step="0.05" value="0.8"></label><label>音质<select class="quality" aria-label="音质"><option value="high">高音质</option><option value="smooth">流畅</option></select></label><label>顺序<select class="play-mode" aria-label="播放模式"><option value="sequence">顺序</option><option value="repeat-one">单曲循环</option><option value="shuffle">随机</option></select></label></div><div class="room" hidden><p>在网易云 App 邀请陪伴账号。歌曲由 App 播放，小屋只同步状态。</p><label>你的网易云 UID<input class="partner" inputmode="numeric" placeholder="发送邀请的账号 ID"></label><button data-action="join">开始等待邀请</button><button data-action="leave">退出房间</button></div><div class="account"><p>你的账号用于音源与收藏；陪伴账号用于网易云一起听。</p><div class="login-status"></div><div class="row"><button data-login="user">登录我的账号</button><button data-logout="user">退出我的账号</button></div><div class="row"><button data-login="companion">登录陪伴账号</button><button data-logout="companion">退出陪伴账号</button></div><img class="qr" alt="用网易云 App 扫码登录" hidden><p class="qr-status"></p><button data-action="summary">生成共听小结</button><pre class="summary"></pre></div><button data-action="stop" class="end-listening">结束共听</button></section>`;
    const $ = selector => root.querySelector(selector);
    // Keep native media output outside the collapsible panel. Web Audio can be
    // suspended by iOS in the background while the media clock keeps advancing.
    const audio = document.createElement('audio');
    audio.preload = 'none';
    root.append(audio);
    const owner = crypto.randomUUID();
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('syzygy-music-v1') : null;
    let csrf = '';
    let remote = { mode: 'local', state: 'closed' };
    let chosenMode = 'local';
    let current = null;
    let epoch = null;
    let generation = 0;
    let wantsPlayback = false;
    let claimChain = Promise.resolve();
    let eventChain = Promise.resolve();
    let currentTab = 'search';
    let queue = [];
    let cursor = -1;
    let interruption = null;
    let dailySongs = [];
    let lastHeartbeat = 0;
    let qrTimer = null;
    let qrGeneration = 0;
    let qrProfile = null;
    const refreshQr = document.createElement('button');
    refreshQr.textContent = '刷新二维码';
    refreshQr.dataset.action = 'refresh-qr';
    refreshQr.hidden = true;
    $('.qr-status').after(refreshQr);
    refreshQr.addEventListener('click', () => { if (qrProfile) void attempt(() => login(qrProfile)); });
    let lastOffers = '';
    let restoredTime = 0;
    let restoredFromServer = false;
    const inRoom = () => remote.mode === 'netease-room';
    function notice(text, error = false) { $('.notice').textContent = text; $('.notice').classList.toggle('error', error); }
    async function api(path, body, method = 'POST') {
        const response = await fetch('/api/music' + path, { method: body === undefined ? 'GET' : method,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Music-CSRF': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
        const value = await response.json();
        if (!response.ok) { const error = new Error(value.error || '音乐请求失败'); error.code = value.code; throw error; }
        return value;
    }
    function attempt(fn) { return Promise.resolve().then(fn).catch(e => notice(e.message, true)); }
    function snapshot() { return { version: 2, queue, cursor, currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        playMode: $('.play-mode').value, quality: $('.quality').value }; }
    function persist() {
        try { localStorage.setItem('syzygy-music-snapshot-v2', JSON.stringify({ ...snapshot(), savedAt: Date.now(), song: current, interruption })); } catch { /* Storage may be disabled. */ }
    }
    function sendEvent(type) {
        if (!epoch || inRoom()) return Promise.resolve();
        const body = { owner, epoch, type, songId: current?.id, snapshot: snapshot() };
        eventChain = eventChain.catch(() => {}).then(() => api('/session/event', body)).then(session => {
            if (epoch === body.epoch && session.owner === owner) { remote = session; updateModeUI(); }
        }).catch(e => {
            if (epoch !== body.epoch) return;
            if (['OWNER_CONFLICT', 'MODE_CONFLICT'].includes(e.code)) passiveStop();
            notice(e.message, true);
        });
        return eventChain;
    }
    function updateTransport() {
        $('.transport [data-action="toggle"]').textContent = wantsPlayback ? '❚❚' : '▶';
        $('.transport [data-action="toggle"]').setAttribute('aria-label', wantsPlayback ? '暂停' : '播放');
        if (navigator.mediaSession) navigator.mediaSession.playbackState = wantsPlayback && !audio.paused ? 'playing' : 'paused';
        renderNow();
    }
    function pausePlayback() {
        generation++;
        wantsPlayback = false;
        audio.pause();
        updateTransport();
        persist();
    }
    function passiveStop() { epoch = null; pausePlayback(); }
    function announce() {
        const message = { owner, at: Date.now() };
        channel?.postMessage(message);
        try { localStorage.setItem('syzygy-music-takeover', JSON.stringify(message)); } catch { /* Same-origin channel remains available. */ }
    }
    const takeover = message => { if (message?.owner !== owner && Date.now() - message.at < 10000) passiveStop(); };
    if (channel) channel.onmessage = e => takeover(e.data);
    window.addEventListener('storage', e => { if (e.key === 'syzygy-music-takeover') { try { takeover(JSON.parse(e.newValue)); } catch {} } });
    function volume() {
        // On iOS volume is controlled by the device buttons; do not reroute
        // through an AudioContext just to implement software volume.
        audio.volume = Number($('.volume').value);
    }
    function sharedState() {
        if (inRoom() && ['play', 'pause'].includes(remote.state)) return ['with-him', '♪ 他也戴着另一只耳机'];
        if (!inRoom() && ['play', 'pause'].includes(remote.state)) return ['alone', '此刻只有你一个人'];
        return ['ended', '耳机先收起来了'];
    }
    function renderNow(s = current) {
        $('.song-name').textContent = s?.name || '还没有选择歌曲';
        $('.artist').textContent = s?.artist || '你先选。不选我就塞一首给你。';
        $('.cover').hidden = !s;
        if (s) { $('.cover').src = `/api/music/cover/${s.id}`; $('.record-label').textContent = s.album?.slice(0, 12) || 'SHARED'; }
        const [kind, text] = sharedState();
        $('.shared-state').textContent = text;
        $('.shared-state').dataset.state = kind;
        $('.record-stage').dataset.playing = wantsPlayback && !audio.paused ? 'true' : 'false';
        $('.transport').hidden = inRoom();
        $('.seek-label').hidden = inRoom();
    }
    async function play(s, actor = 'user', lane = false, resumeTime = 0) {
        if (inRoom()) { notice('这是给网易云房间的点歌建议，请在网易云 App 选择：' + s.name); return; }
        volume();
        if (!lane && queue.length && cursor >= 0 && !interruption) interruption = { queue: [...queue], cursor, currentTime: audio.currentTime };
        passiveStop();
        const token = generation;
        wantsPlayback = true;
        current = s;
        updateTransport();
        // Serialize claims so an older, slow request cannot take over a newer song.
        const pendingClaim = claimChain.catch(() => {}).then(async () => {
            await eventChain.catch(() => {});
            if (token !== generation) return null;
            return api('/session/event', { type: 'claim', owner, songId: s.id, actor, snapshot: { ...snapshot(), currentTime: resumeTime } });
        });
        claimChain = pendingClaim;
        let claim;
        try { claim = await pendingClaim; }
        catch (e) { if (token !== generation) return; pausePlayback(); throw e; }
        if (token !== generation) return;
        epoch = claim.epoch;
        current = claim.song;
        remote = claim;
        audio.src = `/api/music/stream/${current.id}?quality=${$('.quality').value}`;
        if (resumeTime > 0) audio.addEventListener('loadedmetadata', () => {
            if (token === generation) audio.currentTime = Math.min(resumeTime, audio.duration || resumeTime);
        }, { once: true });
        announce(); renderNow(); renderQueue(); persist();
        if (navigator.mediaSession && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: current.name, artist: current.artist, album: current.album || '' });
        notice('正在准备音源…');
        try { await audio.play(); if (token === generation) notice(''); }
        catch (e) {
            if (token !== generation) return;
            wantsPlayback = false; updateTransport();
            await sendEvent('pause');
            notice(e.name === 'NotAllowedError' ? '浏览器需要你再点一下“播放”继续。' : '音源暂时无法播放，请尝试流畅音质或检查账号登录。', true);
        }
        if (!$('.lyrics-view').hidden) void attempt(loadLyrics);
    }
    async function resumePlayback() {
        if (inRoom() || wantsPlayback) return;
        if (!current) return notice('先选一首歌曲。');
        if (!epoch) {
            const position = audio.currentTime || restoredTime; restoredTime = 0;
            return play(current, 'user', true, position);
        }
        const token = ++generation;
        wantsPlayback = true; updateTransport(); volume();
        try { await audio.play(); }
        catch (e) { if (token !== generation) return; pausePlayback(); throw e; }
    }
    function appendButton(parent, text, action) {
        const button = document.createElement('button'); button.textContent = text;
        button.addEventListener('click', () => attempt(action)); parent.append(button); return button;
    }
    function renderSongs(container, songs, { actor = 'user', lane = false, feedback = false } = {}) {
        container.replaceChildren();
        if (!songs.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '这里还空着，放几首喜欢的歌进来。'; container.append(empty); }
        songs.forEach((s, index) => {
            const card = document.createElement('article'); card.className = 'track'; card.tabIndex = 0;
            const info = document.createElement('div'); info.className = 'track-info';
            const title = document.createElement('strong'); title.textContent = s.name;
            const artist = document.createElement('small'); artist.textContent = s.artist;
            info.append(title, artist);
            if (s.reason) { const reason = document.createElement('p'); reason.textContent = `${s.tag || ''} · ${s.reason}`; info.append(reason); }
            card.append(info);
            const more = document.createElement('details'); more.className = 'track-more';
            const summary = document.createElement('summary'); summary.textContent = '⋯'; summary.setAttribute('aria-label', `《${s.name}》更多操作`); more.append(summary);
            appendButton(more, inRoom() ? '点歌建议' : '加入队列', async () => { if (inRoom()) return play(s, actor, lane); if (!queue.some(v => v.id === s.id)) queue.push(s); queue = queue.slice(0, 200); renderQueue(); persist(); return sendEvent('queue'); });
            appendButton(more, '收藏', () => saveToPlaylist(s));
            if (feedback) {
                const select = document.createElement('select'); select.setAttribute('aria-label', '歌曲反馈');
                for (const [value, label] of [['', '反馈…'], ['like', '喜欢'], ['heard', '听过了'], ['more_like_this', '多推这种'], ['less_like_this', '少推这种'], ['dislike', '不喜欢']]) {
                    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
                }
                select.addEventListener('change', () => { if (select.value) void attempt(async () => { await api('/feedback', { songId: s.id, action: select.value }); notice('记住了，会用于下一次私选。'); }); });
                more.append(select);
            }
            card.append(more); container.append(card);
            const choose = () => { if (lane) { cursor = index; interruption = null; } void attempt(() => play(s, actor, lane)); };
            card.addEventListener('click', e => { if (!e.target.closest('details,button,select,summary')) choose(); });
            card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); choose(); } });
        });
    }
    function renderQueue() {
        renderSongs($('.queue-list'), queue, { lane: true });
        $('[data-action="restore-lane"]').hidden = !interruption;
    }
    async function saveToPlaylist(s) {
        const playlists = await api('/my-playlists');
        const container = $('.library'); container.replaceChildren();
        await tab('playlists', false);
        const heading = document.createElement('h3'); heading.textContent = `把《${s.name}》收藏到…`; container.append(heading);
        for (const p of playlists) appendButton(container, p.name, async () => {
            await api('/playlists/add-song', { songId: s.id, playlistId: p.id }); notice('已收藏到 ' + p.name);
        });
        if (!playlists.length) notice('没有可写入的自建歌单，请先在网易云创建歌单。');
    }
    async function loadLibrary() {
        const playlists = await api('/playlists');
        const container = $('.library'); container.replaceChildren();
        for (const p of playlists) {
            const section = document.createElement('details');
            const summary = document.createElement('summary'); summary.textContent = `${p.name} · ${p.tracks.length} 首`; section.append(summary);
            appendButton(section, '播放歌单', async () => { queue = p.tracks.slice(0, 200); cursor = 0; interruption = null; renderQueue(); persist(); if (queue[0]) await play(queue[0], 'user', true); });
            appendButton(section, '刷新', async () => { await api('/playlists/import', { value: p.id }); await loadLibrary(); });
            appendButton(section, '移除本地歌单', async () => { await api('/playlists/' + p.id, {}, 'DELETE'); await loadLibrary(); });
            const songs = document.createElement('div'); renderSongs(songs, p.tracks); section.append(songs); container.append(section);
        }
        if (!playlists.length) container.textContent = '导入一个喜欢的歌单，从这里开始。';
    }
    async function loadDaily(refresh = false) {
        notice('正在寻找并验证能播放的歌，首次可能需要一分钟…');
        const card = await api('/daily-discovery', { refresh });
        dailySongs = card.songs;
        $('.daily-note').textContent = `${card.date} · ${card.songs.length} 首 · ${card.strategy.llmRanked ? 'AI 私选' : '品味私选'}`;
        renderSongs($('.daily-list'), card.songs, { actor: 'companion', feedback: true });
        notice(card.warning || '今日私选准备好了。');
    }
    async function loadLyrics() {
        const s = inRoom() ? remote.song : current;
        $('.lyrics-title').textContent = s ? `${s.name} · ${s.artist}` : '歌词';
        if (!s) { $('.lyrics').textContent = '选一首歌后查看歌词。'; return; }
        const lyrics = await api('/lyrics/' + s.id);
        $('.lyrics').textContent = lyrics.lyric || '这首歌暂时没有歌词。';
    }
    async function openLyrics() {
        $('.lyrics-view').hidden = false;
        $('.music-shell').hidden = true;
        await loadLyrics();
    }
    function closeLyrics() { $('.lyrics-view').hidden = true; $('.music-shell').hidden = false; }
    async function tab(name, load = true) {
        currentTab = name;
        root.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
        root.querySelectorAll('[data-tab]').forEach(p => p.classList.toggle('active', p.dataset.tab === name));
        if (!load) return;
        if (name === 'queue') renderQueue();
        if (name === 'playlists') await loadLibrary();
        if (name === 'daily') await loadDaily();
    }
    function updateModeUI() {
        root.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === chosenMode));
        $('.room').hidden = chosenMode !== 'netease-room';
        $('.state').textContent = `${inRoom() ? '网易云一起听' : '小屋播放器'} · ${({ play: '正在播放', pause: '已暂停', waiting: '等待邀请 / 同步', ready: '等待播放', stale: '历史状态，点击播放继续', disconnected: '连接中断，正在重试', closed: '已结束', finished: '已播完' })[remote.state] || remote.state}`;
        renderNow();
    }
    async function refresh() {
        const observedGeneration = generation;
        const observedEpoch = epoch;
        const status = await api('/status');
        csrf = status.csrfToken;
        if (observedGeneration !== generation || observedEpoch !== epoch) return;
        if (epoch && (status.session.mode !== 'local' || status.session.owner !== owner || status.session.epoch !== epoch)) passiveStop();
        const oldRoomSong = remote.song?.id;
        remote = status.session;
        if (!restoredFromServer) {
            restoredFromServer = true;
            if (!current && remote.mode === 'local' && remote.song) {
                current = remote.song;
                const saved = remote.snapshot;
                if (saved?.version === 2) {
                    queue = saved.queue || []; cursor = saved.cursor; restoredTime = saved.currentTime || 0;
                    $('.quality').value = saved.quality; $('.play-mode').value = saved.playMode;
                }
                renderNow(); renderQueue();
            }
        }
        if (inRoom()) { chosenMode = 'netease-room'; renderNow(remote.song); }
        else if (chosenMode === 'netease-room' && remote.state === 'closed' && oldRoomSong) { chosenMode = 'local'; renderNow(); }
        $('.login-status').textContent = `我的账号：${status.userLoggedIn ? '已保存登录态' : '未登录'} · 陪伴账号：${status.companionLoggedIn ? '已保存登录态' : '未登录'}`;
        updateModeUI();
        if (!status.configured) notice('音乐面板已就绪，等待服务端连接音源服务。');
        if (inRoom() && oldRoomSong !== remote.song?.id && !$('.lyrics-view').hidden) void attempt(loadLyrics);
        if (!$('.music-shell').hidden) {
            const data = await api('/session');
            const signature = JSON.stringify(data.offers);
            if (signature !== lastOffers) {
                lastOffers = signature;
                const songs = data.offers.slice().reverse().flatMap(o => o.status === 'ready' ? [o.song] : o.candidates || []);
                renderSongs($('.offers'), [...new Map(songs.map(s => [s.id, s])).values()], { actor: 'companion' });
            }
        }
    }
    async function next(direction = 1) {
        if (interruption) {
            queue = interruption.queue; cursor = interruption.cursor;
            const position = interruption.currentTime; interruption = null;
            if (queue[cursor]) return play(queue[cursor], 'user', true, position);
        }
        if (!queue.length) { notice('队列已播完。'); return; }
        if ($('.play-mode').value === 'shuffle') cursor = Math.floor(Math.random() * queue.length);
        else cursor += direction;
        if (cursor < 0 || cursor >= queue.length) { cursor = Math.max(-1, Math.min(queue.length - 1, cursor)); notice('已到队列末尾。'); return; }
        await play(queue[cursor], 'user', true);
    }
    async function login(profile) {
        const token = ++qrGeneration;
        clearInterval(qrTimer);
        qrProfile = profile;
        refreshQr.hidden = false;
        refreshQr.disabled = true;
        $('.qr').hidden = true;
        $('.qr').removeAttribute('src');
        $('.qr-status').textContent = '正在生成新二维码…';
        let start;
        try { start = await api('/login/start', { profile }); }
        catch (e) {
            if (token !== qrGeneration) return;
            $('.qr-status').textContent = '生成失败，请点“刷新二维码”重试。';
            throw e;
        } finally { if (token === qrGeneration) refreshQr.disabled = false; }
        if (token !== qrGeneration) return;
        $('.qr').src = start.image; $('.qr').hidden = false;
        $('.qr-status').textContent = '请使用对应账号的网易云 App 扫码。';
        let checking = false;
        qrTimer = setInterval(async () => {
            if (checking) return;
            checking = true;
            try {
                const result = await api('/login/check', { token: start.token });
                if (token !== qrGeneration) return;
                $('.qr-status').textContent = ({ waiting: '等待扫码', confirm: '请在手机上确认登录', success: '登录成功', expired: '二维码已过期，请点“刷新二维码”。', error: '登录失败，请点“刷新二维码”重试。' })[result.status];
                if (result.status === 'success') { refreshQr.hidden = true; qrProfile = null; }
                if (['success', 'expired', 'error'].includes(result.status)) { clearInterval(qrTimer); $('.qr').hidden = true; await refresh(); }
            } catch (e) {
                if (token !== qrGeneration) return;
                clearInterval(qrTimer); $('.qr').hidden = true;
                $('.qr-status').textContent = '登录状态检查失败，请点“刷新二维码”重试。';
                notice(e.message, true);
            }
            finally { checking = false; }
        }, 3000);
    }
    root.addEventListener('click', e => {
        const button = e.target.closest('button'); if (!button) return;
        if (button.dataset.tab) void attempt(() => tab(button.dataset.tab));
        if (button.dataset.login) void attempt(() => login(button.dataset.login));
        if (button.dataset.logout) void attempt(async () => { qrGeneration++; clearInterval(qrTimer); qrProfile = null; refreshQr.hidden = true; $('.qr').hidden = true; $('.qr-status').textContent = ''; await api('/login/logout', { profile: button.dataset.logout }); await refresh(); });
        if (button.dataset.mode) void attempt(async () => {
            chosenMode = button.dataset.mode;
            if (chosenMode === 'local' && inRoom()) { await api('/mode', { mode: 'local' }); await refresh(); renderNow(); }
            updateModeUI();
        });
        const actions = {
            hide: () => { $('.music-shell').hidden = true; },
            'settings-toggle': () => { $('.settings-drawer').hidden = !$('.settings-drawer').hidden; },
            'open-lyrics': () => void attempt(openLyrics),
            'close-lyrics': closeLyrics,
            'playlist-import-toggle': () => { const form = $('.import'); form.hidden = !form.hidden; button.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) form.querySelector('input').focus(); },
            join: async () => { pausePlayback(); const closing = sendEvent('close'); epoch = null; await closing; passiveStop(); announce(); await api('/mode', { mode: 'netease-room', partnerUid: $('.partner').value.trim() }); await refresh(); notice('已开始等待，请在网易云 App 发出一起听邀请。'); },
            leave: async () => { await api('/mode', { mode: 'local' }); chosenMode = 'local'; await refresh(); renderNow(); },
            toggle: () => wantsPlayback || !audio.paused ? pausePlayback() : resumePlayback(),
            previous: () => next(-1), next: () => next(1),
            stop: async () => { pausePlayback(); const token = generation; const closing = sendEvent('close'); epoch = null; await closing; if (token !== generation) return; notice('本次共听已结束。'); await refresh(); },
            'clear-queue': () => { queue = []; cursor = -1; interruption = null; renderQueue(); persist(); return sendEvent('queue'); },
            'restore-lane': () => next(),
            'refresh-daily': () => loadDaily(true),
            'play-daily': async () => { queue = [...new Map([...queue, ...dailySongs].map(s => [s.id, s])).values()].slice(0, 200); cursor = queue.findIndex(s => s.id === dailySongs[0]?.id); interruption = null; renderQueue(); if (cursor >= 0) await play(queue[cursor], 'companion', true); },
            'my-playlists': async () => { const ps = await api('/my-playlists'); $('.library').replaceChildren(); for (const p of ps) appendButton($('.library'), `导入 ${p.name}`, async () => { await api('/playlists/import', { value: p.id }); await loadLibrary(); }); },
            summary: async () => { const s = await api('/summary', {}); $('.summary').textContent = `最近 ${s.eventCount} 条共听记录\n` + s.topArtists.map(a => `${a.artist} · ${a.plays} 次`).join('\n'); },
        };
        if (actions[button.dataset.action]) void attempt(actions[button.dataset.action]);
    });
    $('.launcher').addEventListener('click', () => { $('.music-shell').hidden = !$('.music-shell').hidden; if (!$('.music-shell').hidden) void attempt(refresh); });
    const chatSection = document.getElementById('sec-chat');
    if (chatSection) {
        const syncChatLauncher = () => host.classList.toggle('chat-active', chatSection.classList.contains('active'));
        new MutationObserver(syncChatLauncher).observe(chatSection, { attributes: true, attributeFilter: ['class'] });
        syncChatLauncher();
    }
    root.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (!$('.lyrics-view').hidden) { closeLyrics(); return; }
        if (!$('.settings-drawer').hidden) { $('.settings-drawer').hidden = true; return; }
        if (!$('.music-shell').hidden) { $('.music-shell').hidden = true; $('.launcher').focus(); }
    });
    $('.search').addEventListener('submit', e => { e.preventDefault(); const query = new FormData(e.currentTarget).get('q'); void attempt(async () => { notice('正在搜索…'); const songs = await api('/search?q=' + encodeURIComponent(query)); renderSongs($('.search-results'), songs); notice(songs.length ? '' : '没有找到歌曲，试试补充歌手。'); }); });
    $('.import').addEventListener('submit', e => { e.preventDefault(); const value = new FormData(e.currentTarget).get('value'); void attempt(async () => { notice('正在导入歌单…'); await api('/playlists/import', { value }); await loadLibrary(); notice('歌单已导入。'); }); });
    $('.volume').addEventListener('input', volume);
    $('.volume').addEventListener('change', volume);
    $('.play-mode').addEventListener('change', persist);
    $('.quality').addEventListener('change', () => { persist(); notice('音质设置将用于下一次播放。'); });
    $('.seek').addEventListener('input', e => { if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(e.target.value) / 100; });
    const time = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
    audio.addEventListener('playing', () => { if (audio.paused) return; if (!epoch || inRoom() || !wantsPlayback) { audio.pause(); return; } updateTransport(); void sendEvent('play'); });
    audio.addEventListener('pause', () => { if (!audio.paused || audio.ended) return; if (epoch) wantsPlayback = false; updateTransport(); if (epoch) { persist(); void sendEvent('pause'); } });
    audio.addEventListener('error', () => { if (epoch) { pausePlayback(); void sendEvent('pause'); notice('音源加载失败，请尝试重新登录、切换音质或另一首歌。', true); } });
    audio.addEventListener('ended', () => { if (!epoch || !audio.ended || !wantsPlayback) return; const token = generation; wantsPlayback = false; updateTransport(); void attempt(async () => { await sendEvent('finish'); if (token !== generation) return; if ($('.play-mode').value === 'repeat-one' && current) await play(current, 'user', true); else await next(); }); });
    if (navigator.mediaSession) {
        for (const [action, handler] of Object.entries({ play: resumePlayback, pause: pausePlayback, previoustrack: () => next(-1), nexttrack: () => next(1) })) {
            try { navigator.mediaSession.setActionHandler(action, () => { void attempt(handler); }); } catch { /* Some browsers only support play/pause. */ }
        }
    }
    audio.addEventListener('timeupdate', () => {
        $('.time').textContent = `${time(audio.currentTime)} / ${time(audio.duration)}`;
        $('.seek').value = audio.duration ? String(audio.currentTime / audio.duration * 100) : '0';
        if (Date.now() - lastHeartbeat > 10000 && epoch && !audio.paused) { lastHeartbeat = Date.now(); persist(); void sendEvent('heartbeat'); }
    });
    window.addEventListener('pagehide', () => {
        persist();
        if (epoch) void fetch('/api/music/session/event', { method: 'POST', keepalive: true,
            headers: { 'Content-Type': 'application/json', 'X-Music-CSRF': csrf }, body: JSON.stringify({ owner, epoch, type: 'close', snapshot: snapshot() }) });
    });
    try {
        const saved = JSON.parse(localStorage.getItem('syzygy-music-snapshot-v2') || 'null');
        if (saved?.version === 2) { queue = Array.isArray(saved.queue) ? saved.queue.slice(0, 200) : []; cursor = saved.cursor; current = saved.song; restoredTime = Number(saved.currentTime) || 0; interruption = saved.interruption; $('.quality').value = saved.quality || 'high'; $('.play-mode').value = saved.playMode || 'sequence'; }
    } catch { /* No automatic playback or writes on restoration. */ }
    window.SyzygyMusic = { open() { $('.lyrics-view').hidden = true; $('.music-shell').hidden = false; void attempt(refresh); }, play(id, actor = 'companion') {
        $('.lyrics-view').hidden = true; $('.music-shell').hidden = false; void attempt(async () => { const s = await api('/detail/' + id); await play(s, actor); });
    } };
    document.addEventListener('click', e => { const button = e.target.closest('[data-music-song]'); if (button) window.SyzygyMusic.play(button.dataset.musicSong); });
    let refreshing = false;
    function shouldPollStatus() {
        const inactiveLocalPlayer = audio.paused && !epoch && !inRoom();
        return !inactiveLocalPlayer || (!document.hidden && !$('.music-shell').hidden);
    }
    setInterval(async () => {
        if (refreshing || !shouldPollStatus()) return;
        refreshing = true;
        try { await refresh(); } catch (e) { notice('音乐状态同步暂时中断，正在重试。', true); }
        finally { refreshing = false; }
    }, 5000);
    renderNow(); renderQueue(); void attempt(refresh);
})();
