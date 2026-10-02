import type { MessageMedia } from '@/data/types';

export type AttachmentPreviewKind = 'video' | 'audio' | 'pdf' | 'markdown' | 'file';
export type MarkdownBlock = { kind: 'heading' | 'bullet' | 'code' | 'text'; text: string; level?: number };

export function attachmentPreviewKind(media: MessageMedia): AttachmentPreviewKind {
  if (media.type === 'video') return 'video';
  if (media.type === 'audio') return 'audio';
  if (media.contentType === 'application/pdf') return 'pdf';
  if (media.contentType === 'text/markdown' || media.contentType === 'text/plain') return 'markdown';
  return 'file';
}

export function markdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let code: string[] | null = null;
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim().startsWith('```')) {
      if (code) { blocks.push({ kind: 'code', text: code.join('\n') }); code = null; } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { blocks.push({ kind: 'heading', text: heading[2], level: heading[1].length }); continue; }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) { blocks.push({ kind: 'bullet', text: bullet[1] }); continue; }
    if (line.trim()) blocks.push({ kind: 'text', text: line.trim() });
  }
  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}
