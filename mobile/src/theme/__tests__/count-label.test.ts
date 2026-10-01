import { countLabel } from '@/theme';

describe('countLabel', () => {
  it('appends the full count for VoiceOver', () => {
    expect(countLabel('Ping me on status change', 12)).toBe('Ping me on status change, 12');
    expect(countLabel('Thumbs up', 12_345)).toBe('Thumbs up, 12,345');
    expect(countLabel('Comments', 0)).toBe('Comments, 0');
  });

  it('is just the label when there is no count', () => {
    expect(countLabel('Save', undefined)).toBe('Save');
  });
});
