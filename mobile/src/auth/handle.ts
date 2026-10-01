/**
 * Handle rules. The server is authoritative (`setHandle` rejects with `invalid`); the
 * client checks the same rules for instant feedback, and the mock enforces them as the
 * server will. Keep in step with the Rust server's validator.
 */
const HANDLE = /^[a-z][a-z0-9._]{2,29}$/;

/** What the person typed, as a candidate handle: trimmed, lowercased, no leading `@`. */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

/** Why `handle` (already normalized) is not allowed, or null if it is fine. */
export function handleProblem(handle: string): string | null {
  if (handle.length < 3) return 'At least 3 characters.';
  if (handle.length > 30) return 'At most 30 characters.';
  if (!HANDLE.test(handle)) return 'Start with a letter; then letters, numbers, dots, or underscores.';
  if (handle.includes('..') || handle.endsWith('.')) return 'No double dots, and no dot at the end.';
  return null;
}
