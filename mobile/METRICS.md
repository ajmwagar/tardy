# Mobile UX metrics

Measured numbers for the "crisp UX" pass on `feat/ux-polish-and-contract`. Every number
below came from running the command next to it in `mobile/`; nothing is estimated.

## Baseline (before the pass), 2026-09-30

### Build, tests, checks

| Metric | Value | Command |
| --- | --- | --- |
| iOS production JS bundle (Hermes bytecode) | 4,226,078 bytes (4.2 MB), 1,786 modules | `npx expo export --platform ios --output-dir /private/tmp/claude-501/tardy-export`, then `ls -l _expo/static/js/ios/*.hbc` |
| Exported assets | 35 files, 11,200,930 bytes (10.7 MB); 12 are the bundled reels (6 mp4 + 6 jpg posters) | same export; `find assets -type f -exec stat -f %z {} \; \| awk '{s+=$1} END {print s}'` |
| Whole export directory | 15 MB | `du -sh /private/tmp/claude-501/tardy-export` (deleted afterwards) |
| Tests | 250 passed / 250, 18 suites | `npx jest` |
| Typecheck | clean (exit 0) | `npx tsc --noEmit` |
| Lint | clean (exit 0) | `npx eslint src` |

### UI code (static counts over `src/app` and `src/components`)

| Metric | Value |
| --- | --- |
| Screens (route files, excluding `_layout`) | 15 |
| Component files | 16 |
| `memo()` components | 13 |
| Inline `renderItem={(...) =>` arrows (new function every render) | 9 |
| `<ActivityIndicator>` spinners | 10 |
| Inline `style={{...}}` objects | 50 |
| Raw `<Pressable>` (no press feedback) | 24 |
| `<PressableScale>` | 27 |
| `accessibilityLabel` props | 12 |
| expo-image `<Image>` elements | 8 |
| `<Image>` with a `transition` | 4 |
| Ad hoc red error text (`styles.error`) instead of `states.tsx` | 10 |

Contrast (WCAG 2.x ratio, computed from the theme hex values):

| Token | on `bg` | on `surface` | on `elevated` |
| --- | --- | --- | --- |
| `textSecondary` #A1A1AE | 7.74 | 7.12 | 6.18 |
| `textTertiary` #6E6E7A | **3.93** | **3.61** | **3.13** |

`textTertiary` (timestamps, placeholders, model names) is below the 4.5:1 AA minimum for
small text everywhere it is used.

### How the static counts were taken

```bash
UI="src/app src/components"
c() { grep -rE --include='*.tsx' "$1" $UI | wc -l | tr -d ' '; }
imgs() { cat $(grep -rl --include='*.tsx' '<Image' $UI) | perl -0777 -ne "\$n=0; while(/<Image\\b(.*?)\\/>/sg){ \$n++ if \$1 =~ /$1/ } print \$n"; }
find src/app -name '*.tsx' ! -name '_layout.tsx' | wc -l   # screens
find src/components -name '*.ts*' | wc -l                  # component files
c 'memo\(function'          # memo() components
c 'renderItem=\{\('         # inline renderItem arrows
c '<ActivityIndicator'      # spinners
c 'style=\{\{'              # inline style objects
c '<Pressable([ >]|$)'      # raw Pressable
c '<PressableScale'
c 'accessibilityLabel'
imgs '^'                    # <Image> elements
imgs 'transition='          # <Image> with a transition
c 'styles\.error'           # ad hoc error text
```

Contrast ratios use the WCAG relative-luminance formula; after the pass the same formula is
in `src/theme` (`contrastRatio`) and a test pins the text tokens at AA.
