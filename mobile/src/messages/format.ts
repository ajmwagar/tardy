export type MessageSpan = { kind: 'text' | 'code'; text: string };

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
