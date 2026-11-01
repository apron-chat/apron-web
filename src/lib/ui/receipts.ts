import type { RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds } from '$lib/protocol/reducer';
import type { Identity } from '$lib/protocol/types';
import type { Face } from '$lib/design/components/types';
import type { TimelineItem } from './timeline';

/** No receipts: the same empty map each time, so rows reading it don't redraw. */
const NONE: ReadonlyMap<string, Identity[]> = new Map();

/**
 * Where read receipts show in a private room's timeline (`readers`, from
 * `ext.settings.read_receipts` `'private'`): each other member under the
 * newest message shown that they have read through, by `message_id`, in
 * the order the room lists them. A reader whose cursor is older than
 * everything shown, who is you, or who is no longer a member (where the
 * members are known) shows nowhere. Each is the room's member object
 * where it has one, else just the `user_id`.
 */
export function receiptsByMessage(
	timeline: readonly TimelineItem[],
	room: Pick<RoomSnapshot, 'readers' | 'members'> | undefined,
	you: string | undefined
): ReadonlyMap<string, Identity[]> {
	const readers = room?.readers?.filter((reader) => reader.user_id !== you);
	if (!readers?.length) return NONE;
	const ids: string[] = [];
	for (const item of timeline) if (item.kind === 'message') ids.push(item.event.message_id);
	if (!ids.length) return NONE;
	const placed = new Map<string, Identity[]>();
	for (const reader of readers) {
		const at = newestThrough(ids, reader.message_id);
		if (at === undefined) continue;
		const member = room?.members?.find((entry) => entry.user_id === reader.user_id);
		if (room?.members && !member) continue;
		const person = member ?? { user_id: reader.user_id };
		const people = placed.get(at);
		if (people) people.push(person);
		else placed.set(at, [person]);
	}
	return placed.size ? placed : NONE;
}

/** The newest of `ids` at or before `through`. A scan, not a search: a moved message keeps its older id. */
function newestThrough(ids: readonly string[], through: string): string | undefined {
	let newest: string | undefined;
	for (const id of ids) if (compareLogIds(id, through) <= 0 && (newest === undefined || compareLogIds(id, newest) > 0)) newest = id;
	return newest;
}

/**
 * `next` with each message's faces kept from `last` where they are the same people, shown the same way, and `last`
 * itself when nothing changed: the rows under unchanged messages then don't redraw (AGENTS.md, Reactivity).
 */
export function steadyReceipts(last: ReadonlyMap<string, Face[]>, next: ReadonlyMap<string, Face[]>): ReadonlyMap<string, Face[]> {
	if (!next.size) return next;
	let changed = next.size !== last.size;
	const kept = new Map<string, Face[]>();
	for (const [messageId, faces] of next) {
		const old = last.get(messageId);
		const same = old && old.length === faces.length && old.every((face, index) => sameFace(face, faces[index]));
		kept.set(messageId, same ? old : faces);
		if (!same) changed = true;
	}
	return changed ? kept : last;
}

function sameFace(a: Face, b: Face): boolean {
	return a.user_id === b.user_id && a.name === b.name && a.src === b.src && a.hue === b.hue;
}
