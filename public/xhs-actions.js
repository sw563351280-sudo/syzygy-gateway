'use strict';
const result = document.getElementById('result');
async function request(url, method = 'POST') {
    const response = await fetch(url, { method, headers: { 'X-XHS-Confirm': '1' }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作未完成');
    return data;
}
function show(data) {
    result.textContent = '';
    function visit(value) {
        if (value == null) return;
        if (Array.isArray(value)) return value.forEach(visit);
        if (typeof value === 'object') {
            if (value.type === 'image' && value.mimeType === 'image/png' && /^[A-Za-z0-9+/=]+$/.test(value.data || '')) {
                const img = document.createElement('img'); img.alt = '登录二维码'; img.src = 'data:image/png;base64,' + value.data; result.append(img); return;
            }
            if (value.type === 'text') return visit(value.text);
            if (value.result) return visit(value.result);
            if (value.content) return visit(value.content);
            result.append(document.createTextNode(JSON.stringify(value, null, 2))); return;
        }
        result.append(document.createTextNode(String(value) + '\n'));
    }
    visit(data);
}
for (const action of ['qr', 'status']) {
    const button = document.getElementById(action);
    if (button) button.onclick = async () => {
        button.disabled = true; result.textContent = '正在连接…';
        try { show(await request('/api/xhs-mcp/login/' + action)); } catch (error) { result.textContent = error.message; }
        finally { button.disabled = false; }
    };
}
const confirmButton = document.getElementById('confirm');
if (confirmButton) {
    const id = new URLSearchParams(location.search).get('id');
    const endpoint = '/api/xhs-mcp/approval/' + encodeURIComponent(id || '');
    request(endpoint, 'GET').then(data => {
        const actions = { publish_content: '发布图文', publish_with_video: '发布视频', post_comment_to_feed: '发表评论', reply_comment_in_feed: '回复评论', like_feed: '设置笔记点赞', favorite_feed: '设置笔记收藏', delete_cookies: '退出登录', list_notifications: '读取通知并清除未读标记', reply_notification: '回复通知中的评论', like_notification: '设置评论点赞' };
        const labels = { feed_id: '目标笔记', comment_id: '目标评论', user_id: '目标用户', title: '标题', content: '正文', images: '图片', video: '视频', tags: '话题', schedule_at: '发布时间', visibility: '可见范围', unlike: '取消点赞', unfavorite: '取消收藏', is_original: '声明原创', products: '关联商品', tab: '通知分类', limit: '数量' };
        const details = document.getElementById('details');
        details.textContent = (actions[data.name] || data.name) + '\n\n' + Object.entries(data.args).map(([key, value]) => (labels[key] || key) + '：' + (typeof value === 'string' ? value : JSON.stringify(value))).join('\n') + (data.expired ? '\n\n本次确认已过期' : '') + (data.status !== 'pending' ? '\n\n本次操作已提交，不会重复执行。' : '');
        for (const image of data.args.images || []) {
            if (typeof image === 'string' && /^\/api\/xhs-mcp\/media\/[a-f0-9]+$/.test(image)) { const img = document.createElement('img'); img.src = image; img.alt = '本次发布图片'; details.after(img); }
        }
        confirmButton.disabled = data.status !== 'pending' || data.expired;
    }).catch(error => { result.textContent = error.message; });
    confirmButton.onclick = async () => {
        confirmButton.disabled = true; result.textContent = '正在执行，请勿重复提交…';
        try { show(await request(endpoint)); } catch (error) { result.textContent = error.message; }
    };
}
