/**
 * An archive (ARCHIVE.md): what this client has stored from one server, as
 * JSON Lines. A header, then lines that each hold the arrays of a `room_list`
 * result (`joined`, `not_joined`, `users`) or of a `history` result (`rooms`,
 * `messages`, `reactions`, `memberships`), so a line reads like the wire.
 * `ArchiveServer` serves one back, read-only.
 *
 * ```jsonl
 * {"apron_archive":1,"server":"wss://chat.example/","exported_at":"2026-10-27T12:00:00.000Z","you":{…},"media":["https://chat.example"]}
 * {"joined":[{"room_id":"general","log_id":"…","latest_log_id":"…","history_log_id":"…","members":[{"user_id":"ada"}]}],"not_joined":[],"users":[{"user_id":"ada","name":"Ada"}]}
 * {"messages":[{"message_id":"…","log_id":"…","room_id":"general","from":{…},"body":{…}}]}
 * {"reactions":[{"log_id":"…","message_id":"…","room_id":"general","reactions":[{"from":{…},"emojis":["👍"]}]}]}
 * {"memberships":[{"log_id":"…","room_id":"general","members":[{"user":{…},"joined":true}]}]}
 * ```
 *
 * This client writes the listing, then one record per line in `log_id`
 * order, compacted as it keeps them (§4.3.4). An archive is untrusted when it
 * is read back: every record goes through the same decoders as a server's.
 */
import type { ClientSnapshot, RoomSync } from '$lib/protocol/client-types';
import { serverMedia } from '$lib/protocol/client-views';
import { serverOrigin } from '$lib/protocol/embeds';
import { compareLogIds, type StoredRecords } from '$lib/protocol/reducer';
import {
	cloneJson,
	decodeMembership,
	decodeMessage,
	decodeReactions,
	decodeRoom,
	isIdentity,
	isJsonObject,
	type Identity,
	type JsonObject,
	type MembershipEntry,
	type MessageRecord,
	type ReactionSet,
	type RoomRecord
} from '$lib/protocol/types';

/** The format's version, in the header's `apron_archive` (ARCHIVE.md §2): an archive of a later one isn't read. */
export const ARCHIVE_VERSION = 1;

/** A room an archive lists (ARCHIVE.md §3.1): its record, whether you had joined it, and its listing's fields. */
export interface ArchiveRoom {
	record: RoomRecord;
	joined: boolean;
	/** Its `latest_log_id` when it was saved. */
	latest?: string;
	/** Its `history_log_id`: where the archive's stretch of its log starts. Null: it holds none; absent: from its oldest record. */
	history?: string | null;
	/** The `user_id`s of its members, when they were listed. */
	members?: string[];
	memberCount?: number;
}

/** An archive, read back (`parseArchive`). */
export interface Archive {
	/** The server it was saved from, as the client named it (a WebSocket URL). */
	server: string;
	/** When, as an ISO 8601 time. */
	exportedAt: string;
	/** Who it was saved as, if signed in. */
	you?: Identity;
	/** Origins its media loads from (`ext:media`, EXT.md §6): the server's own, and those it named. */
	media: string[];
	users: Identity[];
	/** The rooms it lists, each once: a later listing of a room replaces an earlier one. */
	rooms: ArchiveRoom[];
	/** Logged room records (a `history` result's `rooms`). */
	roomRecords: RoomRecord[];
	messages: MessageRecord[];
	reactions: ReactionSet[];
	memberships: MembershipEntry[];
	/** Lines, and records in them, that weren't valid or that this version doesn't know: left out. */
	skipped: number;
}

/** An archive ready to save. */
export interface ArchiveFile {
	name: string;
	text: string;
	rooms: number;
	messages: number;
	/** The private rooms left out (`privateRooms` false), threads in them not counted. */
	privateLeftOut: number;
}

export interface ExportOptions {
	/** When it was saved: now, unless said. */
	now?: Date;
	/**
	 * Private rooms (§4.2.4) and the threads in them go too. Without, they and their records are left out, and so is
	 * anyone known only from them.
	 */
	privateRooms?: boolean;
}

/** Why a file couldn't be read as an archive, in words to show. */
export class ArchiveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ArchiveError';
	}
}

/**
 * The archive of what a client stored from `url`: the rooms it shows and the rooms those are threads of, each
 * with where its unbroken stretch of records starts (`syncs`, ARCHIVE.md §3.1), and the records in those
 * stretches. A message outside them goes only when a message in them replies to it. Statuses aren't kept:
 * they are about now. Private rooms go only with `privateRooms`.
 */
export function exportArchive(url: string, snapshot: ClientSnapshot, stored: StoredRecords, syncs: readonly RoomSync[], options: ExportOptions = {}): ArchiveFile {
	const { now = new Date(), privateRooms = true } = options;
	const records = new Map(stored.rooms.map((record) => [record.room_id, record]));
	const shown = new Map(snapshot.rooms.map((room) => [room.id, room]));
	const sync = new Map(syncs.map((room) => [room.id, room]));
	const recordOf = (id: string): RoomRecord => records.get(id) ?? shown.get(id)?.record ?? { room_id: id };
	const listed = new Set(shown.keys());
	for (const id of [...listed]) {
		for (let parent = recordOf(id).parent_room_id; parent !== undefined && !listed.has(parent); parent = recordOf(parent).parent_room_id) listed.add(parent);
	}
	// A private room, and a thread in one: a thread is as private as the room it is in.
	const isPrivate = (id: string): boolean => {
		for (let at: string | undefined = id, depth = 0; at !== undefined && depth < 64; at = recordOf(at).parent_room_id, depth++) {
			if (recordOf(at).private === true || shown.get(at)?.private === true) return true;
		}
		return false;
	};
	let privateLeftOut = 0;
	if (!privateRooms) {
		for (const id of [...listed]) {
			if (!isPrivate(id)) continue;
			listed.delete(id);
			if (recordOf(id).parent_room_id === undefined) privateLeftOut++;
		}
	}
	// Without capability `history` there is no lower bound to give: what arrived live is all there is.
	const paged = snapshot.capabilities.history;
	const starts = new Map([...listed].map((id) => [id, paged ? stretchStart(sync.get(id)) : undefined]));
	const within = (room: string, log: string) => {
		if (!listed.has(room)) return false;
		const start = starts.get(room);
		return start === undefined || (start !== null && compareLogIds(log, start) >= 0);
	};

	const kept = stored.messages.filter((message) => within(message.room_id, message.log_id));
	const keptIds = new Set(kept.map((message) => message.message_id));
	const replied = new Set(kept.flatMap((message) => (message.reply_to ? [message.reply_to.message_id] : [])));
	// A reply's message goes with it, but not out of a room left out.
	const references = stored.messages.filter((message) => !keptIds.has(message.message_id) && replied.has(message.message_id) && (privateRooms || !isPrivate(message.room_id)));
	const homes = new Map(kept.map((message) => [message.message_id, message.room_id]));
	/** Everyone the rooms that go show: you, their members, and who wrote, reacted or came and went in them. */
	const seen = new Set<string>([
		...(snapshot.you ? [snapshot.you.user_id] : []),
		...[...listed].flatMap((id) => shown.get(id)?.members?.map((member) => member.user_id) ?? []),
		...[...references, ...kept].map((message) => message.from.user_id),
		...stored.reactions.filter((set) => homes.has(set.message_id) && within(homes.get(set.message_id)!, set.log_id)).map((set) => set.from.user_id),
		...stored.memberships.filter((entry) => within(entry.room_id, entry.log_id)).map((entry) => entry.user.user_id)
	]);

	const lines: string[] = [];
	const origins = [serverOrigin(url), ...serverMedia(snapshot.server).origins].filter((origin): origin is string => origin !== undefined);
	lines.push(JSON.stringify({ apron_archive: ARCHIVE_VERSION, server: url, exported_at: now.toISOString(), ...(snapshot.you ? { you: withoutStatus(snapshot.you) } : {}), media: [...new Set(origins)] }));
	const listing = (id: string): JsonObject => {
		const room = shown.get(id);
		const start = starts.get(id);
		const latest = sync.get(id)?.latestLogId ?? room?.latestLogId;
		return {
			...recordOf(id),
			...(latest !== undefined ? { latest_log_id: latest } : {}),
			...(start !== undefined ? { history_log_id: start } : {}),
			...(room?.members ? { members: room.members.map((member) => ({ user_id: member.user_id })) } : {})
		};
	};
	const rooms = [...listed];
	lines.push(JSON.stringify({
		joined: rooms.filter((id) => shown.get(id)?.joined).map(listing),
		not_joined: rooms.filter((id) => !shown.get(id)?.joined).map(listing),
		users: Object.values(snapshot.users).filter((user) => privateRooms || seen.has(user.user_id)).map(withoutStatus)
	}));

	// The records, one per line, in `log_id` order.
	const logged: Array<{ log_id: string; line: JsonObject }> = [...references, ...kept].map((message) => ({ log_id: message.log_id, line: { messages: [message] } }));
	const sets = new Map<string, ReactionSet[]>();
	for (const set of stored.reactions) {
		const room = homes.get(set.message_id);
		if (room === undefined || set.emojis.length === 0 || !within(room, set.log_id)) continue;
		sets.set(set.message_id, [...(sets.get(set.message_id) ?? []), set]);
	}
	for (const [message_id, folded] of sets) {
		const log_id = folded.map((set) => set.log_id).reduce((a, b) => (compareLogIds(a, b) >= 0 ? a : b));
		logged.push({ log_id, line: { reactions: [{ log_id, message_id, room_id: homes.get(message_id)!, reactions: folded.map((set) => ({ from: set.from, emojis: set.emojis })) }] } });
	}
	const memberships = new Map<string, { log_id: string; room_id: string; members: JsonObject[] }>();
	for (const entry of stored.memberships) {
		if (!within(entry.room_id, entry.log_id)) continue;
		const key = `${entry.room_id}\n${entry.log_id}`;
		const record = memberships.get(key) ?? { log_id: entry.log_id, room_id: entry.room_id, members: [] };
		record.members.push({ user: entry.user, joined: entry.joined });
		memberships.set(key, record);
	}
	for (const membership of memberships.values()) logged.push({ log_id: membership.log_id, line: { memberships: [membership] } });
	logged.sort((a, b) => compareLogIds(a.log_id, b.log_id));
	for (const { line } of logged) lines.push(JSON.stringify(line));

	return { name: archiveFileName(url, now), text: lines.join('\n') + '\n', rooms: listed.size, messages: kept.length, privateLeftOut };
}

/**
 * Where a room's unbroken stretch of stored records starts: the oldest page it holds (`olderBefore`), or its
 * retention floor if that is later. Null when it holds no page: what arrived live may have gaps.
 */
function stretchStart(sync: RoomSync | undefined): string | null {
	if (sync?.olderBefore === undefined) return null;
	return sync.floor !== undefined && compareLogIds(sync.floor, sync.olderBefore) > 0 ? sync.floor : sync.olderBefore;
}

/** `apron-chat.example-2026-10-27.jsonl`: the server's host and the day, in UTC. */
export function archiveFileName(url: string, when: Date): string {
	let host = '';
	try {
		host = new URL(url).host;
	} catch {
		// Not a URL: the name goes without it.
	}
	const safe = host.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
	return `apron-${safe ? `${safe}-` : ''}${when.toISOString().slice(0, 10)}.jsonl`;
}

/** Reads an archive (ARCHIVE.md). Throws `ArchiveError` when it isn't one this version reads. */
export function parseArchive(text: string): Archive {
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
	const header = parseLine(lines[0] ?? '');
	if (!header || !Object.hasOwn(header, 'apron_archive')) throw new ArchiveError('This file isn’t an Apron export.');
	if (header.apron_archive !== ARCHIVE_VERSION) throw new ArchiveError('This export is from a newer version of Apron, which this one can’t read.');
	const archive: Archive = {
		server: typeof header.server === 'string' ? header.server : '',
		exportedAt: typeof header.exported_at === 'string' ? header.exported_at : '',
		...(isIdentity(header.you) ? { you: withoutStatus(cloneJson(header.you)) } : {}),
		media: Array.isArray(header.media) ? header.media.filter((origin): origin is string => typeof origin === 'string') : [],
		users: [], rooms: [], roomRecords: [], messages: [], reactions: [], memberships: [], skipped: 0
	};
	const rooms = new Map<string, ArchiveRoom>();
	const users = new Map<string, Identity>();
	/** Each element of `line[key]`, when it is an array; a line without any known key is skipped. */
	const each = (line: JsonObject, key: string, read: (value: unknown) => boolean): boolean => {
		const values = line[key];
		if (!Array.isArray(values)) return false;
		for (const value of values) if (!read(value)) archive.skipped++;
		return true;
	};
	const listed = (joined: boolean) => (value: unknown) => {
		const room = decodeRoom(value);
		if (!room) return false;
		const { delivery } = room;
		rooms.set(room.record.room_id, {
			record: room.record,
			joined,
			...(delivery.latest_log_id !== undefined ? { latest: delivery.latest_log_id } : {}),
			...(delivery.history_log_id !== undefined ? { history: delivery.history_log_id } : {}),
			...(delivery.members ? { members: delivery.members.map((member) => member.user_id) } : {}),
			...(delivery.member_count !== undefined ? { memberCount: delivery.member_count } : {})
		});
		return true;
	};
	for (const text of lines.slice(1)) {
		const line = parseLine(text);
		if (!line) {
			archive.skipped++;
			continue;
		}
		const read = [
			each(line, 'joined', listed(true)),
			each(line, 'not_joined', listed(false)),
			each(line, 'users', (value) => {
				if (!isIdentity(value)) return false;
				users.set(value.user_id, withoutStatus(cloneJson(value)));
				return true;
			}),
			each(line, 'rooms', (value) => {
				const record = decodeRoom(value)?.record;
				if (record?.log_id === undefined) return false;
				archive.roomRecords.push(record);
				return true;
			}),
			each(line, 'messages', (value) => {
				const message = decodeMessage(value);
				if (message) archive.messages.push(message.record, ...message.embedded);
				return Boolean(message);
			}),
			each(line, 'reactions', (value) => {
				const sets = decodeReactions(value);
				archive.reactions.push(...sets);
				return sets.length > 0;
			}),
			each(line, 'memberships', (value) => {
				const entries = decodeMembership(value);
				archive.memberships.push(...entries);
				return entries.length > 0;
			})
		];
		if (!read.includes(true)) archive.skipped++;
	}
	archive.rooms = [...rooms.values()];
	archive.users = [...users.values()];
	return archive;
}

function parseLine(text: string): JsonObject | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return isJsonObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/** A user object without `status` and `seen` (§4.5), which are about the moment it was kept. */
function withoutStatus(user: Identity): Identity {
	const { status: _status, seen: _seen, ...rest } = user;
	return rest as Identity;
}
