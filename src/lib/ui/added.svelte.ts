import { SvelteMap } from 'svelte/reactivity';

/**
 * Who you added to which room (`room_join` with their `user_id`, §4.2.2), for the timeline to say "You added Ada" at
 * their join instead of "Ada joined": the membership record doesn't say who added them. Kept in memory for the
 * session, so after a reload the join reads as any other.
 */
const byRoom = new SvelteMap<string, SvelteMap<string, string | undefined>>();

/**
 * You added `userId` to `roomId` when its latest membership record was at `after` (none: no record yet), so their
 * first join past it is the one you asked for.
 */
export function noteAdded(roomId: string, userId: string, after: string | undefined): void {
	let users = byRoom.get(roomId);
	if (!users) byRoom.set(roomId, (users = new SvelteMap()));
	users.set(userId, after);
}

/** Per `user_id` you added to `roomId`, the room's latest membership `log_id` when you asked; read reactively. */
export function addedTo(roomId: string | undefined): ReadonlyMap<string, string | undefined> | undefined {
	return roomId === undefined ? undefined : byRoom.get(roomId);
}
