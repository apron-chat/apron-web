// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '$lib/protocol/markdown';
import { settleMarkdown } from './live-markdown';

/** The text as it would show mid-stream, as markup. */
const shown = (text: string) => renderMarkdown(settleMarkdown(text));

describe('Markdown still arriving (an append embed, §4.8.5)', () => {
	it('leaves whole Markdown as it is', () => {
		for (const text of ['Here is **the plan**.', '1. one\n2. two\n', '```sh\nls\n```\n\nDone.', 'a `b` c', '| a | b |\n| - | - |\n| 1 | 2 |', '']) {
			expect(settleMarkdown(text)).toBe(text);
		}
	});

	it('closes an open code fence with its own kind and length, and touches nothing inside it', () => {
		expect(settleMarkdown('Run:\n\n```sh\nls **')).toBe('Run:\n\n```sh\nls **\n```');
		expect(settleMarkdown('~~~~\ncode')).toBe('~~~~\ncode\n~~~~');
		// A shorter run, or one of the other character, doesn't close it.
		expect(settleMarkdown('````\n```\nx')).toBe('````\n```\nx\n````');
		expect(shown('Run:\n\n```sh\nls -la\n')).toContain('<pre><code class="language-sh">ls -la\n</code></pre>');
		// ``` followed by text with a backtick is a code span, not a fence.
		expect(settleMarkdown('``` a ` b')).not.toContain('\n```');
	});

	it('closes an open code span, and holds back one with nothing in it yet', () => {
		expect(settleMarkdown('Use `./migrate do')).toBe('Use `./migrate do`');
		expect(settleMarkdown('Use ``a ` b')).toBe('Use ``a ` b``');
		expect(settleMarkdown('Use `')).toBe('Use ');
		expect(shown('Use `./migrate do')).toContain('<code>./migrate do</code>');
	});

	it('closes an odd ** or ~~ after the text so far, the last opened first, and holds back one with nothing after it', () => {
		expect(settleMarkdown('Roll **back the')).toBe('Roll **back the**');
		expect(settleMarkdown('a ~~b **c')).toBe('a ~~b **c**~~');
		expect(settleMarkdown('a **b ~~c')).toBe('a **b ~~c~~**');
		expect(settleMarkdown('Roll **')).toBe('Roll ');
		expect(settleMarkdown('**done** and **')).toBe('**done** and ');
		expect(shown('Roll **back the')).toContain('<strong>back the</strong>');
		// Inside a code span, or escaped, they are not delimiters.
		expect(settleMarkdown('`a ** b` c')).toBe('`a ** b` c');
		expect(settleMarkdown('2 \\** 3')).toBe('2 \\** 3');
	});

	it('looks only at the last paragraph, so an odd ** that ended earlier stays as written', () => {
		expect(settleMarkdown('a ** b\n\nc')).toBe('a ** b\n\nc');
	});

	it('shows a link whose destination is still arriving as its label, an image as nothing, and an unclosed [ as its text', () => {
		expect(settleMarkdown('See [the docs](https://exa')).toBe('See the docs');
		expect(settleMarkdown('See ![chart](https://exa')).toBe('See ');
		expect(settleMarkdown('See [the do')).toBe('See the do');
		expect(shown('See [the docs](https://exa')).not.toContain('](');
		expect(settleMarkdown('See [the docs](https://example.com) now')).toBe('See [the docs](https://example.com) now');
	});

	it('holds back a last line that is only a list marker, or a - or = that would make the line above a heading for now', () => {
		expect(settleMarkdown('Steps:\n-')).toBe('Steps:');
		expect(settleMarkdown('Steps:\n2.')).toBe('Steps:');
		expect(settleMarkdown('Title\n==')).toBe('Title');
		expect(shown('The plan\n-')).not.toContain('<h2');
		// Once more arrives, it is what it is.
		expect(settleMarkdown('Steps:\n- one')).toBe('Steps:\n- one');
	});

	it('keeps the rest of the layout whatever is cut off: everything before the cut renders the same', () => {
		const whole = 'Intro\n\n1. **Roll back** `0042`\n2. Renew [the cert](https://ci.example/cert)\n\n```sh\n./migrate down 0042\n```\n\nThat should do it.';
		const intro = renderMarkdown('Intro\n\n1. **Roll back** `0042`');
		for (let cut = 30; cut < whole.length; cut++) {
			const html = shown(whole.slice(0, cut));
			// The list's first item is drawn the same whatever comes after it.
			expect(html.startsWith(intro.slice(0, intro.indexOf('</li>')))).toBe(true);
		}
	});
});
