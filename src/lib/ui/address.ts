/**
 * Where the page's URL says it is, so a room, thread or message can be
 * shared, bookmarked and reloaded: the server and the destination in the
 * query, a message as a fragment.
 *
 * ```text
 * /?room=general
 * /?server=wss%3A%2F%2Fchat.example.com%2Fws&room=general&thread=thread-123#message=message-456
 * ```
 *
 * The server is left out when it is the one the page connects to anyway. A
 * message is named by its `message_id`, which stays the same as it is edited
 * (§2). Nothing that signs in ever goes in the URL: a server URL carrying a
 * user name or password is refused on the way in and stripped on the way out.
 */

export const SERVER_PARAM = 'server';
export const ROOM_PARAM = 'room';
export const THREAD_PARAM = 'thread';
export const MESSAGE_PARAM = 'message';
/** A user in the room, whose profile card opens: a link's `user` (Appendix A.4), in the fragment as link.apron.chat passes it. */
export const USER_PARAM = 'user';

/** What a URL names: a thread only under its room, a message anywhere a room is named. */
export interface Destination {
	server?: string;
	room?: string;
	thread?: string;
	message?: string;
	user?: string;
}

/** Reads a URL's destination; a server that isn't a `ws:` or `wss:` URL, or that carries credentials, is ignored. */
export function readDestination(location: Pick<Location, 'search' | 'hash'>): Destination {
	const query = new URLSearchParams(location.search);
	const server = webSocketUrl(query.get(SERVER_PARAM));
	const room = query.get(ROOM_PARAM) || undefined;
	const thread = room ? query.get(THREAD_PARAM) || undefined : undefined;
	const fragment = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : undefined;
	const message = room ? fragment?.get(MESSAGE_PARAM) || undefined : undefined;
	const user = room ? fragment?.get(USER_PARAM) || undefined : undefined;
	return {
		...(server ? { server } : {}),
		...(room ? { room } : {}),
		...(thread ? { thread } : {}),
		...(message ? { message } : {}),
		...(user ? { user } : {})
	};
}

/**
 * The URL for a destination, from the page's current one: its path and any
 * other query parameters are kept, the destination's replace whatever was
 * there, and the fragment is the message's, or none.
 * `defaultServer` is the one the page connects to with no `server` given.
 */
export function destinationUrl(current: string, destination: Destination, defaultServer: string): string {
	const url = new URL(current);
	for (const param of [SERVER_PARAM, ROOM_PARAM, THREAD_PARAM]) url.searchParams.delete(param);
	const server = destination.server ? withoutCredentials(destination.server) : undefined;
	if (server && server !== withoutCredentials(defaultServer)) url.searchParams.set(SERVER_PARAM, server);
	if (destination.room) {
		url.searchParams.set(ROOM_PARAM, destination.room);
		if (destination.thread) url.searchParams.set(THREAD_PARAM, destination.thread);
	}
	const fragment = new URLSearchParams();
	if (destination.room && destination.message) fragment.set(MESSAGE_PARAM, destination.message);
	if (destination.room && destination.user) fragment.set(USER_PARAM, destination.user);
	url.hash = fragment.toString();
	return url.toString();
}

function webSocketUrl(value: string | null): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined;
		return url.username || url.password ? undefined : url.toString();
	} catch {
		return undefined;
	}
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
