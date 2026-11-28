import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { normalizePath, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { UPDATE_POLL_MS } from './src/lib/ui/update-poll';

// Node's fs, without Node's types (the app has none): only to sort the test files below.
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as { readdirSync(path: URL, options: { recursive: true }): string[]; readFileSync(path: URL | string, encoding: 'utf8'): string };
const src = new URL('./src/', import.meta.url);
const urlModule = 'node:url';
const { fileURLToPath, pathToFileURL } = (await import(/* @vite-ignore */ urlModule)) as { fileURLToPath(url: URL): string; pathToFileURL(path: string): URL };
const cryptoModule = 'node:crypto';
const { createHash } = (await import(/* @vite-ignore */ cryptoModule)) as { createHash(algorithm: 'sha256'): { update(data: string): { digest(encoding: 'hex'): string } } };
const moduleModule = 'node:module';
const { createRequire } = (await import(/* @vite-ignore */ moduleModule)) as { createRequire(from: string | URL): { resolve(id: string): string } };

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
 * quietly doing nothing. Each rule must read exactly as it did when checked (`sha`, of markdown-it 15.0.3's), so the
 * build fails after an upgrade that changed one: check that it still does nothing more with its option off, then
 * record its new `sha`. A stub keeps the rule's line count, so what follows it keeps its lines.
 */
function markdownItUnusedRules(): Plugin {
	const rules: Array<{ head: string; option: string; returns: string; sha: string }> = [
		{ head: 'linkify$1(state)', option: 'linkify', returns: '', sha: '225d67aff5653229' },
		{ head: 'linkify(state, silent)', option: 'linkify', returns: 'false', sha: '85002114200aa5f7' },
		{ head: 'replace(state)', option: 'typographer', returns: '', sha: '8f40c885b0a0f7a3' },
		{ head: 'smartquotes(state)', option: 'typographer', returns: '', sha: 'fe7bd280aa21d5cc' },
		{ head: 'html_block(state, startLine, endLine, silent)', option: 'html', returns: 'false', sha: '19e0f241b7a18ec0' },
		{ head: 'html_inline(state, silent)', option: 'html', returns: 'false', sha: '9326ced3bdc049d2' }
	];
	return {
		name: 'apron:markdown-it-unused-rules',
		enforce: 'pre',
		transform(code, id) {
			if (!id.split('?')[0].endsWith('/markdown-it/dist/markdown-it.mjs')) return;
			for (const { head, option, returns, sha } of rules) {
				const start = code.indexOf(`\nfunction ${head} {\n`);
				const end = start < 0 ? -1 : code.indexOf('\n}\n', start) + 2;
				const rule = code.slice(start, end);
				if (end < 2 || createHash('sha256').update(rule).digest('hex').slice(0, 16) !== sha) {
					throw new Error(`apron:markdown-it-unused-rules: markdown-it's ${head} isn't as checked; see that it does nothing with ${option} off, then record its sha`);
				}
				const stub = `if (state.md.options.${option}) throw new Error("markdown-it's ${option} rules are stubbed out (vite.config.ts): markdown.ts must keep ${option} off"); return ${returns};`;
				code = `${code.slice(0, start)}\nfunction ${head} {${stub}${'\n'.repeat(rule.split('\n').length - 2)}}${code.slice(end)}`;
			}
			return { code, map: null };
		}
	};
}

/**
 * What else of markdown-it `markdown.ts` never reaches, out of the bundle: its `zero` and `commonmark` presets (it
 * makes the default one; asking for another now fails as for an unknown name), and the methods it never calls, which
 * turn rules on and off, take plugins or work on inline text only: about 2.2 KB of startup JS. Calling one of those
 * fails (`md.use is not a function`): see here. Each part must read exactly as it did when checked (`sha`, of
 * markdown-it 15.0.3's), so the build fails after an upgrade that changed one: check that nothing else of
 * markdown-it uses it, then record its new `sha`. Each keeps its line count, so what follows it keeps its lines.
 */
function markdownItUnusedParts(): Plugin {
	// A class's method, from its head to its closing brace.
	const method = (code: string, within: string, head: string): [number, number] => {
		const start = code.indexOf(`\n\t${head} {\n`, code.indexOf(within));
		return [start, start < 0 ? -1 : code.indexOf('\n\t}\n', start) + 3];
	};
	const parts: Array<{ name: string; find: (code: string) => [number, number]; sha: string }> = [
		{ name: 'other presets', find: (code) => [code.indexOf('\n\tzero: {\n'), code.indexOf('\n};\nvar BAD_PROTO_RE')], sha: 'f69f6df047340bf9' },
		...([
			['Ruler', 'enable(list, ignoreInvalid = false)', '97aa61fc774fad46'],
			['Ruler', 'enableOnly(list, ignoreInvalid = false)', 'bdf661529fd472c5'],
			['Ruler', 'disable(list, ignoreInvalid = false)', 'ed7d4425a6dd9d54'],
			['MarkdownIt', 'enable(list, ignoreInvalid = false)', '294b1488db281022'],
			['MarkdownIt', 'disable(list, ignoreInvalid = false)', '7b133c79bae2088c'],
			['MarkdownIt', 'use(plugin, ...params)', '7a1892a01565a632'],
			['MarkdownIt', 'parseInline(src, env)', '0156c195e4363ff6'],
			['MarkdownIt', 'renderInline(src, env = {})', 'e8e4e82ca02de23c']
		] as const).map(([owner, head, sha]) => ({ name: `${owner}'s ${head}`, find: (code: string) => method(code, `var ${owner} = class {`, head), sha }))
	];
	return {
		name: 'apron:markdown-it-unused-parts',
		enforce: 'pre',
		transform(code, id) {
			if (!id.split('?')[0].endsWith('/markdown-it/dist/markdown-it.mjs')) return;
			for (const part of parts) {
				const [start, end] = part.find(code);
				const text = code.slice(start, end);
				if (start < 0 || end <= start || createHash('sha256').update(text).digest('hex').slice(0, 16) !== part.sha) {
					throw new Error(`apron:markdown-it-unused-parts: markdown-it's ${part.name} isn't as checked; see that nothing else of markdown-it uses it, then record its sha`);
				}
				code = `${code.slice(0, start)}${'\n'.repeat(text.split('\n').length - 1)}${code.slice(end)}`;
			}
			return { code, map: null };
		}
	};
}

/**
 * markdown-it's class fields as plain assignments. Its dist sets each field through oxc's `_defineProperty` helper,
 * which goes through `toPropertyKey`, `toPrimitive` and `_typeof` (two calls of it) before assigning: five calls per
 * field, eleven fields per `Token`, so about 12,000 calls to render the messages the app opens with (6% of a phone's
 * load). Every key is a string literal, and none is ever already on the object it's set on (no prototype has one), so
 * the helper always takes its `e[r] = t` branch: `obj.key = value` does the same. That holds for the file as checked
 * (`sha`, markdown-it 15.0.3's, less its last line: the source map's comment, which Vitest blanks), so the build fails
 * after an upgrade that changed it: check again that no field's key is on its object when set (wrap the helper to
 * report `r in e`), then record its new `sha`. Each call keeps its lines.
 */
function markdownItPlainFields(): Plugin {
	const sha = 'c9efb7b1fe655d9d';
	const call = /_defineProperty\(\s*(this|\w+),\s*(?:\/\*[\s\S]*?\*\/\s*)?"([\w$]+)",\s*([\s\S]*?)\s*\);(?=\n)/g;
	return {
		name: 'apron:markdown-it-plain-fields',
		enforce: 'pre',
		transform(code, id) {
			if (!id.split('?')[0].endsWith('/markdown-it/dist/markdown-it.mjs')) return;
			if (createHash('sha256').update(code.slice(0, code.lastIndexOf('\n'))).digest('hex').slice(0, 16) !== sha) {
				throw new Error("apron:markdown-it-plain-fields: markdown-it's dist isn't as checked; see that no class field's key is already on its object when set, then record its sha");
			}
			code = code.replace(call, (whole, object, key, value) => `${object}.${key} = ${value};${'\n'.repeat(whole.split('\n').length - 1)}`);
			if (code.match(/_defineProperty\(/g)?.length !== 1) throw new Error('apron:markdown-it-plain-fields: a call of _defineProperty is left');
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
	// Read from lucide's own files, not where Vite resolves it: `vite dev` resolves it to its prebundled copy.
	const dist = new URL('.', pathToFileURL(createRequire(import.meta.url).resolve('@lucide/svelte')));
	return {
		name: 'apron:lucide-shared-icon',
		enforce: 'pre',
		resolveId(source, _importer, options) {
			if (source === SHARED) return SHARED;
			// The client's only: a server render (prerendering, tests in Node) calls components otherwise.
			const name = options.ssr ? undefined : /^@lucide\/svelte\/icons\/([a-z0-9-]+)$/.exec(source)?.[1];
			return name && ICON + name;
		},
		load(id) {
			if (id === SHARED) {
				const icon = normalizePath(fileURLToPath(new URL('Icon.svelte', dist)));
				return [
					`import Icon from ${JSON.stringify(icon)};`,
					"import { spread_props } from 'svelte/internal/client';",
					'export const lucideIcon = (icon) => (anchor, props) => Icon(anchor, spread_props(props, { icon }));'
				].join('\n');
			}
			if (!id.startsWith(ICON)) return;
			const entry = new URL(`icons/${id.slice(ICON.length)}.js`, dist);
			// An icon's module re-exports its component, maybe another's under an old name (`smile`).
			const component = /^export \{ default \} from "\.\/([a-z0-9-]+\.svelte)";$/m.exec(fs.readFileSync(entry, 'utf8'))?.[1];
			const source = component && fs.readFileSync(new URL(component, entry), 'utf8');
			const data = source && /^const iconData = (\{.*\});$/m.exec(source)?.[1];
			if (!data || !/^<Icon \{\.\.\.props\} icon=\{iconData\} \/>$/m.test(source) || !/^let props = \$props\(\);$/m.test(source)) {
				throw new Error(`apron:lucide-shared-icon: ${fileURLToPath(entry)} isn't the wrapper it reads; check what lucide's icons do now`);
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
			// Before markdownItUnusedRules, which changes the file this checks.
			markdownItPlainFields(),
			markdownItUnusedRules(),
			markdownItUnusedParts(),
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
