import { Alert, Linking } from 'react-native';

/**
 * Runtime configuration from `EXPO_PUBLIC_*` env vars (inlined at bundle time).
 * Set them in `mobile/.env.local`; see `.env.example`.
 */
export const config = {
  /** Tardy website; hosts paid checkouts (verification, story boosts). */
  webUrl: process.env.EXPO_PUBLIC_TARDY_WEB_URL?.replace(/\/$/, '') ?? null,
  /**
   * Tardy API server (the Rust backend). When set, the app talks to it over HTTP
   * (`data/http/http-api.ts`); unset or empty, it runs on the in-app mock backend.
   */
  apiUrl: process.env.EXPO_PUBLIC_TARDY_API_URL || null,
} as const;

/** What can be bought on the website: its path there, and what it enables (for alerts). */
export const WEB_CHECKOUTS = {
  verify: { path: '/verify', enables: 'verification' },
  boost: { path: '/boost', enables: 'story boosts' },
} as const;

export type WebCheckout = keyof typeof WEB_CHECKOUTS;

/**
 * Paid features are bought on the website (checkout owned by the web app), so the app
 * only hands off to the system browser. The site identifies the buyer from their Tardy
 * session; nothing about the user goes in the URL. Alerts loudly when the website URL
 * isn't configured or the browser can't be opened.
 */
export async function openWebCheckout(kind: WebCheckout, webUrl: string | null = config.webUrl): Promise<void> {
  const { path, enables } = WEB_CHECKOUTS[kind];
  if (!webUrl) {
    Alert.alert('Checkout not configured', `Set EXPO_PUBLIC_TARDY_WEB_URL to the Tardy website to enable ${enables}.`);
    return;
  }
  const url = `${webUrl}${path}`;
  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert("Couldn't open checkout", `${url}\n\n${error instanceof Error ? error.message : String(error)}`);
  }
}
