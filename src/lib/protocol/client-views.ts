/** Pure helpers over client snapshots, capabilities, and server URLs. */
import { parseOrigins, safeAvatar, serverOrigin } from './embeds';
import { cleanPlainText, withoutBidiOverrides } from './plain-text';
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

const CAPABILITIES: Capability[] = ['history', 'edit', 'rooms', 'reactions', 'activity', 'embed:upload', 'embed:stream', 'command', 'status', 'ext', 'ext:settings', 'ext:limits', 'ext:media', 'ext:permissions', 'ext:bio', 'ext:archive'];

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
 * The server's settings (extension `ext:settings`, `server.ext.settings`):
 * `read_cursors` is `true` unless the server says `false`, also without the
 * extension; `private_rooms` only as a count. A value of the wrong type takes
 * its default.
 */
export function serverSettings(server: ServerParams | undefined): { read_cursors: boolean; private_rooms?: number } {
	const ext = hasCapability(server, 'ext:settings') ? server?.ext : undefined;
	const settings = isJsonObject(ext) && isJsonObject(ext.settings) ? ext.settings : {};
	// The most private rooms one user may be a member of. Absent (or not a count) states no limit.
	const limit = settings.private_rooms;
	return {
		read_cursors: settings.read_cursors !== false,
		...(typeof limit === 'number' && Number.isInteger(limit) && limit >= 0 ? { private_rooms: limit } : {})
	};
}

/**
 * What an archive's server says of it (`ext:archive`, ARCHIVE.md §4.1): the server it was saved from and when.
 * Undefined from any other server.
 */
export function serverArchive(server: ServerParams | undefined): { server?: string; exportedAt?: string } | undefined {
	const ext = hasCapability(server, 'ext:archive') ? server?.ext : undefined;
	if (!isJsonObject(ext) || !isJsonObject(ext.archive)) return undefined;
	const { server: from, exported_at: at } = ext.archive;
	return { ...(typeof from === 'string' ? { server: from } : {}), ...(typeof at === 'string' ? { exportedAt: at } : {}) };
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
	// Shown, so without bidi embeddings and overrides (§3.5.2).
	return names.map(withoutBidiOverrides).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b)).join(', ');
}

/** What the client offers the signed-in user (`ext:permissions`, `you.ext.permissions`). */
export interface Permissions {
	/** May send the requests of `ext:limits`' `write` row: post, react, join, leave, and change rooms. */
	write: boolean;
	/** Offer adding other users to any room (`room_join` with a `user_id`); without it, only to the private rooms they are a member of. */
	add_members: boolean;
	/** May move other users' messages; without it, only their own. */
	move_any: boolean;
}

/** The extension's defaults, for each key that is absent. */
const DEFAULT_PERMISSIONS: Permissions = { write: true, add_members: false, move_any: false };

/**
 * Without the extension: what PROTOCOL.md allows. Any member may ask to add
 * others to any room (§4.2.2), and the server answers `denied` or
 * `unsupported` where it doesn't let them; moves stay with your own
 * messages.
 */
const CORE_PERMISSIONS: Permissions = { write: true, add_members: true, move_any: false };

/**
 * What the signed-in user may do that the core leaves to the server
 * (extension `ext:permissions`, `you.ext.permissions`), read from `you`
 * only. Each key that is absent or not a boolean takes its default (`write`
 * on, the rest off); so does every key when `permissions` isn't an object.
 * Without the extension the client offers what PROTOCOL.md allows instead
 * (CORE_PERMISSIONS), and handles the server's refusals.
 */
export function yourPermissions(server: ServerParams | undefined, you: Identity | undefined): Permissions {
	if (!hasCapability(server, 'ext:permissions')) return { ...CORE_PERMISSIONS };
	const ext = you?.ext;
	const granted = isJsonObject(ext) && isJsonObject(ext.permissions) ? ext.permissions : {};
	const flag = (key: keyof Permissions) => (typeof granted[key] === 'boolean' ? (granted[key] as boolean) : DEFAULT_PERMISSIONS[key]);
	return { write: flag('write'), add_members: flag('add_members'), move_any: flag('move_any') };
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

/** How a server shows itself (§3.1), where people pick it or sign in to it, always beside its address. */
export interface ServerLook {
	/** Its `title`, plain text; absent without one, when clients show its address. */
	title?: string;
	/** Its `description`, CommonMark. */
	description?: string;
	/** Its `avatar`, where the client loads it as a user's (§4.8.6): `https:`, a small image data URL, or its own origin. */
	avatar?: string;
}

/**
 * How the server at `url` shows itself, from its `server` frame (§3.1): each
 * field only as a non-blank string, as shown, without bidi embeddings and
 * overrides (§3.5.2), and the avatar only from a source that avatars load
 * from. A server is never known by these (§1).
 */
export function serverLook(server: ServerParams | undefined, url: string | undefined): ServerLook {
	const text = (value: unknown) => {
		const shown = typeof value === 'string' ? withoutBidiOverrides(value).trim() : '';
		return shown || undefined;
	};
	const title = text(server?.title);
	const description = text(server?.description);
	const avatar = safeAvatar(server?.avatar, url ? serverOrigin(url) : undefined);
	return { ...(title ? { title } : {}), ...(description ? { description } : {}), ...(avatar ? { avatar } : {}) };
}

/** What a server takes of one type of file (`ext:media`): the largest file, and the longest image side it keeps. */
export interface MediaLimit {
	max_bytes?: number;
	max_side?: number;
}

/** A category of files (`ext:media` `upload`, `avatar` or `emoji`): each MIME pattern it takes (`type/subtype`, `type/*`, `*\/*`), with its limits. */
export type MediaTypes = Record<string, MediaLimit>;

/** What a server says about media (`ext:media`): origins besides its own, and the files it takes, by category. */
export interface ServerMedia {
	/** Where embed media may also load from: exact `https:` origins, or `http:` ones on localhost. */
	origins: string[];
	/** Message attachments (§4.8.4). Absent: nothing is known. */
	upload?: MediaTypes;
	/** `/avatar` (§4.8.6). Absent: nothing is known. */
	avatar?: MediaTypes;
	/** Custom emoji images, as `/emoji add` takes them (`ext:emoji`). Absent: nothing is known. */
	emoji?: MediaTypes;
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
	const emoji = mediaTypes(media.emoji);
	return { origins: parseOrigins(media.origins), ...(upload ? { upload } : {}), ...(avatar ? { avatar } : {}), ...(emoji ? { emoji } : {}) };
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

/**
 * A server's address as clients compare it (§1): the URI normalized by RFC
 * 3986 §6.2.2 and §6.2.3. The scheme and host are lowercased, a default port
 * dropped (`80` for `ws:`, `443` for `wss:`), an empty path is `/`, dot
 * segments go, percent-encoded unreserved characters are decoded and the
 * rest's hex digits uppercased. A fragment goes too: it names nothing on the
 * server, and a WebSocket URL can't carry one. `ws:` and `wss:` stay apart.
 * Throws on a value that isn't a URL.
 */
export function serverAddress(value: string): string {
	// WHATWG URL does the case, the port, the empty path and the dot segments for `ws:` and `wss:`.
	const url = new URL(value);
	const percent = (part: string) => part.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => {
		const char = String.fromCharCode(parseInt(hex, 16));
		return /^[A-Za-z0-9._~-]$/.test(char) ? char : `%${hex.toUpperCase()}`;
	});
	url.pathname = percent(url.pathname);
	if (url.search) url.search = percent(url.search);
	url.hash = '';
	return url.toString();
}

/** Whether two addresses are the same server (§1), compared normalized (`serverAddress`); never by title or avatar. */
export function sameServer(a: string | undefined, b: string | undefined): boolean {
	if (a === undefined || b === undefined) return false;
	try {
		return serverAddress(a) === serverAddress(b);
	} catch {
		return a === b;
	}
}

/** What the user typed for a server, as its address (`serverAddress`): a WebSocket URL, an HTTP(S) base URL, a path on this host, or a bare host. */
export function normalizeWebSocketUrl(input: string, locationLike?: Location): string {
	const value = input.trim();
	if (!value) return serverAddress(defaultWebSocketUrl(locationLike));
	// Schemes are case-insensitive (RFC 3986 §3.1).
	if (/^wss?:\/\//i.test(value)) return serverAddress(value);
	if (/^https?:\/\//i.test(value)) return serverAddress(value.replace(/^http/i, 'ws'));
	if (value.startsWith('/')) {
		const base = locationLike ? `${locationLike.protocol === 'https:' ? 'wss:' : 'ws:'}//${locationLike.host}` : 'ws://localhost:5173';
		return serverAddress(`${base}${value}`);
	}
	return serverAddress(`ws://${value}`);
}
