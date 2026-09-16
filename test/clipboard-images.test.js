'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectImages, isImageFile } = require('../public/clipboard-images');

test('clipboard image collector keeps screenshots and ignores text', () => {
    const screenshot = { type: 'image/png', name: 'Screenshot.png' };
    const clipboard = {
        items: [
            { kind: 'string', type: 'text/plain', getAsFile: () => null },
            { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
        ],
        files: [screenshot]
    };

    assert.deepEqual(collectImages(clipboard), [screenshot]);
});

test('clipboard image collector deduplicates desktop clipboard wrappers', () => {
    const itemImage = {
        type: 'image/png',
        name: 'image.png',
        size: 18432,
        lastModified: 0
    };
    const filesImage = {
        type: 'image/png',
        name: 'image.png',
        size: 18432,
        lastModified: 0
    };
    const clipboard = {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => itemImage }],
        files: [filesImage]
    };

    assert.deepEqual(collectImages(clipboard), [itemImage]);
});

test('clipboard image collector does not hijack plain text paste', () => {
    const clipboard = {
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
        files: []
    };

    assert.deepEqual(collectImages(clipboard), []);
    assert.equal(isImageFile({ type: 'text/plain' }), false);
});
