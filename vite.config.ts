import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { UPDATE_POLL_MS } from './src/lib/ui/update-poll';

// Node's fs, without Node's types (the app has none): only to sort the test files below.
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as { readdirSync(path: URL, options: { recursive: true }): string[]; readFileSync(path: URL, encoding: 'utf8'): string };
const src = new URL('./src/', import.meta.url);
const urlModule = 'node:url';
const { fileURLToPath } = (await import(/* @vite-ignore */ urlModule)) as { fileURLToPath(url: URL): string };

/**
 * The tests that mock a module (`vi.mock`). A mock takes only where the module is imported afresh, so these
 * run isolated, each file in a fresh module graph; the other tests share their worker's modules, which takes
 * under half the time (for the rune tests, it saves a worker spawn per file). So module state outlives a test file:
 * reset what a test changes. Found by reading the files, so a new test that mocks is isolated without listing it here.
 */
const MOCKING = fs.readdirSync(src, { recursive: true })
	.filter((path) => path.endsWith('.test.ts'))
	.filter((path) => /\bvi\.(doMock|mock)\(/.test(fs.readFileSync(new URL(path, src), 'utf8')))
	.map((path) => `src/${path.replaceAll('\\', '/')}`);
const MOCKING_NODE = MOCKING.filter((path) => !path.endsWith('.svelte.test.ts'));
const MOCKING_RUNES = MOCKING.filter((path) => path.endsWith('.svelte.test.ts'));

/**
 * The in-memory `/__preview` page is for development: `vite dev`, and builds made with `APRON_PREVIEW=1` (the QA
 * snapshots and `npm run e2e`). A plain `vite build`, which production deploys, has no such page and none of its code.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig(({ command }) => {
	const preview = command === 'serve' || env.APRON_PREVIEW === '1';
	return {
		define: { __APRON_PREVIEW__: JSON.stringify(preview) },
		// markdown-it always constructs linkify-it, which Apron never uses (`linkify: false`): see the stub.
		resolve: { alias: { 'linkify-it': fileURLToPath(new URL('lib/protocol/linkify-off.ts', src)) } },
		plugins: [
			sveltekit({
				compilerOptions: {
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				// Strict (every route prerendered) where /__preview is: without it, that one route is left out on purpose.
				adapter: adapter({ strict: preview }),
				// Open tabs look for a newer deploy every 5 minutes, and on coming back after as long away, and offer a
				// reload (UpdateNotice).
				version: { pollInterval: UPDATE_POLL_MS }
			})
		],
		test: {
			// Bundled for the tests too, so they meet the linkify-it stub as the app does (rather than Node's linkify-it).
			server: { deps: { inline: ['markdown-it'] } },
			projects: [
				{ extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.svelte.test.ts', ...MOCKING], isolate: false } },
				{ extends: true, test: { name: 'mocking', include: MOCKING_NODE.length ? MOCKING_NODE : ['no-such-file'] } },
				// Rune tests need Svelte's client compile and runtime, where effects run.
				{ extends: true, resolve: { conditions: ['browser'] }, test: { name: 'runes', include: ['src/**/*.svelte.test.ts'], exclude: MOCKING_RUNES, environment: './src/lib/test/runes-environment.ts', isolate: false } },
				{ extends: true, resolve: { conditions: ['browser'] }, test: { name: 'runes-mocking', include: MOCKING_RUNES.length ? MOCKING_RUNES : ['no-such-file'], environment: './src/lib/test/runes-environment.ts' } }
			]
		},
		server: {
			proxy: {
				'/ws': {
					target: 'ws://127.0.0.1:8080',
					ws: true
				},
				// Upload, file, and live text URLs the Go server mints from this host.
				'/write/': 'http://127.0.0.1:8080',
				'/files/': 'http://127.0.0.1:8080',
				'/live/': 'http://127.0.0.1:8080'
			}
		}
	};
});
