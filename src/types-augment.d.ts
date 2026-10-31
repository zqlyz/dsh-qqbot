/**
 * SDK MiddlewareState 类型扩展
 *
 * 为 @tencent-connect/qqbot-nodejs 的 MiddlewareState 添加
 * 项目自定义中间件填充的 well-known keys 类型声明。
 *
 * 这些字段由项目中间件填充：
 * - downloadedFiles: historyMediaProcessor（群聊早期）或 attachmentProcessor → 当前消息附件下载结果
 * - downloadedQuoteFiles: attachmentProcessor 中间件 → 下载到本地的引用消息附件
 */
import '@tencent-connect/qqbot-nodejs';
import type { DownloadedFile } from './transport/attachment.ts';

declare module '@tencent-connect/qqbot-nodejs' {
  interface MiddlewareState {
    /** 当前消息附件下载结果：群聊由 historyMediaProcessor 预取，其余由 attachmentProcessor 填充 */
    downloadedFiles?: DownloadedFile[];
    /** attachmentProcessor 下载到本地的引用消息附件结果 */
    downloadedQuoteFiles?: DownloadedFile[];
  }
}
