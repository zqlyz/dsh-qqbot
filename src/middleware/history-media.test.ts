import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, RawAttachment } from '../types.ts';
import type { DownloadedFile } from '../transport/attachment.ts';
import { attachmentProcessor } from './attachment.ts';
import { historyMediaProcessor } from './history-media.ts';
import {
  clearGroupHistory,
  getHistoryStore,
  historyGroupKey,
} from '../features/history-store.ts';

vi.mock('../transport/attachment.ts', async () => {
  const actual = await vi.importActual<typeof import('../transport/attachment.ts')>('../transport/attachment.ts');
  return { ...actual, downloadMediaAttachments: vi.fn() };
});

import { downloadMediaAttachments } from '../transport/attachment.ts';

const APP_ID = 'test-app';
const GROUP_ID = 'group-1';
const KEY = historyGroupKey(APP_ID, GROUP_ID);

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const imageAttachment: RawAttachment = {
  content_type: 'image/png',
  filename: 'photo.png',
  size: 123,
  url: 'https://example.com/photo.png',
};

const videoAttachment: RawAttachment = {
  content_type: 'video/mp4',
  filename: 'clip.mp4',
  size: 456,
  url: 'https://example.com/clip.mp4',
};

const downloaded: DownloadedFile[] = [
  { filename: 'photo.png', contentType: 'image', localPath: '/media/photo.png' },
];

function makeConfig(enabled = true): ImQQBotConfig {
  return {
    appId: APP_ID,
    media: { enabled, maxMB: 1, ttlHours: 24 },
  } as unknown as ImQQBotConfig;
}

function makeCtx(
  message: Record<string, unknown>,
  state: Record<string, unknown> = {},
): MiddlewareContext {
  return {
    message,
    state,
    bot: {},
    log: logger,
  } as unknown as MiddlewareContext;
}

function entry(messageId: string) {
  return {
    senderId: 'sender-a',
    senderName: 'Alice',
    content: 'hello',
    timestamp: Date.now(),
    messageId,
  };
}

beforeEach(() => {
  clearGroupHistory(APP_ID, GROUP_ID);
  vi.mocked(downloadMediaAttachments).mockReset();
  vi.clearAllMocks();
});

describe('historyMediaProcessor', () => {
  it('downloads group media and attaches descriptors to the cached entry', async () => {
    vi.mocked(downloadMediaAttachments).mockResolvedValue(downloaded);
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);

    const ctx = makeCtx({
      kind: 'group',
      groupOpenid: GROUP_ID,
      messageId: 'm1',
      attachments: [imageAttachment, videoAttachment],
    });
    const next = vi.fn(async () => {});

    await historyMediaProcessor(makeConfig(), logger)(ctx, next);

    expect(downloadMediaAttachments).toHaveBeenCalledOnce();
    expect(downloadMediaAttachments).toHaveBeenCalledWith(
      [imageAttachment, videoAttachment],
      makeConfig().media,
      logger,
    );
    expect(ctx.state.downloadedFiles).toEqual(downloaded);
    expect(store.list(KEY, 10)[0]!.media).toEqual([
      {
        kind: 'image',
        filename: 'photo.png',
        url: 'https://example.com/photo.png',
        size: 123,
        localPath: '/media/photo.png',
      },
      {
        kind: 'video',
        filename: 'clip.mp4',
        url: 'https://example.com/clip.mp4',
        size: 456,
      },
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips download and history media when media.enabled is false', async () => {
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);

    const ctx = makeCtx({
      kind: 'group',
      groupOpenid: GROUP_ID,
      messageId: 'm1',
      attachments: [imageAttachment],
    });
    const next = vi.fn(async () => {});

    await historyMediaProcessor(makeConfig(false), logger)(ctx, next);

    expect(downloadMediaAttachments).not.toHaveBeenCalled();
    expect(ctx.state.downloadedFiles).toBeUndefined();
    expect(store.list(KEY, 10)[0]!.media).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ['c2c', { kind: 'c2c', senderId: 'user-a', messageId: 'm1', attachments: [imageAttachment] }],
    ['group without attachments', { kind: 'group', groupOpenid: GROUP_ID, messageId: 'm1' }],
  ])('does nothing for %s', async (_name, message) => {
    const next = vi.fn(async () => {});

    await historyMediaProcessor(makeConfig(), logger)(makeCtx(message), next);

    expect(downloadMediaAttachments).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('keeps the message chain alive when the downloader throws', async () => {
    vi.mocked(downloadMediaAttachments).mockRejectedValue(new Error('boom'));
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);

    const ctx = makeCtx({
      kind: 'group',
      groupOpenid: GROUP_ID,
      messageId: 'm1',
      attachments: [imageAttachment],
    });
    const next = vi.fn(async () => {});

    await historyMediaProcessor(makeConfig(), logger)(ctx, next);

    expect(ctx.state.downloadedFiles).toBeUndefined();
    expect(store.list(KEY, 10)[0]!.media).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('history media download failed'));
    expect(next).toHaveBeenCalledOnce();
  });

  it('excludes voice attachments from history media', async () => {
    vi.mocked(downloadMediaAttachments).mockResolvedValue([]);
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);

    const ctx = makeCtx({
      kind: 'group',
      groupOpenid: GROUP_ID,
      messageId: 'm1',
      attachments: [{
        content_type: 'audio/silk',
        filename: 'voice.silk',
        size: 99,
        url: 'https://example.com/voice.silk',
      }],
    });
    const next = vi.fn(async () => {});

    await historyMediaProcessor(makeConfig(), logger)(ctx, next);

    expect(ctx.state.downloadedFiles).toEqual([]);
    expect(store.list(KEY, 10)[0]!.media).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('attachmentProcessor', () => {
  it('reuses pre-downloaded attachments instead of downloading again', async () => {
    const ctx = makeCtx(
      {
        kind: 'group',
        groupOpenid: GROUP_ID,
        messageId: 'm1',
        attachments: [imageAttachment],
      },
      { downloadedFiles: downloaded },
    );
    const next = vi.fn(async () => {});

    await attachmentProcessor(makeConfig(), logger)(ctx, next);

    expect(downloadMediaAttachments).not.toHaveBeenCalled();
    expect(ctx.state.downloadedFiles).toEqual(downloaded);
    expect(next).toHaveBeenCalledOnce();
  });
});
