import { saveRoomTitles, TITLES_MAX, type RoomTitle } from './push-store';

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
