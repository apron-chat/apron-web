/**
 * A room's log as `history` pages it (§4.3.2), for everything that answers
 * `history` from what is kept rather than from a server: the reader of an
 * export (`ArchiveServer`), from memory, and this device's kept history
 * (`history-db.ts`), from IndexedDB. Each keeps its records one per entry,
 * a reaction set per user and a membership per user, each at its `log_id`;
 * `historyResult` groups them back into the records a server sends.
 */
import { compareLogIds } from '$lib/protocol/reducer';
import { isLogId, type JsonObject, type MembershipEntry, type MessageRecord, type ReactionSet, type RoomRecord } from '$lib/protocol/types';

/** The most entries one page holds. */
export const PAGE_LIMIT = 200;

export type LogEntry =
	| { log: string; kind: 'room'; record: RoomRecord }
	| { log: string; kind: 'message'; record: MessageRecord }
	| { log: string; kind: 'reaction'; record: ReactionSet }
	| { log: string; kind: 'membership'; record: MembershipEntry };

/** A `history` request's bounds (inclusive) and limit. */
export interface PageQuery {
	after?: string;
	before?: string;
	limit: number;
}

/** The bounds and limit of `history` params, as a server reads them: invalid bounds are left out, the limit clamped. */
export function pageQuery(params: JsonObject): PageQuery {
	const limit = Math.floor(Number(params.limit));
	return {
		...(isLogId(params.after) ? { after: params.after } : {}),
		...(isLogId(params.before) ? { before: params.before } : {}),
		limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, PAGE_LIMIT) : PAGE_LIMIT
	};
}

/** The first index whose entry is at or past `log` (`strict`: past it), in a log ascending by `log`. */
function boundary(log: readonly LogEntry[], position: string, strict: boolean): number {
	let low = 0;
	let high = log.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const order = compareLogIds(log[middle].log, position);
		if (order < 0 || (strict && order === 0)) low = middle + 1;
		else high = middle;
	}
	return low;
}

/**
 * The page of an ascending log that `query` selects (§4.3.2): within its bounds, the oldest `limit` entries
 * with `after`, else the newest; `more` when the bounds hold more in that direction. Entries at one `log_id` are
 * one record (a reaction or membership record's sets and entries): a page takes all of them or none, so going
 * on from its `first_log_id - 1` or `last_log_id + 1` skips none, even past `limit`.
 */
export function sliceLog(log: readonly LogEntry[], query: PageQuery): { page: LogEntry[]; more: boolean } {
	const start = query.after === undefined ? 0 : boundary(log, query.after, false);
	const end = query.before === undefined ? log.length : boundary(log, query.before, true);
	if (end <= start) return { page: [], more: false };
	let from = start;
	let to = end;
	if (query.after !== undefined) {
		to = Math.min(end, start + query.limit);
		while (to < end && log[to].log === log[to - 1].log) to++;
	} else {
		from = Math.max(start, end - query.limit);
		while (from > start && log[from - 1].log === log[from].log) from--;
	}
	return { page: log.slice(from, to), more: to - from < end - start };
}

/**
 * A page as a `history` result: its records by kind, in `log_id` order, with each message's reaction sets at
 * one `log_id` folded into one record, and a room's memberships at one `log_id` into one; the page's bounds;
 * and the log's (`latest`, `history`). `embed` may give a message its `reply_to` snapshot.
 */
export function historyResult(page: readonly LogEntry[], more: boolean, log: { latest: string; history: string | null }, embed?: (message: MessageRecord) => JsonObject): JsonObject {
	const rooms: JsonObject[] = [];
	const messages: JsonObject[] = [];
	const reactions = new Map<string, JsonObject & { reactions: JsonObject[] }>();
	const memberships = new Map<string, JsonObject & { members: JsonObject[] }>();
	for (const entry of page) {
		switch (entry.kind) {
			case 'room':
				rooms.push(entry.record);
				break;
			case 'message':
				messages.push(embed ? embed(entry.record) : entry.record);
				break;
			case 'reaction': {
				const set = entry.record;
				const key = `${set.message_id}\n${set.log_id}`;
				const record = reactions.get(key) ?? { log_id: set.log_id, message_id: set.message_id, ...(set.room_id !== undefined ? { room_id: set.room_id } : {}), reactions: [] };
				record.reactions.push({ from: set.from, emojis: set.emojis });
				reactions.set(key, record);
				break;
			}
			case 'membership': {
				const member = entry.record;
				const key = `${member.room_id}\n${member.log_id}`;
				const record = memberships.get(key) ?? { log_id: member.log_id, room_id: member.room_id, members: [] };
				record.members.push({ user: member.user, joined: member.joined });
				memberships.set(key, record);
				break;
			}
		}
	}
	return {
		rooms, messages, reactions: [...reactions.values()], memberships: [...memberships.values()],
		more,
		...(page.length ? { first_log_id: page[0].log, last_log_id: page.at(-1)!.log } : {}),
		latest_log_id: log.latest,
		history_log_id: log.history
	};
}

/** A room's entries from kept records, ascending: what `sliceLog` pages. */
export function roomLog(records: { room?: RoomRecord; messages?: MessageRecord[]; reactions?: ReactionSet[]; memberships?: MembershipEntry[] }): LogEntry[] {
	const log: LogEntry[] = [
		...(records.room?.log_id !== undefined ? [{ log: records.room.log_id, kind: 'room' as const, record: records.room }] : []),
		...(records.messages ?? []).map((record) => ({ log: record.log_id, kind: 'message' as const, record })),
		...(records.reactions ?? []).map((record) => ({ log: record.log_id, kind: 'reaction' as const, record })),
		...(records.memberships ?? []).map((record) => ({ log: record.log_id, kind: 'membership' as const, record }))
	];
	return log.sort((a, b) => compareLogIds(a.log, b.log));
}
