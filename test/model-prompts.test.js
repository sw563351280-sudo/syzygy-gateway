'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const promptsPath = path.join(__dirname, '..', 'model_prompts.json');

test('model prompt configuration is valid JSON with usable entries', () => {
    const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));

    for (const name of ['deepseek', 'gemini', 'xx']) {
        assert.ok(Object.hasOwn(prompts, name), `${name} prompt must exist`);
    }
    for (const [name, config] of Object.entries(prompts)) {
        assert.equal(config.role, 'system', `${name}.role must be system`);
        assert.equal(typeof config.prepend, 'string', `${name}.prepend must be a string`);
        assert.ok(config.prepend.trim(), `${name}.prepend must not be empty`);
    }
});
