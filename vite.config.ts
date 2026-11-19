import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { UPDATE_POLL_MS } from './src/lib/ui/update-poll';

// Node's fs, without Node's types (the app has none): only to sort the test files below.
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as { readdirSync(path: URL, options: { recursive: true }): string[]; readFileSync(path: URL | string, encoding: 'utf8'): string };
const src = new URL('./src/', import.meta.url);
const urlModule = 'node:url';
const { fileURLToPath, pathToFileURL } = (await import(/* @vite-ignore */ urlModule)) as { fileURLToPath(url: URL): string; pathToFileURL(path: string): URL };

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

/**
 * emoji-mart's data gives each skin twice: as its characters (`native`) and as their code points (`unified`), which
 * emoji-mart reads only to build image URLs for its image sets. The picker draws the system's emoji (`set: 'native'`),
 * so the data goes out without `unified`: 89 KB (12 KB gzipped) less to fetch, parse and hold when a picker or
 * `:shortcode` first loads it.
 */
function emojiDataNativeOnly(): Plugin {
	return {
		name: 'apron:emoji-data-native-only',
		enforce: 'pre',
		transform(code, id) {
			if (!id.split('?')[0].endsWith('/@emoji-mart/data/sets/15/native.json')) return;
			const data = JSON.parse(code) as { emojis: Record<string, { skins: Array<{ unified?: string }> }> };
			for (const emoji of Object.values(data.emojis)) for (const skin of emoji.skins) delete skin.unified;
			return { code: JSON.stringify(data), map: null };
		}
	};
}

/**
 * markdown-it's rules for options `markdown.ts` keeps off (`html`, `linkify`, `typographer`), each of which returns at
 * once on its option: replaced by a stub that still does, so the rule and what only it uses (HTML block names,
 * smart quotes) leave the bundle, about 7 KB of startup JS. Each stub throws if its option is turned on, rather than
 * quietly doing nothing; and the build fails if a rule isn't found as written, or no longer starts from its option,
 * as after a markdown-it upgrade that changed it.
 */
function markdownItUnusedRules(): Plugin {
	const rules: Array<{ head: string; option: string; returns: string }> = [
		{ head: 'linkify$1(state)', option: 'linkify', returns: '' },
		{ head: 'linkify(state, silent)', option: 'linkify', returns: 'false' },
		{ head: 'replace(state)', option: 'typographer', returns: '' },
		{ head: 'smartquotes(state)', option: 'typographer', returns: '' },
		{ head: 'html_block(state, startLine, endLine, silent)', option: 'html', returns: 'false' },
		{ head: 'html_inline(state, silent)', option: 'html', returns: 'false' }
	];
	return {
		name: 'apron:markdown-it-unused-rules',
		enforce: 'pre',
		transform(code, id) {
			if (!id.split('?')[0].endsWith('/markdown-it/dist/markdown-it.mjs')) return;
			for (const { head, option, returns } of rules) {
				const start = code.indexOf(`\nfunction ${head} {\n`);
				const end = start < 0 ? -1 : code.indexOf('\n}\n', start);
				if (end < 0 || !code.slice(start, end).includes(`if (!state.md.options.${option}) return${returns ? ` ${returns}` : ''};`)) {
					throw new Error(`apron:markdown-it-unused-rules: markdown-it's ${head} isn't as written; check what it does now`);
				}
				const stub = `if (state.md.options.${option}) throw new Error("markdown-it's ${option} rules are stubbed out (vite.config.ts): markdown.ts must keep ${option} off"); return ${returns};`;
				code = `${code.slice(0, start)}\nfunction ${head} {${stub}}${code.slice(end + 2)}`;
			}
			return { code, map: null };
		}
	};
}

/**
 * Each lucide icon (`@lucide/svelte/icons/<name>`) is a component of its own that passes its shape and its props on
 * to lucide's `Icon`, compiled once per icon. Here each is its shape handed to one shared component that does the
 * same, written once: its props, with its shape as `icon`, spread onto `Icon` as Svelte compiles each icon's
 * `<Icon {...props} icon={iconData} />` to (`spread_props`, from `svelte/internal/client`, so only in the client),
 * less the wrapper's own `rest_props`, which leaves out what `Icon`'s does too (`$$slots`, `$$events`, `$$legacy`).
 * About 5 KB of startup JS less, and a component and its props fewer for every icon drawn. The build fails if an
 * icon's file isn't the one-line wrapper it reads, as after a lucide upgrade that changed them.
 */
function lucideSharedIcon(): Plugin {
	const ICON = '\0apron-lucide-icon:';
	const SHARED = '\0apron-lucide-shared';
	return {
		name: 'apron:lucide-shared-icon',
		enforce: 'pre',
		async resolveId(source, importer, options) {
			if (source === SHARED) return SHARED;
			// The client's only: a server render (prerendering, tests in Node) calls components otherwise.
			if (options.ssr || !/^@lucide\/svelte\/icons\/[a-z0-9-]+$/.test(source)) return;
			const resolved = await this.resolve(source, importer, { skipSelf: true });
			return resolved && ICON + resolved.id;
		},
		async load(id) {
			if (id === SHARED) {
				const entry = await this.resolve('@lucide/svelte', fileURLToPath(src), { skipSelf: true });
				if (!entry) throw new Error('apron:lucide-shared-icon: @lucide/svelte not found');
				const icon = fileURLToPath(new URL('Icon.svelte', pathToFileURL(entry.id)));
				return [
					`import Icon from ${JSON.stringify(icon)};`,
					"import { spread_props } from 'svelte/internal/client';",
					'export const lucideIcon = (icon) => (anchor, props) => Icon(anchor, spread_props(props, { icon }));'
				].join('\n');
			}
			if (!id.startsWith(ICON)) return;
			const entry = id.slice(ICON.length);
			// An icon's module re-exports its component, maybe another's under an old name (`smile`).
			const component = /^export \{ default \} from "\.\/([a-z0-9-]+\.svelte)";$/m.exec(fs.readFileSync(entry, 'utf8'))?.[1];
			const source = component && fs.readFileSync(fileURLToPath(new URL(component, pathToFileURL(entry))), 'utf8');
			const data = source && /^const iconData = (\{.*\});$/m.exec(source)?.[1];
			if (!data || !/^<Icon \{\.\.\.props\} icon=\{iconData\} \/>$/m.test(source) || !/^let props = \$props\(\);$/m.test(source)) {
				throw new Error(`apron:lucide-shared-icon: ${entry} isn't the wrapper it reads; check what lucide's icons do now`);
			}
			return `import { lucideIcon } from ${JSON.stringify(SHARED)};\nexport default lucideIcon(${data});\n`;
		}
	};
}

export default defineConfig(({ command }) => {
	const preview = command === 'serve' || env.APRON_PREVIEW === '1';
	return {
		define: { __APRON_PREVIEW__: JSON.stringify(preview) },
		resolve: {
			alias: [
				// markdown-it always constructs linkify-it, which Apron never uses (`linkify: false`): see the stub.
				{ find: /^linkify-it$/, replacement: fileURLToPath(new URL('lib/protocol/linkify-off.ts', src)) },
				// markdown-it's character references and Unicode categories, from what the browser already has: see each.
				{ find: /^entities$/, replacement: fileURLToPath(new URL('lib/protocol/entities-dom.ts', src)) },
				{ find: /^uc\.micro$/, replacement: fileURLToPath(new URL('lib/protocol/uc-micro-native.ts', src)) }
			]
		},
		plugins: [
			emojiDataNativeOnly(),
			markdownItUnusedRules(),
			lucideSharedIcon(),
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
