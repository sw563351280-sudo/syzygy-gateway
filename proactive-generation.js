'use strict';

const INITIAL_MAX_TOKENS = 1024;
const RETRY_MAX_TOKENS = 2048;
const RETRY_INSTRUCTION = '【截断重试】请从头重新生成，不要续写刚才被截断的内容。正文保持1至3句，表达完整、自然收尾；正文后必须输出完整的 NEXT_WAKE 标签。';

function buildRetryMessages(messages = []) {
    const retryMessages = messages.map(message => ({ ...message }));
    const last = retryMessages[retryMessages.length - 1];
    if (last?.role === 'user' && typeof last.content === 'string') {
        last.content = `${last.content}\n\n${RETRY_INSTRUCTION}`;
    } else {
        retryMessages.push({ role: 'user', content: RETRY_INSTRUCTION });
    }
    return retryMessages;
}

async function generateProactiveCompletion({ fetchImpl, url, apiKey, model, messages, temperature = 0.65 }) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

    const attempts = [];
    const request = async (requestMessages, maxTokens) => {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages: requestMessages, temperature, max_tokens: maxTokens }),
        });
        if (!response.ok) return { ok: false, response };
        const data = await response.json();
        attempts.push({ max_tokens: maxTokens, data });
        return { ok: true, response, data };
    };

    const first = await request(messages, INITIAL_MAX_TOKENS);
    if (!first.ok) return { ...first, attempts, retried: false };
    if (first.data?.choices?.[0]?.finish_reason !== 'length') {
        return { ...first, attempts, retried: false };
    }

    const second = await request(buildRetryMessages(messages), RETRY_MAX_TOKENS);
    return { ...second, attempts, retried: true };
}

module.exports = {
    INITIAL_MAX_TOKENS,
    RETRY_MAX_TOKENS,
    RETRY_INSTRUCTION,
    buildRetryMessages,
    generateProactiveCompletion,
};
