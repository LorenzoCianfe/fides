import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkTheme, lightTheme, themeToCss } from '@fides/ui-tokens';

// Generate the CSS custom-property themes from the token source of truth.
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'app');
const outFile = join(outDir, 'theme.css');

const css = [
  '/* Generated from @fides/ui-tokens — do not edit by hand. */',
  themeToCss(lightTheme, ':root'),
  themeToCss(darkTheme, '[data-theme="dark"]'),
  '',
].join('\n\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, css);
console.warn(`Wrote ${outFile}`);
