/** Pure helpers over client snapshots, capabilities, and server URLs. */
import { timelineEvents } from './reducer';
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
 * `user_id` (following a retired ID to the identity that replaced it), else
 * the recorded object the frame carries (`from`, a membership's `user`), and
 * the display name falls back to the `user_id` last. Returns the kept object
 * itself when it has every field the recorded one has.
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
	return server?.caps?.includes(cap) === true;
}

export function capabilitiesOf(server: ServerParams | undefined): Capabilities {
	return Object.fromEntries(CAPABILITIES.map((cap) => [cap, hasCapability(server, cap)])) as Capabilities;
}

/** Edit, move, and delete controls (cap `edit`). */
export const canEdit = (server: ServerParams | undefined) => hasCapability(server, 'edit');
/** Room and thread creation and room updates (cap `rooms`). */
export const canManageRooms = (server: ServerParams | undefined) => hasCapability(server, 'rooms');
/** Reaction controls (cap `reactions`). */
export const canReact = (server: ServerParams | undefined) => hasCapability(server, 'reactions');
/** History recovery and paging (cap `history`). */
export const hasHistory = (server: ServerParams | undefined) => hasCapability(server, 'history');

export function defaultWebSocketUrl(locationLike?: Location): string {
	const configured = import.meta.env.VITE_DEFAULT_SERVER_URL;
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
