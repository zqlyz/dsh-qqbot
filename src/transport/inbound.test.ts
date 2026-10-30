/**
 * 入站消息时间戳测试
 *
 * 当前消息保留 SDK/QQ 的 ISO 字符串，群历史把 SDK 的毫秒数转回 ISO 8601。
 */
import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger } from '../types.ts';
import { handleInbound } from './inbound.ts';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

async function run(
  message: Record<string, unknown>,
  state: Record<string, unknown> = {},
): Promise<string> {
  const followup = vi.fn();
  const ctx = {
    message,
    state,
    bot: { sendMarkdown: vi.fn(async () => ({})) },
  } as unknown as MiddlewareContext;
  const manager = {
    getOrCreate: vi.fn(async () => ({
      agent: {
        followup,
        whenIdle: vi.fn(async () => {}),
      },
    })),
  } as unknown as SessionManager;
  const config = { appId: 'test-app' } as unknown as ImQQBotConfig;

  await handleInbound(ctx, manager, config, makeLogger());

  const sent = followup.mock.calls[0]?.[0] as {
    content: Array<{ type: string; text?: string }>;
  };
  return sent.content[0]?.text ?? '';
}

describe('handleInbound timestamps', () => {
  it('prefixes the current group message and cached history with the same ISO format', async () => {
    const currentTimestamp = '2026-01-02T03:04:05+08:00';
    const earlierTimestamp = Date.parse('2026-01-01T18:59:58.000Z');

    const body = await run(
      {
        rawEventType: 'GROUP_AT_MESSAGE_CREATE',
        kind: 'group',
        senderId: 'sender-a',
        senderName: 'Alice',
        content: 'hello',
        messageId: 'm1',
        timestamp: currentTimestamp,
        groupOpenid: 'group-a',
      },
      {
        mention: { wasMentioned: true },
        history: [
          {
            senderId: 'sender-b',
            senderName: 'Bob',
            content: 'earlier',
            timestamp: earlierTimestamp,
            messageId: 'm0',
          },
        ],
      },
    );

    expect(body).toBe(
      [
        '[Chat history begins]',
        '[2026-01-02T02:59:58+08:00] [Bob (sender-b)] earlier',
        '',
        '[Chat history ends]',
        '[Current message]',
        `[${currentTimestamp}] [Alice (sender-a)] hello (@you)`,
      ].join('\n'),
    );
  });

  it('puts the current timestamp after the quote block', async () => {
    const timestamp = '2026-01-01T19:04:05.000Z';

    const body = await run(
      {
        rawEventType: 'C2C_MESSAGE_CREATE',
        kind: 'c2c',
        senderId: 'user-a',
        content: 'hello',
        messageId: 'm2',
        timestamp,
      },
      { quote: { text: 'old message' } },
    );

    expect(body).toBe(
      [
        '[Quoted message begins]',
        'old message',
        '[Quoted message ends]',
        '[Current message]',
        '[2026-01-02T03:04:05+08:00] hello',
      ].join('\n'),
    );
  });

  it('omits the timestamp when it is missing or invalid', async () => {
    const base = {
      rawEventType: 'C2C_MESSAGE_CREATE',
      kind: 'c2c',
      senderId: 'user-a',
      content: 'hello',
      messageId: 'm3',
    };

    await expect(run({ ...base, timestamp: undefined })).resolves.toBe('hello');
    await expect(run({ ...base, timestamp: 'not-a-timestamp' })).resolves.toBe('hello');
  });
});

describe('handleInbound history media', () => {
  it('renders cached media under each history line with local-path and fallback rules', async () => {
    const currentTimestamp = '2026-01-02T03:04:05+08:00';
    const earlierTimestamp = Date.parse('2026-01-01T18:59:58.000Z');
    const existingFile = fileURLToPath(import.meta.url);

    const body = await run(
      {
        rawEventType: 'GROUP_AT_MESSAGE_CREATE',
        kind: 'group',
        senderId: 'sender-a',
        senderName: 'Alice',
        content: 'summarize',
        messageId: 'm1',
        timestamp: currentTimestamp,
        groupOpenid: 'group-a',
      },
      {
        mention: { wasMentioned: true },
        history: [
          {
            senderId: 'sender-b',
            senderName: 'Bob',
            content: 'look',
            timestamp: earlierTimestamp,
            messageId: 'm0',
            media: [
              {
                kind: 'image',
                filename: 'photo.png',
                url: 'https://example.com/photo.png',
                localPath: existingFile,
                size: 12,
              },
              {
                kind: 'image',
                filename: 'missing.png',
                url: 'https://example.com/missing.png',
                localPath: '/nonexistent/missing.png',
                size: 34,
              },
              {
                kind: 'video',
                filename: 'clip.mp4',
                url: 'https://example.com/clip.mp4',
                size: 56,
              },
              {
                kind: 'file',
                filename: 'notes.txt',
                url: 'https://example.com/notes.txt',
                size: 2048,
              },
            ],
          },
        ],
      },
    );

    expect(body).toBe(
      [
        '[Chat history begins]',
        '[2026-01-02T02:59:58+08:00] [Bob (sender-b)] look',
        `  - Image: ${existingFile}`,
        '  - Image: https://example.com/missing.png',
        '  - Video: clip.mp4 (download failed)',
        '  - File: notes.txt (2.0KB)',
        '',
        '[Chat history ends]',
        '[Current message]',
        `[${currentTimestamp}] [Alice (sender-a)] summarize (@you)`,
      ].join('\n'),
    );
  });
});
