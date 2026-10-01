import { useCallback, useRef, useState } from 'react';

import { haptic } from './ui';

/**
 * Pull-to-refresh with a feel: a tap the moment the pull passes the threshold (iOS calls
 * `onRefresh` right then), and a softer tick when fresh content lands. The spinner stops as
 * soon as `task` settles; a second pull while one is running is ignored.
 */
export function useRefresh(task: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);
  const onRefresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    haptic.impact();
    setRefreshing(true);
    try {
      await task();
      haptic.selection();
    } finally {
      running.current = false;
      setRefreshing(false);
    }
  }, [task]);
  return { refreshing, onRefresh };
}
