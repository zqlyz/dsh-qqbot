import { resolveHistoryIntervalTimer } from "../config.js";
import { handleInbound } from "../transport/inbound.js";
import { getHistoryStore, historyGroupKey, } from "./history-store.js";
export class GroupHistoryBatcher {
    manager;
    config;
    logger;
    /** 每群最近一条未 @bot 的上下文（回复目标/媒体等元数据来源） */
    pending = new Map();
    /** 正在发送的群，避免同一群重复组包 */
    flushing = new Set();
    timer;
    constructor(manager, config, logger) {
        this.manager = manager;
        this.config = config;
        this.logger = logger;
    }
    /** 记录一条待批量处理的群消息（覆盖该群上一条） */
    buffer(ctx) {
        const groupId = ctx.message.kind === 'group' ? ctx.message.groupOpenid : undefined;
        if (!groupId)
            return;
        this.pending.set(historyGroupKey(this.config.appId, groupId), ctx);
    }
    /** @bot 已触发即时处理：取消该群待发送的定时批次 */
    forget(key) {
        this.pending.delete(key);
    }
    /** 启动定时检查（仅 requireMention=false 时由 bootstrap 调用） */
    start() {
        if (this.timer !== undefined)
            return;
        const seconds = resolveHistoryIntervalTimer(this.config.historyIntervalTimer);
        this.logger.info(`im-qqbot: group history interval enabled (${seconds}s)`);
        this.timer = setInterval(() => {
            void this.flushAll();
        }, seconds * 1000);
        this.timer.unref?.();
    }
    stop() {
        if (this.timer !== undefined) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.pending.clear();
        this.flushing.clear();
    }
    /** 遍历当前有缓存的群并逐个发送 */
    async flushAll() {
        const keys = getHistoryStore().keys();
        await Promise.all(keys.map(key => this.flushGroup(key)));
    }
    async flushGroup(key) {
        if (this.flushing.has(key))
            return;
        const ctx = this.pending.get(key);
        if (!ctx)
            return;
        // 同步取走缓存并移除 pending：await 之后新到的消息会进入下一轮。
        const entries = getHistoryStore().take(key, this.config.historyLimit);
        this.pending.delete(key);
        if (entries.length === 0)
            return;
        this.flushing.add(key);
        this.logger.info(`im-qqbot: flushing group history ${key} (${entries.length} messages)`);
        try {
            // 批次把最后一条消息作为「当前消息」，其余作为历史；即使当前消息因
            // limit 淘汰不在快照里，也把全部快照作为历史交给 agent。
            const currentId = ctx.message.messageId;
            const context = ctx.state;
            const withCurrent = entries.some(entry => entry.messageId === currentId);
            context.history = withCurrent
                ? entries.filter(entry => entry.messageId !== currentId)
                : entries;
            context.historyBatch = true;
            await handleInbound(ctx, this.manager, this.config, this.logger);
        }
        catch (err) {
            this.logger.warn(`im-qqbot: history batch flush failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.flushing.delete(key);
        }
    }
}
//# sourceMappingURL=history-batcher.js.map