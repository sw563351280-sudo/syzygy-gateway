'use strict';

const CRUMB_UNDO_WINDOW_MS = 30 * 1000;

function softDeleteCrumb(items, id, now = new Date()) {
    const item = (items || []).find(row => row.id === id);
    if (!item || ['deleted', 'retracted'].includes(item.status)) throw Object.assign(new Error('没有找到这粒星尘'), { status: 404 });
    item.deleted_from_status = item.status || 'active';
    item.status = 'deleted';
    item.deleted_at = now.toISOString();
    return { item, undoUntil: new Date(now.getTime() + CRUMB_UNDO_WINDOW_MS).toISOString() };
}

function undoCrumbDelete(items, id, now = new Date()) {
    const item = (items || []).find(row => row.id === id);
    if (!item || item.status !== 'deleted') throw Object.assign(new Error('没有可撤销的删除'), { status: 404 });
    if (!item.deleted_at || now.getTime() - Date.parse(item.deleted_at) > CRUMB_UNDO_WINDOW_MS) {
        throw Object.assign(new Error('撤销时间已经过去，这粒星尘仍会保留在服务端软删除记录中'), { status: 410 });
    }
    item.status = ['active', 'quiet', 'archived'].includes(item.deleted_from_status) ? item.deleted_from_status : 'active';
    delete item.deleted_from_status;
    delete item.deleted_at;
    return item;
}

module.exports = { CRUMB_UNDO_WINDOW_MS, softDeleteCrumb, undoCrumbDelete };
