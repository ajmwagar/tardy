import type { Message } from '@/data/types';
import { conversationAttachments } from '../attachment-index';

const message = (id: string, attached = true): Message => ({
  id, threadId: 'thread', senderId: 'sender', text: 'Photo', createdAt: '2026-10-05',
  media: attached ? [{ assetId: 'same-asset', type: 'image', url: 'https://tardy.test/image' }] : undefined,
});

test('indexes newest first and keeps original message navigation', () => {
  const entries = conversationAttachments([message('first'), message('empty', false), message('last')]);
  expect(entries.map((item) => item.messageId)).toEqual(['last', 'first']);
  expect(new Set(entries.map((item) => item.id)).size).toBe(2);
  expect(entries[0].media.assetId).toBe('same-asset');
});

test('empty conversations have no phantom attachments', () => {
  expect(conversationAttachments([])).toEqual([]);
  expect(conversationAttachments([message('empty', false)])).toEqual([]);
});
