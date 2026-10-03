import { dataSource } from '../diagnostics';

describe('development diagnostics', () => {
  it.each([
    [null, 'mock'],
    ['https://api.tardy.news', 'production'],
    ['http://192.168.10.82:3300', 'local'],
    ['https://averys-macbook-neo.tail5ba253.ts.net:8443', 'local'],
    ['https://staging.tardy.news', 'remote'],
  ] as const)('classifies %s as %s', (url, expected) => expect(dataSource(url)).toBe(expected));
});
