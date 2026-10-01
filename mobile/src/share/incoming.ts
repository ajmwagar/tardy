/**
 * What came in from the system share sheet ("Open in Tardy"), reduced to the one thing Tardy
 * shares today: a web link. Apps share links either as a URL or as text containing one (a
 * caption plus a link), so both are read. Anything without an http(s) link is not shareable yet.
 */
export function sharedUrl(intent: { webUrl?: string | null; text?: string | null }): string | null {
  const direct = intent.webUrl?.trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const inText = intent.text?.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  return inText ? inText.replace(/[).,;!?]+$/, '') : null;
}
