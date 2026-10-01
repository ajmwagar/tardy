// Renders the app icon set from alarm-icon.js (variant #1, "Classic") into mobile/assets.
// Run from the repo root: NODE_PATH=$(npm root -g) node docs/brand/export.cjs
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const IMG = path.join(ROOT, 'mobile/assets/images');
const ICON = path.join(ROOT, 'mobile/assets/expo.icon');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tardy-icons-'));
const BG = '#0A0A0D';

/** Shrinks the whole drawing (clock + dot) toward the centre, for safe zones. */
const inset = (svg, k) =>
  svg.replace('<svg viewBox="0 0 1024 1024">', `<svg viewBox="0 0 1024 1024"><g transform="translate(512 512) scale(${k}) translate(-512 -512)">`)
     .replace(/<\/svg>$/, '</g></svg>');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<script>${fs.readFileSync(path.join(__dirname, 'alarm-icon.js'), 'utf8')}</script>`);
  const svg = (cfg) => page.evaluate((c) => icon(c), cfg);

  const render = async (svgStr, size, file) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svgStr.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };

  const full = await svg({});
  const glyph = await svg({ bg: 'none' });
  const clockOnly = await svg({ bg: 'none', dot: 'none' });
  const mono = await svg({ bg: 'none', body: '#FFFFFF', ink: '#000000', dotColor: '#FFFFFF' });

  // App icon (iOS fallback + Android legacy + store), full-bleed, opaque.
  await render(full, 1024, path.join(IMG, 'icon.png'));
  await render(full, 48, path.join(IMG, 'favicon.png'));
  // Android adaptive: glyph inside the 66% safe zone over a solid field.
  await render(inset(glyph, 0.62), 512, path.join(IMG, 'android-icon-foreground.png'));
  await render(`<svg viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${BG}"/></svg>`, 512, path.join(IMG, 'android-icon-background.png'));
  // Android themed icon: single colour, play button cut out. Luminance becomes alpha.
  const monoTmp = path.join(TMP, 'mono.png');
  await render(inset(mono, 0.62), 432, monoTmp);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', monoTmp, '-vf',
    "format=rgba,geq=r='255':g='255':b='255':a='alpha(X,Y)*r(X,Y)/255'", path.join(IMG, 'android-icon-monochrome.png')]);
  // Splash: the glyph on transparent; app.json supplies the background colour.
  await render(inset(glyph, 0.9), 1024, path.join(IMG, 'splash-icon.png'));

  // iOS Icon Composer bundle: clock and dot as separate layers over a solid fill.
  fs.rmSync(path.join(ICON, 'Assets'), { recursive: true, force: true });
  fs.mkdirSync(path.join(ICON, 'Assets'), { recursive: true });
  fs.writeFileSync(path.join(ICON, 'Assets/clock.svg'), clockOnly.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '));
  fs.writeFileSync(path.join(ICON, 'Assets/dot.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><circle cx="790" cy="230" r="70" fill="#FF2D3D"/></svg>');
  const srgb = (hex) => 'srgb:' + [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',') + ',1.00000';
  fs.writeFileSync(path.join(ICON, 'icon.json'), JSON.stringify({
    fill: { solid: srgb(BG) },
    groups: [
      { layers: [{ 'image-name': 'dot.svg', name: 'dot' }], shadow: { kind: 'neutral', opacity: 0.5 }, translucency: { enabled: false, value: 0 } },
      { layers: [{ 'image-name': 'clock.svg', name: 'clock' }], shadow: { kind: 'neutral', opacity: 0.5 }, translucency: { enabled: true, value: 0.3 } },
    ],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  }, null, 2) + '\n');

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('icons written');
})();
