import { describe, expect, it } from 'vitest';
import { cleanPlainText, parseFrame, withoutBidiOverrides } from './plain-text';

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
	it('are taken out of what users write, isolates kept', () => {
		expect(withoutBidiOverrides('evil\u202Egnp.exe\u202A\u202B\u202C\u202D \u2068x\u2069')).toBe('evilgnp.exe \u2068x\u2069');
	});

	it('are taken out of every string of a frame, written or escaped, keys and other values left alone', () => {
		const raw = '{"method":"message","params":{"from":{"user_id":"ada","name":"Ada\\u202e"},"body":{"text":"evil\u202Egnp.exe","n":1}}}';
		expect(parseFrame(raw)).toEqual({ method: 'message', params: { from: { user_id: 'ada', name: 'Ada' }, body: { text: 'evilgnp.exe', n: 1 } } });
		// A backslash written before `u202e` is text, not an escape.
		expect(parseFrame('{"a":"plain","b":[1,"\\\\u202e"]}')).toEqual({ a: 'plain', b: [1, '\\u202e'] });
		expect(() => parseFrame('{')).toThrow();
	});
});
