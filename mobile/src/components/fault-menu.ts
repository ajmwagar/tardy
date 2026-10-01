import { ActionSheetIOS } from 'react-native';

import { FAULT_PRESETS, faults } from '@/data/mock/faults';

/**
 * Dev-only action sheet over the mock's fault switch (`data/mock/faults.ts`). Returns
 * whether a menu was shown; in production builds the switch is unavailable and this does
 * nothing. Feed states need a pull-to-refresh (or a fresh tab) to show.
 */
export function openFaultMenu(): boolean {
  if (!faults.available) return false;
  const options = ['Cancel', 'Off (no faults)', ...FAULT_PRESETS.map((p) => p.label)];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Fault injection (dev only)',
      message: `${faults.active ? 'Faults are ON.' : 'Faults are off.'} Pull to refresh after changing feed faults.`,
      options,
      cancelButtonIndex: 0,
    },
    (i) => {
      if (i === 1) faults.reset();
      else if (i >= 2) faults.set(FAULT_PRESETS[i - 2].faults);
    },
  );
  return true;
}
