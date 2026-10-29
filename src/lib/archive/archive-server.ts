import { memorySocket, type MemoryHost, type MemorySocket } from '$lib/preview/memory-socket';
import type { WebSocketFactory } from '$lib/protocol/client-types';
import { historyResult, pageQuery, sliceLog, type LogEntry } from '$lib/history/log';
import { compareLogIds } from '$lib/protocol/reducer';
import { cloneJson, isJsonObject, type Identity, type JsonObject, type MessageRecord, type RoomRecord, type WireFrame } from '$lib/protocol/types';
import type { Archive, ArchiveRoom } from './archive';

/** What it advertises (ARCHIVE.md §4): enough to list and read, nothing to write with. */
export const ARCHIVE_CAPABILITIES = ['history', 'rooms', 'reactions', 'ext', 'ext:settings', 'ext:permissions', 'ext:media', 'ext:archive'];

/** Requests that would change something (§3–§4): refused, where any other unknown request is `unsupported`. */
const WRITES = new Set(['message', 'reactions', 'room_set', 'room_join', 'room_leave', 'me', 'status', 'command', 'push_register', 'push_unregister']);

/** Who is reading an archive that was saved signed out. */
const VIEWER: Identity = { user_id: 'archive_viewer', name: 'Viewer' };

/** A listed room as it is served: its latest record, and its log from where the archive's stretch starts. */
interface ServedRoom {
	listed: ArchiveRoom;
	record: RoomRecord & { log_id: string };
	/** Ascending by `log_id`, from `bound` on (`$lib/history/log`). */
	log: LogEntry[];
	/** The effective lower bound (§4.3.3): the stretch's start, or past `latest` when it holds none. */
	bound: string;
	latest: string;
}

/**
 * A server in this page that serves one archive (`parseArchive`, ARCHIVE.md §4) read-only: it offers only
 * guest sign-in, as the archive's `you`, allowed only to read (`ext:permissions` `write: false`), so nothing can
 * lift it; lists the archive's rooms with `room_list`; pages each room's stretch of records with `history`, and
 * the joined rooms' together without `room_id`; and refuses every request that would change anything. Media
 * loads from the origins the archive names (`ext:media`). It owns no network connection or storage.
 */
export class ArchiveServer {
	private readonly rooms = new Map<string, ServedRoom>();
	/** Every message's latest snapshot, those outside any stretch included: what `reply_to` embeds (§3.5.4). */
	private readonly messages = new Map<string, MessageRecord>();
	private readonly users = new Map<string, Identity>();

	constructor(private readonly archive: Archive) {
		for (const user of archive.users) this.users.set(user.user_id, user);
		const taken = new Set<string>();
		for (const message of archive.messages) {
			taken.add(message.log_id);
			const kept = this.messages.get(message.message_id);
			if (!kept || compareLogIds(message.log_id, kept.log_id) > 0) this.messages.set(message.message_id, message);
		}
		// Each room's entries, a record at each position once: an archive may repeat one.
		const entries = new Map<string, Map<string, LogEntry>>();
		const add = (room: string | undefined, key: string, entry: LogEntry) => {
			if (room === undefined) return;
			taken.add(entry.log);
			const log = entries.get(room) ?? new Map<string, LogEntry>();
			log.set(`${entry.kind}\n${entry.log}\n${key}`, entry);
			entries.set(room, log);
		};
		for (const record of this.messages.values()) add(record.room_id, record.message_id, { log: record.log_id, kind: 'message', record });
		// A reaction set is in the room its message is in.
		for (const record of archive.reactions) add(this.messages.get(record.message_id)?.room_id ?? record.room_id, `${record.message_id}\n${record.from.user_id}`, { log: record.log_id, kind: 'reaction', record });
		for (const record of archive.memberships) add(record.room_id, record.user.user_id, { log: record.log_id, kind: 'membership', record });
		for (const record of archive.roomRecords) add(record.room_id, '', { log: record.log_id!, kind: 'room', record });
		for (const room of archive.rooms) {
			if (room.record.log_id !== undefined) add(room.record.room_id, '', { log: room.record.log_id, kind: 'room', record: room.record });
		}

		for (const listed of archive.rooms) {
			const id = listed.record.room_id;
			const all = [...(entries.get(id)?.values() ?? [])].sort((a, b) => compareLogIds(a.log, b.log));
			// The room's record: its latest, else one without `log_id`, older than all its records (ARCHIVE.md §3.1).
			const latestRoom = all.findLast((entry) => entry.kind === 'room')?.record as RoomRecord | undefined;
			const record = { ...(latestRoom ?? listed.record), log_id: latestRoom?.log_id ?? this.positionBefore(all[0]?.log ?? listed.latest, taken) };
			const last = [record.log_id, listed.latest, all.at(-1)?.log].filter((log) => log !== undefined).reduce((a, b) => (compareLogIds(a, b) >= 0 ? a : b));
			// Absent `history_log_id`: from its oldest record. Null: none of it.
			const start = listed.history === undefined ? all.find((entry) => entry.kind !== 'room')?.log : listed.history ?? undefined;
			const bound = start ?? String(Number(last) + 1);
			const log = all.filter((entry) => compareLogIds(entry.log, bound) >= 0);
			this.rooms.set(id, { listed, record, log, bound, latest: last });
		}
	}

	/** A position below `log` (or 1) that no record of the archive holds. */
	private positionBefore(log: string | undefined, taken: ReadonlySet<string>): string {
		let position = log === undefined ? 1 : Math.max(1, Number(log) - 1);
		while (taken.has(String(position)) && position > 1) position--;
		return String(position);
	}

	factory: WebSocketFactory = (url) => memorySocket(url, this.host);

	private host: MemoryHost = {
		opened: (socket) => {
			const settings = { read_cursors: false };
			const archive = { ...(this.archive.server ? { server: this.archive.server } : {}), ...(this.archive.exportedAt ? { exported_at: this.archive.exportedAt } : {}) };
			socket.deliver({ method: 'server', params: { apron: 9, agent: 'apron-archive', auth: ['guest'], capabilities: ARCHIVE_CAPABILITIES, ext: { settings, media: { origins: this.archive.media }, archive } } });
		},
		received: (socket, frame) => this.receive(socket, frame),
		closed: () => undefined
	};

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
				if (params.room_id === undefined) {
					reply(this.history(this.joinedLog(), params));
					return;
				}
				const room = typeof params.room_id === 'string' ? this.rooms.get(params.room_id) : undefined;
				if (!room) fail(-32602, 'This archive has no such room.');
				else reply(this.history(room, params));
				return;
			}
			default:
				if (typeof frame.method === 'string' && WRITES.has(frame.method)) fail(-32001, 'This is a read-only archive: nothing in it can change.');
				else fail(-32601, 'Unsupported method');
		}
	}

	/** `room_list` (§4.2.1): the archive's rooms, as joined as they were, the most recently active first. */
	private listRooms(params: JsonObject): JsonObject {
		const parent = typeof params.parent_room_id === 'string' ? params.parent_room_id : undefined;
		const exact = typeof params.room_id === 'string' ? params.room_id : undefined;
		const withMembers = params.members === true;
		const matching = [...this.rooms.values()]
			.filter((room) => exact !== undefined ? room.record.room_id === exact : parent !== undefined ? room.record.parent_room_id === parent : true)
			.sort((a, b) => compareLogIds(b.latest, a.latest));
		const listed = (rooms: ServedRoom[]) => rooms.map((room) => this.listing(room, withMembers));
		const joined = listed(matching.filter((room) => room.listed.joined));
		// Without `parent_room_id` or `room_id`, `not_joined` holds top-level rooms only.
		const notJoined = listed(matching.filter((room) => !room.listed.joined && (exact !== undefined || parent !== undefined || room.record.parent_room_id === undefined)));
		const users = withMembers ? { users: [...new Set(matching.flatMap((room) => this.membersOf(room)))].map((id) => this.users.get(id) ?? { user_id: id }) } : {};
		if (params.filter === 'joined') return { joined, ...users };
		if (params.filter === 'not_joined') return { not_joined: notJoined, ...users };
		return { joined, not_joined: notJoined, ...users };
	}

	private listing(room: ServedRoom, withMembers: boolean): JsonObject {
		return {
			...room.record,
			latest_log_id: room.latest,
			history_log_id: this.historyLogId(room),
			...(withMembers ? { members: this.membersOf(room).map((user_id) => ({ user_id })) } : {}),
			...(withMembers && room.listed.memberCount !== undefined ? { member_count: room.listed.memberCount } : {})
		};
	}

	/** `history_log_id` (§4.3.3): the bound, or null when it is past the latest, as for a room that keeps none. */
	private historyLogId(room: { bound: string; latest: string }): string | null {
		return compareLogIds(room.bound, room.latest) > 0 ? null : room.bound;
	}

	/** Who had joined: as the archive listed them, else as its memberships leave them. */
	private membersOf(room: ServedRoom): string[] {
		if (room.listed.members) return room.listed.members;
		const joined = new Map<string, boolean>();
		for (const entry of this.archive.memberships) if (entry.room_id === room.record.room_id) joined.set(entry.user.user_id, entry.joined);
		return [...joined].filter(([, member]) => member).map(([id]) => id);
	}

	/**
	 * The joined rooms' logs as one (§4.3, without `room_id`), from the greatest of their bounds: below it, one
	 * room's stretch may have started while another's hadn't, and the one log would seem to hold all of both.
	 */
	private joinedLog(): { log: LogEntry[]; bound: string; latest: string } {
		const joined = [...this.rooms.values()].filter((room) => room.listed.joined);
		const latest = joined.map((room) => room.latest).reduce((a, b) => (compareLogIds(a, b) >= 0 ? a : b), '1');
		const bound = joined.map((room) => room.bound).reduce((a, b) => (compareLogIds(a, b) >= 0 ? a : b), '1');
		const log = joined.flatMap((room) => room.log.filter((entry) => compareLogIds(entry.log, bound) >= 0)).sort((a, b) => compareLogIds(a.log, b.log));
		return { log, bound, latest };
	}

	/** `history` (§4.3.2): a slice of a log, the oldest from `after`, else the newest up to `before`. */
	private history(room: { log: LogEntry[]; bound: string; latest: string }, params: JsonObject): JsonObject {
		const { page, more } = sliceLog(room.log, pageQuery(params));
		return historyResult(page, more, { latest: room.latest, history: this.historyLogId(room) }, (message) => this.withReply(message));
	}

	/** A message with the snapshot it replies to embedded, when the archive has it, so a quote shows from any room. */
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
