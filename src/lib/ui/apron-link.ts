/**
 * Apron links (PROTOCOL.md Appendix A.4): what this app writes when the user
 * shares a room or message, and the two forms it reads in messages, opened
 * here rather than on link.apron.chat:
 *
 * ```text
 * https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
 * apron:?server=wss://chat.example/ws&room=general
 * apron:?room=ops
 * ```
 *
 * A link without `server`, like the last, is for the server that sent the
 * message it is in. Its keys are `application/x-www-form-urlencoded` pairs
 * after `https://link.apron.chat/#` or `apron:?`, and no other form is read
 * (not `web+apron:`). Each key reads its first value: a key appended to a
 * link cannot replace one before it, such as `server` (§5.4).
 */

import { unescapeHtml } from '$lib/protocol/markdown';
import { serverAddress } from '$lib/protocol/client-views';

export interface ApronLink {
	/** A `ws:` or `wss:` URL; absent in a relative link. */
	server?: string;
	/** A `room_id`, also of a thread. */
	room?: string;
	/** A `message_id` in `room`. */
	message?: string;
	/** A `user_id`; with `room`, a member of it. */
	user?: string;
	/** An invite or a sign-in token: a credential, never written here. */
	token?: string;
	/** The `state` of the sign-in proposal a token answers. */
	state?: string;
}

const WEB_ORIGIN = 'https://link.apron.chat';
const URI_PREFIX = 'apron:?';
/** The keys this app reads besides `server`; any other is ignored (Appendix A.4). */
const KEYS = ['room', 'message', 'user', 'token', 'state'] as const;

/**
 * Reads an Apron link, or undefined for any other URL, and for a link this
 * app can't use: a message without a room, a token without a server, or a
 * `server` it can't reach (`ws:` only on this device). Each key is its first
 * value (Appendix A.4), a repeat ignored; so only the first `server` counts,
 * and a link whose first can't be reached is refused rather than opening a
 * later one, which may have been appended to it (§5.4).
 */
export function readApronLink(href: string): ApronLink | undefined {
	const params = keysOf(href.trim());
	if (!params) return undefined;
	const link: ApronLink = {};
	const written = params.get('server');
	if (written !== null) {
		const server = reachable(written);
		if (!server) return undefined;
		link.server = server;
	}
	for (const key of KEYS) {
		const value = params.get(key);
		if (value) link[key] = value;
	}
	if (link.message !== undefined && (link.room === undefined || !/^[1-9][0-9]*$/.test(link.message))) return undefined;
	if (link.token !== undefined && link.server === undefined) return undefined;
	return link;
}

/** An anchor's `href` in rendered markup, which the renderer and DOMPurify write in double quotes, escaped. */
const ANCHOR_HREF = /<a\s[^>]*?\bhref="([^"]*)"/gi;

/**
 * The distinct links to messages, rooms and threads in a message's body as
 * rendered (`renderMarkdown`, `renderPlain`), in order, up to `max`, read
 * strictly (`readPlaceLink`): not to users. Read from its links, not its source, so it finds
 * what the renderer linked and no more: nothing in code, and a link the way
 * it reads, percent-encoding and all.
 */
export function placeLinksIn(html: string, max: number): PlaceLink[] {
	const found = new Map<string, PlaceLink>();
	for (const match of html.matchAll(ANCHOR_HREF)) {
		if (found.size >= max) break;
		const link = readPlaceLink(unescapeHtml(match[1]));
		if (link && link.user === undefined) found.set(`${link.server ?? ''} ${link.room} ${link.message ?? ''}`, link);
	}
	return [...found.values()];
}

/** A link to a place: a room or thread, a message in it, or a member of it. */
export type PlaceLink = ApronLink & { room: string };

/** The keys a link to a place may have; any other (a token, a sign-in's state, one this app doesn't know) makes it none. */
const PLACE_KEYS = new Set(['server', 'room', 'message', 'user']);
/**
 * A `room_id` or `user_id` (§2.4): not empty, no whitespace or control characters, and no bidi formatting
 * characters either, which could reverse how a chip naming it reads.
 */
const ID = /^[^\s\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]+$/u;
/** A `message_id`: the `log_id` of its creation (§2.2), digits without a leading zero. */
const MESSAGE_ID = /^[1-9][0-9]*$/;

/**
 * A link to a room, thread, message or user, read strictly, for drawing it as
 * one (a chip in the text, a card under it), which says it is one: every key
 * known and given once, every pair `key=value` with a value that decodes and
 * is of its type, in one of the shapes Appendix A.4 lists (`room`; `room` and
 * `message`; `room` and `user`) with at most one `server`, one this app can
 * reach. A link with any other key, an empty or malformed part, or anything
 * after its keys is none, and stays a plain link, though `readApronLink` may
 * still open it.
 */
export function readPlaceLink(href: string): PlaceLink | undefined {
	const keys = rawKeysOf(href.trim());
	if (keys === undefined) return undefined;
	const values = new Map<string, string>();
	for (const pair of keys.split('&')) {
		const at = pair.indexOf('=');
		const key = at > 0 ? formDecode(pair.slice(0, at)) : undefined;
		const value = at > 0 ? formDecode(pair.slice(at + 1)) : undefined;
		if (key === undefined || !value || !PLACE_KEYS.has(key) || values.has(key)) return undefined;
		values.set(key, value);
	}
	const room = values.get('room'), message = values.get('message'), user = values.get('user'), written = values.get('server');
	if (room === undefined || !ID.test(room)) return undefined;
	if (message !== undefined && (user !== undefined || !MESSAGE_ID.test(message))) return undefined;
	if (user !== undefined && !ID.test(user)) return undefined;
	const server = written === undefined ? undefined : reachable(written);
	if (written !== undefined && server === undefined) return undefined;
	return { room, ...(server !== undefined ? { server } : {}), ...(message !== undefined ? { message } : {}), ...(user !== undefined ? { user } : {}) };
}

/** A link's keys as written, for `readPlaceLink`: the https form's fragment, with no query, or what follows `apron:?`, with no fragment. */
function rawKeysOf(href: string): string | undefined {
	if (href.toLowerCase().startsWith(URI_PREFIX)) {
		const keys = href.slice(URI_PREFIX.length);
		return keys.includes('#') ? undefined : keys;
	}
	try {
		const url = new URL(href);
		return url.origin === WEB_ORIGIN && url.pathname === '/' && !url.search && url.hash.length > 1 ? url.hash.slice(1) : undefined;
	} catch {
		return undefined;
	}
}

/** A key or value of `application/x-www-form-urlencoded` (`+` is a space), or undefined where its percent-encoding is malformed. */
function formDecode(value: string): string | undefined {
	try {
		return decodeURIComponent(value.replace(/\+/g, ' '));
	} catch {
		return undefined;
	}
}

/** The link to share for a place on `server`, in the `https` form (Appendix A.4). */
export function writeApronLink(link: Pick<ApronLink, 'room' | 'message' | 'user'> & { server: string }): string {
	const entries: [string, string | undefined][] = [['server', withoutCredentials(link.server)], ['room', link.room], ['message', link.room ? link.message : undefined], ['user', link.user]];
	return `${WEB_ORIGIN}/#${formKeys(entries.filter((entry): entry is [string, string] => entry[1] !== undefined))}`;
}

/** The key list of a link in either of its forms. */
function keysOf(href: string): URLSearchParams | undefined {
	if (href.toLowerCase().startsWith(URI_PREFIX)) return new URLSearchParams(href.slice(URI_PREFIX.length));
	try {
		const url = new URL(href);
		return url.origin === WEB_ORIGIN && url.pathname === '/' && url.hash.length > 1 ? new URLSearchParams(url.hash.slice(1)) : undefined;
	} catch {
		return undefined;
	}
}

/** A `server` value this app can connect to: `wss:`, or `ws:` on this device, without credentials. */
function reachable(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (url.username || url.password || url.hash) return undefined;
		// The server's address as clients compare it (§1).
		if (url.protocol === 'wss:') return serverAddress(url.toString());
		return url.protocol === 'ws:' && loopback(url.hostname) ? serverAddress(url.toString()) : undefined;
	} catch {
		return undefined;
	}
}

function loopback(host: string): boolean {
	return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** Keys and values as a link writes them: `key=value` joined with `&`, readable (`encodeKey`). */
export function formKeys(entries: Iterable<[string, string]>): string {
	return [...entries].map(([key, value]) => `${encodeKey(key)}=${encodeKey(value)}`).join('&');
}

/** Leaves letters, digits and `-._~:/` as they are, so the link reads well, and encodes everything else. */
function encodeKey(value: string): string {
	return encodeURIComponent(value).replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function withoutCredentials(value: string): string {
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		return url.toString();
	} catch {
		return value;
	}
}
