import { describe, expect, it } from 'vitest';
import { linkHost, lookalike, shownHost, unicodeHost } from './link-host';

describe('a link whose text says where it goes', () => {
	it('gets no tag when its text is its own URL or that URL\'s site', () => {
		expect(linkHost('https://example.com/a', 'https://example.com/a')).toBeUndefined();
		expect(linkHost('https://shazow.net/', 'shazow.net')).toBeUndefined();
		expect(linkHost('https://www.shazow.net/x', 'shazow.net')).toBeUndefined();
		expect(linkHost('https://münchen.de/', 'https://münchen.de/')).toBeUndefined();
	});

	it('gets none when it is no web link', () => {
		expect(linkHost('mailto:a@example.com', 'mail me')).toBeUndefined();
		expect(linkHost('apron:?room=ops', 'ops')).toBeUndefined();
		expect(linkHost('#install', 'Install')).toBeUndefined();
	});
});

describe('a link with words of its own', () => {
	it('shows its site, quietly', () => {
		expect(linkHost('https://shazow.net', 'my website')).toEqual({ host: 'shazow.net', warn: false });
		expect(linkHost('https://www.example.com/docs', '')).toEqual({ host: 'example.com', warn: false });
		expect(linkHost('https://github.com/x/y/blob/main/notes.md', 'notes.md')).toEqual({ host: 'github.com', warn: false });
	});

	it('warns where its text names another site', () => {
		expect(linkHost('https://evil.example/watch', 'youtube.com')).toEqual({ host: 'evil.example', warn: true });
		expect(linkHost('https://evil.example/watch', 'https://www.youtube.com/watch?v=1')).toEqual({ host: 'evil.example', warn: true });
		expect(linkHost('https://evil.example/', 'Watch it on youtube.com!')).toEqual({ host: 'evil.example', warn: true });
		expect(linkHost('https://youtube.com.evil.example/', 'youtube.com')).toEqual({ host: 'youtube.com.evil.example', warn: true });
	});

	it('warns where the text before an @ passes for the site', () => {
		expect(linkHost('https://youtube.com@evil.example/', 'https://youtube.com@evil.example/')).toEqual({ host: 'evil.example', warn: true });
	});
});

describe('a site whose name could pass for another', () => {
	it('is shown in punycode, and warned of, even as its own URL', () => {
		expect(linkHost('https://www.xn--yutube-i0e.com/watch', 'https://www.xn--yutube-i0e.com/watch')).toEqual({ host: 'xn--yutube-i0e.com', warn: true });
		expect(linkHost('https://www.yοutube.com/watch', 'https://www.yοutube.com/watch')).toEqual({ host: 'xn--yutube-i0e.com', warn: true });
		expect(linkHost('https://xn--80ak6aa92e.com/', 'apple')).toEqual({ host: 'xn--80ak6aa92e.com', warn: true });
	});

	it('mixes Latin with another script, or spells a Latin-looking name in another', () => {
		expect(lookalike('xn--yutube-i0e.com')).toBe(true); // a Greek omicron among Latin letters
		expect(lookalike('xn--80ak6aa92e.com')).toBe(true); // аррӏе, all Cyrillic
		expect(lookalike('xn--pple-43d.com')).toBe(true); // a Cyrillic а
		expect(lookalike('xn--ggle-0nd.com')).toBe(true); // gοgle, a Greek omicron
	});

	it('is not one in its own letters: a German, Russian, Japanese or Chinese name', () => {
		for (const host of ['xn--mnchen-3ya.de', 'xn--80aswg.xn--p1ai', 'xn--eckwd4c7c.xn--zckzah', 'example.com']) expect(lookalike(host), host).toBe(false);
		expect(unicodeHost('xn--mnchen-3ya.de')).toBe('münchen.de');
		expect(unicodeHost('xn--80aswg.xn--p1ai')).toBe('сайт.рф');
		expect(shownHost('xn--mnchen-3ya.de')).toBe('münchen.de');
	});

	it('keeps the end of a long name', () => {
		const host = `${'a'.repeat(50)}.example.com`;
		expect(shownHost(host)).toBe(`…${host.slice(-39)}`);
	});
});
