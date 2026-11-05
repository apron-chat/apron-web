/**
 * Finding rooms and threads by name: Go to a Room or Thread (`SearchDialog`'s rooms mode), and the rooms the
 * composer's `#` and search's `room:` suggest (`searchRooms`). What is searched is what this page knows of
 * (`knownRooms`): the rooms and threads you've joined, which the server lists in full (§4.2.1), those open without
 * joining, those the latest listings offer to join, and those whose records this device holds. Joined ones come
 * first, then how well each matches, then the most recently active.
 */
import { compareLogIds } from '$lib/protocol/reducer';
import type { RoomRecord } from '$lib/protocol/types';
import { folded } from './fold';
import { matchTier, wantedOf, type MatchTier } from './room-match';

export { matchTier, wantedOf, type MatchTier };

/** A room or thread, wherever it is known from. */
export interface KnownRoom {
	id: string;
	title: string;
	parentRoomId?: string;
	/** What it is about, as written (CommonMark by convention). */
	description?: string;
	private?: boolean;
	/** You have joined it. */
	joined: boolean;
	/** The log ID of its latest activity known here, for the order; none when nothing says. */
	activeId?: string;
}

/** A room as the page shows it: joined, or open without joining (`RoomSnapshot`). */
type Shown = { id: string; title: string; parentRoomId?: string; description?: string; private?: boolean; joined: boolean; latestLogId?: string };
/** A room a listing offers to join (`RoomListing`). */
type Listed = { id: string; title: string; parentRoomId?: string; record: RoomRecord; latestLogId?: string; joined: boolean };

/**
 * Every room and thread known, each once: as shown, else as last listed, else from its stored record. A private
 * room known only from a record (one you left) is left out: it can't be read without being a member again.
 */
export function knownRooms(shown: readonly Shown[], listed: readonly Listed[], records: readonly RoomRecord[]): KnownRoom[] {
	const known = new Map<string, KnownRoom>();
	for (const room of shown) {
		known.set(room.id, {
			id: room.id, title: room.title, joined: room.joined,
			...(room.parentRoomId !== undefined ? { parentRoomId: room.parentRoomId } : {}),
			...(room.description ? { description: room.description } : {}),
			...(room.private ? { private: true } : {}),
			...(room.latestLogId !== undefined ? { activeId: room.latestLogId } : {})
		});
	}
	for (const listing of listed) {
		if (known.has(listing.id)) continue;
		const description = listing.record.description;
		known.set(listing.id, {
			id: listing.id, title: listing.title, joined: listing.joined,
			...(listing.parentRoomId !== undefined ? { parentRoomId: listing.parentRoomId } : {}),
			...(typeof description === 'string' && description ? { description } : {}),
			...(listing.record.private === true ? { private: true } : {}),
			...(listing.latestLogId !== undefined ? { activeId: listing.latestLogId } : {})
		});
	}
	for (const record of records) {
		if (known.has(record.room_id) || record.private === true) continue;
		known.set(record.room_id, {
			id: record.room_id, title: typeof record.title === 'string' && record.title.trim() ? record.title : record.room_id, joined: false,
			...(typeof record.parent_room_id === 'string' ? { parentRoomId: record.parent_room_id } : {}),
			...(typeof record.description === 'string' && record.description ? { description: record.description } : {}),
			...(record.log_id !== undefined ? { activeId: record.log_id } : {})
		});
	}
	return [...known.values()];
}

/** Newest first by `activeId`, those without one last. */
function byActivity(a: { activeId?: string }, b: { activeId?: string }): number {
	if (a.activeId === b.activeId) return 0;
	if (a.activeId === undefined) return 1;
	if (b.activeId === undefined) return -1;
	return compareLogIds(b.activeId, a.activeId);
}

/** What a rooms search asks for: words in a name, and with `room:`, only the threads of those rooms (`parseQuery`'s values). */
export interface RoomQuery {
	text: string;
	rooms: readonly string[];
}

/** The rooms a search found: the first `limit` of them, in order, and how many matched in all. */
export interface FoundRooms {
	rooms: Array<KnownRoom & { tier: MatchTier }>;
	total: number;
	/** The rooms `room:` named, when it named any that are known: their threads are what was searched. */
	scope: KnownRoom[];
}

/** The most rooms a search lists: past them, more words narrow it. */
export const ROOM_SEARCH_LIMIT = 50;

/**
 * The rooms in `known` that `query` finds: joined ones first, then by how well they match (`matchTier`, the
 * description too), then the most recently active, then by title. With `room:`, only the threads of the top-level
 * rooms it names (by `room_id` or title), and with nothing typed, every room, or every thread of those.
 */
export function rankRooms(known: readonly KnownRoom[], query: RoomQuery, limit = ROOM_SEARCH_LIMIT): FoundRooms {
	const wanted = wantedOf(query.text);
	const scope = query.rooms.length ? known.filter((room) => room.parentRoomId === undefined && query.rooms.some((value) => folded(room.id) === value || folded(room.title.trim()) === value)) : [];
	const parents = new Set(scope.map((room) => room.id));
	const found: Array<KnownRoom & { tier: MatchTier }> = [];
	for (const room of known) {
		if (query.rooms.length && (room.parentRoomId === undefined || !parents.has(room.parentRoomId))) continue;
		const tier = matchTier(room, wanted, true);
		if (tier !== undefined) found.push({ ...room, tier });
	}
	found.sort((a, b) => Number(b.joined) - Number(a.joined) || a.tier - b.tier || byActivity(a, b) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return { rooms: found.slice(0, limit), total: found.length, scope };
}
