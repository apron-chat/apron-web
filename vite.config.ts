import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Node's fs, without Node's types (the app has none): only to sort the test files below.
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as { readdirSync(path: URL, options: { recursive: true }): string[]; readFileSync(path: URL, encoding: 'utf8'): string };
const src = new URL('./src/', import.meta.url);

/**
 * The node tests that mock a module (`vi.mock`). A mock takes only where the module is imported afresh, so these
 * run isolated, each file in a fresh module graph; the other node tests share their worker's modules, which takes
 * about half the time. Found by reading the files, so a new test that mocks is isolated without listing it here.
 */
const MOCKING = fs.readdirSync(src, { recursive: true })
	.filter((path) => path.endsWith('.test.ts') && !path.endsWith('.svelte.test.ts'))
	.filter((path) => /\bvi\.(doMock|mock)\(/.test(fs.readFileSync(new URL(path, src), 'utf8')))
	.map((path) => `src/${path.replaceAll('\\', '/')}`);

/**
 * The in-memory `/__preview` page is for development: `vite dev`, and builds made with `APRON_PREVIEW=1` (the QA
 * snapshots and `npm run e2e`). A plain `vite build`, which production deploys, has no such page and none of its code.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig(({ command }) => {
	const preview = command === 'serve' || env.APRON_PREVIEW === '1';
	return {
		define: { __APRON_PREVIEW__: JSON.stringify(preview) },
		plugins: [
			sveltekit({
				compilerOptions: {
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				// Strict (every route prerendered) where /__preview is: without it, that one route is left out on purpose.
				adapter: adapter({ strict: preview }),
				// Open tabs look for a newer deploy every 5 minutes and offer a reload (UpdateNotice).
				version: { pollInterval: 5 * 60 * 1000 }
			})
		],
		test: {
			projects: [
				{ extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.svelte.test.ts', ...MOCKING], isolate: false } },
				{ extends: true, test: { name: 'mocking', include: MOCKING.length ? MOCKING : ['no-such-file'] } },
				// Rune tests need Svelte's client compile and runtime, where effects run.
				{ extends: true, resolve: { conditions: ['browser'] }, test: { name: 'runes', include: ['src/**/*.svelte.test.ts'], environment: './src/lib/test/runes-environment.ts' } }
			]
		},
		server: {
			proxy: {
				'/ws': {
					target: 'ws://127.0.0.1:8080',
					ws: true
				},
				// Upload, file, and stream URLs the Go server mints from this host.
				'/write/': 'http://127.0.0.1:8080',
				'/files/': 'http://127.0.0.1:8080',
				'/streams/': 'http://127.0.0.1:8080'
			}
		}
	};
});
