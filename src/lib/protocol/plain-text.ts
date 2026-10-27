/**
 * Cleaning user-written plain text for display, such as a bio (`ext:bio`).
 * Shown as text, never as markup, it can't inject anything, but some
 * characters still change how it and what's around it read.
 */

/**
 * Control characters but the line feed, and the bidi embeddings, overrides
 * and isolates (U+202A–U+202E, U+2066–U+2069), which could reverse how the
 * text around it reads, as `evil\u202Egnp.exe` shows as `evilexe.png`.
 */
const UNSAFE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Plain text as it is safe to show and to send: line feeds for line breaks,
 * tabs as spaces, no control or bidi formatting characters, at most one
 * blank line in a row, trimmed, and cut to `maxChars` characters (code
 * points, so an emoji is one) when given. Everything else stays as written:
 * markup and URLs are text, and only ever rendered as text.
 */
export function cleanPlainText(text: string, maxChars?: number): string {
	const clean = text.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, ' ').replace(UNSAFE, '').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	return maxChars === undefined ? clean : [...clean].slice(0, maxChars).join('').trimEnd();
}

/** The bidi embeddings and overrides (U+202A–U+202E), which clients ignore in what users write (§3.5.2). */
const BIDI_OVERRIDES = /[‪-‮]/g;

/** Text without bidi embeddings and overrides (§3.5.2): a name or a file title can't show its own characters out of order. */
export function withoutBidiOverrides(text: string): string {
	return text.replace(BIDI_OVERRIDES, '');
}

/** One in a frame as sent, or as a JSON escape (`‮`). */
const RAW_OVERRIDE = /[‪-‮]|\\u202[A-Ea-e]/;

/**
 * A frame's JSON, parsed, with the bidi embeddings and overrides taken out of
 * every string in it (§3.5.2): every name, title, description and message the
 * client shows comes from a frame, so none reaches the page. Frames without
 * any parse as they are.
 */
export function parseFrame(raw: string): unknown {
	if (!RAW_OVERRIDE.test(raw)) return JSON.parse(raw);
	return JSON.parse(raw, (_key, value: unknown) => (typeof value === 'string' ? withoutBidiOverrides(value) : value));
}
