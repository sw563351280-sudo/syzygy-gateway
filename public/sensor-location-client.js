/* Device-local location sharing for the main chat. */
'use strict';

(function installSensorLocation(global) {
    const PREFERENCE_KEY = 'syzygy.location-sharing.enabled.v1';
    const TOKEN_KEY = 'sensor_ingest_token';
    const LAST_SENT_KEY = 'syzygy.location-sharing.last-sent.v1';
    const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

    let enabled = false;
    let chatActive = false;
    let initialized = false;
    let requestInFlight = false;
    let timer = null;

    function storageGet(key) {
        try { return global.localStorage?.getItem(key) || ''; } catch (_) { return ''; }
    }

    function storageSet(key, value) {
        try { global.localStorage?.setItem(key, value); } catch (_) {}
    }

    function token() {
        return storageGet(TOKEN_KEY).trim();
    }

    function initialPreference() {
        const stored = storageGet(PREFERENCE_KEY);
        if (stored === 'true' || stored === 'false') return stored === 'true';
        // The old sensor page already required an explicit pairing step. Reuse
        // that consent on this device without turning location on elsewhere.
        return Boolean(token());
    }

    function statusElement() {
        return global.document?.getElementById('locationSharingStatus') || null;
    }

    function toggleElement() {
        return global.document?.getElementById('locationSharingToggle') || null;
    }

    function setStatus(message) {
        const element = statusElement();
        if (element) element.textContent = message;
    }

    function lastSentLabel() {
        const sentAt = Number(storageGet(LAST_SENT_KEY));
        if (!Number.isFinite(sentAt) || sentAt <= 0) return '聊天打开时自动更新';
        const elapsedMinutes = Math.max(0, Math.floor((Date.now() - sentAt) / 60000));
        if (elapsedMinutes < 1) return '刚刚更新';
        if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前更新`;
        return '聊天打开时自动更新';
    }

    function refreshStatus() {
        if (!enabled) return setStatus('已关闭');
        if (!token()) return setStatus('需要先在定位页完成配对');
        setStatus(lastSentLabel());
    }

    function shouldCollect() {
        return enabled && chatActive && !global.document?.hidden;
    }

    function stopTimer() {
        if (timer !== null) global.clearInterval(timer);
        timer = null;
    }

    function geolocationErrorMessage(error) {
        if (error?.code === 1) return '需要重新允许定位';
        if (error?.code === 2) return '暂时无法取得位置';
        if (error?.code === 3) return '定位超时，稍后再试';
        return '暂时无法取得位置';
    }

    async function uploadPosition(position) {
        if (!shouldCollect()) return;
        const uploadToken = token();
        if (!uploadToken) return refreshStatus();
        const capturedTime = Number(position?.timestamp);
        const capturedAt = new Date(Number.isFinite(capturedTime) ? capturedTime : Date.now()).toISOString();
        const payload = {
            device_id: 'iphone-chat',
            captured_at: capturedAt,
            location_captured_at: capturedAt,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
        };
        if (Number.isFinite(position.coords.accuracy)) payload.accuracy = position.coords.accuracy;
        try {
            const response = await global.fetch('/api/sensors/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + uploadToken },
                body: JSON.stringify(payload),
                cache: 'no-store',
                keepalive: true
            });
            if (!response.ok) {
                setStatus(response.status === 401 ? '配对已失效，请重新配对' : `更新失败（${response.status}）`);
                return;
            }
            if (!enabled) return refreshStatus();
            storageSet(LAST_SENT_KEY, String(Date.now()));
            setStatus('刚刚更新');
        } catch (_) {
            setStatus('网络恢复后会再试');
        }
    }

    function requestUpdate() {
        if (!shouldCollect() || requestInFlight) return;
        if (!token()) return refreshStatus();
        const geolocation = global.navigator?.geolocation;
        if (!geolocation?.getCurrentPosition) return setStatus('此设备不支持定位');
        requestInFlight = true;
        setStatus('正在更新位置…');
        geolocation.getCurrentPosition(
            position => {
                requestInFlight = false;
                void uploadPosition(position);
            },
            error => {
                requestInFlight = false;
                setStatus(geolocationErrorMessage(error));
            },
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
        );
    }

    function syncActivity({ immediate = true } = {}) {
        stopTimer();
        refreshStatus();
        if (!shouldCollect()) return;
        if (immediate) requestUpdate();
        timer = global.setInterval(requestUpdate, UPDATE_INTERVAL_MS);
    }

    function setEnabled(next) {
        enabled = Boolean(next);
        storageSet(PREFERENCE_KEY, String(enabled));
        const toggle = toggleElement();
        if (toggle) toggle.checked = enabled;
        syncActivity({ immediate: false });
    }

    function setChatActive(next) {
        const wasActive = chatActive;
        chatActive = Boolean(next);
        syncActivity({ immediate: chatActive && !wasActive });
    }

    function init() {
        if (initialized) return;
        initialized = true;
        enabled = initialPreference();
        const toggle = toggleElement();
        if (toggle) {
            toggle.checked = enabled;
            toggle.addEventListener('change', () => setEnabled(toggle.checked));
        }
        chatActive = global.document?.body?.dataset?.view === 'chat';
        global.document?.addEventListener('visibilitychange', () => syncActivity({ immediate: !global.document.hidden }));
        syncActivity({ immediate: chatActive });
    }

    global.SyzygyLocation = {
        init,
        requestUpdate,
        setChatActive,
        setEnabled,
        state: () => ({ enabled, chatActive, requestInFlight, timerActive: timer !== null })
    };

    if (global.document?.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(window);
