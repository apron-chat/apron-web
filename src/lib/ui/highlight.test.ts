// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '$lib/protocol/markdown';
import { highlight, highlightCode, languageOf } from './highlight';

/**
 * Waits for the fenced languages in `source` to load (the same shared load the
 * action waits on), then for the highlighting they held up to be applied,
 * rather than for a fixed time a slow machine can overrun.
 */
async function settle(source: string): Promise<void> {
	const languages = [...source.matchAll(/```(\S+)/g)].map((match) => languageOf(match[1])).filter((language) => language !== undefined);
	await Promise.all(languages.map((language) => highlight('', language)));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A rendered body in a node, with the action applied and its languages loaded. */
async function mount(source: string): Promise<HTMLElement> {
	const node = document.createElement('div');
	node.innerHTML = renderMarkdown(source);
	document.body.append(node);
	highlightCode(node);
	await settle(source);
	return node;
}

describe('languageOf', () => {
	it('takes names and common aliases, in any case, and leaves unknown names and object keys alone', () => {
		expect(languageOf('typescript')).toBe('typescript');
		expect(languageOf('TS')).toBe('typescript');
		expect(languageOf('sh')).toBe('bash');
		expect(languageOf('html')).toBe('xml');
		expect(languageOf('c++')).toBe('cpp');
		// Unknown names, and object keys, are no language.
		expect(languageOf('brainfuck')).toBeUndefined();
		expect(languageOf('constructor')).toBeUndefined();
		expect(languageOf('__proto__')).toBeUndefined();
		expect(languageOf('')).toBeUndefined();
	});
});

describe('highlightCode', () => {
	it('highlights a fenced block with a known language, diffs too, keeping its text', async () => {
		const source = 'const answer = 42; // why';
		const node = await mount('```ts\n' + source + '\n```');
		const code = node.querySelector('pre > code')!;
		expect(code.classList.contains('hljs')).toBe(true);
		expect(code.querySelector('.hljs-keyword')?.textContent).toBe('const');
		expect(code.querySelector('.hljs-number')?.textContent).toBe('42');
		expect(code.querySelector('.hljs-comment')?.textContent).toBe('// why');
		expect(code.textContent).toBe(source + '\n');
		const diff = await mount('```diff\n-old\n+new\n```');
		expect(diff.querySelector('.hljs-deletion')?.textContent).toContain('-old');
		expect(diff.querySelector('.hljs-addition')?.textContent).toContain('+new');
	});

	it('leaves blocks without a language, with an unknown one, and inline code alone', async () => {
		const node = await mount('```\nconst a = 1\n```\n\n```brainfuck\n+++\n```\n\n`const b = 2`');
		expect(node.querySelector('.hljs, [class^="hljs-"]')).toBeNull();
	});

	it('keeps markup in code as text', async () => {
		const node = await mount('```html\n<img src=x onerror="alert(1)"><script>alert(2)</script>\n```');
		const code = node.querySelector('pre > code')!;
		expect(code.classList.contains('hljs')).toBe(true);
		expect(node.querySelector('img, script')).toBeNull();
		expect(code.textContent).toBe('<img src=x onerror="alert(1)"><script>alert(2)</script>\n');
		for (const element of code.querySelectorAll('*')) {
			expect(element.tagName).toBe('SPAN');
			expect([...element.attributes].map((attribute) => attribute.name)).toEqual(['class']);
		}
	});

	it('does not touch a block that changed while its language loaded', async () => {
		const node = document.createElement('div');
		const source = '```rust\nfn main() {}\n```';
		node.innerHTML = renderMarkdown(source);
		document.body.append(node);
		highlightCode(node);
		node.querySelector('code')!.textContent = 'replaced';
		await settle(source);
		expect(node.querySelector('code')!.innerHTML).toBe('replaced');
	});

	it('finds blocks added by an update', async () => {
		const node = document.createElement('div');
		document.body.append(node);
		const action = highlightCode(node);
		const source = '```python\ndef f(): pass\n```';
		node.innerHTML = renderMarkdown(source);
		action.update();
		await settle(source);
		expect(node.querySelector('.hljs-keyword')?.textContent).toBe('def');
	});
});

describe('highlight', () => {
	it('marks up source in the language named', async () => {
		expect(await highlight('let x = "y"', 'javascript')).toContain('<span class="hljs-string">"y"</span>');
	});
});
