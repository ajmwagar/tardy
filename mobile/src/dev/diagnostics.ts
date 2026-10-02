export type DataSource = 'mock' | 'local' | 'production' | 'remote';

/** Classifies the configured backend without maintaining a second environment flag. */
export function dataSource(apiUrl: string | null): DataSource {
  if (!apiUrl) return 'mock';
  try {
    const host = new URL(apiUrl).hostname.toLowerCase();
    if (host === 'api.tardy.news') return 'production';
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || host.endsWith('.ts.net')) return 'local';
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'local';
    return 'remote';
  } catch {
    return 'remote';
  }
}

export async function probeBackend(apiUrl: string | null): Promise<{ latencyMs: number; serverVersion: string | null }> {
  if (!apiUrl) return { latencyMs: 0, serverVersion: null };
  const started = Date.now();
  const health = await fetch(`${apiUrl.replace(/\/$/, '')}/healthz`);
  if (!health.ok) throw new Error(`healthz returned HTTP ${health.status}`);
  const latencyMs = Date.now() - started;
  let serverVersion: string | null = health.headers.get('x-tardy-revision');
  if (!serverVersion) {
    try {
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/openapi.json`);
      if (response.ok) {
        const document = (await response.json()) as { info?: { version?: unknown } };
        serverVersion = typeof document.info?.version === 'string' ? document.info.version : null;
      }
    } catch {
      // Health is authoritative; an optional version lookup must not make it fail.
    }
  }
  return { latencyMs, serverVersion };
}
