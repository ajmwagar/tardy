/**
 * A random RFC 4122 v4 UUID, for client-made idempotency keys (event ids, request ids).
 * These need to be unique, not secret, so `Math.random` is enough and no native module is needed.
 */
export function uuidV4(random: () => number = Math.random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16));
  hex[12] = 4; // version
  hex[16] = (hex[16] & 0x3) | 0x8; // variant 10xx
  const s = hex.map((n) => n.toString(16)).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
