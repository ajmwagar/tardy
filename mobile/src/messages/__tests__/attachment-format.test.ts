import { attachmentPreviewKind, markdownBlocks } from '../attachment-format';

const media = (type: 'video' | 'audio' | 'document', contentType: string) => ({
  assetId: 'asset', type, url: 'https://tardy.test/file', contentType,
});

test('routes typed attachments to their inline preview', () => {
  expect(attachmentPreviewKind(media('video', 'video/mp4'))).toBe('video');
  expect(attachmentPreviewKind(media('audio', 'audio/mpeg'))).toBe('audio');
  expect(attachmentPreviewKind(media('document', 'application/pdf'))).toBe('pdf');
  expect(attachmentPreviewKind(media('document', 'text/markdown'))).toBe('markdown');
  expect(attachmentPreviewKind(media('document', 'application/octet-stream'))).toBe('file');
});

test('parses safe markdown blocks without interpreting HTML', () => {
  expect(markdownBlocks('# Plan\n- ship it\n```rust\nfn main() {}\n```\n<script>nope</script>')).toEqual([
    { kind: 'heading', text: 'Plan', level: 1 },
    { kind: 'bullet', text: 'ship it' },
    { kind: 'code', text: 'fn main() {}' },
    { kind: 'text', text: '<script>nope</script>' },
  ]);
});
