/** Pure helpers over client snapshots, capabilities, and server URLs. */
import { parseOrigins } from './embeds';
import { cleanPlainText } from './plain-text';
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

const CAPABILITIES: Capability[] = ['history', 'edit', 'rooms', 'reactions', 'activity', 'embed:upload', 'embed:stream', 'command', 'status', 'ext', 'ext:settings', 'ext:limits', 'ext:media', 'ext:permissions', 'ext:bio', 'ext:device_add'];

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
	const id = snapshot.userAliases[recorded.user_id] ?? recorded.user_id;
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

/**
 * The server's settings (extension `ext:settings`, `server.ext.settings`),
 * each `true` unless the server says `false`: also without the extension.
 */
export function serverSettings(server: ServerParams | undefined): { guest_posting: boolean; read_cursors: boolean; add_members: boolean; private_rooms?: number } {
	const ext = hasCapability(server, 'ext:settings') ? server?.ext : undefined;
	const settings = isJsonObject(ext) && isJsonObject(ext.settings) ? ext.settings : {};
	// A number, unlike the rest: the most private rooms one user may be in at once. Absent (or not a count) states no limit.
	const limit = settings.private_rooms;
	return {
		guest_posting: settings.guest_posting !== false, read_cursors: settings.read_cursors !== false, add_members: settings.add_members !== false,
		...(typeof limit === 'number' && Number.isInteger(limit) && limit >= 0 ? { private_rooms: limit } : {})
	};
}

/** What an untitled private room is called while its members aren't known (§4.2.4: its `room_id` is no name, §2.4). */
export const PRIVATE_ROOM = 'Private room';

/**
 * The title of an untitled top-level private room (§4.2.4), from its members
 * other than you: their names, sorted and joined with ", ", or "You" when no
 * one else is left. The one naming rule for it, so the sidebar, the header,
 * the page title, notifications and the composer all agree.
 */
export function peopleTitle(names: readonly string[]): string {
	if (!names.length) return 'You';
	return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b)).join(', ');
}

/**
 * What the signed-in user may do that the core leaves to the server
 * (extension `ext:permissions`, `you.ext.permissions`): move other users'
 * messages, add other users to rooms, and be pushed for wake scope
 * `joined`. Read from `you` only; each is `false` without the extension.
 */
export function yourPermissions(server: ServerParams | undefined, you: Identity | undefined): { move_any: boolean; add_members: boolean; push_joined: boolean } {
	const ext = hasCapability(server, 'ext:permissions') ? you?.ext : undefined;
	const granted: unknown[] = isJsonObject(ext) && Array.isArray(ext.permissions) ? ext.permissions : [];
	return { move_any: granted.includes('move_any'), add_members: granted.includes('add_members'), push_joined: granted.includes('push_joined') };
}

/**
 * Whether push wakes you for `joined` where `server.push.wake` lists it: on a
 * server with `ext:permissions`, only with `push_joined` (EXT.md §7); on any
 * other, as listed.
 */
export function pushesJoined(server: ServerParams | undefined, you: Identity | undefined): boolean {
	return !hasCapability(server, 'ext:permissions') || yourPermissions(server, you).push_joined;
}

/** The longest bio (extension `ext:bio`), in characters (code points). */
export const MAX_BIO_CHARS = 250;

/** Whether the server keeps a bio (extension `ext:bio`): it advertises `ext:bio`, or `ext`, which keeps any key. */
export const keepsBio = (server: ServerParams | undefined) => hasCapability(server, 'ext:bio') || hasCapability(server, 'ext');

/** A bio (extension `ext:bio`) as clients send and show it: cleaned plain text (cleanPlainText), at most MAX_BIO_CHARS. */
export const cleanBio = (text: string) => cleanPlainText(text, MAX_BIO_CHARS);

/**
 * A user's bio (extension `ext:bio`, `ext.bio`), cleaned (cleanBio).
 * Undefined without one, or for a value that isn't a string, or that is
 * blank, as a cleared one (`""`) is.
 */
export function bioOf(user: Identity | undefined): string | undefined {
	const bio = isJsonObject(user?.ext) ? user.ext.bio : undefined;
	return typeof bio === 'string' ? cleanBio(bio) || undefined : undefined;
}

/** What a server takes of one type of file (`ext:media`): the largest file, and the longest image side it keeps. */
export interface MediaLimit {
	max_bytes?: number;
	max_side?: number;
}

/** A category of files (`ext:media` `upload` or `avatar`): each MIME pattern it takes (`type/subtype`, `type/*`, `*\/*`), with its limits. */
export type MediaTypes = Record<string, MediaLimit>;

/** What a server says about media (`ext:media`): origins besides its own, and the files it takes, by category. */
export interface ServerMedia {
	/** Where embed media may also load from: exact `https:` origins, or `http:` ones on localhost. */
	origins: string[];
	/** Message attachments (§4.8.4). Absent: nothing is known. */
	upload?: MediaTypes;
	/** `/avatar` (§4.8.6). Absent: nothing is known. */
	avatar?: MediaTypes;
}

const MIME_PATTERN = /^(\*\/\*|[\w!#$&^.+-]+\/(\*|[\w!#$&^.+-]+))$/;
const MEDIA_LIMITS = ['max_bytes', 'max_side'] as const;

/**
 * The server's media (extension `ext:media`, `server.ext.media`), field by
 * field: an origin, a pattern, or a limit of the wrong shape is left out,
 * and so is a category that isn't an object. Without the extension, no
 * origins and no categories.
 */
export function serverMedia(server: ServerParams | undefined): ServerMedia {
	const ext = hasCapability(server, 'ext:media') ? server?.ext : undefined;
	const media = isJsonObject(ext) && isJsonObject(ext.media) ? ext.media : {};
	const upload = mediaTypes(media.upload);
	const avatar = mediaTypes(media.avatar);
	return { origins: parseOrigins(media.origins), ...(upload ? { upload } : {}), ...(avatar ? { avatar } : {}) };
}

function mediaTypes(value: unknown): MediaTypes | undefined {
	if (!isJsonObject(value)) return undefined;
	const types: MediaTypes = {};
	for (const [pattern, limits] of Object.entries(value)) {
		if (!MIME_PATTERN.test(pattern) || !isJsonObject(limits)) continue;
		const limit: MediaLimit = {};
		for (const name of MEDIA_LIMITS) {
			const amount = limits[name];
			if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0) limit[name] = amount;
		}
		types[pattern.toLowerCase()] = limit;
	}
	return types;
}

/**
 * What a category takes of a file of `type`, the type the client declares
 * for it (`File.type`, or `application/octet-stream` without one): the
 * limits of its most specific pattern, `type/subtype`, then `type/*`, then
 * `*\/*`. Undefined when no pattern matches: the server doesn't take it.
 */
export function mediaLimit(types: MediaTypes, type: string): MediaLimit | undefined {
	const exact = (type.split(';')[0].trim() || 'application/octet-stream').toLowerCase();
	for (const pattern of [exact, `${exact.split('/')[0]}/*`, '*/*']) {
		if (Object.hasOwn(types, pattern)) return types[pattern];
	}
	return undefined;
}

/** The VAPID public key (base64url) of the server's `webpush` push kind (§4.9), if it offers one. */
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
