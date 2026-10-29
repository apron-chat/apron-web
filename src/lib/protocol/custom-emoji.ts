/**
 * Custom emoji (extension `ext:emoji`): images a server defines, which users
 * write as `:name:` in reactions and text. The `server` frame carries the URL
 * of the catalog, a JSON object keyed by that string; clients fetch it only
 * when they need it. And reaction entries (§4.7), which are one emoji
 * sequence or a key such as a custom emoji's.
 */
import { safeAvatar } from './embeds';
import { withoutBidiOverrides } from './plain-text';
import { isJsonObject, type ServerParams } from './types';

/** A key: `:`, a name of `[A-Za-z0-9_+-]`, and `:`. Case-sensitive. */
export const EMOJI_KEY = /^:[A-Za-z0-9_+-]+:$/;

/** One custom emoji, as the catalog defines it, with its key. */
export interface CustomEmoji {
	key: string;
	/** The image, loaded as an avatar is (§4.8.6). */
	url: string;
	/** Hover and screen reader text; the key without one. */
	alt?: string;
	/** Together, the aspect ratio; square when either is absent. */
	width?: number;
	height?: number;
	/** A still copy of an animated image. */
	static_url?: string;
	/** Groups the picker. */
	category?: string;
	/** More words to search by. */
	tags: string[];
	/** Rendered, but not offered in the picker. */
	hidden: boolean;
}

/** A catalog: each key the server defines, in the catalog's order. */
export type EmojiCatalog = ReadonlyMap<string, CustomEmoji>;

/**
 * The catalog's URL (`server.ext.emoji.catalog_url`), only while the server
 * lists `ext:emoji`: an `https:` URL, an `http:` one on a loopback host, or
 * a `data:application/json` URL. Undefined for anything else.
 */
export function catalogUrlOf(server: ServerParams | undefined): string | undefined {
	if (!server?.capabilities?.includes('ext:emoji')) return undefined;
	const emoji = isJsonObject(server.ext) ? server.ext.emoji : undefined;
	const value = isJsonObject(emoji) ? emoji.catalog_url : undefined;
	if (typeof value !== 'string') return undefined;
	if (/^data:application\/json[;,]/i.test(value)) return value;
	try {
		const url = new URL(value);
		const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
		return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url.href : undefined;
	} catch {
		return undefined;
	}
}

const positive = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? withoutBidiOverrides(value.trim()) : undefined);

/**
 * A fetched catalog, entry by entry: a key that isn't one, or an entry
 * without a `url` that loads as an avatar would from the chat server at
 * `origin`, is left out; a field of the wrong type is left out on its own.
 */
export function parseCatalog(json: unknown, origin: string | undefined): EmojiCatalog {
	const catalog = new Map<string, CustomEmoji>();
	if (!isJsonObject(json)) return catalog;
	for (const [key, entry] of Object.entries(json)) {
		if (!EMOJI_KEY.test(key) || !isJsonObject(entry)) continue;
		const url = safeAvatar(entry.url, origin);
		if (!url) continue;
		const width = positive(entry.width), height = positive(entry.height);
		const alt = text(entry.alt), category = text(entry.category);
		const still = safeAvatar(entry.static_url, origin);
		const tags = Array.isArray(entry.tags) ? entry.tags.flatMap((tag) => text(tag) ?? []) : [];
		catalog.set(key, {
			key, url,
			...(alt ? { alt } : {}),
			...(width && height ? { width, height } : {}),
			...(still ? { static_url: still } : {}),
			...(category ? { category } : {}),
			tags,
			hidden: entry.hidden === true
		});
	}
	return catalog;
}

/** A key found in text. */
export interface EmojiKeyMatch {
	key: string;
}

/**
 * Text split around the keys it has that `known` knows, scanning from left to
 * right: at each `:`, if the text up to the next `:` forms a known key, it is
 * one, and the scan goes on after it; otherwise the scan goes on at that next
 * `:`. So keys can be adjacent (`:a::b:`), and `12:30:partyparrot:` has
 * `:partyparrot:`.
 */
export function emojiKeySegments(source: string, known: (key: string) => boolean): (string | EmojiKeyMatch)[] {
	const segments: (string | EmojiKeyMatch)[] = [];
	let last = 0;
	let at = source.indexOf(':');
	while (at !== -1) {
		const close = source.indexOf(':', at + 1);
		if (close === -1) break;
		const key = source.slice(at, close + 1);
		if (EMOJI_KEY.test(key) && known(key)) {
			if (at > last) segments.push(source.slice(last, at));
			segments.push({ key });
			last = close + 1;
			at = source.indexOf(':', last);
		} else {
			at = close;
		}
	}
	if (last < source.length) segments.push(source.slice(last));
	return segments;
}

/** Whether text has anything that could be a key, so a catalog not yet fetched is needed to show it. */
export function mayHaveKeys(source: string): boolean {
	return /:[A-Za-z0-9_+-]+:/.test(source);
}

/**
 * The catalog's emoji a search finds, in the catalog's order, those it
 * finds by key first: by the key or its name, `alt`, or a tag, without
 * regard to case. `hidden` ones aren't offered.
 */
export function searchCatalog(catalog: EmojiCatalog, query: string, limit = Infinity): CustomEmoji[] {
	const needle = query.trim().toLowerCase().replace(/^:|:$/g, '');
	const offered = [...catalog.values()].filter((emoji) => !emoji.hidden);
	if (!needle) return offered.slice(0, limit);
	const ranked: { emoji: CustomEmoji; rank: number }[] = [];
	for (const emoji of offered) {
		const name = emoji.key.slice(1, -1).toLowerCase();
		const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2
			: [emoji.alt ?? '', ...emoji.tags].some((term) => term.toLowerCase().includes(needle)) ? 3 : -1;
		if (rank >= 0) ranked.push({ emoji, rank });
	}
	return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map(({ emoji }) => emoji);
}

/**
 * One emoji sequence (UTS #51): a flag, a keycap, or a pictograph with its
 * skin tones, U+FE0F selectors, tags and ZWJ joins, such as 👍🏽, 🏳️‍🌈 or
 * 👨‍👩‍👧. A reaction entry that isn't one is a key (§4.7).
 */
const EMOJI_SEQUENCE =
	/^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|[\u{E0020}-\u{E007F}])*(?:‍\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️)*)*)$/u;

/** Whether a reaction entry is an emoji sequence, rather than a key for another kind of reaction (§4.7). */
export function isEmojiSequence(entry: string): boolean {
	return EMOJI_SEQUENCE.test(entry);
}

/** A reaction entry as clients compare it (§4.7): without U+FE0F, so ❤ and ❤️ are one. */
export function reactionKey(entry: string): string {
	return entry.replace(/️/g, '');
}
