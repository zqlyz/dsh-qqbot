/**
 * 群历史媒体中间件 — 在消息进入群历史缓存时就近下载附件
 *
 * 位置必须在 historyBuffer 之后（条目已入库）、mentionGate 之前
 * （未被 @ 的群消息也要缓存媒体）。下载结果同时写入 ctx.state.downloadedFiles，
 * 供后续 attachmentProcessor / handleInbound 复用，避免 @ 消息重复下载。
 *
 * 下载行为完全复用 media.enabled / maxMB / ttlHours，不新增配置。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, RawAttachment } from '../types.ts';
import {
  classifyContentType,
  downloadMediaAttachments,
  type DownloadedFile,
} from '../transport/attachment.ts';
import {
  attachGroupHistoryMedia,
  type CachedHistoryMedia,
} from '../features/history-store.ts';

export function historyMediaProcessor(config: ImQQBotConfig, logger: Logger) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const msg = ctx.message;
    const groupId = msg.kind === 'group' ? msg.groupOpenid : undefined;
    const attachments = (msg as { attachments?: RawAttachment[] }).attachments;

    if (!config.media.enabled || !groupId || !attachments || attachments.length === 0) {
      await next();
      return;
    }

    try {
      const downloaded = await downloadMediaAttachments(attachments, config.media, logger);
      // 复用给 attachmentProcessor / handleInbound，避免 @ 消息重复下载
      ctx.state.downloadedFiles = downloaded;
      attachGroupHistoryMedia(
        config.appId,
        groupId,
        msg.messageId,
        buildCachedMedia(attachments, downloaded),
      );
    } catch (err) {
      logger.warn(`im-qqbot: history media download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await next();
  };
}

/**
 * 按 filename 把原始附件与下载结果配对；下载失败的附件也保留 URL/文件名/大小，
 * 由历史渲染回退（与当前消息的媒体兜底规则一致）。语音不进入历史媒体。
 */
function buildCachedMedia(
  attachments: RawAttachment[],
  downloaded: DownloadedFile[],
): CachedHistoryMedia[] {
  const downloadedByFilename = new Map(downloaded.map(d => [d.filename, d]));
  const media: CachedHistoryMedia[] = [];

  for (const att of attachments) {
    const kind = classifyContentType(att.content_type);
    if (kind === 'voice') continue;
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
