import { formKeys } from './apron-link';

/**
 * Where the page's URL says it is, so a room, thread or message can be
 * shared, bookmarked and reloaded. All of it is in the fragment, which the
 * browser never sends, so the host that serves this app doesn't learn which
 * server or room anyone opens:
 *
 * ```text
 * /#room=general
 * /#server=wss://chat.example.com/ws&room=general&thread=thread-123&message=message-456
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
/** A user in the room, whose profile card opens: a link's `user` (Appendix A.4). */
export const USER_PARAM = 'user';
/** The fragment's keys that say where the page is, written in this order. */
const PLACE_PARAMS = [SERVER_PARAM, ROOM_PARAM, THREAD_PARAM, MESSAGE_PARAM, USER_PARAM];

/** What a URL names: a thread, a message or a user only with its room. */
export interface Destination {
	server?: string;
	room?: string;
	thread?: string;
	message?: string;
	user?: string;
}

/** Reads a URL's destination from its fragment; a server that isn't a `ws:` or `wss:` URL, or that carries credentials, is ignored. */
export function readDestination(location: Pick<Location, 'hash'>): Destination {
	const fragment = fragmentParams(location.hash);
	const server = webSocketUrl(fragment.get(SERVER_PARAM));
	const room = fragment.get(ROOM_PARAM) || undefined;
	const inRoom = (key: string) => (room ? fragment.get(key) || undefined : undefined);
	const thread = inRoom(THREAD_PARAM), message = inRoom(MESSAGE_PARAM), user = inRoom(USER_PARAM);
	return {
		...(server ? { server } : {}),
		...(room ? { room } : {}),
		...(thread ? { thread } : {}),
		...(message ? { message } : {}),
		...(user ? { user } : {})
	};
}

/**
 * The URL for a destination, from the page's current one: its path and query
 * are kept, and the fragment names the destination, keeping any other keys
 * it had. `defaultServer` is the one the page connects to with no `server` given.
 */
export function destinationUrl(current: string, destination: Destination, defaultServer: string): string {
	const url = new URL(current);
	const fragment = fragmentParams(url.hash);
	for (const key of PLACE_PARAMS) fragment.delete(key);
	const server = destination.server ? withoutCredentials(destination.server) : undefined;
	const place: [string, string][] = [];
	if (server && server !== withoutCredentials(defaultServer)) place.push([SERVER_PARAM, server]);
	if (destination.room) {
		place.push([ROOM_PARAM, destination.room]);
		if (destination.thread) place.push([THREAD_PARAM, destination.thread]);
		if (destination.message) place.push([MESSAGE_PARAM, destination.message]);
		if (destination.user) place.push([USER_PARAM, destination.user]);
	}
	url.hash = formKeys([...place, ...fragment]);
	return url.toString();
}

function fragmentParams(hash: string): URLSearchParams {
	return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
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
