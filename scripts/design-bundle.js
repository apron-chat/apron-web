// Builds the Apron design system's bundle from src/lib/design: components/bundle.js (one classic script that sets
// window.Apron) and components/bundle.css (every token from tokens.css, both themes, then apron.css's component styles, then
// rail.css's BackendRail and AppShell's rail column, which the app never renders and so doesn't import),
// under dist-design/project/. Also index.d.ts and each components/<Name>/preview.html. Publish those files to the design system artifact.
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

// Every token, read from tokens.css, the source of truth: its dark :root, the light theme's media-query block and the
// data-theme blocks, whole, so bundle.css works on its own and no token is written out a second time by hand.
const tokens = readFileSync('src/lib/design/tokens.css', 'utf8');
for (const block of [':root {', '@media (prefers-color-scheme: light) {', ":root:not([data-theme='dark']) {", ":root[data-theme='dark'] {", ":root[data-theme='light'] {"]) {
	if (!tokens.includes(block)) throw new Error(`tokens.css has no ${block} block`);
}
const css = [tokens, ...['apron.css', 'rail.css'].map((f) => readFileSync(`src/lib/design/${f}`, 'utf8'))].join('\n');
if (/<\/style/i.test(css)) throw new Error('bundle.css must not contain </style');

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/bundle.js`, `/* @ds-bundle: ${JSON.stringify(header)} */\n${js}`);
writeFileSync(`${OUT}/bundle.css`, css);
// Props documentation, generated from each component's `interface Props`.
await import('./design-dts.js');
rmSync('dist-design/bundle.js');

// One live preview per component (and the layout pages), mounted with window.Apron.render.
for (const f of readdirSync('src/lib/design/previews')) {
	if (!f.endsWith('.html')) continue;
	const dir = `${OUT}/${f.slice(0, -5)}`;
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/preview.html`, readFileSync(`src/lib/design/previews/${f}`));
}
console.log(`${OUT}/bundle.js  ${(js.length / 1024).toFixed(1)} KB · ${names.length} components`);
