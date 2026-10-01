import { Alert, Linking } from 'react-native';

import { openWebCheckout } from '../config';

const WEB = 'https://tardy.example';

let alert: jest.SpyInstance;
let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('openWebCheckout', () => {
  it.each([
    ['verify', `${WEB}/verify`],
    ['boost', `${WEB}/boost`],
  ] as const)('%s opens %s in the system browser', async (kind, url) => {
    await openWebCheckout(kind, WEB);
    expect(openURL).toHaveBeenCalledWith(url);
    expect(alert).not.toHaveBeenCalled();
  });

  it('alerts, naming what is disabled, when the website is not configured', async () => {
    await openWebCheckout('boost', null);
    expect(openURL).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Checkout not configured', expect.stringContaining('story boosts'));
  });

  it('alerts with the URL and the reason when the browser cannot open', async () => {
    openURL.mockRejectedValue(new Error('no handler'));
    await openWebCheckout('verify', WEB);
    expect(alert).toHaveBeenCalledWith("Couldn't open checkout", expect.stringMatching(/\/verify[\s\S]*no handler/));
  });
});
