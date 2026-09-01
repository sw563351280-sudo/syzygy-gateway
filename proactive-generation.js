'use strict';

// Give the model enough room on the first attempt. Retrying a truncated wake
// used to resend the entire (usually ~20k-token) context and double input cost.
const MAX_TOKENS = 2048;

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

    const first = await request(messages, MAX_TOKENS);
    return { ...first, attempts, retried: false };
}

module.exports = {
    MAX_TOKENS,
    generateProactiveCompletion,
};
