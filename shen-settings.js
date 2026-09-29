'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');

const MAX_PROMPT_LENGTH = 50000;

function createShenSettings({ directory, legacyPromptFile }) {
    const settingsFile = path.join(directory, 'shen-settings.json');
    const backupFile = settingsFile + '.backup';

    function legacyPrompt() {
        return fs.readFileSync(legacyPromptFile, 'utf8').trim();
    }

    function initialSettings() {
        const prompt = legacyPrompt();
        return { active: 'A', prompts: { A: prompt, B: prompt }, updatedAt: null };
    }

    function readFile(file) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }

    function normalize(value) {
        const active = value?.active === 'B' ? 'B' : 'A';
        const prompts = value?.prompts;
        if (!prompts || typeof prompts.A !== 'string' || typeof prompts.B !== 'string') {
            throw new Error('沈望设定文件损坏，请检查服务器文件');
        }
        if (!prompts.A.trim() || !prompts.B.trim()) throw new Error('A/B 两版 prompt 都不能为空');
        if (prompts.A.length > MAX_PROMPT_LENGTH || prompts.B.length > MAX_PROMPT_LENGTH) {
            throw new Error(`每版 prompt 最多 ${MAX_PROMPT_LENGTH} 字符`);
        }
        return { active, prompts: { A: prompts.A, B: prompts.B }, updatedAt: value.updatedAt || null };
    }

    function settings() {
        const saved = readFile(settingsFile) || readFile(backupFile);
        return saved ? normalize(saved) : initialSettings();
    }

    function write(file, value) {
        fs.mkdirSync(directory, { recursive: true });
        const temporary = file + '.' + randomUUID() + '.tmp';
        try {
            fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
            fs.renameSync(temporary, file);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }

    function saveSettings(value) {
        const previous = settings();
        if (Object.hasOwn(value || {}, 'expectedUpdatedAt') && value.expectedUpdatedAt !== previous.updatedAt) {
            const error = new Error('设定已在其他页面更新。你的草稿仍在，请重新打开后核对。');
            error.status = 409;
            throw error;
        }
        const normalized = normalize({ active: value?.active, prompts: value?.prompts, updatedAt: null });
        const result = {
            ...normalized,
            updatedAt: new Date(Math.max(Date.now(), (Date.parse(previous.updatedAt) || 0) + 1)).toISOString()
        };
        write(settingsFile, result);
        write(backupFile, result);
        return result;
    }

    function activePrompt() {
        const value = settings();
        return value.prompts[value.active];
    }

    return { settings, saveSettings, activePrompt };
}

function shenSettingsRouter(store) {
    const router = express.Router();
    router.get('/', (_req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json({ version: 1, settings: store.settings(), maxPromptLength: MAX_PROMPT_LENGTH }); }
        catch (error) { res.status(500).json({ error: error.message }); }
    });
    router.put('/', (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json({ version: 1, settings: store.saveSettings(req.body) }); }
        catch (error) { res.status(error.status || 400).json({ error: error.message }); }
    });
    return router;
}

module.exports = { createShenSettings, shenSettingsRouter, MAX_PROMPT_LENGTH };
