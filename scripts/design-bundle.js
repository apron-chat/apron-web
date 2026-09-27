// Builds the Apron design system's bundle from src/lib/design: components/bundle.js (one classic script that sets
// window.Apron) and components/bundle.css (tokens-independent component styles), under dist-design/project/.
// Also each components/<Name>/preview.html. Publish those files to the design system artifact; its tokens.css comes from its own tokens.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { build } from 'vite';

const OUT = 'dist-design/project/components';
await build({ configFile: 'vite.design.config.ts', logLevel: 'warn' });

const index = readFileSync('src/lib/design/components/index.ts', 'utf8');
const names = [...index.matchAll(/export \{ default as (\w+) \}/g)].map((m) => m[1]);
const header = { format: 4, namespace: 'Apron', components: names.map((name) => ({ name })) };

let js = readFileSync('dist-design/bundle.js', 'utf8');
// Consumers inline the bundle in a <script>: it must not close or comment out that element.
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--');
if (/\bimport\s*\(|\beval\s*\(|new Function\s*\(/.test(js)) throw new Error('bundle.js must not import, eval or new Function');

// Variables the app's tokens.css derives from other tokens (the design system's tokens.json holds only literal values).
const derived = `:root { --font-chat: var(--font-sans); --font-emoji: 'EmojiMart', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Segoe UI', 'Apple Color Emoji', 'Twemoji Mozilla', 'Noto Color Emoji', 'Android Emoji'; }\n`;
const css = derived + readFileSync('src/lib/design/apron.css', 'utf8');
if (/<\/style/i.test(css)) throw new Error('bundle.css must not contain </style');

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/bundle.js`, `/* @ds-bundle: ${JSON.stringify(header)} */\n${js}`);
writeFileSync(`${OUT}/bundle.css`, css);
// Props documentation; keep it in step with the components' Props interfaces.
writeFileSync(`${OUT}/index.d.ts`, readFileSync('src/lib/design/index.d.ts'));
rmSync('dist-design/bundle.js');

// One live preview per component (and the layout pages), mounted with window.Apron.render.
for (const f of readdirSync('src/lib/design/previews')) {
	if (!f.endsWith('.html')) continue;
	const dir = `${OUT}/${f.slice(0, -5)}`;
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/preview.html`, readFileSync(`src/lib/design/previews/${f}`));
}
console.log(`${OUT}/bundle.js  ${(js.length / 1024).toFixed(1)} KB · ${names.length} components`);
