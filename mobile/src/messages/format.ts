export type MessageSpan = { kind: 'text' | 'code'; text: string };
export type MessageImage = { alt: string; url: string };

/** Compatibility bridge for agents that emit Markdown images before native attachments land. */
export function messageImages(source: string): { text: string; images: MessageImage[] } {
  const images: MessageImage[] = [];
  const text = source
    .replace(/!\[([^\]\n]{0,300})\]\((https?:\/\/[^\s)]+)\)/g, (_all, alt: string, url: string) => {
      images.push({ alt: alt.trim() || 'Shared image', url });
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, images };
}

/**
 * The DM wire format is still plain text. Render the one Markdown primitive agents use most
 * without accepting arbitrary HTML or introducing a second Markdown dialect into the API.
 */
export function messageSpans(source: string): MessageSpan[] {
  const spans: MessageSpan[] = [];
  let cursor = 0;
  for (const match of source.matchAll(/`([^`\n]+)`/g)) {
    const index = match.index ?? 0;
    if (index > cursor) spans.push({ kind: 'text', text: source.slice(cursor, index) });
    spans.push({ kind: 'code', text: match[1] });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) spans.push({ kind: 'text', text: source.slice(cursor) });
  return spans.length ? spans : [{ kind: 'text', text: source }];
}
