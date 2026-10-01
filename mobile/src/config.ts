import { Alert, Linking } from 'react-native';

/**
 * Runtime configuration from `EXPO_PUBLIC_*` env vars (inlined at bundle time).
 * Set them in `mobile/.env.local`; see `.env.example`.
 */
export const config = {
  /** Tardy website; hosts paid verification checkout. */
  webUrl: process.env.EXPO_PUBLIC_TARDY_WEB_URL?.replace(/\/$/, '') ?? null,
} as const;

/**
 * Paid verification is bought on the website (checkout owned by the web app), so the
 * app only hands off to the system browser. The site identifies the buyer from their
 * Tardy session; nothing about the user goes in the URL.
 */
export async function openVerificationCheckout(): Promise<void> {
  if (!config.webUrl) {
    Alert.alert('Checkout not configured', 'Set EXPO_PUBLIC_TARDY_WEB_URL to the Tardy website to enable verification.');
    return;
  }
  const url = `${config.webUrl}/verify`;
  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert("Couldn't open checkout", `${url}\n\n${error instanceof Error ? error.message : String(error)}`);
  }
}
