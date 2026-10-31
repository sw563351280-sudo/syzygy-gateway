'use strict';
const express = require('express');
module.exports = function xhsRouter(gate, fetchMedia, maxImageBytes) {
const router = express.Router();
function xhsBrowserAction(req, res, next) {
    // Browser-only explicit action; model bridges cannot confirm writes.
    let sameOrigin = false;
    try { sameOrigin = new URL(req.headers.origin).host === req.get('host'); } catch {}
    if (!sameOrigin || req.get('X-XHS-Confirm') !== '1') return res.status(403).json({ error: '请在小屋页面操作' });
    next();
}
router.get('/approval/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(gate.approval(req.params.id)); } catch (error) { res.status(404).json({ error: error.message }); }
});
router.post('/approval/:id', xhsBrowserAction, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await gate.confirm(req.params.id)); } catch (error) { res.status(409).json({ error: error.message }); }
});
router.post('/login/:action', xhsBrowserAction, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const name = { status: 'check_login_status', qr: 'get_login_qrcode' }[req.params.action];
    if (!name) return res.sendStatus(404);
    try { res.json(JSON.parse(await gate.login(name))); } catch (error) { res.status(409).json({ error: error.message }); }
});
router.get('/media/:id', async (req, res) => {
    const url = gate.media(req.params.id);
    if (!url) return res.sendStatus(404);
    try {
        const media = await fetchMedia(url, maxImageBytes, 'image/*');
        if (!/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/i.test(media.contentType)) return res.sendStatus(415);
        res.set('Cache-Control', 'private, max-age=21600');
        res.set('X-Content-Type-Options', 'nosniff');
        res.type(media.contentType.split(';')[0]).send(media.buffer);
    } catch { res.status(502).json({ error: '图片暂时取不到' }); }
});

return router;
};
