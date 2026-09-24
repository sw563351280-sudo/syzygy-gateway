'use strict';
const { mergeUsage } = require('./context-budget');

function mergeToolCallDeltas(target, deltas) {
    for (const delta of deltas || []) {
        const index = Number.isInteger(delta?.index) ? delta.index : target.length;
        if (!target[index]) {
            target[index] = {
                id: delta?.id || '',
                type: delta?.type || 'function',
                function: { name: '', arguments: '' },
            };
        }
        const current = target[index];
        if (delta?.id) current.id = delta.id;
        if (delta?.type) current.type = delta.type;
        if (delta?.function?.name) current.function.name += delta.function.name;
        if (delta?.function?.arguments) current.function.arguments += delta.function.arguments;
    }
}

async function consumeOpenAIStream(stream, onChunk = null) {
    if (!stream || typeof stream.getReader !== 'function') {
        throw new Error('上游流式响应缺少可读取的 Web Stream');
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const result = {
        id: '',
        model: '',
        content: '',
        reasoning: '',
        toolCalls: [],
        finishReason: null,
        usage: null,
    };

    async function consumeLine(rawLine) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;

        let parsed;
        try { parsed = JSON.parse(payload); } catch (_) { return; }
        if (parsed.id) result.id = parsed.id;
        if (parsed.model) result.model = parsed.model;
        if (parsed.usage) result.usage = mergeUsage(result.usage, parsed.usage);

        const choice = parsed.choices?.[0];
        const delta = choice?.delta || {};
        if (typeof delta.content === 'string') result.content += delta.content;
        if (typeof delta.reasoning_content === 'string') result.reasoning += delta.reasoning_content;
        if (Array.isArray(delta.tool_calls)) mergeToolCallDeltas(result.toolCalls, delta.tool_calls);
        if (choice?.finish_reason) result.finishReason = choice.finish_reason;
        if (onChunk) await onChunk(parsed, delta);
    }

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) await consumeLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) await consumeLine(buffer);
    result.toolCalls = result.toolCalls.filter(Boolean);
    return result;
}

module.exports = {
    consumeOpenAIStream,
    mergeToolCallDeltas,
};
