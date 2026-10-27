/**
 * The history a signed-in session keeps on this device, in IndexedDB, shaped
 * like a server's log (§4.3): each room's records keyed by their `log_id`,
 * compacted as they are written (one snapshot per message, one reaction set
 * per user and message, as `ProtocolStore` keeps them), beside each room's
 * record and how far it is synced (`RoomSync`). One account per server, as a
 * saved session is: another account's sign-in there replaces it.
 *
 * - `meta`, by server: whose it is, whether its joined set was complete, the
 *   kept users, and a `version` each write moves on, so a writer can tell
 *   whether what it read is still what is there.
 * - `rooms`, by `[server, room]`: the room's record and its sync.
 * - `records`, by `[server, room, log, kind, id]`: messages (`m`), reaction
 *   sets (`r`) and memberships (`j`). Ordered by `log` within a room, so a
 *   page or everything below a bound is one key range; the `key` index finds
 *   the row of a message or reaction set to replace.
 *
 * `log_id`s are kept as numbers (they are below 2^53, §2.1), which IndexedDB
 * orders numerically, as the protocol compares them.
 */
import type { RoomSync } from '$lib/protocol/client-types';
import type { StoreChange } from '$lib/protocol/reducer';
import type { Identity, MembershipEntry, MessageRecord, ReactionSet, RoomRecord } from '$lib/protocol/types';

export const DB_NAME = 'apron-history';
const DB_VERSION = 1;

type Kind = 'm' | 'r' | 'j';

export interface MetaRow {
	server: string;
	userId: string;
	complete: boolean;
	users: Identity[];
	version: number;
	savedAt: number;
}

export interface RoomRow {
	server: string;
	room: string;
	record?: RoomRecord;
	sync?: RoomSync;
}

interface RecordRow {
	server: string;
	room: string;
	log: number;
	kind: Kind;
	id: string;
	value: MessageRecord | ReactionSet | MembershipEntry;
}

/** Everything kept for one server, as read in one transaction. */
export interface KeptHistory {
	meta: MetaRow;
	rooms: RoomRow[];
	messages: MessageRecord[];
	reactions: ReactionSet[];
	memberships: MembershipEntry[];
}

export type Databases = Pick<IDBFactory, 'open'>;

export function openHistory(databases: Databases = globalThis.indexedDB): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = databases.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			db.createObjectStore('meta', { keyPath: 'server' });
			db.createObjectStore('rooms', { keyPath: ['server', 'room'] });
			db.createObjectStore('records', { keyPath: ['server', 'room', 'log', 'kind', 'id'] }).createIndex('key', ['server', 'kind', 'id']);
		};
		request.onsuccess = () => {
			const db = request.result;
			// A newer version open in another tab: this one steps aside rather than block it.
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error('History is open in an older tab'));
	});
}

/** A request's result, as a promise; a transaction stays active through its continuation. */
function done<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function committed(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error ?? new Error('History write aborted'));
	});
}

/** Every key from `[server]` up: arrays order after numbers and strings, so `[server, []]` is past them all. */
function serverRange(server: string): IDBKeyRange {
	return IDBKeyRange.bound([server], [server, []]);
}

function roomRange(server: string, room: string, below?: number): IDBKeyRange {
	return below === undefined ? IDBKeyRange.bound([server, room], [server, room, []]) : IDBKeyRange.bound([server, room], [server, room, below], false, true);
}

/** Calls `visit` for each row in `range`, which may delete it, then resolves. */
function eachRow(store: IDBObjectStore, range: IDBKeyRange, visit: (row: RecordRow, cursor: IDBCursorWithValue) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = store.openCursor(range);
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return resolve();
			visit(cursor.value as RecordRow, cursor);
			cursor.continue();
		};
		request.onerror = () => reject(request.error);
	});
}

function messageRow(server: string, record: MessageRecord): RecordRow {
	return { server, room: record.room_id, log: Number(record.log_id), kind: 'm', id: record.message_id, value: record };
}

function reactionRow(server: string, set: ReactionSet, room: string): RecordRow {
	return { server, room, log: Number(set.log_id), kind: 'r', id: `${set.message_id} ${set.from.user_id}`, value: set };
}

function membershipRow(server: string, entry: MembershipEntry): RecordRow {
	return { server, room: entry.room_id, log: Number(entry.log_id), kind: 'j', id: entry.user.user_id, value: entry };
}

/** Reads everything kept for `server`, or undefined when nothing is. */
export async function readHistory(db: IDBDatabase, server: string): Promise<KeptHistory | undefined> {
	const transaction = db.transaction(['meta', 'rooms', 'records'], 'readonly');
	const [meta, rooms, rows] = await Promise.all([
		done(transaction.objectStore('meta').get(server)) as Promise<MetaRow | undefined>,
		done(transaction.objectStore('rooms').getAll(serverRange(server))) as Promise<RoomRow[]>,
		done(transaction.objectStore('records').getAll(serverRange(server))) as Promise<RecordRow[]>
	]);
	if (!meta) return undefined;
	const kept: KeptHistory = { meta, rooms, messages: [], reactions: [], memberships: [] };
	for (const row of rows) {
		if (row.kind === 'm') kept.messages.push(row.value as MessageRecord);
		else if (row.kind === 'r') kept.reactions.push(row.value as ReactionSet);
		else kept.memberships.push(row.value as MembershipEntry);
	}
	return kept;
}

/** The version of what is kept for `server`, or undefined when nothing is. */
export async function historyVersion(db: IDBDatabase, server: string): Promise<{ version: number; userId: string } | undefined> {
	const meta = await done(db.transaction('meta', 'readonly').objectStore('meta').get(server)) as MetaRow | undefined;
	return meta ? { version: meta.version, userId: meta.userId } : undefined;
}

/** One write: changes to rooms already kept, rooms kept whole, room rows, rooms dropped, and the meta row. */
export interface HistoryWrite {
	/** Changes to the records of rooms kept as they are, in the order they were made. */
	changes: StoreChange[];
	/** Rooms whose rows are replaced with these records, in full. */
	whole: Array<{ room: string; messages: MessageRecord[]; reactions: ReactionSet[]; memberships: MembershipEntry[] }>;
	/** Room rows to put. */
	rooms: RoomRow[];
	/** Rooms to drop, rows and records. */
	dropped: string[];
	/** Every room to keep: any other kept for the server goes, rows and records. */
	keepOnly?: string[];
	meta: Omit<MetaRow, 'version' | 'savedAt'>;
	/** Everything kept for the server goes first: another account's, or nothing known of what is there. */
	reset?: boolean;
}

/**
 * Applies one write in one transaction, so a room's sync is never kept
 * without the records it covers. Resolves with the new version, once committed.
 * `kept` lists the rooms changes apply to: a change to any other room is skipped.
 */
export async function writeHistory(db: IDBDatabase, server: string, write: HistoryWrite, kept: ReadonlySet<string>): Promise<number> {
	const transaction = db.transaction(['meta', 'rooms', 'records'], 'readwrite', { durability: 'relaxed' });
	const finished = committed(transaction);
	const meta = transaction.objectStore('meta');
	const rooms = transaction.objectStore('rooms');
	const records = transaction.objectStore('records');
	const byKey = records.index('key');
	/**
	 * Replaces the row of the same message or reaction set (`kind`, `id`) wherever it was, as `row` when its room
	 * is kept: a message moved to a room that isn't goes from the one it left all the same.
	 */
	const replace = async (row: RecordRow) => {
		for (const key of await done(byKey.getAllKeys(IDBKeyRange.only([server, row.kind, row.id])))) records.delete(key);
		if (kept.has(row.room)) records.put(row);
	};
	if (write.reset) {
		records.delete(serverRange(server));
		rooms.delete(serverRange(server));
	}
	for (const change of write.changes) {
		switch (change.kind) {
			case 'message':
				await replace(messageRow(server, change.record));
				break;
			case 'reaction':
				// Kept with its message, in the room it is in (the writer names it).
				if (change.set.room_id !== undefined) await replace(reactionRow(server, change.set, change.set.room_id));
				break;
			case 'membership':
				if (kept.has(change.entry.room_id)) records.put(membershipRow(server, change.entry));
				break;
			case 'evict':
				// What the client drops below a room's bound: its messages and memberships (`evictBefore`).
				if (kept.has(change.room)) await eachRow(records, roomRange(server, change.room, Number(change.floor)), (row, cursor) => { if (row.kind !== 'r') cursor.delete(); });
				break;
			case 'clearRoom': {
				// A rebuild: its messages and reactions go, and its sync with them until the room settles again.
				if (!kept.has(change.room)) break;
				await eachRow(records, roomRange(server, change.room), (row, cursor) => { if (row.kind !== 'j') cursor.delete(); });
				const row = await done(rooms.get([server, change.room])) as RoomRow | undefined;
				if (row?.sync) rooms.put({ server, room: change.room, ...(row.record ? { record: row.record } : {}) });
				break;
			}
			// A room record goes with its room's row; `clear` stops the writer before it gets here.
			default:
				break;
		}
	}
	for (const room of write.whole) {
		records.delete(roomRange(server, room.room));
		for (const message of room.messages) records.put(messageRow(server, message));
		for (const set of room.reactions) records.put(reactionRow(server, set, room.room));
		for (const entry of room.memberships) records.put(membershipRow(server, entry));
	}
	for (const row of write.rooms) rooms.put(row);
	const keepOnly = write.keepOnly ? new Set(write.keepOnly) : undefined;
	const others = keepOnly ? (await done(rooms.getAllKeys(serverRange(server)))).map((key) => (key as [string, string])[1]).filter((room) => !keepOnly.has(room)) : [];
	for (const room of [...write.dropped, ...others]) {
		records.delete(roomRange(server, room));
		rooms.delete([server, room]);
	}
	const previous = await done(meta.get(server)) as MetaRow | undefined;
	const version = (previous?.version ?? 0) + 1;
	meta.put({ ...write.meta, server, version, savedAt: Date.now() } satisfies MetaRow);
	await finished;
	return version;
}

/**
 * Drops what is older than `cutoff` (epoch milliseconds, a `log_id` on servers whose `log_id`s are times):
 * messages and memberships logged before it, and reaction sets before it whose message is gone. Only in rooms
 * whose positions read as times, so a server counting from 1 loses nothing.
 */
export async function pruneHistory(db: IDBDatabase, cutoff: number): Promise<void> {
	const transaction = db.transaction(['rooms', 'records'], 'readwrite', { durability: 'relaxed' });
	const finished = committed(transaction);
	const records = transaction.objectStore('records');
	const byKey = records.index('key');
	const rooms = await done(transaction.objectStore('rooms').getAll()) as RoomRow[];
	for (const { server, room, sync } of rooms) {
		if (!timeLike(sync)) continue;
		const reactions: RecordRow[] = [];
		await eachRow(records, roomRange(server, room, cutoff), (row, cursor) => {
			if (row.kind === 'r') reactions.push(row);
			else cursor.delete();
		});
		for (const row of reactions) {
			const message = (row.value as ReactionSet).message_id;
			if (!(await done(byKey.count(IDBKeyRange.only([server, 'm', message]))))) records.delete([server, room, row.log, row.kind, row.id]);
		}
	}
	await finished;
}

/** Removes what is kept for `server`, or for every server. */
export async function forgetHistory(db: IDBDatabase, server?: string): Promise<void> {
	const transaction = db.transaction(['meta', 'rooms', 'records'], 'readwrite');
	const finished = committed(transaction);
	for (const name of ['meta', 'rooms', 'records'] as const) {
		const store = transaction.objectStore(name);
		if (server === undefined) store.clear();
		else store.delete(name === 'meta' ? server : serverRange(server));
	}
	await finished;
}

/** The earliest time a `log_id` reads as: before it, a server counts its positions some other way. */
const EARLIEST_TIME = Date.UTC(2000, 0, 1);

/** A room whose positions read as times (epoch milliseconds), so that a retention in days applies to it. */
export function timeLike(sync: RoomSync | undefined): boolean {
	const position = Number(sync?.checkpoint ?? sync?.loadCheckpoint ?? sync?.latestLogId);
	return Number.isSafeInteger(position) && position >= EARLIEST_TIME;
}
