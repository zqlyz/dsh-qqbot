/**
 * 进程内群历史环形缓冲（按 groupKey 隔离）。
 *
 * 行为对齐 SDK 的 MemoryHistoryStore：按 messageId 去重、超出 limit 从头部淘汰。
 * 额外提供 attachMedia，把异步下载完成的媒体挂到已入库的条目上。
 */
class GroupHistoryStore {
    buffers = new Map();
    append(groupKey, entry, limit) {
        let buf = this.buffers.get(groupKey);
        if (!buf) {
            buf = [];
            this.buffers.set(groupKey, buf);
        }
        // De-dup by messageId.
        if (buf.some(e => e.messageId === entry.messageId)) {
            return;
        }
        buf.push(entry);
        if (buf.length > limit) {
            buf.splice(0, buf.length - limit);
        }
    }
    list(groupKey, limit) {
        const buf = this.buffers.get(groupKey);
        if (!buf)
            return [];
        return buf.slice(-limit);
    }
    clear(groupKey) {
        this.buffers.delete(groupKey);
    }
    /** 把媒体挂到某条已缓存消息上；条目不存在或已被淘汰时静默忽略 */
    attachMedia(groupKey, messageId, media) {
        if (media.length === 0)
            return;
        const entry = this.buffers.get(groupKey)?.find(e => e.messageId === messageId);
        if (entry)
            entry.media = media;
    }
    /** Diagnostic: number of groups with buffered history. */
    size() {
        return this.buffers.size;
    }
}
let _store = null;
/** 获取共享历史存储（单例） */
export function getHistoryStore() {
    if (!_store)
        _store = new GroupHistoryStore();
    return _store;
}
/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export function historyGroupKey(appId, groupId) {
    return `${appId}:${groupId}`;
}
/** 清空群历史（回复后调用，避免下次 @ 时重复组包） */
export function clearGroupHistory(appId, groupId) {
    _store?.clear(historyGroupKey(appId, groupId));
}
/** 给某条群历史消息挂下载完成的媒体 */
export function attachGroupHistoryMedia(appId, groupId, messageId, media) {
    _store?.attachMedia(historyGroupKey(appId, groupId), messageId, media);
}
//# sourceMappingURL=history-store.js.map