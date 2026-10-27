/**
 * An export of what this client has stored from one server, as JSON Lines:
 * a header, then one record per line, compacted as the client keeps them
 * (§4.3.4): each room's record, each message's latest snapshot, each
 * message's reaction sets folded into one record, and each room's
 * memberships at each `log_id`. `ArchiveServer` serves one back, read-only.
 *
 * ```jsonl
 * {"apron_export":1,"server":"wss://chat.example/","exported_at":"2026-10-27T12:00:00.000Z","you":{…},"media":["https://chat.example"]}
 * {"user":{"user_id":"ada","name":"Ada"}}
 * {"room":{"room_id":"general","log_id":"…","title":"general"},"joined":true,"members":["ada"]}
 * {"message":{"message_id":"…","log_id":"…","room_id":"general","from":{…},"body":{…}}}
 * {"reactions":{"log_id":"…","message_id":"…","room_id":"general","reactions":[{"from":{…},"emojis":["👍"]}]}}
 * {"membership":{"log_id":"…","room_id":"general","members":[{"user":{…},"joined":true}]}}
 * ```
 *
 * Users, then rooms, then the records in `log_id` order. Each record line is
 * the record as a server would send it (§2.3), so a line reads like the wire.
 * An export is untrusted when it is read back: every line goes through the
 * same decoders as a server's frames.
 */
import type { ClientSnapshot } from '$lib/protocol/client-types';
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
	isOpaqueId,
	type Identity,
	type JsonObject,
	type MembershipEntry,
	type MessageRecord,
	type ReactionSet,
	type RoomRecord
} from '$lib/protocol/types';

/** The format's version, in the header's `apron_export`: an export of a later one isn't read. */
export const ARCHIVE_VERSION = 1;

/** A room as an export keeps it: its record, whether you had joined it, and who had. */
export interface ArchiveRoom {
	record: RoomRecord;
	joined: boolean;
	/** The `user_id`s of its members, when they were known. */
	members?: string[];
}

/** An export, read back (`parseArchive`). */
export interface Archive {
	/** The server it was exported from, as the client named it (a WebSocket URL). */
	server: string;
	/** When, as an ISO 8601 time. */
	exportedAt: string;
	/** Who it was exported as, if signed in. */
	you?: Identity;
	/** Origins its media loads from (`ext:media`, EXT.md §6): the server's own, and those it named. */
	media: string[];
	users: Identity[];
	rooms: ArchiveRoom[];
	messages: MessageRecord[];
	reactions: ReactionSet[];
	memberships: MembershipEntry[];
	/** Lines that weren't a record this version knows, or weren't valid: left out. */
	skipped: number;
}

/** An export ready to save. */
export interface ArchiveFile {
	name: string;
	text: string;
	rooms: number;
	messages: number;
}

/** Why a file couldn't be read as an export, in words to show. */
export class ArchiveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ArchiveError';
	}
}

/**
 * The export of what a client stored from `url`: the rooms it shows, any
 * other room a stored message is in, and the rooms those are threads of, with
 * every stored record of theirs. Statuses aren't kept: they are about now.
 */
export function exportArchive(url: string, snapshot: ClientSnapshot, stored: StoredRecords, now = new Date()): ArchiveFile {
	const records = new Map(stored.rooms.map((record) => [record.room_id, record]));
	const shown = new Map(snapshot.rooms.map((room) => [room.id, room]));
	const recordOf = (id: string): RoomRecord => records.get(id) ?? shown.get(id)?.record ?? { room_id: id };
	const included = new Set([...shown.keys(), ...stored.messages.map((message) => message.room_id)]);
	for (const id of [...included]) {
		for (let parent = recordOf(id).parent_room_id; parent !== undefined && !included.has(parent); parent = recordOf(parent).parent_room_id) included.add(parent);
	}
	const homes = new Map(stored.messages.map((message) => [message.message_id, message.room_id]));

	const lines: string[] = [];
	const origins = [serverOrigin(url), ...serverMedia(snapshot.server).origins].filter((origin): origin is string => origin !== undefined);
	lines.push(JSON.stringify({ apron_export: ARCHIVE_VERSION, server: url, exported_at: now.toISOString(), ...(snapshot.you ? { you: withoutStatus(snapshot.you) } : {}), media: [...new Set(origins)] }));
	for (const user of Object.values(snapshot.users)) lines.push(JSON.stringify({ user: withoutStatus(user) }));
	for (const id of included) {
		const room = shown.get(id);
		const members = room?.members?.map((member) => member.user_id);
		lines.push(JSON.stringify({ room: recordOf(id), joined: room?.joined ?? false, ...(members ? { members } : {}) }));
	}

	// The records, each as one wire record, in `log_id` order.
	const logged: Array<{ log_id: string; line: JsonObject }> = stored.messages.map((message) => ({ log_id: message.log_id, line: { message } }));
	const sets = new Map<string, ReactionSet[]>();
	for (const set of stored.reactions) {
		if (!homes.has(set.message_id) || set.emojis.length === 0) continue;
		sets.set(set.message_id, [...(sets.get(set.message_id) ?? []), set]);
	}
	for (const [message_id, folded] of sets) {
		const log_id = folded.map((set) => set.log_id).reduce((a, b) => (compareLogIds(a, b) >= 0 ? a : b));
		logged.push({ log_id, line: { reactions: { log_id, message_id, room_id: homes.get(message_id)!, reactions: folded.map((set) => ({ from: set.from, emojis: set.emojis })) } } });
	}
	const memberships = new Map<string, { log_id: string; room_id: string; members: JsonObject[] }>();
	for (const entry of stored.memberships) {
		if (!included.has(entry.room_id)) continue;
		const key = `${entry.room_id}\n${entry.log_id}`;
		const record = memberships.get(key) ?? { log_id: entry.log_id, room_id: entry.room_id, members: [] };
		record.members.push({ user: entry.user, joined: entry.joined });
		memberships.set(key, record);
	}
	for (const membership of memberships.values()) logged.push({ log_id: membership.log_id, line: { membership } });
	logged.sort((a, b) => compareLogIds(a.log_id, b.log_id));
	for (const { line } of logged) lines.push(JSON.stringify(line));

	return { name: archiveFileName(url, now), text: lines.join('\n') + '\n', rooms: included.size, messages: stored.messages.length };
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

/** Reads an export (`exportArchive`). Throws `ArchiveError` when it isn't one this version reads. */
export function parseArchive(text: string): Archive {
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
	const header = parseLine(lines[0] ?? '');
	if (!header || !Object.hasOwn(header, 'apron_export')) throw new ArchiveError('This file isn’t an Apron export.');
	if (header.apron_export !== ARCHIVE_VERSION) throw new ArchiveError('This export is from a newer version of Apron, which this one can’t read.');
	const archive: Archive = {
		server: typeof header.server === 'string' ? header.server : '',
		exportedAt: typeof header.exported_at === 'string' ? header.exported_at : '',
		...(isIdentity(header.you) ? { you: cloneJson(header.you) } : {}),
		media: Array.isArray(header.media) ? header.media.filter((origin): origin is string => typeof origin === 'string') : [],
		users: [], rooms: [], messages: [], reactions: [], memberships: [], skipped: 0
	};
	for (const text of lines.slice(1)) {
		const line = parseLine(text);
		if (line && isIdentity(line.user)) {
			archive.users.push(cloneJson(line.user));
		} else if (line && isJsonObject(line.room)) {
			const room = decodeRoom(line.room);
			if (!room) archive.skipped++;
			else archive.rooms.push({ record: room.record, joined: line.joined === true, ...(Array.isArray(line.members) ? { members: line.members.filter(isOpaqueId) } : {}) });
		} else if (line && isJsonObject(line.message)) {
			const message = decodeMessage(line.message);
			if (!message) archive.skipped++;
			else archive.messages.push(message.record, ...message.embedded);
		} else if (line && isJsonObject(line.reactions)) {
			const sets = decodeReactions(line.reactions);
			if (!sets.length) archive.skipped++;
			archive.reactions.push(...sets);
		} else if (line && isJsonObject(line.membership)) {
			const entries = decodeMembership(line.membership);
			if (!entries.length) archive.skipped++;
			archive.memberships.push(...entries);
		} else {
			archive.skipped++;
		}
	}
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
