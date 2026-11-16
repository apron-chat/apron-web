/**
 * Where a link in a message really goes, shown beside it, so its text can't pass it off as somewhere else: a link
 * written with words of its own (`[my website](https://shazow.net)`) shows its site after them, and one whose text
 * names another site (`[youtube.com](https://evil.example)`), or whose site only looks like a familiar one
 * (`https://www.yοutube.com`, with a Greek omicron), is flagged. Chat clients and mail readers do the like: Mastodon
 * tags a link whose text is a URL to another site with that site, and browsers show a site's name in punycode
 * (`xn--…`) wherever its letters could pass for others (Unicode TR #39, Chromium's IDN display policy).
 */

/** What a link's tag says: the site it goes to, as it is safe to show, and whether its text or that site misleads. */
export interface LinkHost {
	host: string;
	warn: boolean;
}

/** The longest a site's name is shown: a longer one keeps its end, which says whose it is (`…youtube.com.evil.net`). */
const MAX_HOST = 40;

/**
 * The tag a link to `href` written as `text` gets, or nothing where its text is its own URL (or that URL's site) and
 * nothing about it misleads. Only web links are tagged: anything else (an Apron link, `mailto:`, a heading in the
 * same file) opens nothing whose site could be passed off as another's.
 */
export function linkHost(href: string, text: string): LinkHost | undefined {
	const url = parse(href);
	if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return undefined;
	const host = url.hostname;
	// Text before an `@` reads as the site but is only a user name: `https://youtube.com@evil.net` goes to evil.net.
	const suspect = lookalike(host) || url.username !== '' || url.password !== '';
	const written = text.trim();
	const whole = hostOf(written);
	if (whole !== undefined && sameSite(whole, host) && !suspect) return undefined;
	const named = written.split(/\s+/).map((word) => hostOf(word.replace(/^[("'[<]+|[)"'\]>.,;:!?]+$/g, '')));
	const warn = suspect || named.some((site) => site !== undefined && !sameSite(site, host));
	return { host: shownHost(host), warn };
}

/** A site's name as it is shown: without `www.`, in its own letters unless they could pass for others, cut from the front. */
export function shownHost(host: string): string {
	const shown = (lookalike(host) ? host : unicodeHost(host)).replace(/^www\./, '');
	return shown.length > MAX_HOST ? `…${shown.slice(-(MAX_HOST - 1))}` : shown;
}

function parse(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

/**
 * The site a piece of text names, ASCII as a URL holds it, or undefined where it names none: a URL with a scheme, or a
 * name with a dot such as `youtube.com` or `www.example.org/path`. A file's name (`notes.md`) isn't taken for a site.
 */
function hostOf(text: string): string | undefined {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return parse(text)?.hostname || undefined;
	const site = /^([^\s/?#@:]+\.([^\s/?#@:.]+))(?::\d+)?(?:[/?#]\S*)?$/u.exec(text);
	if (!site) return undefined;
	const [, name, tld] = site;
	if (!/^(?:\p{L}{2,}|xn--[a-z0-9-]+)$/iu.test(tld)) return undefined;
	if (!/^www\./i.test(name) && name === text && FILE_ENDINGS.has(tld.toLowerCase())) return undefined;
	return parse(`https://${name}`)?.hostname || undefined;
}

/** Endings more often a file's than a site's, so `README.md` alone is a file. With `www.` or a path it is a site. */
const FILE_ENDINGS = new Set(['md', 'rs', 'py', 'sh', 'js', 'ts', 'go', 'pl', 'rb', 'cs', 'gz', 'db', 'so', 'hs', 'txt', 'json', 'yaml', 'yml', 'toml', 'html', 'css', 'png', 'jpg', 'gif', 'pdf', 'zip', 'exe', 'svelte', 'tsx', 'jsx', 'lock', 'log', 'csv']);

function sameSite(a: string, b: string): boolean {
	const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');
	return bare(a) === bare(b);
}

/** Scripts a site's name may mix with Latin, as Japanese, Chinese and Korean names do; any other mix could hide a lookalike. */
const MIXES = [['Latin', 'Han', 'Hiragana', 'Katakana'], ['Latin', 'Han', 'Hangul'], ['Latin', 'Han', 'Bopomofo']];
const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Cherokee', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Bopomofo'].map((name) => [name, new RegExp(`\\p{Script=${name}}`, 'u')] as const);
/** Letters of another script, each drawn like a Latin one, from which a whole name can be spelt to pass for a Latin one (`аррӏе`). */
const LATIN_LIKE: Record<string, RegExp> = {
	Cyrillic: /^[асԁеһіјӏорԛѕԝхуъьҽпгѵѡ]+$/u,
	Greek: /^[αικνορυχ]+$/u,
	Armenian: /^[օսհոցզ]+$/u
};
/** Latin letters drawn like plainer ones: a dotless i, a script a or g. */
const LATIN_LOOKALIKES = /[ıȷɑɡɩʏ]/u;

/**
 * Whether a site's name could pass for another's, as browsers judge it before showing a name in its own letters: a
 * part of it (a label) mixes scripts that don't go together, holds a letter drawn like a plainer Latin one, holds
 * something other than letters, digits, marks and hyphens, or is spelt entirely of another script's Latin-like letters
 * under a Latin ending (`аррӏе.com`; `сайт.рф`, under a Cyrillic one, is just Russian).
 */
export function lookalike(host: string): boolean {
	const labels = host.split('.').map(unicodeLabel);
	const latinEnding = /^[a-z0-9-]*$/i.test(labels.at(-1) ?? '');
	return labels.some((label) => {
		if (/^[\x00-\x7f]*$/.test(label)) return false;
		if (LATIN_LOOKALIKES.test(label)) return true;
		const scripts = new Set<string>();
		for (const char of label) {
			if (/[0-9-]|\p{M}/u.test(char)) continue;
			if (!/\p{L}/u.test(char)) return true;
			scripts.add(SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0] ?? 'Other');
		}
		if (scripts.size > 1) return !MIXES.some((mix) => [...scripts].every((script) => mix.includes(script)));
		const [script] = scripts;
		const letters = label.replace(/[0-9-]|\p{M}/gu, '');
		return latinEnding && script !== undefined && LATIN_LIKE[script]?.test(letters) === true;
	});
}

/** A site's name in its own letters: each `xn--` label decoded. */
export function unicodeHost(host: string): string {
	return host.split('.').map(unicodeLabel).join('.');
}

function unicodeLabel(label: string): string {
	if (!/^xn--/i.test(label)) return label;
	return decodePunycode(label.slice(4).toLowerCase()) ?? label;
}

/** RFC 3492's decoding, for showing a site's name: undefined where `input` isn't punycode. */
function decodePunycode(input: string): string | undefined {
	const BASE = 36, T_MIN = 1, T_MAX = 26, SKEW = 38, DAMP = 700;
	const adapt = (delta: number, points: number, first: boolean) => {
		delta = first ? Math.floor(delta / DAMP) : delta >> 1;
		delta += Math.floor(delta / points);
		let k = 0;
		for (; delta > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - T_MIN));
		return Math.floor(k + ((BASE - T_MIN + 1) * delta) / (delta + SKEW));
	};
	const basic = Math.max(input.lastIndexOf('-'), 0);
	const output = [...input.slice(0, basic)].map((char) => char.codePointAt(0)!);
	if (output.some((code) => code >= 0x80)) return undefined;
	let n = 0x80, i = 0, bias = 72;
	for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
		const old = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (index >= input.length) return undefined;
			const code = input.charCodeAt(index++);
			const digit = code >= 0x30 && code <= 0x39 ? code - 22 : code >= 0x61 && code <= 0x7a ? code - 0x61 : BASE;
			if (digit >= BASE) return undefined;
			i += digit * w;
			const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
			if (digit < t) break;
			w *= BASE - t;
		}
		const points = output.length + 1;
		bias = adapt(i - old, points, old === 0);
		n += Math.floor(i / points);
		i %= points;
		if (n > 0x10ffff) return undefined;
		output.splice(i++, 0, n);
	}
	return String.fromCodePoint(...output);
}
