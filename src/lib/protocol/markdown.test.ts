// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markdownText, renderBio, renderMarkdown, renderPlain, type LinkResolver, type MentionResolver, mentionSegments } from './markdown';

const resolve: MentionResolver = (id) => {
	if (id === 'alice') return { kind: 'user', id, name: 'Alice Chen' };
	if (id === 'guest_1') return { kind: 'user', id, name: 'Sam', me: true };
	if (id === 'ops') return { kind: 'room', id, title: 'Ops & Co' };
	return undefined;
};

describe('bidi embeddings and overrides (§3.5.2)', () => {
	it('are dropped from text as it renders, in every form, the text itself left as written', () => {
		const text = 'evil\u202Egnp.exe \u202A**bold**\u202C';
		expect(renderMarkdown(text)).toBe('<p>evilgnp.exe <strong>bold</strong></p>\n');
		expect(renderPlain(text)).toBe('evilgnp.exe **bold**');
		expect(renderBio('bio\u202Etxt')).toBe('biotxt');
		expect(markdownText('a\u202Db')).toBe('ab');
		expect(mentionSegments('hi\u202E @alice', resolve)).toEqual(['hi ', { target: { kind: 'user', id: 'alice', name: 'Alice Chen' }, hash: false }]);
		expect(text).toContain('\u202E');
	});
});

describe('mentions (Appendix A.3)', () => {
	it('renders a known user_id with the latest name, marking the viewer’s own chip', () => {
		expect(renderMarkdown('Handing this to @alice.', resolve)).toBe('<p>Handing this to <button type="button" class="ap-mention" data-user-id="alice" title="@alice">@Alice Chen</button>.</p>\n');
		// The viewer's own chip is marked.
		expect(renderMarkdown('@guest_1 can you look?', resolve)).toContain('class="ap-mention ap-mention-me" data-user-id="guest_1"');
	});

	it('reads @ as a user only, so a room ID after @ stays text (Appendix A.3)', () => {
		expect(renderMarkdown('see @ops', resolve)).toBe('<p>see @ops</p>\n');
	});

	it('links #room IDs with a hash label, but leaves unknown or embedded hashtags alone', () => {
		expect(renderMarkdown('see #ops.', resolve)).toContain('<button type="button" class="ap-mention ap-mention-room ap-mention-hash-room" data-room-id="ops" title="Open Ops &amp; Co">#Ops &amp; Co</button>.');
		expect(renderPlain('#nobody tag#ops', resolve)).toBe('#nobody tag#ops');
		expect(renderMarkdown('`#ops`', resolve)).toBe('<p><code>#ops</code></p>\n');	});

	it('links a thread by its all-digit ID, naming an untitled one’s ID on hover, and leaves numbers that name no room as text', () => {
		const threads = (id: string) => (id === '1790473611343' ? { kind: 'room' as const, id, title: 'Deploy checklist' } : undefined);
		expect(renderPlain('see #1790473611343, not #1.', undefined, threads)).toBe(
			'see <button type="button" class="ap-mention ap-mention-room ap-mention-hash-room" data-room-id="1790473611343" title="Open Deploy checklist">#Deploy checklist</button>, not #1.'
		);
		// An untitled thread's ID is named on its chip's hover.
		const untitled = (id: string) => (id === '1790473611343' ? { kind: 'room' as const, id, title: 'Untitled', untitled: true as const } : undefined);
		expect(renderPlain('see #1790473611343', undefined, untitled)).toBe(
			'see <button type="button" class="ap-mention ap-mention-room ap-mention-hash-room" data-room-id="1790473611343" title="Open Untitled (#1790473611343)">#Untitled</button>'
		);
	});

	it('resolves #room_id as a room even when @id resolves to a user', () => {
		const userResolver: MentionResolver = (id) => id === 'ops' ? { kind: 'user', id, name: 'Ops User' } : undefined;
		const roomResolver = (id: string) => id === 'ops' ? { kind: 'room' as const, id, title: 'Ops Room' } : undefined;
		const html = renderMarkdown('#ops @ops', userResolver, roomResolver);
		expect(html).toContain('data-room-id="ops" title="Open Ops Room">#Ops Room</button>');
		expect(html).toContain('data-user-id="ops" title="@ops">@Ops User</button>');
	});

	it('splits text around known mentions, for reply snippets', () => {
		const roomResolver = (id: string) => (id === 'ops' ? { kind: 'room' as const, id, title: 'Ops Room' } : undefined);
		expect(mentionSegments('ask @alice in #ops, not #nope.', resolve, roomResolver)).toEqual([
			'ask ',
			{ target: { kind: 'user', id: 'alice', name: 'Alice Chen' }, hash: false },
			' in ',
			{ target: { kind: 'room', id: 'ops', title: 'Ops Room' }, hash: true },
			', not #nope.'
		]);
	});

	it('ends an ID at its last letter, digit or _, and never reads a system identity as a mention', () => {
		expect(renderPlain('ask @alice-- now', resolve)).toBe('ask <button type="button" class="ap-mention" data-user-id="alice" title="@alice">@Alice Chen</button>-- now');
		expect(renderPlain('@alice: @alice+ @alice@', resolve).match(/data-user-id="alice"/g)).toHaveLength(3);
		const any: MentionResolver = (id) => ({ kind: 'user', id, name: id });
		expect(renderPlain('ask ~server or @~server', any)).toBe('ask ~server or @~server');
	});

	it('reads email and federated forms as one ID: the longest run of ID characters', () => {
		const ids: string[] = [];
		const any: MentionResolver = (id) => (ids.push(id), { kind: 'user', id, name: id });
		renderPlain('@ada@example.com. @carol:b.example, @ada+chat@example.com @_x_ @.dot @@bob', any);
		expect(ids).toEqual(['ada@example.com', 'carol:b.example', 'ada+chat@example.com', '_x_', 'bob']);
		// Only the whole ID resolves: a known prefix of it is not a mention.
		expect(renderPlain('@alice@example.com and @alice:b.example', resolve)).toBe('@alice@example.com and @alice:b.example');
		expect(mentionSegments('#ops:b.example #ops', resolve, (id) => (id === 'ops' ? { kind: 'room', id, title: 'Ops' } : undefined))).toEqual([
			'#ops:b.example ',
			{ target: { kind: 'room', id: 'ops', title: 'Ops' }, hash: true }
		]);
	});

	it('leaves unknown IDs, emails, mentions inside code or links, and every mention without a resolver, as written', () => {
		expect(renderMarkdown('@nobody and mail@alice.com', resolve)).not.toContain('ap-mention');
		expect(renderMarkdown('`@alice` stays', resolve)).not.toContain('ap-mention');
		expect(renderMarkdown('```\n@alice\n```', resolve)).not.toContain('ap-mention');
		const html = renderMarkdown('[@alice](https://example.com/@alice)', resolve);
		expect(html).toContain('<a href="https://example.com/@alice" rel="noreferrer noopener" target="_blank">');
		expect(html).not.toContain('ap-mention');
		// A plain body is escaped around its mentions, and without a resolver there are none.
		expect(renderPlain('<b>@alice</b>', resolve)).toBe('&lt;b&gt;<button type="button" class="ap-mention" data-user-id="alice" title="@alice">@Alice Chen</button>&lt;/b&gt;');
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

	it('links Apron links in their apron: form too, bare or in markdown (Appendix A.4)', () => {
		expect(renderPlain('see apron:?room=ops&message=1 now')).toBe(`see ${link('apron:?room=ops&amp;message=1')} now`);
		expect(renderPlain('APRON:?room=ops.')).toBe(`${link('APRON:?room=ops')}.`);
		// No other form: not web+apron:, nor apron: inside another word or scheme.
		for (const text of ['web+apron:?room=ops.', 'xapron:?room=ops', 'my_apron:?room=ops', 'x-apron:?room=ops', 'a.apron:?room=ops']) expect(renderPlain(text), text).toBe(text);
		expect(renderMarkdown('[ops](apron:?room=ops)')).toContain('<a href="apron:?room=ops"');
		// A bare scheme with no keys isn't a link, and other schemes stay unlinked.
		expect(renderPlain('apron: is a scheme')).toBe('apron: is a scheme');
		expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href');
	});

	it('draws an Apron link written as its URL as the chip a resolver gives, still the link, and leaves one with its own text or in code', () => {
		const resolveLink: LinkResolver = (href) => {
			if (href === 'apron:?room=ops&message=1') return { kind: 'message', href, label: 'Message', detail: ' in #Ops & Co', title: 'A message in #Ops & Co' };
			if (href === 'apron:?server=wss://h/&room=ops') return { kind: 'room', elsewhere: true, href, label: 'h', detail: ' · Room', title: 'A room on h' };
			if (href.startsWith('https://link.apron.chat/#room=g')) return { kind: 'room', href, label: decodeURI(href).slice(-7), title: 'Open' };
			if (href === 'apron:?room=ops&user=alice') return { kind: 'user', href: 'apron:?server=wss://h/&room=ops&user=alice', label: '@Alice', title: 'Alice in #Ops & Co' };
			return undefined;
		};
		const chip = '<a href="apron:?room=ops&amp;message=1" rel="noreferrer noopener" target="_blank" class="ap-mention ap-mention-room ap-linkchip ap-linkchip-message" title="A message in #Ops &amp; Co">Message<span class="ap-linkchip-detail"> in #Ops &amp; Co</span></a>';
		expect(renderPlain('see apron:?room=ops&message=1.', undefined, undefined, resolveLink)).toBe(`see ${chip}.`);
		expect(renderMarkdown('see <apron:?room=ops&message=1>', undefined, undefined, resolveLink)).toBe(`<p>see ${chip}</p>\n`);
		// The link under it is the one the resolver gives, where it gives one.
		expect(renderMarkdown('apron:?room=ops&user=alice', undefined, undefined, resolveLink))
			.toContain('<a href="apron:?server=wss://h/&amp;room=ops&amp;user=alice" rel="noreferrer noopener" target="_blank" class="ap-mention ap-linkchip" title="Alice in #Ops &amp; Co">@Alice</a>');
		// Another server's is no mention.
		expect(renderPlain('apron:?server=wss://h/&room=ops', undefined, undefined, resolveLink)).toContain('class="ap-linkchip ap-linkchip-elsewhere" title="A room on h">h<span class="ap-linkchip-detail"> · Room</span></a>');
		// Its own text stays, as does code, and a link the resolver leaves.
		expect(renderMarkdown('[that one](apron:?room=ops&message=1)', undefined, undefined, resolveLink)).toContain('>that one</a>');
		expect(renderMarkdown('`apron:?room=ops&message=1`', undefined, undefined, resolveLink)).not.toContain('<a');
		expect(renderPlain('apron:?room=other', undefined, undefined, resolveLink)).toBe(link('apron:?room=other'));
		// An autolink whose href Markdown percent-encodes, but not its text, is still its own URL.
		expect(renderMarkdown('<https://link.apron.chat/#room=général>', undefined, undefined, resolveLink)).toContain('class="ap-mention ap-mention-room ap-linkchip ap-linkchip-room" title="Open">général</a>');
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

describe('bios (ext:bio)', () => {
	/** The rendered bio, parsed: what a browser would build from it. */
	const parse = (source: string) => {
		const box = document.createElement('div');
		box.innerHTML = renderBio(source);
		return box;
	};

	it('links bare http(s) URLs to open in a new tab, without a referrer', () => {
		const box = parse('Ada.\nhttps://example.com/me and http://old.example.');
		const links = [...box.querySelectorAll('a')];
		expect(links.map((a) => [a.getAttribute('href'), a.textContent, a.target, a.rel])).toEqual([
			['https://example.com/me', 'https://example.com/me', '_blank', 'noreferrer noopener'],
			['http://old.example', 'http://old.example', '_blank', 'noreferrer noopener']
		]);
		expect(box.textContent).toBe('Ada.\nhttps://example.com/me and http://old.example.');
	});

	it('leaves everything else text: markup, other schemes, Apron links and mentions', () => {
		const source = '<img src=x onerror=alert(1)> <a href="https://evil.example">ok</a> [x](https://evil.example) javascript:alert(1) data:text/html,hi apron:?room=ops web+apron:?room=ops www.example.com @ada #general';
		const box = parse(source);
		expect(box.querySelectorAll('img, button, script, b').length).toBe(0);
		// Only the bare https URLs inside the markup are linked, each showing the address it opens.
		expect([...box.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
			['https://evil.example', 'https://evil.example'],
			['https://evil.example', 'https://evil.example']
		]);
		expect(box.textContent).toBe(source);
	});

	it('links only the URL in a quoted or bracketed one', () => {
		const box = parse('("https://example.com/a?b=1&c=2") <https://example.com/x>');
		expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a?b=1&c=2', 'https://example.com/x']);
	});
});

describe('tables', () => {
	it('renders a GFM table with alignment, inline markdown, short rows padded and extra cells dropped', () => {
		expect(renderMarkdown('| Name | Count |\n| :-- | --: |\n| **a** | 1 |\n| b |')).toBe(
			'<div class="ap-table"><table>\n<thead>\n<tr>\n<th class="ap-align-left">Name</th>\n<th class="ap-align-right">Count</th>\n</tr>\n</thead>\n' +
				'<tbody>\n<tr>\n<td class="ap-align-left"><strong>a</strong></td>\n<td class="ap-align-right">1</td>\n</tr>\n' +
				'<tr>\n<td class="ap-align-left">b</td>\n<td class="ap-align-right"></td>\n</tr>\n</tbody>\n</table></div>\n'
		);
		// Extra cells are dropped, and a header-only table has no body.
		expect(renderMarkdown('| a |\n| - |')).not.toContain('<tbody>');
		expect(renderMarkdown('| a |\n| - |\n| 1 | 2 |')).toContain('<td>1</td>\n</tr>');
	});

	it('keeps the lines before the header as a paragraph, needs no outer pipes, and finds tables inside quotes and list items', () => {
		const html = renderMarkdown('Results\na | b\n--|--\n1 | 2');
		expect(html).toMatch(/^<p>Results<\/p>\n<div class="ap-table"><table>/);
		expect(html).toContain('<th>a</th>\n<th>b</th>');
		expect(html).toContain('<td>1</td>\n<td>2</td>');
		// Inside quotes and list items too.
		expect(renderMarkdown('> | a |\n> |---|')).toMatch(/^<blockquote>\n<div class="ap-table"><table>/);
		expect(renderMarkdown('- item\n\n  | a |\n  |---|')).toContain('<li>\n<p>item</p>\n<div class="ap-table">');
	});

	it('takes an escaped pipe as a literal, in code too, and links mentions in cells', () => {
		const html = renderMarkdown('| cmd | who |\n|---|---|\n| `a \\| b` | @alice |', resolve);
		expect(html).toContain('<td><code>a | b</code></td>');
		expect(html).toContain('data-user-id="alice"');
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

	it('shows raw HTML as text, in a paragraph, a quote, a list, a heading or bold', () => {
		for (const source of vectors) {
			const html = renderMarkdown(source);
			expect(html, source).toContain('&lt;');
			const tags = [...elements(html)].map((element) => element.tagName.toLowerCase());
			expect(tags.filter((tag) => !['p', 'br', 'strong', 'blockquote', 'ul', 'li', 'h1', 'a'].includes(tag)), source).toEqual([]);
			expect(unsafe(html), source).toEqual([]);
		}
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

describe('emoji', () => {
	const emoji = (text: string) => `<span class="ap-emoji">${text}</span>`;

	it('wraps emoji in plain and markdown bodies, whole sequences at a time', () => {
		expect(renderPlain('ok 👍🏽 go')).toBe(`ok ${emoji('👍🏽')} go`);
		expect(renderMarkdown('**yes** ❤️')).toBe(`<p><strong>yes</strong> ${emoji('❤️')}</p>\n`);
		expect(renderPlain('👩‍👩‍👧 🇨🇦 1️⃣ 🏴󠁧󠁢󠁳󠁣󠁴󠁿')).toBe([emoji('👩‍👩‍👧'), emoji('🇨🇦'), emoji('1️⃣'), emoji('🏴󠁧󠁢󠁳󠁣󠁴󠁿')].join(' '));
		expect(renderPlain('🎉🎉')).toBe(emoji('🎉') + emoji('🎉'));
	});

	it('leaves text-default symbols, code and links alone', () => {
		expect(renderPlain('© ❤ ™ 1 #')).toBe('© ❤ ™ 1 #');
		expect(renderMarkdown('`🎉` [🎉](https://example.com)')).not.toContain('ap-emoji');
	});

	it('keeps mentions working beside emoji', () => {
		expect(renderPlain('🎉@alice', resolve)).toBe(`${emoji('🎉')}<button type="button" class="ap-mention" data-user-id="alice" title="@alice">@Alice Chen</button>`);
	});
});

describe('custom emoji in text (ext:emoji)', () => {
	const images: Record<string, { src: string; alt: string; width?: number; height?: number }> = {
		':partyparrot:': { src: 'https://chat.example/e/parrot.gif', alt: ':partyparrot:' },
		':shipit:': { src: 'https://chat.example/e/shipit.png', alt: 'Squirrel in a hat', width: 64, height: 32 },
		':a:': { src: 'https://chat.example/e/a.png', alt: ':a:' },
		':b:': { src: 'https://chat.example/e/b.png', alt: ':b:' }
	};
	const emoji = (key: string) => images[key];
	const img = (key: string) => {
		const { src, alt, width, height } = images[key];
		return `<img class="ap-cemoji" src="${src}" alt="${alt}" title="${alt}" style="aspect-ratio: ${width && height ? `${width} / ${height}` : '1 / 1'}">`;
	};

	it('renders a key the catalog has as its image, with its alt as hover text and its aspect ratio, square without one', () => {
		expect(renderMarkdown('Shipped :partyparrot:', undefined, undefined, undefined, emoji)).toBe(`<p>Shipped ${img(':partyparrot:')}</p>\n`);
		expect(renderMarkdown(':shipit:', undefined, undefined, undefined, emoji)).toBe(`<p>${img(':shipit:')}</p>\n`);
		expect(renderPlain('plain :shipit:', undefined, undefined, undefined, emoji)).toBe(`plain ${img(':shipit:')}`);
	});

	it('scans left to right: adjacent keys, a time before a key, unknown keys as text', () => {
		expect(renderPlain(':a::b:', undefined, undefined, undefined, emoji)).toBe(img(':a:') + img(':b:'));
		expect(renderPlain('12:30:partyparrot:', undefined, undefined, undefined, emoji)).toBe(`12:30${img(':partyparrot:')}`);
		expect(renderPlain(':nope: :a: :Partyparrot:', undefined, undefined, undefined, emoji)).toBe(`:nope: ${img(':a:')} :Partyparrot:`);
		expect(renderPlain(':a:b:', undefined, undefined, undefined, emoji)).toBe(`${img(':a:')}b:`);
	});

	it('leaves keys in code spans and code blocks as text, and doesn\'t look without a catalog', () => {
		expect(renderMarkdown('`:a:` and\n\n```\n:b:\n```', undefined, undefined, undefined, emoji)).toBe('<p><code>:a:</code> and</p>\n<pre><code>:b:\n</code></pre>\n');
		expect(renderMarkdown('Shipped :partyparrot:')).toBe('<p>Shipped :partyparrot:</p>\n');
	});

	it('keeps a mention that runs into a key a mention, and the key after a space an image', () => {
		const people: MentionResolver = (id) => (id === 'ada' ? { kind: 'user', id, name: 'Ada' } : undefined);
		expect(renderPlain('@ada :a:', people, undefined, undefined, emoji)).toBe(`<button type="button" class="ap-mention" data-user-id="ada" title="@ada">@Ada</button> ${img(':a:')}`);
	});

	it('lets no other style through the sanitizer', () => {
		const sneaky = (key: string) => (key === ':a:' ? { src: 'https://chat.example/a.png', alt: 'x" onerror="alert(1)' } : undefined);
		const html = renderMarkdown(':a:', undefined, undefined, undefined, sneaky);
		expect(html).not.toContain(' onerror="');
		expect(html).toContain('style="aspect-ratio: 1 / 1"');
		// Raw HTML stays text; an image of another class, or another style, keeps no style.
		expect(renderMarkdown('<img class="ap-cemoji" style="color: red">')).not.toContain('<img');
		const odd = (key: string) => (key === ':a:' ? { src: 'https://chat.example/a.png', alt: 'a', width: 1, height: Number.NaN } : undefined);
		expect(renderMarkdown(':a:', undefined, undefined, undefined, odd)).toContain('style="aspect-ratio: 1 / 1"');
	});
});
