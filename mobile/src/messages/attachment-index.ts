import type { Message, MessageMedia } from '@/data/types';

export type ConversationAttachment = { id: string; messageId: string; media: MessageMedia };

/** Preserve occurrences: the same asset may have been shared in multiple messages. */
export function conversationAttachments(messages: readonly Message[]): ConversationAttachment[] {
  return messages.flatMap((message) => (message.media ?? []).map((media, index) => ({
    id: `${message.id}:${media.assetId}:${index}`, messageId: message.id, media,
  }))).reverse();
}
