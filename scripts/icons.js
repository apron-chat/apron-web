#!/usr/bin/env node
/**
 * Rebuilds every app icon from the Apron logo: the favicon, the manifest's
 * icons and the apple-touch-icon. Each is the logo on the app's dark rounded
 * square, sized so it reads at that icon's size.
 *
 *   npm run icons                    # from protocol/art/apron-logo.svg
 *   npm run icons -- path/to/logo.svg
 *
 * The logo is shazow/apron's art/apron-logo.svg, which the protocol/ submodule
 * carries; update the submodule (or pass a path) to pick up a new one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(root, 'protocol/art/apron-logo.svg');

/** The app's dark background (`--bg-100`). */
const BACKGROUND = '#15151f';
/** Corner radius as a share of the side, as the old favicon had it (18 of 64). */
const RADIUS = 18 / 64;

/**
 * `logo` is the share of the side the logo spans; `rounded` icons carry their
 * own corners, the rest are full-bleed squares the platform masks: the
 * maskable one keeps the logo inside the 80% safe circle, and iOS rounds the
 * apple-touch-icon itself.
 */
const ICONS = [
	{ path: 'src/lib/assets/favicon.svg', logo: 0.88, rounded: true },
	{ path: 'static/icon-192.png', size: 192, logo: 0.78, rounded: true },
	{ path: 'static/icon-512.png', size: 512, logo: 0.78, rounded: true },
	{ path: 'static/icon-maskable-512.png', size: 512, logo: 0.62, rounded: false },
	{ path: 'static/apple-touch-icon.png', size: 180, logo: 0.72, rounded: false }
];

const logo = readFileSync(source, 'utf8');
const open = logo.match(/<svg\b[^>]*>/);
const viewBox = open?.[0].match(/viewBox="([^"]+)"/)?.[1];
if (!open || !viewBox) throw new Error(`${source}: expected an <svg> with a viewBox`);
// The drawing without its root element or the editor's bookkeeping.
const drawing = logo
	.slice(open.index + open[0].length, logo.lastIndexOf('</svg>'))
	.replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)/g, '')
	.replace(/<metadata[\s\S]*?<\/metadata>/g, '');

/** The icon as SVG on a 64-unit square. */
function icon({ logo: share, rounded }) {
	const side = 64 * share;
	const inset = (64 - side) / 2;
	const round = rounded ? ` rx="${64 * RADIUS}"` : '';
	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">
  <rect width="64" height="64"${round} fill="${BACKGROUND}"/>
  <svg x="${inset}" y="${inset}" width="${side}" height="${side}" viewBox="${viewBox}" fill="none">${drawing}</svg>
</svg>
`;
}

for (const spec of ICONS) {
	const svg = icon(spec);
	const out = join(root, spec.path);
	if (spec.size) writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: spec.size } }).render().asPng());
	else writeFileSync(out, svg);
	console.log(`${spec.path}${spec.size ? ` (${spec.size}px)` : ''}`);
}
