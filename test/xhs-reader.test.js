'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractXhsUrl,
    isAllowedXhsMediaUrl,
    isAllowedXhsUrl,
    parseInitialState,
    readXhsNote,
} = require('../xhs-reader');

test('only accepts HTTPS Xiaohongshu share URLs and CDN media', () => {
    assert.equal(isAllowedXhsUrl('https://xhslink.com/abc'), true);
    assert.equal(isAllowedXhsUrl('https://www.xiaohongshu.com/explore/abc?xsec_token=ok'), true);
    assert.equal(isAllowedXhsUrl('http://xhslink.com/abc'), false);
    assert.equal(isAllowedXhsUrl('https://example.com/?next=xhslink.com'), false);
    assert.equal(isAllowedXhsMediaUrl('https://sns-img-hw.xhscdn.com/abc.jpg'), true);
    assert.equal(isAllowedXhsMediaUrl('https://example.com/abc.jpg'), false);
});

test('extracts a pasted XHS URL without trailing Chinese punctuation', () => {
    assert.equal(extractXhsUrl('你看这个 https://xhslink.com/abc123 。'), 'https://xhslink.com/abc123');
    assert.equal(extractXhsUrl('复制这条 http://xhslink.cn/o/5SsO51vD8at，打开小红书'), 'https://xhslink.cn/o/5SsO51vD8at');
    assert.equal(extractXhsUrl('没有链接'), null);
});

test('parses INITIAL_STATE and normalizes a video note', async () => {
    const state = {
        noteData: { data: { noteData: {
            noteId: 'note_1', title: '猫咪探店', desc: '第三帧有三花。',
            user: { nickname: '小猫' },
            imageList: [{ infoList: [{ imageScene: 'WB_DFT', url: 'https://sns-img-hw.xhscdn.com/cover.jpg' }] }],
            video: { media: { stream: { h264: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/video.mp4' }] } } },
            interactInfo: { likedCount: '12', collectedCount: '3', commentCount: '1' }
        } } }
    };
    const html = `<script>window.__INITIAL_STATE__ = ${JSON.stringify(state)};</script>`;
    assert.equal(parseInitialState(html).noteData.data.noteData.title, '猫咪探店');
    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(html)); controller.close(); } })
    });
    const note = await readXhsNote(fetchImpl, 'https://xhslink.com/abc');
    assert.equal(note.type, 'video');
    assert.equal(note.video_url, 'https://sns-video-bd.xhscdn.com/video.mp4');
    assert.deepEqual(note.images, ['https://sns-img-hw.xhscdn.com/cover.jpg']);
});

test('rejects redirects that leave the Xiaohongshu allowlist', async () => {
    const fetchImpl = async () => ({ ok: false, status: 302, headers: new Headers({ location: 'https://example.com/private' }) });
    await assert.rejects(() => readXhsNote(fetchImpl, 'https://xhslink.com/abc'), /不受支持/);
});
