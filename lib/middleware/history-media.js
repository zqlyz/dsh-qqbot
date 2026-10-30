import { classifyContentType, downloadMediaAttachments, } from "../transport/attachment.js";
import { attachGroupHistoryMedia, } from "../features/history-store.js";
export function historyMediaProcessor(config, logger) {
    return async (ctx, next) => {
        const msg = ctx.message;
        const groupId = msg.kind === 'group' ? msg.groupOpenid : undefined;
        const attachments = msg.attachments;
        if (!config.media.enabled || !groupId || !attachments || attachments.length === 0) {
            await next();
            return;
        }
        try {
            const downloaded = await downloadMediaAttachments(attachments, config.media, logger);
            // 复用给 attachmentProcessor / handleInbound，避免 @ 消息重复下载
            ctx.state.downloadedFiles = downloaded;
            attachGroupHistoryMedia(config.appId, groupId, msg.messageId, buildCachedMedia(attachments, downloaded));
        }
        catch (err) {
            logger.warn(`im-qqbot: history media download failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await next();
    };
}
/**
 * 按 filename 把原始附件与下载结果配对；下载失败的附件也保留 URL/文件名/大小，
 * 由历史渲染回退（与当前消息的媒体兜底规则一致）。语音不进入历史媒体。
 */
function buildCachedMedia(attachments, downloaded) {
    const downloadedByFilename = new Map(downloaded.map(d => [d.filename, d]));
    const media = [];
    for (const att of attachments) {
        const kind = classifyContentType(att.content_type);
        if (kind === 'voice')
            continue;
        const d = downloadedByFilename.get(att.filename);
        media.push({
            kind,
            filename: att.filename,
            url: att.url,
            size: att.size,
            ...(d ? { localPath: d.localPath } : {}),
        });
    }
    return media;
}
//# sourceMappingURL=history-media.js.map