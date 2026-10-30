import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGroupHistory,
  getHistoryStore,
  historyGroupKey,
  type CachedHistoryMedia,
} from './history-store.ts';

const APP_ID = 'test-app';
const GROUP_ID = 'group-1';
const KEY = historyGroupKey(APP_ID, GROUP_ID);

const image: CachedHistoryMedia = {
  kind: 'image',
  filename: 'photo.png',
  url: 'https://example.com/photo.png',
  localPath: '/media/photo.png',
  size: 123,
};

function entry(messageId: string, content = 'hello') {
  return {
    senderId: 'sender-a',
    senderName: 'Alice',
    content,
    timestamp: Date.now(),
    messageId,
  };
}

beforeEach(() => {
  clearGroupHistory(APP_ID, GROUP_ID);
});

describe('GroupHistoryStore', () => {
  it('dedupes by messageId and keeps only the latest limit entries', () => {
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);
    store.append(KEY, entry('m1', 'ignored'), 10);
    store.append(KEY, entry('m2'), 10);
    store.append(KEY, entry('m3'), 10);

    expect(store.list(KEY, 2).map(e => e.messageId)).toEqual(['m2', 'm3']);
    expect(store.list(KEY, 10).map(e => e.content)).toEqual(['hello', 'hello', 'hello']);
  });

  it('attaches media to an existing entry and ignores unknown ids', () => {
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);

    store.attachMedia(KEY, 'missing', [image]);
    expect(store.list(KEY, 10)[0]!.media).toBeUndefined();

    store.attachMedia(KEY, 'm1', [image]);
    expect(store.list(KEY, 10)[0]!.media).toEqual([image]);
  });

  it('clearGroupHistory removes both entries and attached media', () => {
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);
    store.attachMedia(KEY, 'm1', [image]);

    clearGroupHistory(APP_ID, GROUP_ID);

    expect(store.list(KEY, 10)).toEqual([]);
  });

  it('keeps groups isolated and returns empty for unknown groups', () => {
    const store = getHistoryStore();
    store.append(KEY, entry('m1'), 10);

    expect(store.list(historyGroupKey(APP_ID, 'other-group'), 10)).toEqual([]);
  });
});
