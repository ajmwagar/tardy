import { errorForResponse } from '@/data/http/http-api';
import { FOLLOWING } from '@/data/mock/fixtures';
import { MockTardyApi } from '@/data/mock/mock-api';

const api = () => new MockTardyApi({ latencyMs: 0 });

describe('search', () => {
  it('needs the AI-search opt-in first, then finds tardies by every word', async () => {
    const client = api();
    await expect(client.searchTardies('ranked feed')).rejects.toMatchObject({ code: 'consent_required' });
    await client.allowAiSearch();
    const hits = await client.searchTardies('ranked feed');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((p) => /ranked/i.test(p.caption) && /feed/i.test(p.caption))).toBe(true);
  });

  it('rejects an empty query and an out-of-range limit', async () => {
    const client = api();
    await client.allowAiSearch();
    await expect(client.searchTardies('  ')).rejects.toMatchObject({ code: 'invalid' });
    await expect(client.searchTardies('feed', 51)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('explores beyond who you follow first', async () => {
    const page = await api().explore(null);
    expect(page.items.length).toBeGreaterThan(0);
    expect(new Set(FOLLOWING).has(page.items[0].authorId)).toBe(false);
  });

  it("maps today's server consent 403 to consent_required", () => {
    const error = errorForResponse('POST /v1/search', 403, JSON.stringify({ error: 'explicit search AI consent is required' }));
    expect(error).toMatchObject({ code: 'consent_required' });
    expect(errorForResponse('GET /v1/profile', 403, JSON.stringify({ error: 'nope' }))).toMatchObject({ code: 'forbidden' });
  });
});
