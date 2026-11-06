import { ENABLED, open, run, STORE } from './push-store';

/** Where the titles are kept, in the store the page shares with the service worker (`push-store.ts`). */
const TITLES = 'titles';
/** Rooms whose titles are kept for each account: a push for any other names it by its `room_id`. */
export const TITLES_MAX = 500;

/** What `PushTitles` reads of a room: its id and how the page names it. */
export interface TitledRoom {
	id: string;
	title: string;
	namedForMembers?: true;
	joined: boolean;
}

/**
 * The rooms' titles as a notification names them, joined rooms first, at most `TITLES_MAX`: a push for a room left
 * out names it by its `room_id`.
 */
export function roomTitlesOf(rooms: readonly TitledRoom[]): Map<string, RoomTitle> {
	const titles = new Map<string, RoomTitle>();
	for (const joined of [true, false]) {
		for (const room of rooms) {
			if (room.joined !== joined || titles.has(room.id) || !room.title) continue;
			if (titles.size >= TITLES_MAX) return titles;
			titles.set(room.id, room.namedForMembers ? { title: room.title, namedForMembers: true } : { title: room.title });
		}
	}
	return titles;
}

/**
 * Keeps the signed-in account's room titles where the service worker reads them (`saveRoomTitles`), while push is on
 * for it: a push carries only a `room_id` (§4.9.3), so a notification shown while Apron is closed names the room as
 * the page would. Writes only when the titles changed, one write at a time, and forgets an account's once push is
 * off for it or another account signs in.
 */
export class PushTitles {
	#pushId: string | undefined;
	#key: string | undefined;
	#writes: Promise<void> = Promise.resolve();
	#save: typeof saveRoomTitles;

	constructor(save: typeof saveRoomTitles = saveRoomTitles) {
		this.#save = save;
	}

	/** Follows the account's `push_id` and rooms while push is on for it; both undefined while it's off. */
	keep(pushId: string | undefined, rooms: readonly TitledRoom[] | undefined): Promise<void> {
		if (pushId === undefined || rooms === undefined) {
			const before = this.#pushId;
			this.#pushId = this.#key = undefined;
			return before === undefined ? this.#writes : this.#write(before, undefined);
		}
		const titles = roomTitlesOf(rooms);
		const key = JSON.stringify([...titles]);
		if (pushId === this.#pushId && key === this.#key) return this.#writes;
		const before = this.#pushId;
		this.#pushId = pushId;
		this.#key = key;
		if (before !== undefined && before !== pushId) void this.#write(before, undefined);
		return this.#write(pushId, titles);
	}

	#write(pushId: string, titles: Map<string, RoomTitle> | undefined): Promise<void> {
		this.#writes = this.#writes.then(() => this.#save(pushId, titles));
		return this.#writes;
	}
}

/**
 * How a room is named in a notification, as the page names it (`notificationTitle`): its shown title, and whether
 * that is its members' names (`namedForMembers`).
 */
export interface RoomTitle {
	title: string;
	namedForMembers?: true;
}

/**
 * Kept as a list of `[push_id, [[room_id, title, named], …]]`, not as objects keyed by id: a `room_id` is any string
 * the server chose (§2.4), `__proto__` included.
 */
type KeptTitles = Array<[string, Array<[string, string, boolean]>]>;

/** What `TITLES` holds, as a map of maps, without anything of the wrong shape. */
function readTitles(value: unknown): Map<string, Map<string, RoomTitle>> {
	const accounts = new Map<string, Map<string, RoomTitle>>();
	if (!Array.isArray(value)) return accounts;
	for (const account of value) {
		if (!Array.isArray(account) || typeof account[0] !== 'string' || !Array.isArray(account[1])) continue;
		const rooms = new Map<string, RoomTitle>();
		for (const room of account[1]) {
			if (!Array.isArray(room) || typeof room[0] !== 'string' || typeof room[1] !== 'string' || !room[1]) continue;
			rooms.set(room[0], room[2] === true ? { title: room[1], namedForMembers: true } : { title: room[1] });
		}
		accounts.set(account[0], rooms);
	}
	return accounts;
}

/** The room titles kept for each account's `push_id`; empty when there are none or IndexedDB can't be read. */
export async function loadRoomTitles(): Promise<Map<string, Map<string, RoomTitle>>> {
	try {
		return readTitles(await run('readonly', (store) => store.get(TITLES)));
	} catch {
		return new Map();
	}
}

/**
 * Keeps `titles` as the room titles of the account with `pushId`, replacing what was kept for it, at most
 * `TITLES_MAX` of them; undefined `titles` forgets that account's. Accounts push is no longer on for here are
 * forgotten as well. The read and the write are one transaction, so tabs of different accounts can't undo each other.
 */
export async function saveRoomTitles(pushId: string, titles: ReadonlyMap<string, RoomTitle> | undefined): Promise<void> {
	try {
		const db = await open();
		try {
			await new Promise<void>((resolve, reject) => {
				const transaction = db.transaction(STORE, 'readwrite');
				const store = transaction.objectStore(STORE);
				const read = store.get(TITLES);
				const enabled = store.get(ENABLED);
				enabled.onsuccess = () => {
					const accounts = readTitles(read.result);
					if (titles) accounts.set(pushId, new Map([...titles].slice(0, TITLES_MAX)));
					else accounts.delete(pushId);
					const on: unknown = enabled.result;
					if (Array.isArray(on)) for (const id of accounts.keys()) if (id !== pushId && !on.includes(id)) accounts.delete(id);
					const kept: KeptTitles = [...accounts].map(([id, rooms]) => [id, [...rooms].map(([room, { title, namedForMembers }]) => [room, title, namedForMembers === true])]);
					if (kept.length) store.put(kept, TITLES);
					else store.delete(TITLES);
				};
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
		} finally {
			db.close();
		}
	} catch {
		// Without them, a push names its room by its `room_id`, as before.
	}
}
