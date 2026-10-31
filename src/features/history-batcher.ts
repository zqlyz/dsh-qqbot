/**
 * 群历史定时批量发送器 — requireMention=false 时的消息合并回复
 *
 * 行为：
 * - 未被 @bot 的群消息只入历史缓存，不立即触发回复；
 * - 每 historyIntervalTimer 秒检查一次各群缓存，非空则整批交给 agent；
 * - 被 @bot 的消息仍走即时处理（保留 @ 门控），由 handleInbound 携带缓存历史；
 * - 缓存以 take 语义原子取走，发送期间新到的消息不会被本轮清理误删。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.ts';
import { resolveHistoryIntervalTimer, type ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import { handleInbound } from '../transport/inbound.ts';
import {
  getHistoryStore,
  historyGroupKey,
  type CachedHistoryEntry,
} from './history-store.ts';

export class GroupHistoryBatcher {
  /** 每群最近一条未 @bot 的上下文（回复目标/媒体等元数据来源） */
  private readonly pending = new Map<string, MiddlewareContext>();
  /** 正在发送的群，避免同一群重复组包 */
  private readonly flushing = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly manager: SessionManager,
    private readonly config: ImQQBotConfig,
    private readonly logger: Logger,
  ) {}

  /** 记录一条待批量处理的群消息（覆盖该群上一条） */
  buffer(ctx: MiddlewareContext): void {
    const groupId = ctx.message.kind === 'group' ? ctx.message.groupOpenid : undefined;
    if (!groupId) return;
    this.pending.set(historyGroupKey(this.config.appId, groupId), ctx);
  }

  /** @bot 已触发即时处理：取消该群待发送的定时批次 */
  forget(key: string): void {
    this.pending.delete(key);
  }

  /** 启动定时检查（仅 requireMention=false 时由 bootstrap 调用） */
  start(): void {
    if (this.timer !== undefined) return;
    const seconds = resolveHistoryIntervalTimer(this.config.historyIntervalTimer);
    this.logger.info(`im-qqbot: group history interval enabled (${seconds}s)`);
    this.timer = setInterval(() => {
      void this.flushAll();
    }, seconds * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.pending.clear();
    this.flushing.clear();
  }

  /** 遍历当前有缓存的群并逐个发送 */
  private async flushAll(): Promise<void> {
    const keys = getHistoryStore().keys();
    await Promise.all(keys.map(key => this.flushGroup(key)));
  }

  private async flushGroup(key: string): Promise<void> {
    if (this.flushing.has(key)) return;
    const ctx = this.pending.get(key);
    if (!ctx) return;

    // 同步取走缓存并移除 pending：await 之后新到的消息会进入下一轮。
    const entries = getHistoryStore().take(key, this.config.historyLimit);
    this.pending.delete(key);
    if (entries.length === 0) return;

    this.flushing.add(key);
    this.logger.info(`im-qqbot: flushing group history ${key} (${entries.length} messages)`);
    try {
      // 批次把最后一条消息作为「当前消息」，其余作为历史；即使当前消息因
      // limit 淘汰不在快照里，也把全部快照作为历史交给 agent。
      const currentId = ctx.message.messageId;
      const context = ctx.state as { history?: CachedHistoryEntry[]; historyBatch?: boolean };
      const withCurrent = entries.some(entry => entry.messageId === currentId);
      context.history = withCurrent
        ? entries.filter(entry => entry.messageId !== currentId)
        : entries;
      context.historyBatch = true;

      await handleInbound(ctx, this.manager, this.config, this.logger);
    } catch (err) {
      this.logger.warn(
        `im-qqbot: history batch flush failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.flushing.delete(key);
    }
  }
}
