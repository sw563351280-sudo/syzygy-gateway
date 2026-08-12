const XHS_HOSTS = new Set([
  'xhslink.cn',
  'www.xhslink.cn',
  'xhslink.com',
  'www.xhslink.com',
  'xiaohongshu.com',
  'www.xiaohongshu.com',
]);

const SHORT_HOSTS = new Set([
  'xhslink.cn',
  'www.xhslink.cn',
  'xhslink.com',
  'www.xhslink.com',
]);

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function parseXhsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol === 'http:' && (url.hostname === 'xhslink.cn' || url.hostname === 'www.xhslink.cn')) {
      url.protocol = 'https:';
    }
    if (url.protocol !== 'https:' || !XHS_HOSTS.has(url.hostname.toLowerCase())) return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url;
  } catch (_) {
    return null;
  }
}

export async function expandXhsUrl(fetchImpl, input, maxRedirects = 5) {
  let current = parseXhsUrl(input);
  if (!current || !SHORT_HOSTS.has(current.hostname.toLowerCase())) {
    throw new Error('Only Xiaohongshu share short links are accepted');
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetchImpl(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': MOBILE_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect response has no Location');
      current = parseXhsUrl(new URL(location, current).toString());
      if (!current) throw new Error('Redirect left the Xiaohongshu allowlist');
      continue;
    }
    if (!response.ok) throw new Error(`Xiaohongshu returned HTTP ${response.status}`);
    if (SHORT_HOSTS.has(current.hostname.toLowerCase())) throw new Error('Short link did not expand');
    return current.toString();
  }
  throw new Error('Too many redirects');
}

export default {
  async fetch(request, env) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return json({ ok: true, service: 'syzygy-xhs-resolver' });
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/resolve') {
      return json({ ok: false, error: 'Not found' }, 404);
    }
    if (!env.RESOLVER_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.RESOLVER_TOKEN}`) {
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }
    try {
      const body = await request.json();
      const url = await expandXhsUrl(fetch, body?.url);
      return json({ ok: true, url });
    } catch (error) {
      return json({ ok: false, error: String(error?.message || 'Resolve failed') }, 400);
    }
  },
};
