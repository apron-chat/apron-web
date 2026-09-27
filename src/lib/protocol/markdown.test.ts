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
		expect(renderMarkdown('Deploy plan\nWe cut at 14:00')).toBe('<p>Deploy plan<br />We cut at 14:00</p>\n');
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
		expect(renderPlain('"https://example.com"')).toBe(`&quot;${link('https://example.com')}&quot;`);
	});

	it('stops at markup and escapes what it links', () => {
		expect(renderPlain('<https://example.com/"x>')).toBe(`&lt;${link('https://example.com/')}&quot;x&gt;`);
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
