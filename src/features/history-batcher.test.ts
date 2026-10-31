import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger } from '../types.ts';
import { GroupHistoryBatcher } from './history-batcher.ts';
import { getHistoryStore, historyGroupKey } from './history-store.ts';

const APP_ID = 'test-app';
const GROUP_ID = 'group-1';
const KEY = historyGroupKey(APP_ID, GROUP_ID);

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<ImQQBotConfig> = {}): ImQQBotConfig {
  return {
    appId: APP_ID,
    requireMention: false,
    historyIntervalTimer: 30,
    historyLimit: 10,
    ...overrides,
  } as ImQQBotConfig;
}

function makeCtx(messageId: string, content: string): MiddlewareContext {
  return {
    message: {
      rawEventType: 'GROUP_MESSAGE_CREATE',
      kind: 'group',
      groupOpenid: GROUP_ID,
      senderId: 'sender-a',
      senderName: 'Alice',
      content,
      messageId,
      timestamp: '2026-01-02T03:04:05+08:00',
    },
    state: { mention: { wasMentioned: false } },
    bot: { sendMarkdown: vi.fn(async () => ({})) },
  } as unknown as MiddlewareContext;
}

function entry(messageId: string, content: string) {
  return {
    senderId: 'sender-a',
    senderName: 'Alice',
    content,
    timestamp: Date.now(),
    messageId,
  };
}

function makeManager() {
  const followup = vi.fn();
  const manager = {
    getOrCreate: vi.fn(async () => ({
      agent: { followup, whenIdle: vi.fn(async () => {}) },
    })),
  } as unknown as SessionManager;
  return { manager, followup };
}

beforeEach(() => {
  vi.useFakeTimers();
  getHistoryStore().clear(KEY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GroupHistoryBatcher', () => {
  it('flushes buffered group history on the configured interval and clears it', async () => {
    const { manager, followup } = makeManager();
    const batcher = new GroupHistoryBatcher(manager, makeConfig(), makeLogger());
    const ctx = makeCtx('m2', 'second');

    getHistoryStore().append(KEY, entry('m1', 'first'), 10);
    getHistoryStore().append(KEY, entry('m2', 'second'), 10);

    batcher.buffer(ctx);
    expect(followup).not.toHaveBeenCalled();

    batcher.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(followup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(followup).toHaveBeenCalledTimes(1);
    expect(getHistoryStore().list(KEY, 10)).toEqual([]);

    const sent = followup.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text?: string }>;
    };
    const body = sent.content[0]?.text ?? '';
    expect(body).toContain('[Chat history begins]');
    expect(body).toContain('[Alice (sender-a)] first');
    expect(body).toContain('[Current message]');
    expect(body).toContain('[Alice (sender-a)] second');
    batcher.stop();
  });

  it('forget cancels the pending batch for a group (@bot path)', async () => {
    const { manager, followup } = makeManager();
    const batcher = new GroupHistoryBatcher(manager, makeConfig(), makeLogger());

    getHistoryStore().append(KEY, entry('m1', 'first'), 10);
    batcher.buffer(makeCtx('m1', 'first'));
    batcher.forget(KEY);

    batcher.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(followup).not.toHaveBeenCalled();
    batcher.stop();
  });

  it('falls back to 180s when historyIntervalTimer is invalid', async () => {
    const { manager, followup } = makeManager();
    const batcher = new GroupHistoryBatcher(
      manager,
      makeConfig({ historyIntervalTimer: 10 }),
      makeLogger(),
    );

    getHistoryStore().append(KEY, entry('m1', 'first'), 10);
    batcher.buffer(makeCtx('m1', 'first'));

    batcher.start();
    await vi.advanceTimersByTimeAsync(179_999);
    expect(followup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(followup).toHaveBeenCalledTimes(1);
    batcher.stop();
  });

  it('does nothing when there is no buffered context', async () => {
    const { manager, followup } = makeManager();
    const batcher = new GroupHistoryBatcher(manager, makeConfig(), makeLogger());

    batcher.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(followup).not.toHaveBeenCalled();
    batcher.stop();
  });
});
