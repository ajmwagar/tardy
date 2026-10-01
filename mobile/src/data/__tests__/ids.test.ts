import { uuidV4 } from '../ids';

describe('uuidV4', () => {
  it('is a well-formed v4 UUID and differs each call', () => {
    const a = uuidV4();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV4()).not.toBe(a);
  });
});
