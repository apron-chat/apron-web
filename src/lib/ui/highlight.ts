import DOMPurify from 'dompurify';
import type { HLJSApi, LanguageFn } from 'highlight.js';

type Loader = () => Promise<{ default: LanguageFn }>;

/**
 * The languages a fenced block can name, each its own chunk, fetched the first
 * time a block needs it. Other names stay unhighlighted.
 */
const LANGUAGES: Record<string, Loader> = {
	bash: () => import('highlight.js/lib/languages/bash'),
	c: () => import('highlight.js/lib/languages/c'),
	cpp: () => import('highlight.js/lib/languages/cpp'),
	csharp: () => import('highlight.js/lib/languages/csharp'),
	css: () => import('highlight.js/lib/languages/css'),
	diff: () => import('highlight.js/lib/languages/diff'),
	dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
	elixir: () => import('highlight.js/lib/languages/elixir'),
	go: () => import('highlight.js/lib/languages/go'),
	graphql: () => import('highlight.js/lib/languages/graphql'),
	haskell: () => import('highlight.js/lib/languages/haskell'),
	ini: () => import('highlight.js/lib/languages/ini'),
	java: () => import('highlight.js/lib/languages/java'),
	javascript: () => import('highlight.js/lib/languages/javascript'),
	json: () => import('highlight.js/lib/languages/json'),
	kotlin: () => import('highlight.js/lib/languages/kotlin'),
	lua: () => import('highlight.js/lib/languages/lua'),
	makefile: () => import('highlight.js/lib/languages/makefile'),
	markdown: () => import('highlight.js/lib/languages/markdown'),
	nix: () => import('highlight.js/lib/languages/nix'),
	php: () => import('highlight.js/lib/languages/php'),
	protobuf: () => import('highlight.js/lib/languages/protobuf'),
	python: () => import('highlight.js/lib/languages/python'),
	ruby: () => import('highlight.js/lib/languages/ruby'),
	rust: () => import('highlight.js/lib/languages/rust'),
	scss: () => import('highlight.js/lib/languages/scss'),
	shell: () => import('highlight.js/lib/languages/shell'),
	sql: () => import('highlight.js/lib/languages/sql'),
	swift: () => import('highlight.js/lib/languages/swift'),
	typescript: () => import('highlight.js/lib/languages/typescript'),
	xml: () => import('highlight.js/lib/languages/xml'),
	yaml: () => import('highlight.js/lib/languages/yaml')
};

/** Other names people put on a fence. `shell` is a prompt-and-output session; `sh` is a script. */
const ALIASES: Record<string, string> = {
	js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
	ts: 'typescript', tsx: 'typescript', mts: 'typescript',
	sh: 'bash', zsh: 'bash', console: 'shell', 'shell-session': 'shell',
	py: 'python', python3: 'python', rb: 'ruby', rs: 'rust', golang: 'go',
	h: 'c', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', 'c#': 'csharp', kt: 'kotlin',
	html: 'xml', svg: 'xml', svelte: 'xml', vue: 'xml',
	yml: 'yaml', toml: 'ini', jsonc: 'json', json5: 'json',
	md: 'markdown', patch: 'diff', docker: 'dockerfile', make: 'makefile', mk: 'makefile',
	gql: 'graphql', proto: 'protobuf', ex: 'elixir', exs: 'elixir', hs: 'haskell', postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql'
};

/** Longer blocks stay plain rather than hold up the page. */
const MAX_LENGTH = 20_000;

/** Highlighted blocks kept for reuse (reopening a room), least recently used first. */
const CACHE_SIZE = 500;
const highlighted = new Map<string, string>();

let core: Promise<HLJSApi> | undefined;
const loading = new Map<string, Promise<HLJSApi>>();

/** The name a fence's language resolves to, if it is one we highlight. */
export function languageOf(fence: string): string | undefined {
	const name = fence.toLowerCase();
	const resolved = ALIASES[name] ?? name;
	return Object.hasOwn(LANGUAGES, resolved) ? resolved : undefined;
}

function load(language: string): Promise<HLJSApi> {
	let ready = loading.get(language);
	if (!ready) {
		core ??= import('highlight.js/lib/core').then((module) => module.default);
		ready = Promise.all([core, LANGUAGES[language]()]).then(([hljs, module]) => {
			hljs.registerLanguage(language, module.default);
			return hljs;
		});
		// A failed fetch (a deploy replaced the chunk, a dropped connection) is tried again next time.
		ready.catch(() => loading.delete(language));
		loading.set(language, ready);
	}
	return ready;
}

/**
 * Code as highlighted HTML: highlight.js escapes the source and wraps tokens
 * in `<span class="hljs-…">`, and only those spans are let through.
 */
export async function highlight(source: string, language: string): Promise<string> {
	const key = `${language}\n${source}`;
	let html = highlighted.get(key);
	if (html !== undefined) {
		highlighted.delete(key);
	} else {
		const hljs = await load(language);
		html = DOMPurify.sanitize(hljs.highlight(source, { language, ignoreIllegals: true }).value, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] });
		if (highlighted.size >= CACHE_SIZE) highlighted.delete(highlighted.keys().next().value!);
	}
	highlighted.set(key, html);
	return html;
}

/**
 * A Svelte action that highlights each fenced code block with a known
 * language (`pre > code.language-…`) inside the node, once its language has
 * loaded. Pass the rendered HTML as the parameter so new blocks are found
 * when it changes. The text stays the same, so copying a block is unchanged.
 */
export function highlightCode(node: HTMLElement, _html?: string): { update: (html?: string) => void } {
	const done = new WeakSet<Element>();
	const decorate = (): void => {
		if (!DOMPurify.isSupported) return;
		for (const code of node.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
			if (done.has(code)) continue;
			done.add(code);
			const language = languageOf(code.className.match(/(?:^|\s)language-(\S+)/)?.[1] ?? '');
			const source = code.textContent ?? '';
			if (!language || source.length > MAX_LENGTH) continue;
			highlight(source, language).then(
				(html) => {
					// The block may have been replaced or changed while its language loaded.
					if (!code.isConnected || code.textContent !== source) return;
					code.innerHTML = html;
					code.classList.add('hljs');
				},
				() => done.delete(code)
			);
		}
	};
	decorate();
	return { update: () => queueMicrotask(decorate) };
}
