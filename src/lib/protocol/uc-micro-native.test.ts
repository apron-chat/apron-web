import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { P, S } from './uc-micro-native';

// `uc.micro` is aliased to this stand-in (vite.config.ts), here as in the app.
describe('the uc.micro stand-in', () => {
	it('is what markdown-it gets', () => {
		expect(new MarkdownIt().utils.lib.ucmicro.P).toBe(P);
		expect(new MarkdownIt().utils.lib.ucmicro.S).toBe(S);
	});

	it('knows punctuation and symbols past ASCII, astral ones too', () => {
		for (const char of ['«', '»', '、', '‽', '𐄀']) expect(P.test(char), char).toBe(true);
		for (const char of ['€', '£', '©', '→', '😀']) expect(S.test(char), char).toBe(true);
		for (const char of ['a', 'é', '中', '1', ' ', '\uD83D']) expect(P.test(char) || S.test(char), char).toBe(false);
	});

	it('keeps emphasis from opening between a word and punctuation or a symbol, as CommonMark has it', () => {
		const md = new MarkdownIt();
		// Each `*` follows a letter and comes before a Unicode punctuation mark or symbol, so it can't open emphasis.
		expect(md.render('a*«foo»*')).toBe('<p>a*«foo»*</p>\n');
		expect(md.render('a*€foo€*')).toBe('<p>a*€foo€*</p>\n');
		// CommonMark's own examples (0.31.2, 354): a currency symbol is punctuation to emphasis.
		expect(md.render('*£*bravo.')).toBe('<p>*£*bravo.</p>\n');
		expect(md.render('*€*charlie.')).toBe('<p>*€*charlie.</p>\n');
		expect(md.render('«*foo*»')).toBe('<p>«<em>foo</em>»</p>\n');
	});
});
