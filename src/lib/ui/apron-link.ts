/**
 * Apron links (PROTOCOL.md Appendix A.4): what this app writes when the user
 * shares a room or message, and the three forms it reads in messages, opened
 * here rather than on link.apron.chat:
 *
 * ```text
 * https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042
 * apron:?server=wss://chat.example/ws&room=general
 * web+apron:?room=ops
 * ```
 *
 * A link without `server`, like the last, is for the server that sent the
 * message it is in.
 */

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
const URI_PREFIXES = ['apron:?', 'web+apron:?'];
/** Keys a link has at most once: two readers that kept different copies would open different places. */
const SINGLE_KEYS = ['room', 'message', 'user', 'token', 'state'] as const;

/**
 * Reads an Apron link, or undefined for any other URL, and for a link this
 * app can't use: a repeated key, a message without a room, a token without a
 * server, or no `server` it can reach (`ws:` only on this device).
 */
export function readApronLink(href: string): ApronLink | undefined {
	const params = keysOf(href.trim());
	if (!params) return undefined;
	if (SINGLE_KEYS.some((key) => params.getAll(key).length > 1)) return undefined;
	const link: ApronLink = {};
	const servers = params.getAll('server');
	if (servers.length) {
		const server = servers.map(reachable).find((value) => value !== undefined);
		if (!server) return undefined;
		link.server = server;
	}
	for (const key of SINGLE_KEYS) {
		const value = params.get(key);
		if (value) link[key] = value;
	}
	if (link.message !== undefined && (link.room === undefined || !/^[1-9][0-9]*$/.test(link.message))) return undefined;
	if (link.token !== undefined && link.server === undefined) return undefined;
	return link;
}

/** The link to share for a place on `server`, in the `https` form (Appendix A.4). */
export function writeApronLink(link: Pick<ApronLink, 'room' | 'message' | 'user'> & { server: string }): string {
	const entries: [string, string | undefined][] = [['server', withoutCredentials(link.server)], ['room', link.room], ['message', link.room ? link.message : undefined], ['user', link.user]];
	return `${WEB_ORIGIN}/#${entries.filter((entry): entry is [string, string] => entry[1] !== undefined).map(([key, value]) => `${key}=${encodeKey(value)}`).join('&')}`;
}

/** The key list of a link in any of its forms. */
function keysOf(href: string): URLSearchParams | undefined {
	const prefix = URI_PREFIXES.find((candidate) => href.toLowerCase().startsWith(candidate));
	if (prefix) return new URLSearchParams(href.slice(prefix.length));
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
		if (url.protocol === 'wss:') return url.toString();
		return url.protocol === 'ws:' && loopback(url.hostname) ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function loopback(host: string): boolean {
	return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
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
