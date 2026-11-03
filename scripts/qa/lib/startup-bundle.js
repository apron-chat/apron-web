import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

/**
 * The JavaScript a production build loads to start the app at `/`: the files its prerendered page preloads
 * (`<link rel="modulepreload">`) and imports (`import("…")`), which SvelteKit writes for the page's own code and
 * everything it imports statically, so code loaded on demand isn't among them. How many there are, and their size
 * as the browser parses them (`startupJsKB`) and as a CDN sends them, brotli-compressed (`startupJsBrotliKB`).
 *
 * Read from the build itself, with no browser: what CI's production build (`npm run build`) checks in seconds,
 * against the budget's `production` row (`qa startup-budget`). The preview build's `startupJsKB` (`qa budget`)
 * also counts the preview's own code; this one counts what users load, so code meant for the preview reaching
 * production shows here.
 */
export function productionStartup(buildDir) {
	const page = join(buildDir, 'index.html');
	if (!existsSync(page)) throw new Error(`no ${page}: build first (npm run build)`);
	if (existsSync(join(buildDir, '__preview.html'))) throw new Error(`${buildDir} is a preview build (APRON_PREVIEW=1): startup-budget checks a production one (npm run build)`);
	const html = readFileSync(page, 'utf8');
	// Each preload link's href, whichever order its attributes come in.
	const preloads = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /\brel="modulepreload"/.test(tag)).map((tag) => /\bhref="([^"]+\.js)"/.exec(tag)?.[1]);
	const imports = [...html.matchAll(/import\("([^"]+\.js)"\)/g)].map((m) => m[1]);
	const files = [...new Set([...preloads, ...imports].filter((file) => file !== undefined).map((file) => file.replace(/^\.?\//, '')))].sort();
	if (!files.length) throw new Error(`${page} preloads no JavaScript: has SvelteKit changed how it writes the page?`);
	let raw = 0;
	let brotli = 0;
	for (const file of files) {
		const bytes = readFileSync(join(buildDir, file));
		raw += bytes.length;
		brotli += brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
	}
	const kb = (n) => Math.round((n / 1024) * 10) / 10;
	return { files, counts: { startupFiles: files.length, startupJsKB: kb(raw), startupJsBrotliKB: kb(brotli) } };
}
