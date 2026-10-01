import { useCallback, useEffect, useState } from 'react';

import type { PrivacySettings } from '@/privacy/settings';
import { api, reportError } from '@/state/store';

/**
 * The viewer's privacy settings, loaded once per screen; `update` applies a change at once and
 * rolls it back (with a toast) if the server refuses.
 */
export function usePrivacy() {
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await api.privacySettings());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; load() sets state only after its request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const update = useCallback(
    async (patch: Partial<PrivacySettings>) => {
      if (!settings) return;
      const before = settings;
      setSettings({ ...settings, ...patch });
      try {
        setSettings(await api.updatePrivacy(patch));
      } catch (e) {
        setSettings(before);
        reportError(`Couldn't save that setting: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [settings],
  );

  return { settings, error, load, update };
}
