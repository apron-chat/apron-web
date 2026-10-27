import { memorySocket, type MemoryHost, type MemorySocket } from '$lib/preview/memory-socket';
import type { WebSocketFactory } from '$lib/protocol/client-types';
import { compareLogIds } from '$lib/protocol/reducer';
import { cloneJson, isJsonObject, isLogId, type Identity, type JsonObject, type MessageRecord, type WireFrame } from '$lib/protocol/types';
import type { Archive, ArchiveRoom } from './archive';

/** What it advertises (§3.1): enough to list and read, nothing to write with. */
export const ARCHIVE_CAPABILITIES = ['history', 'rooms', 'reactions', 'ext', 'ext:settings', 'ext:permissions', 'ext:media'];

/** Who is reading an export that was made signed out. */
const VIEWER: Identity = { user_id: 'archive_viewer', name: 'Viewer' };

/** The most changes one `history` page holds. */
const PAGE_LIMIT = 200;

type Kind = 'rooms' | 'messages' | 'reactions' | 'memberships';

/** One record of a room's log, as `history` sends it. */
interface Entry {
	log_id: string;
	kind: Kind;
	record: JsonObject;
}

/**
 * A server in this page that serves one export (`parseArchive`) read-only:
 * it signs anyone in as a guest, as the export's `you` allowed only to
 * read (`ext:permissions` `write: false`), lists the
 * export's rooms with `room_list`, pages each room's records with `history`,
 * and refuses every request that would change anything. Media loads from the
 * origins the export names (`ext:media`). It owns no network connection or
 * storage.
 */
export class ArchiveServer {
	private readonly rooms = new Map<string, ArchiveRoom>();
	/** Each room's log, ascending by `log_id`. */
	private readonly logs = new Map<string, Entry[]>();
	/** Every message, for the `reply_to` snapshots `history` embeds (§3.5.4). */
	private readonly messages = new Map<string, MessageRecord>();
	private readonly users = new Map<string, Identity>();

	constructor(private readonly archive: Archive) {
		for (const user of archive.users) this.users.set(user.user_id, user);
		for (const room of archive.rooms) {
			this.rooms.set(room.record.room_id, room);
			this.logs.set(room.record.room_id, []);
		}
		for (const message of archive.messages) {
			const kept = this.messages.get(message.message_id);
			if (!kept || compareLogIds(message.log_id, kept.log_id) > 0) this.messages.set(message.message_id, message);
		}
		for (const message of this.messages.values()) this.log(message.room_id, 'messages', message);
		const reactions = new Map<string, JsonObject & { reactions: JsonObject[] }>();
		for (const set of archive.reactions) {
			const room = this.messages.get(set.message_id)?.room_id ?? set.room_id;
			if (room === undefined) continue;
			const key = `${set.message_id}\n${set.log_id}`;
			const record = reactions.get(key) ?? { log_id: set.log_id, message_id: set.message_id, room_id: room, reactions: [] };
			record.reactions.push({ from: set.from, emojis: set.emojis });
			reactions.set(key, record);
		}
		for (const record of reactions.values()) this.log(String(record.room_id), 'reactions', record);
		const memberships = new Map<string, JsonObject & { members: JsonObject[] }>();
		for (const entry of archive.memberships) {
			const key = `${entry.room_id}\n${entry.log_id}`;
			const record = memberships.get(key) ?? { log_id: entry.log_id, room_id: entry.room_id, members: [] };
			record.members.push({ user: entry.user, joined: entry.joined });
			memberships.set(key, record);
		}
		for (const record of memberships.values()) this.log(String(record.room_id), 'memberships', record);
		for (const [id, log] of this.logs) {
			const room = this.rooms.get(id)!;
			// Every room record carries `log_id` with capability `history` (§4.3.3): one exported without gets the position
			// before its room's first record, since no two records share one.
			if (room.record.log_id === undefined) {
				const first = Math.min(...log.map((entry) => Number(entry.log_id)));
				room.record = { ...room.record, log_id: String(Number.isFinite(first) && first > 1 ? first - 1 : 1) };
			}
			log.push({ log_id: room.record.log_id!, kind: 'rooms', record: room.record });
			log.sort((a, b) => compareLogIds(a.log_id, b.log_id));
		}
	}

	factory: WebSocketFactory = (url) => memorySocket(url, this.host);

	private host: MemoryHost = {
		opened: (socket) => {
			const settings = { read_cursors: false };
			socket.deliver({ method: 'server', params: { apron: 9, agent: 'apron-archive', auth: ['guest'], capabilities: ARCHIVE_CAPABILITIES, ext: { settings, media: { origins: this.archive.media } } } });
		},
		received: (socket, frame) => this.receive(socket, frame),
		closed: () => undefined
	};

	/** Adds a record to its room's log, if the export has that room. */
	private log(roomId: string, kind: Kind, record: JsonObject): void {
		const log = this.logs.get(roomId);
		if (log && isLogId(record.log_id)) log.push({ log_id: record.log_id, kind, record });
	}

	private receive(socket: MemorySocket, frame: WireFrame): void {
		if (frame.method === 'ping') {
			socket.deliver({ method: 'pong' });
			return;
		}
		// Notifications (`activity`, `status` without an id) go nowhere: no one else is here.
		if (!frame.id) return;
		const reply = (result: JsonObject) => socket.deliver({ id: frame.id, result });
		const fail = (code: number, message: string) => socket.deliver({ id: frame.id, error: { code, message } });
		const params = frame.params ?? {};
		switch (frame.method) {
			case 'auth':
				// A guest, never a token: the client reads it as a guest who only reads.
				reply({ you: readOnly(this.archive.you ?? VIEWER) });
				return;
			case 'room_list':
				reply(this.listRooms(params));
				return;
			case 'history': {
				const room = typeof params.room_id === 'string' ? this.logs.get(params.room_id) : undefined;
				if (!room) fail(-32602, 'This export has no such room.');
				else reply(this.history(room, params));
				return;
			}
			default:
				fail(-32001, 'This is a read-only export: nothing in it can change.');
		}
	}

	/** `room_list` (§4.2.1): the export's rooms, as joined as they were, the most recently active first. */
	private listRooms(params: JsonObject): JsonObject {
		const parent = typeof params.parent_room_id === 'string' ? params.parent_room_id : undefined;
		const exact = typeof params.room_id === 'string' ? params.room_id : undefined;
		const withMembers = params.members === true;
		const matching = [...this.rooms.values()]
			.filter((room) => exact !== undefined ? room.record.room_id === exact : parent !== undefined ? room.record.parent_room_id === parent : true)
			.sort((a, b) => compareLogIds(this.latest(b), this.latest(a)));
		const listed = (rooms: ArchiveRoom[]) => rooms.map((room) => this.listing(room, withMembers));
		const joined = listed(matching.filter((room) => room.joined));
		// Without `parent_room_id` or `room_id`, `not_joined` holds top-level rooms only.
		const notJoined = listed(matching.filter((room) => !room.joined && (exact !== undefined || parent !== undefined || room.record.parent_room_id === undefined)));
		const users = withMembers ? { users: [...new Set(matching.flatMap((room) => this.membersOf(room)))].map((id) => this.users.get(id) ?? { user_id: id }) } : {};
		if (params.filter === 'joined') return { joined, ...users };
		if (params.filter === 'not_joined') return { not_joined: notJoined, ...users };
		return { joined, not_joined: notJoined, ...users };
	}

	private listing(room: ArchiveRoom, withMembers: boolean): JsonObject {
		const log = this.logs.get(room.record.room_id)!;
		return {
			...room.record,
			latest_log_id: this.latest(room),
			history_log_id: log[0]?.log_id ?? null,
			...(withMembers ? { members: this.membersOf(room).map((user_id) => ({ user_id })) } : {})
		};
	}

	private latest(room: ArchiveRoom): string {
		return this.logs.get(room.record.room_id)!.at(-1)?.log_id ?? room.record.log_id!;
	}

	/** Who had joined: as the export listed them, else as its memberships leave them. */
	private membersOf(room: ArchiveRoom): string[] {
		if (room.members) return room.members;
		const joined = new Map<string, boolean>();
		for (const entry of this.archive.memberships) if (entry.room_id === room.record.room_id) joined.set(entry.user.user_id, entry.joined);
		return [...joined].filter(([, member]) => member).map(([id]) => id);
	}

	/** `history` (§4.3.2): a slice of the room's log, the oldest from `after`, else the newest up to `before`. */
	private history(log: Entry[], params: JsonObject): JsonObject {
		const after = isLogId(params.after) ? params.after : undefined;
		const before = isLogId(params.before) ? params.before : undefined;
		const limit = Math.max(1, Math.min(Math.floor(Number(params.limit)) || PAGE_LIMIT, PAGE_LIMIT));
		const matches = log.filter((entry) => (after === undefined || compareLogIds(entry.log_id, after) >= 0) && (before === undefined || compareLogIds(entry.log_id, before) <= 0));
		const page = after !== undefined ? matches.slice(0, limit) : matches.slice(-limit);
		const result: JsonObject & Record<Kind, JsonObject[]> = { rooms: [], messages: [], reactions: [], memberships: [] };
		for (const entry of page) result[entry.kind].push(entry.kind === 'messages' ? this.withReply(entry.record as MessageRecord) : entry.record);
		return {
			...result,
			more: matches.length > page.length,
			...(page.length ? { first_log_id: page[0].log_id, last_log_id: page.at(-1)!.log_id } : {}),
			latest_log_id: log.at(-1)!.log_id,
			history_log_id: log[0].log_id
		};
	}

	/** A message with the snapshot it replies to embedded, when the export has it, so a quote shows from any room. */
	private withReply(message: MessageRecord): JsonObject {
		const target = message.reply_to ? this.messages.get(message.reply_to.message_id) : undefined;
		return target && target.message_id !== message.message_id ? { ...message, reply_to: target } : message;
	}
}

/** `you` as this server signs one in: allowed only to read (`ext:permissions` `write: false`). */
function readOnly(you: Identity): Identity {
	const ext = isJsonObject(you.ext) ? you.ext : {};
	return { ...cloneJson(you), ext: { ...cloneJson(ext), permissions: { write: false, add_members: false, move_any: false } } };
}
