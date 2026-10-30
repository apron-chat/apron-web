import type { MetaRow, RoomRow } from '$lib/history/history-db';
import type { MembershipEntry, MessageRecord, ReactionSet } from '$lib/protocol/types';

function all<T>(store: IDBObjectStore, query?: string): Promise<T[]> {
	return new Promise((resolve, reject) => {
		const request = store.getAll(query);
		request.onsuccess = () => resolve(request.result as T[]);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Everything kept in one account's database (`$lib/history`), read straight from its stores, rooms with a sync or
 * not: what a test checks was written. Undefined when nothing is kept.
 */
export async function readKept(db: IDBDatabase): Promise<{ meta: MetaRow; rooms: RoomRow[]; messages: MessageRecord[]; reactions: ReactionSet[]; memberships: MembershipEntry[] } | undefined> {
	const transaction = db.transaction(['meta', 'rooms', 'records'], 'readonly');
	const [[meta], rooms, rows] = await Promise.all([
		all<MetaRow>(transaction.objectStore('meta'), 'meta'),
		all<RoomRow>(transaction.objectStore('rooms')),
		all<{ kind: string; value: unknown }>(transaction.objectStore('records'))
	]);
	if (!meta) return undefined;
	return {
		meta, rooms,
		messages: rows.filter((row) => row.kind === 'm').map((row) => row.value as MessageRecord),
		reactions: rows.filter((row) => row.kind === 'r').map((row) => row.value as ReactionSet),
		memberships: rows.filter((row) => row.kind === 'j').map((row) => row.value as MembershipEntry)
	};
}
