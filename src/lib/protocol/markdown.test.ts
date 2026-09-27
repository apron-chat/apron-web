// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderPlain, type MentionResolver } from './markdown';

const resolve: MentionResolver = (id) => {
	if (id === 'alice') return { kind: 'user', id, name: 'Alice Chen' };
	if (id === 'guest_1') return { kind: 'user', id, name: 'Sam', me: true };
	if (id === '@server') return { kind: 'user', id, name: 'Server' };
	if (id === 'ops') return { kind: 'room', id, title: 'Ops & Co' };
	return undefined;
};

describe('mentions (Appendix A.3)', () => {
	it('renders a known user_id with the latest name', () => {
		expect(renderMarkdown('Handing this to @alice.', resolve)).toBe('<p>Handing this to <span class="ap-mention" data-user-id="alice" title="@alice">@Alice Chen</span>.</p>\n');
	});

	it('marks the viewer’s own chip', () => {
		expect(renderMarkdown('@guest_1 can you look?', resolve)).toContain('class="ap-mention ap-mention-me" data-user-id="guest_1"');
	});

	it('links a room mention and escapes its title', () => {
		expect(renderMarkdown('see @ops', resolve)).toContain('<button type="button" class="ap-mention ap-mention-room" data-room-id="ops" title="Open Ops &amp; Co">Ops &amp; Co</button>');
	});

	it('takes a second @ for system identities and drops trailing dots and dashes', () => {
		expect(renderPlain('ask @@server-- now', resolve)).toBe('ask <span class="ap-mention" data-user-id="@server" title="@@server">@Server</span>-- now');
	});

	it('leaves unknown IDs, emails, and mentions inside code or links as written', () => {
		expect(renderMarkdown('@nobody and mail@alice.com', resolve)).not.toContain('ap-mention');
		expect(renderMarkdown('`@alice` stays', resolve)).not.toContain('ap-mention');
		expect(renderMarkdown('```\n@alice\n```', resolve)).not.toContain('ap-mention');
		const html = renderMarkdown('[@alice](https://example.com/@alice)', resolve);
		expect(html).toContain('<a href="https://example.com/@alice" rel="noreferrer noopener" target="_blank">');
		expect(html).not.toContain('ap-mention');
	});

	it('escapes plain bodies and renders without a resolver as before', () => {
		expect(renderPlain('<b>@alice</b>', resolve)).toBe('&lt;b&gt;<span class="ap-mention" data-user-id="alice" title="@alice">@Alice Chen</span>&lt;/b&gt;');
		expect(renderMarkdown('@alice is here')).toBe('<p>@alice is here</p>\n');
	});
});

describe('line breaks', () => {
	it('keeps a typed line break inside a paragraph, and paragraphs apart', () => {
		expect(renderMarkdown('Deploy plan\nWe cut at 14:00')).toBe('<p>Deploy plan<br>\nWe cut at 14:00</p>\n');
		expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>\n');
		expect(renderMarkdown('```\na\nb\n```')).toBe('<pre><code>a\nb\n</code></pre>\n');
	});
});

describe('rendering the same source again', () => {
	it('links mentions with the current names', () => {
		const source = 'Handing **this** to @alice.';
		expect(renderMarkdown(source, resolve)).toContain('@Alice Chen');
		expect(renderMarkdown(source, (id) => (id === 'alice' ? { kind: 'user', id, name: 'Alice Park' } : undefined))).toContain('@Alice Park');
		expect(renderMarkdown(source)).toBe('<p>Handing <strong>this</strong> to @alice.</p>\n');
	});
});

describe('bare links', () => {
	const link = (url: string) => `<a href="${url}" rel="noreferrer noopener" target="_blank">${url}</a>`;

	it('links http and https URLs in markdown and plain bodies', () => {
		expect(renderMarkdown('see https://example.com/a?b=1&c=2 now')).toBe(`<p>see ${link('https://example.com/a?b=1&amp;c=2')} now</p>\n`);
		expect(renderPlain('go to http://example.com')).toBe(`go to ${link('http://example.com')}`);
	});

	it('leaves trailing punctuation and an unmatched closing paren out', () => {
		expect(renderPlain('(see https://example.com/x).')).toBe(`(see ${link('https://example.com/x')}).`);
		expect(renderPlain('https://en.wikipedia.org/wiki/Foo_(bar), ok')).toBe(`${link('https://en.wikipedia.org/wiki/Foo_(bar)')}, ok`);
		expect(renderPlain('"https://example.com"')).toBe(`"${link('https://example.com')}"`);
	});

	it('stops at markup and escapes what it links', () => {
		expect(renderPlain('<https://example.com/"x>')).toBe(`&lt;${link('https://example.com/')}"x&gt;`);
		expect(renderMarkdown('**https://example.com**')).toBe(`<p><strong>${link('https://example.com')}</strong></p>\n`);
	});

	it('leaves links, code, other schemes and bare schemes alone', () => {
		expect(renderMarkdown('[docs](https://example.com)')).toBe('<p><a href="https://example.com" rel="noreferrer noopener" target="_blank">docs</a></p>\n');
		expect(renderMarkdown('`https://example.com`')).toBe('<p><code>https://example.com</code></p>\n');
		expect(renderMarkdown('```\nhttps://example.com\n```')).not.toContain('<a ');
		expect(renderPlain('javascript:alert(1) ftp://example.com https://')).not.toContain('<a ');
	});

	it('opens markdown links and autolinks in a new tab too', () => {
		expect(renderMarkdown('[docs](https://example.com "Docs")')).toBe('<p><a href="https://example.com" title="Docs" rel="noreferrer noopener" target="_blank">docs</a></p>\n');
		expect(renderMarkdown('<https://example.com>')).toBe(`<p>${link('https://example.com')}</p>\n`);
	});

	it('does not turn an @ inside a URL into a mention', () => {
		const html = renderPlain('@alice https://example.com/@alice', resolve);
		expect(html).toContain(link('https://example.com/@alice'));
		expect(html.match(/ap-mention/g)).toHaveLength(1);
	});
});

describe('tables', () => {
	it('renders a GFM table with alignment, inline markdown, and short rows padded', () => {
		expect(renderMarkdown('| Name | Count |\n| :-- | --: |\n| **a** | 1 |\n| b |')).toBe(
			'<div class="ap-table"><table>\n<thead>\n<tr>\n<th class="ap-align-left">Name</th>\n<th class="ap-align-right">Count</th>\n</tr>\n</thead>\n' +
				'<tbody>\n<tr>\n<td class="ap-align-left"><strong>a</strong></td>\n<td class="ap-align-right">1</td>\n</tr>\n' +
				'<tr>\n<td class="ap-align-left">b</td>\n<td class="ap-align-right"></td>\n</tr>\n</tbody>\n</table></div>\n'
		);
	});

	it('keeps the lines before the header as a paragraph and needs no outer pipes', () => {
		const html = renderMarkdown('Results\na | b\n--|--\n1 | 2');
		expect(html).toMatch(/^<p>Results<\/p>\n<div class="ap-table"><table>/);
		expect(html).toContain('<th>a</th>\n<th>b</th>');
		expect(html).toContain('<td>1</td>\n<td>2</td>');
	});

	it('omits the body of a header-only table and drops extra cells', () => {
		expect(renderMarkdown('| a |\n| - |')).not.toContain('<tbody>');
		expect(renderMarkdown('| a |\n| - |\n| 1 | 2 |')).toContain('<td>1</td>\n</tr>');
	});

	it('takes an escaped pipe as a literal, in code too, and links mentions in cells', () => {
		const html = renderMarkdown('| cmd | who |\n|---|---|\n| `a \\| b` | @alice |', resolve);
		expect(html).toContain('<td><code>a | b</code></td>');
		expect(html).toContain('data-user-id="alice"');
	});

	it('renders tables inside quotes and list items', () => {
		expect(renderMarkdown('> | a |\n> |---|')).toMatch(/^<blockquote>\n<div class="ap-table"><table>/);
		expect(renderMarkdown('- item\n\n  | a |\n  |---|')).toContain('<li>\n<p>item</p>\n<div class="ap-table">');
	});

	it('stays safe inside cells', () => {
		const html = renderMarkdown('| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | [x](javascript:alert(1)) |');
		expect(html).toContain('<td>&lt;img src=x onerror=alert(1)&gt;</td>');
		expect(html).not.toContain('<a');
	});

	it('leaves pipes that are not a table as text', () => {
		expect(renderMarkdown('a | b')).toBe('<p>a | b</p>\n');
		expect(renderMarkdown('| a | b |\n| --- |')).toBe('<p>| a | b |<br>\n| --- |</p>\n');
		expect(renderMarkdown('```\n| a |\n|---|\n```')).toBe('<pre><code>| a |\n|---|\n</code></pre>\n');
	});
});

describe('arbitrary HTML', () => {
	/** Every element the browser would build from the HTML. */
	const elements = (html: string) => {
		const template = document.createElement('template');
		template.innerHTML = html;
		return template.content.querySelectorAll('*');
	};
	/** Handlers, styles and non-http(s) links, as `tag attr=value`. */
	const unsafe = (html: string) =>
		[...elements(html)].flatMap((element) =>
			[...element.attributes]
				.filter(({ name, value }) => /^on|^style$/i.test(name) || (/^(href|src)$/i.test(name) && !/^https?:\/\//i.test(value)))
				.map(({ name, value }) => `${element.tagName} ${name}=${value}`)
		);

	const vectors = [
		'<script>alert(1)</script>',
		'<img src=x onerror=alert(1)>',
		'<div onclick="alert(1)">x</div>',
		'<iframe src="https://example.com"></iframe>',
		'<style>body{display:none}</style>',
		'<a href="javascript:alert(1)">x</a>',
		'hi <b onmouseover=alert(1)>there</b>',
		'<!-- comment --><svg onload=alert(1)>',
		'<details open ontoggle=alert(1)>',
		'> <script>alert(1)</script>',
		'- <img src=x onerror=alert(1)>',
		'# <span style="color:red">x</span>',
		'**<u>x</u>**'
	];

	it.each(vectors)('shows %s as text', (source) => {
		const html = renderMarkdown(source);
		expect(html).toContain('&lt;');
		const tags = [...elements(html)].map((element) => element.tagName.toLowerCase());
		expect(tags.every((tag) => ['p', 'br', 'strong', 'blockquote', 'ul', 'li', 'h1', 'a'].includes(tag))).toBe(true);
		expect(unsafe(html)).toEqual([]);
	});

	it('does not link unsafe schemes', () => {
		for (const source of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](vbscript:msgbox(1))', '[x](data:text/html;base64,PHNjcmlwdD4=)', '<javascript:alert(1)>', '![x](javascript:alert(1))']) {
			const html = renderMarkdown(source);
			expect(html, source).not.toMatch(/<a |<img /);
		}
		expect(renderMarkdown('[x](&#106;avascript:alert(1))')).not.toContain('<a ');
	});

	it('escapes attributes it does write', () => {
		expect(renderMarkdown('[x](https://example.com/"onmouseover="alert(1) "t\\"itle")')).not.toMatch(/"\s*onmouseover=/);
		expect(renderMarkdown('```js" onclick="alert(1)\nx\n```')).toBe('<pre><code class="language-js&quot;">x\n</code></pre>\n');
	});

	it('keeps linking bare URLs and mentions from breaking out of attributes', () => {
		for (const source of [
			'https://example.com/"onmouseover="alert(1)',
			'<a href="https://example.com/x"onmouseover="alert(1)">',
			'[x](https://example.com "t> https://example.com/y/onmouseover=alert(1)//")',
			'[x](https://example.com "@alice onmouseover=alert(1)")'
		]) {
			expect(unsafe(renderMarkdown(source, resolve)), source).toEqual([]);
			expect(unsafe(renderPlain(source, resolve)), source).toEqual([]);
		}
	});

	it('keeps inline styles and handlers out of rendered markup', () => {
		const html = renderMarkdown('| a |\n|:-:|\n| b |');
		expect(html).not.toContain('style=');
		expect(html).toContain('class="ap-align-center"');
	});
});
