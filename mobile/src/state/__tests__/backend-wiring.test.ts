/**
 * Which backend the store builds is decided by EXPO_PUBLIC_TARDY_API_URL, and
 * `usesMockBackend` (which gates developer shortcuts) follows the instance, not the env.
 */
function loadStore(apiUrl: string | undefined): typeof import('../store') {
  const saved = process.env.EXPO_PUBLIC_TARDY_API_URL;
  if (apiUrl === undefined) delete process.env.EXPO_PUBLIC_TARDY_API_URL;
  else process.env.EXPO_PUBLIC_TARDY_API_URL = apiUrl;
  try {
    // A fresh module registry, so the store module re-reads the env at import.
    let store!: typeof import('../store');
    jest.isolateModules(() => {
      store = jest.requireActual('../store');
    });
    return store;
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_TARDY_API_URL;
    else process.env.EXPO_PUBLIC_TARDY_API_URL = saved;
  }
}

describe('backend wiring', () => {
  it('uses the mock when the API URL is unset or empty', () => {
    expect(loadStore(undefined).usesMockBackend).toBe(true);
    expect(loadStore('').usesMockBackend).toBe(true);
  });

  it('uses the HTTP client when the API URL is set', () => {
    expect(loadStore('https://api.example.test').usesMockBackend).toBe(false);
  });
});
