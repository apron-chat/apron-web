import { describe, expect, it } from 'vitest';
import { cleanPlainText, shownEmbed, shownPerson, withoutBidiOverrides } from './plain-text';

describe('cleanPlainText', () => {
	it('drops bidi embeddings, overrides and isolates, which could make the text around it read backwards', () => {
		expect(cleanPlainText('evil\u202Egnp.exe\u2066x\u2069\u202A\u202B\u202C\u202D\u2067\u2068')).toBe('evilgnp.exex');
	});

	it('drops control characters, keeping line feeds as line breaks and tabs as spaces', () => {
		expect(cleanPlainText('a\u0000b\u0007c\u001Bd\u007Fe\u0085f')).toBe('abcdef');
		expect(cleanPlainText('one\r\ntwo\rthree\u2028four\u2029five\tsix')).toBe('one\ntwo\nthree\nfour\nfive six');
	});

	it('keeps at most one blank line in a row, and trims', () => {
		expect(cleanPlainText('  top  \n\n\n\n\nbottom  \n ')).toBe('top\n\nbottom');
	});

	it('cuts to maxChars code points, so an emoji is one', () => {
		expect(cleanPlainText('🦆'.repeat(10), 3)).toBe('🦆🦆🦆');
		expect(cleanPlainText('ab  cd', 3)).toBe('ab');
	});

	it('leaves markup, links and every script as written: they are only ever shown as text', () => {
		const text = '<img src=x onerror=alert(1)> [link](javascript:alert(1)) @everyone مرحبا 你好 👋🏽 👩‍💻 נ\u200Fx';
		expect(cleanPlainText(text)).toBe(text);
	});
});

describe('bidi embeddings and overrides (§3.5.2)', () => {
	it('are taken out of text as it is shown, isolates kept', () => {
		expect(withoutBidiOverrides('evil\u202Egnp.exe\u202A\u202B\u202C\u202D \u2068x\u2069')).toBe('evilgnp.exe \u2068x\u2069');
		const plain = 'nothing to drop';
		expect(withoutBidiOverrides(plain)).toBe(plain);
	});

	it('are taken out of a user\'s name and roles as shown, the object kept as written', () => {
		const mallory = { user_id: 'mal\u202Elory', name: 'Mal\u202Elory', roles: ['ad\u202Dmin', 'ok'], ext: { bio: 'x' } };
		const shown = shownPerson(mallory);
		expect(shown).toEqual({ user_id: 'mal\u202Elory', name: 'Mallory', roles: ['admin', 'ok'], ext: { bio: 'x' } });
		// The user_id is an identifier: kept, and so is the object itself.
		expect(mallory.name).toBe('Mal\u202Elory');
		expect(shownPerson(mallory)).toBe(shown);
		const ada = { user_id: 'ada', name: 'Ada' };
		expect(shownPerson(ada)).toBe(ada);
		expect(shownPerson(undefined)).toBeUndefined();
	});

	it('are taken out of an embed\'s text as shown, never out of its addresses, IDs or a terminal\'s output', () => {
		const embed = {
			kind: 'upload', embed_id: 'e\u202E1', url: 'https://x.example/a\u202Eb', title: 'evil\u202Egnp.exe', html: '<b>t\u202Ax</b>', output: '\u202Eraw',
			og: { title: 'O\u202Bg', description: 'd\u202Ce', site_name: 's\u202Dn', image: { url: 'https://x.example/i\u202E.png', alt: 'a\u202Elt' } }
		};
		const shown = shownEmbed(embed);
		expect(shown).toEqual({
			kind: 'upload', embed_id: 'e\u202E1', url: 'https://x.example/a\u202Eb', title: 'evilgnp.exe', html: '<b>tx</b>', output: '\u202Eraw',
			og: { title: 'Og', description: 'de', site_name: 'sn', image: { url: 'https://x.example/i\u202E.png', alt: 'alt' } }
		});
		expect(embed.title).toBe('evil\u202Egnp.exe');
		expect(shownEmbed(embed)).toBe(shown);
		const plain = { kind: 'upload', url: 'https://x.example/\u202E', title: 'File' };
		expect(shownEmbed(plain)).toBe(plain);
	});
});
