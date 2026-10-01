import { colors, contrastRatio } from '@/theme';

/** WCAG AA minimum for normal-size text. */
const AA = 4.5;

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio(colors.text, colors.bg)).toBeCloseTo(contrastRatio(colors.bg, colors.text), 10);
  });

  it('fails loudly on colors it cannot read', () => {
    expect(() => contrastRatio('rgba(0,0,0,0.5)', '#000000')).toThrow('Not a #RRGGBB color');
  });
});

describe('theme text contrast', () => {
  const backgrounds = { bg: colors.bg, surface: colors.surface } as const;
  const texts = { text: colors.text, textSecondary: colors.textSecondary, textTertiary: colors.textTertiary } as const;

  for (const [textName, fg] of Object.entries(texts)) {
    for (const [bgName, bg] of Object.entries(backgrounds)) {
      it(`${textName} on ${bgName} meets AA`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it('keeps secondary and tertiary text distinguishable', () => {
    expect(contrastRatio(colors.textSecondary, colors.bg)).toBeGreaterThan(contrastRatio(colors.textTertiary, colors.bg) + 1.5);
  });

  it('keeps text on Tardy yellow readable', () => {
    expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(AA);
  });
});
