/** Pure helpers over client snapshots, capabilities, and server URLs. */
import { timelineEvents } from './reducer';
import { isJsonObject } from './types';
import type {
	JsonObject,
	Capability,
	Identity,
	MessageRecord,
	ServerParams
} from './types';
import type { Capabilities, ClientSnapshot, RoomSnapshot } from './client-types';

const CAPABILITIES: Capability[] = ['history', 'edit', 'rooms', 'reactions', 'activity', 'embed:upload', 'embed:stream', 'command'];

/**
 * How to render a user (§3.3): field by field, the kept object for its
 * `user_id` (following a retired ID to the identity that replaced it), and
 * the recorded object the frame carries (`from`, a membership's `user`) only
 * for fields the kept object lacks, so a field cleared there (kept as its
 * empty value) stays cleared. Renderers treat an empty field as none, and an
 * empty or unknown name as the `user_id`. Returns the kept object itself
 * when it has every field the recorded one has.
 */
export function userIn(snapshot: Pick<ClientSnapshot, 'users' | 'userAliases'>, recorded: Identity): Identity {
	let id = recorded.user_id;
	for (let hops = 0; hops < 8 && snapshot.userAliases[id] !== undefined; hops += 1) id = snapshot.userAliases[id];
	const kept = snapshot.users[id] ?? snapshot.users[recorded.user_id];
	if (!kept) return recorded;
	const missing = Object.keys(recorded).filter((key) => key !== 'user_id' && !Object.hasOwn(kept, key) && recorded[key] !== undefined && recorded[key] !== null);
	if (!missing.length) return kept;
	const merged: JsonObject = Object.create(null);
	for (const key of missing) merged[key] = recorded[key];
	return Object.assign(merged, kept) as Identity;
}

/** Messages of a room in timeline order. */
export function timelineMessages(room: RoomSnapshot | undefined): MessageRecord[] {
	return room ? timelineEvents(room.timeline) : [];
}

/** Finds a message in any visible room's published timeline (for example a cross-room reply target). */
export function findMessage(rooms: readonly RoomSnapshot[], messageId: string): MessageRecord | undefined {
	for (const room of rooms) {
		const message = room.timeline.events[messageId];
		if (message) return message;
	}
	return undefined;
}

/** Rooms without a parent, in listing order. */
export function topLevelRooms(rooms: readonly RoomSnapshot[]): RoomSnapshot[] {
	return rooms.filter((room) => room.parentRoomId === undefined);
}

/** Direct children (threads) of a room, in listing order. */
export function childRooms(rooms: readonly RoomSnapshot[], parentRoomId: string): RoomSnapshot[] {
	return rooms.filter((room) => room.parentRoomId === parentRoomId);
}

/** Whether a `server` frame advertises a capability (§4). Capabilities gate UI, not authorization. */
function hasCapability(server: ServerParams | undefined, cap: Capability): boolean {
	return server?.capabilities?.includes(cap) === true;
}

export function capabilitiesOf(server: ServerParams | undefined): Capabilities {
	return Object.fromEntries(CAPABILITIES.map((cap) => [cap, hasCapability(server, cap)])) as Capabilities;
}

/** Edit, move, and delete controls (capability `edit`). */
export const canEdit = (server: ServerParams | undefined) => hasCapability(server, 'edit');
/** Room and thread creation and room updates (capability `rooms`). */
export const canManageRooms = (server: ServerParams | undefined) => hasCapability(server, 'rooms');
/** Reaction controls (capability `reactions`). */
export const canReact = (server: ServerParams | undefined) => hasCapability(server, 'reactions');
/** History recovery and paging (capability `history`). */
export const hasHistory = (server: ServerParams | undefined) => hasCapability(server, 'history');

/** The VAPID public key (base64url) of the server's `webpush` push kind (§4.7), if it offers one. */
export function webPushKey(server: ServerParams | undefined): string | undefined {
	const webpush = server?.push?.webpush;
	const key = isJsonObject(webpush) ? webpush.key : undefined;
	return typeof key === 'string' && key ? key : undefined;
}

export function defaultWebSocketUrl(locationLike?: Location): string {
	// `?.`: outside Vite (plain Node) there is no `import.meta.env`.
	const configured = import.meta.env?.VITE_DEFAULT_SERVER_URL;
	if (configured) return configured;
	if (!locationLike) return 'ws://localhost:8080/ws';
	const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${locationLike.host}/ws`;
}

export function normalizeWebSocketUrl(input: string, locationLike?: Location): string {
	const value = input.trim();
	if (!value) return defaultWebSocketUrl(locationLike);
	if (value.startsWith('ws://') || value.startsWith('wss://')) return new URL(value).toString();
	if (value.startsWith('http://') || value.startsWith('https://')) {
		return new URL(value.replace(/^http/, 'ws')).toString();
	}
	if (value.startsWith('/')) {
		const base = locationLike ? `${locationLike.protocol === 'https:' ? 'wss:' : 'ws:'}//${locationLike.host}` : 'ws://localhost:5173';
		return `${base}${value}`;
	}
	return new URL(`ws://${value}`).toString();
}
