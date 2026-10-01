/**
 * Decoding the server's snake_case JSON into the app's camelCase types, strictly.
 *
 * A response that does not match the contract throws `TardyWireError` naming the route and
 * the exact field (`GET /v1/feed: items[0].like_count: expected integer, got undefined`),
 * so a server/client mismatch fails loudly at the boundary instead of rendering `undefined`.
 *
 * Wire conventions (contracts/app-api-addendum.md):
 * - keys are the snake_case of the app's camelCase field (`postCount` ↔ `post_count`),
 *   unless a field names its wire key explicitly with `wire(...)`;
 * - timestamps are integer milliseconds since the Unix epoch in a key with an `_ms` suffix
 *   (`created_at_ms`); the app's types hold ISO strings, so `timeMs` converts both ways;
 * - unknown extra keys are ignored (the server may add fields before clients ship).
 */

/** The response did not match the client contract. Not a `TardyApiError`: nothing the user did. */
export class TardyWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TardyWireError';
  }
}

/**
 * Decodes one value; `path` locates it in the response for error messages. Optional
 * metadata says which wire key an object field reads: `wireKey` replaces the derived key,
 * `wireSuffix` is appended to it (timestamps read `<key>_ms`).
 */
export type Decoder<T> = ((value: unknown, path: string) => T) & { wireKey?: string; wireSuffix?: string };

const describe = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'string' ? `"${value}"` : typeof value === 'object' ? 'object' : String(value));

function fail(path: string, expected: string, value: unknown): never {
  throw new TardyWireError(`${path}: expected ${expected}, got ${describe(value)}`);
}

/** `postCount` → `post_count`. */
export const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Shallow camelCase → snake_case for request bodies, dropping `undefined` values (an
 * omitted optional field is absent on the wire, never `null`).
 */
export function snakeKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]));
}

/** ISO time → wire milliseconds. Throws on an unparseable time rather than sending NaN. */
export function isoToMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO time: ${iso}`);
  return ms;
}

export const string: Decoder<string> = (v, path) => (typeof v === 'string' ? v : fail(path, 'string', v));

export const boolean: Decoder<boolean> = (v, path) => (typeof v === 'boolean' ? v : fail(path, 'boolean', v));

export const number: Decoder<number> = (v, path) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'number', v));

export const integer: Decoder<number> = (v, path) => (typeof v === 'number' && Number.isInteger(v) ? v : fail(path, 'integer', v));

/** Wire `<key>_ms` (integer ms since epoch) → ISO string. */
export const timeMs: Decoder<string> = Object.assign(
  (v: unknown, path: string) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? new Date(v).toISOString() : fail(path, 'integer milliseconds since epoch', v)),
  { wireSuffix: '_ms' },
);

/** Wire RFC 3339 time (the social routes' `created_at`) → normalized ISO string. */
export const isoTime: Decoder<string> = (v, path) => {
  if (typeof v !== 'string') return fail(path, 'RFC 3339 time', v);
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? fail(path, 'RFC 3339 time', v) : new Date(ms).toISOString();
};

/** Reads the field from `key` on the wire instead of the derived snake_case name. */
export function wire<T>(key: string, decoder: Decoder<T>): Decoder<T> {
  const renamed = ((v: unknown, path: string) => decoder(v, path)) as Decoder<T>;
  renamed.wireKey = key;
  return renamed;
}

/** One of a closed set of strings. Unknown values are a contract break. */
export function oneOf<const V extends string>(values: readonly V[]): Decoder<V> {
  return (v, path) => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as V) : fail(path, `one of ${values.join(' | ')}`, v));
}

/**
 * One of an open set: the server may add values before clients ship, and the contract
 * says clients ignore ones they do not know. Unknown strings decode to `undefined`; a
 * non-string is still a contract break.
 */
export function knownOf<const V extends string>(values: readonly V[]): Decoder<V | undefined> {
  return (v, path) => (typeof v !== 'string' ? fail(path, 'string', v) : (values as readonly string[]).includes(v) ? (v as V) : undefined);
}

/** Absent or `null` → `undefined`. Keeps the inner decoder's wire metadata. */
export function optional<T>(decoder: Decoder<T>): Decoder<T | undefined> {
  return Object.assign((v: unknown, path: string) => (v === undefined || v === null ? undefined : decoder(v, path)), {
    wireKey: decoder.wireKey,
    wireSuffix: decoder.wireSuffix,
  });
}

/** Present and `null` → `null`. A missing key is still an error: null must be explicit. */
export function nullable<T>(decoder: Decoder<T>): Decoder<T | null> {
  return Object.assign((v: unknown, path: string) => (v === null ? null : v === undefined ? fail(path, 'value or null', v) : decoder(v, path)), {
    wireKey: decoder.wireKey,
    wireSuffix: decoder.wireSuffix,
  });
}

export function array<T>(decoder: Decoder<T>): Decoder<T[]> {
  return (v, path) => (Array.isArray(v) ? v.map((item, i) => decoder(item, `${path}[${i}]`)) : fail(path, 'array', v));
}

/** An array whose items decode to `undefined` when the client should skip them (unknown kinds). */
export function arraySkipping<T>(decoder: Decoder<T | undefined>): Decoder<T[]> {
  const all = array(decoder);
  return (v, path) => all(v, path).filter((item): item is T => item !== undefined);
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every key of `T` needs a decoder, including optional ones, so no field is forgotten. */
export type Shape<T> = { [K in keyof T]-?: Decoder<T[K]> };

/**
 * A JSON object → `T`, field by field. Optional fields that decode to `undefined` are
 * left off the result, so decoded values compare equal to hand-built ones.
 */
export function object<T>(shape: Shape<T>): Decoder<T> {
  return (v, path) => {
    if (!isRecord(v)) fail(path, 'object', v);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      const decoder = shape[key];
      const wireKey = decoder.wireKey ?? `${toSnake(key)}${decoder.wireSuffix ?? ''}`;
      const value = decoder(v[wireKey], `${path}.${wireKey}`);
      if (value !== undefined) out[key] = value;
    }
    return out as T;
  };
}

/** A tagged union discriminated by `tag` (e.g. media `type`), one object decoder per tag value. */
export function tagged<T>(tag: string, variants: Record<string, Decoder<T>>): Decoder<T> {
  return (v, path) => {
    if (!isRecord(v)) fail(path, 'object', v);
    const key = v[tag];
    const variant = typeof key === 'string' ? variants[key] : undefined;
    return variant ? variant(v, path) : fail(`${path}.${tag}`, `one of ${Object.keys(variants).join(' | ')}`, key);
  };
}

/** An object used as a map from known string keys to values; unknown keys are skipped. */
export function knownRecord<const K extends string, V>(keys: readonly K[], value: Decoder<V>, { requireAll }: { requireAll: boolean }): Decoder<Record<K, V>> {
  return (v, path) => {
    if (!isRecord(v)) fail(path, 'object', v);
    const out = {} as Record<K, V>;
    for (const key of keys) {
      if (v[key] === undefined) {
        if (requireAll) fail(`${path}.${key}`, 'value', undefined);
        continue;
      }
      out[key] = value(v[key], `${path}.${key}`);
    }
    return out;
  };
}

/** Applies `f` to a decoded value (e.g. unwrapping an envelope). */
export function map<A, B>(decoder: Decoder<A>, f: (a: A) => B): Decoder<B> {
  return (v, path) => f(decoder(v, path));
}
