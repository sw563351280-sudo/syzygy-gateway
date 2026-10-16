'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/script.js'), 'utf8');
const start = source.indexOf('let _isOpeningArchiveRoom = false;');
const end = source.indexOf('async function triggerDreamFromHome()', start);
const authSource = source.slice(start, end);

function setup({ stored = '', promptValue = '', responses = [] } = {}) {
    let current = stored;
    const removed = [];
    const saved = [];
    const assigned = [];
    const prompts = [];
    const toasts = [];
    const fetches = [];
    const button = { style: { opacity: '' } };
    const context = vm.createContext({
        encodeURIComponent,
        document: { querySelector: () => button },
        localStorage: {
            getItem: key => key === 'memoryPwd' ? current : null,
            removeItem: key => { removed.push(key); if (key === 'memoryPwd') current = ''; },
            setItem: (key, value) => { saved.push([key, value]); if (key === 'memoryPwd') current = value; }
        },
        prompt: message => { prompts.push(message); return promptValue; },
        toast: message => toasts.push(message),
        fetch: async (url, options) => {
            fetches.push({ url, options });
            return responses.shift() || { status: 302, type: 'basic' };
        },
        window: { location: { assign: url => assigned.push(url) } }
    });
    vm.runInContext(authSource, context);
    return { context, removed, saved, assigned, prompts, toasts, fetches, button };
}

test('rejected stored password is cleared and replaced with the independent Star Crossing password', async () => {
    const state = setup({
        stored: 'house-password',
        promptValue: 'star-password',
        responses: [{ status: 401, type: 'basic' }, { status: 302, type: 'basic' }]
    });

    await state.context.openStarCrossing();

    assert.deepEqual(state.removed, ['memoryPwd']);
    assert.deepEqual(state.saved, [['memoryPwd', 'star-password']]);
    assert.deepEqual(state.assigned, ['/long-term.html?pwd=star-password']);
    assert.equal(state.prompts.length, 1);
    assert.match(state.prompts[0], /星渡独立密码（不是小屋登录密码）/);
    assert.equal(state.fetches.length, 2);
});

test('rejected replacement is not saved or opened', async () => {
    const state = setup({
        stored: 'house-password',
        promptValue: 'still-wrong',
        responses: [{ status: 401, type: 'basic' }, { status: 401, type: 'basic' }]
    });

    await state.context.openStarCrossing();

    assert.deepEqual(state.saved, []);
    assert.deepEqual(state.assigned, []);
    assert.equal(state.removed.length, 2);
    assert.deepEqual(state.toasts, ['星渡独立密码不正确，请重新输入']);
    assert.equal(state.button.style.opacity, '');
});

test('temporary server failure does not erase a stored password', async () => {
    const state = setup({
        stored: 'star-password',
        responses: [{ status: 503, type: 'basic' }]
    });

    await state.context.openStarCrossing();

    assert.deepEqual(state.removed, []);
    assert.deepEqual(state.saved, []);
    assert.deepEqual(state.assigned, []);
    assert.deepEqual(state.toasts, ['星渡暂时无法验证密码，请稍后重试']);
});
