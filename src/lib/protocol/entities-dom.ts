/**
 * Stands in for `entities` (aliased in `vite.config.ts`), of which markdown-it takes only `decodeHTMLStrict`: for a
 * character reference written in Markdown (`&copy;`, `&#169;`) or in a link's URL or title. The package carries HTML's
 * table of 2,125 named references; the browser's HTML parser holds the same table, so a name is decoded there (as
 * micromark's `decode-named-character-reference` does in browsers). That leaves ~23 KB out of startup JS.
 *
 * Strict, as markdown-it asks: a reference counts only whole and with its semicolon, so `&notit;` stays as written
 * where the HTML parser would read `¬it;`, and `&#12abc;` stays too. Without a DOM (prerendering, tests outside jsdom) a
 * named reference stays as written; nothing there shows Markdown (`renderMarkdown` renders plain text without a DOM).
 */

/** A whole reference, semicolon and all: hexadecimal, decimal or named. */
const REFERENCE = /&(?:#[xX]([0-9A-Fa-f]+)|#([0-9]+)|[A-Za-z][A-Za-z0-9]*);/g;

/** What HTML reads a numeric reference to a C1 control as (windows-1252's characters); 0 keeps the code point. */
const C1 = [8364, 0, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 0, 381, 0, 0, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 0, 382, 376];

/**
 * The names read so far, each parsed once: a parse costs ~1.5 µs where a table costs ~0.1, which text full of
 * `&lt;` and `&gt;` (pasted escaped HTML) would feel. Only names that matched are kept, so it holds at most HTML's 2,125.
 */
const decoded = new Map<string, string>();

export function decodeHTMLStrict(text: string): string {
	// What markdown-it asks most: one reference, read before.
	const known = decoded.get(text);
	if (known !== undefined) return known;
	if (!text.includes('&')) return text;
	return text.replace(REFERENCE, (reference, hex: string | undefined, decimal: string | undefined) =>
		hex !== undefined ? numeric(parseInt(hex, 16)) : decimal !== undefined ? numeric(parseInt(decimal, 10)) : named(reference)
	);
}

/** A numeric reference as HTML reads it: U+FFFD for none (0, a surrogate, past U+10FFFF), C1 controls as windows-1252. */
function numeric(code: number): string {
	if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return '\uFFFD';
	return String.fromCodePoint(code >= 0x80 && code <= 0x9f ? C1[code - 0x80] || code : code);
}

/**
 * Parses references, in a document of its own, which is inert: nothing in it loads or runs. Only `&name;` (letters and
 * digits) is ever written to it, so no markup reaches it either.
 */
let reader: HTMLElement | undefined;

/** A named reference, `&name;`, as its characters, or as written when no name matches it whole. */
function named(reference: string): string {
	const known = decoded.get(reference);
	if (known !== undefined) return known;
	if (typeof document === 'undefined') return reference;
	reader ??= document.implementation.createHTMLDocument('').createElement('i');
	reader.innerHTML = reference;
	const text = reader.textContent ?? reference;
	// The parser also reads a legacy name without its semicolon (`&not` in `&notit;`), leaving the rest and the `;`;
	// a whole match never ends in `;`, but for `&semi;` itself. Unmatched (`&nosuchname;` reads as written), so not kept.
	if (text.endsWith(';') && reference !== '&semi;') return reference;
	decoded.set(reference, text);
	return text;
}
