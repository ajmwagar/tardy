import type { SFSymbol } from 'expo-symbols';

import type { AuthProvider } from '@/data/types';

/** How each sign-in provider is named and drawn. One table, used everywhere. */
export const PROVIDERS: Record<AuthProvider, { name: string; symbol: SFSymbol }> = {
  github: { name: 'GitHub', symbol: 'chevron.left.forwardslash.chevron.right' },
  apple: { name: 'Apple', symbol: 'apple.logo' },
  google: { name: 'Google', symbol: 'g.circle.fill' },
  x: { name: 'X', symbol: 'xmark' },
  email: { name: 'Email', symbol: 'envelope.fill' },
};

/** Providers that sign in through a browser or native sheet (email has its own screen). */
export const ONE_TAP_PROVIDERS = ['apple', 'google', 'github', 'x'] as const satisfies readonly AuthProvider[];
