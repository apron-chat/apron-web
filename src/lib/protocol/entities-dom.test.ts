// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownIt from 'markdown-it';
import { decodeHTMLStrict } from './entities-dom';

// `entities` is aliased to this stand-in (vite.config.ts), here as in the app. Each expectation is what entities'
// own decodeHTMLStrict answers.
describe('the entities stand-in', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('decodes a named reference whole, with its semicolon', () => {
		expect(decodeHTMLStrict('&copy;')).toBe('©');
		expect(decodeHTMLStrict('&AMP;')).toBe('&');
		expect(decodeHTMLStrict('&frac12;')).toBe('½');
		expect(decodeHTMLStrict('&nbsp;')).toBe(' ');
		expect(decodeHTMLStrict('&NotNestedGreaterGreater;')).toBe('⪢̸');
		expect(decodeHTMLStrict('&CounterClockwiseContourIntegral;')).toBe('∳');
		expect(decodeHTMLStrict('&semi;')).toBe(';');
		expect(decodeHTMLStrict('a &lt;b&gt; &amp;&amp; c')).toBe('a <b> && c');
	});

	it('leaves a name that matches only in part, in another case, or not at all, as written', () => {
		// The HTML parser alone reads a legacy `&not` here, as `¬it;`.
		expect(decodeHTMLStrict('&notit;')).toBe('&notit;');
		expect(decodeHTMLStrict('&ampx;')).toBe('&ampx;');
		expect(decodeHTMLStrict('&Amp;')).toBe('&Amp;');
		expect(decodeHTMLStrict('&SEMI;')).toBe('&SEMI;');
		expect(decodeHTMLStrict('&nosuchname;')).toBe('&nosuchname;');
		expect(decodeHTMLStrict('&amp')).toBe('&amp');
		expect(decodeHTMLStrict('no references')).toBe('no references');
	});

	it('decodes a numeric reference as HTML does', () => {
		expect(decodeHTMLStrict('&#65;&#x42;&#X43;&#000000068;')).toBe('ABCD');
		expect(decodeHTMLStrict('&#x1F600;')).toBe('😀');
		// C1 controls read as windows-1252 does, but for the five it leaves unassigned.
		expect(decodeHTMLStrict('&#128;&#x9F;&#129;')).toBe('€Ÿ\u0081');
		// No character: U+FFFD.
		expect(decodeHTMLStrict('&#0;&#xD800;&#xDFFF;&#x110000;&#1234567890;&#99999999999999999999999;')).toBe('�'.repeat(6));
	});

	it('leaves a numeric reference without digits or its semicolon as written', () => {
		for (const text of ['&#12abc;', '&#abc;', '&#;', '&#x;', '&#xyz;', '&#65']) expect(decodeHTMLStrict(text)).toBe(text);
	});

	it('is what markdown-it decodes with, in text, link destinations and titles', () => {
		const md = new MarkdownIt();
		// Numeric references of up to 7 digits markdown-it decodes itself.
		expect(md.render('&copy; &notit; &semi;')).toBe('<p>© &amp;notit; ;</p>\n');
		expect(md.render('[x](https://example.com/?a=1&amp;b=&frac12; "&quot;t&quot;")')).toBe('<p><a href="https://example.com/?a=1&amp;b=%C2%BD" title="&quot;t&quot;">x</a></p>\n');
	});

	it('reads each name once, keeping only those that matched', () => {
		const parse = vi.spyOn(Element.prototype, 'innerHTML', 'set');
		expect(decodeHTMLStrict('&lArr;&lArr;&lArr;')).toBe('⇐⇐⇐');
		expect(decodeHTMLStrict('&nosuchname;&nosuchname;')).toBe('&nosuchname;&nosuchname;');
		expect(parse).toHaveBeenCalledTimes(3);
		parse.mockRestore();
	});

	it('leaves named references as written without a DOM, where nothing shows Markdown', () => {
		vi.stubGlobal('document', undefined);
		expect(decodeHTMLStrict('&NotSucceeds; &#169;')).toBe('&NotSucceeds; ©');
	});
});
