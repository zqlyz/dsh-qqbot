/**
 * 群历史存储共享模块
 *
 * historyBuffer 中间件需要一个跨调用可访问的 HistoryStore 实例，
 * 以便在回复完成后清空某群的历史缓存（避免下次 @ 时重复组包）。
 *
 * 相比 SDK 的 MemoryHistoryStore，这里额外支持给缓存条目挂媒体描述：
 * 群消息到达时就下载图片/视频/文件并关联到对应 messageId，
 * 后续被 @ 时历史上下文即可带上这些媒体的本地路径。
 */
import type { HistoryEntry, HistoryStore } from '@tencent-connect/qqbot-nodejs';
import type { MediaKind } from '../transport/attachment.ts';

/** 缓存消息附带的媒体描述（下载成功带 localPath，否则保留 url 等兜底信息） */
export interface CachedHistoryMedia {
  kind: Exclude<MediaKind, 'voice'>;
  filename?: string;
  url?: string;
  localPath?: string;
  size?: number;
}

/** 带媒体信息的群历史条目 */
export interface CachedHistoryEntry extends HistoryEntry {
  media?: CachedHistoryMedia[];
}

/**
 * 进程内群历史环形缓冲（按 groupKey 隔离）。
 *
 * 行为对齐 SDK 的 MemoryHistoryStore：按 messageId 去重、超出 limit 从头部淘汰。
 * 额外提供 attachMedia，把异步下载完成的媒体挂到已入库的条目上。
 */
class GroupHistoryStore implements HistoryStore {
  private readonly buffers = new Map<string, CachedHistoryEntry[]>();

  append(groupKey: string, entry: HistoryEntry, limit: number): void {
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

  list(groupKey: string, limit: number): CachedHistoryEntry[] {
    const buf = this.buffers.get(groupKey);
    if (!buf) return [];
    return buf.slice(-limit);
  }

  clear(groupKey: string): void {
    this.buffers.delete(groupKey);
  }

  /** 把媒体挂到某条已缓存消息上；条目不存在或已被淘汰时静默忽略 */
  attachMedia(groupKey: string, messageId: string, media: CachedHistoryMedia[]): void {
    if (media.length === 0) return;
    const entry = this.buffers.get(groupKey)?.find(e => e.messageId === messageId);
    if (entry) entry.media = media;
  }

  /** Diagnostic: number of groups with buffered history. */
  size(): number {
    return this.buffers.size;
  }
}

let _store: GroupHistoryStore | null = null;

/** 获取共享历史存储（单例） */
export function getHistoryStore(): GroupHistoryStore {
  if (!_store) _store = new GroupHistoryStore();
  return _store;
}

/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export function historyGroupKey(appId: string, groupId: string): string {
  return `${appId}:${groupId}`;
}

/** 清空群历史（回复后调用，避免下次 @ 时重复组包） */
export function clearGroupHistory(appId: string, groupId: string): void {
  _store?.clear(historyGroupKey(appId, groupId));
}

/** 给某条群历史消息挂下载完成的媒体 */
export function attachGroupHistoryMedia(
  appId: string,
  groupId: string,
  messageId: string,
  media: CachedHistoryMedia[],
): void {
  _store?.attachMedia(historyGroupKey(appId, groupId), messageId, media);
}
