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
import type { LogEntry, PageQuery } from './log';

export const DB_NAME = 'apron-history';
const DB_VERSION = 1;

type Kind = 'm' | 'r' | 'j';

export interface MetaRow {
	server: string;
	userId: string;
	complete: boolean;
	/** No joined room was catching up when it was saved: each room kept was caught up as of `savedAt`. */
	current?: boolean;
	users: Identity[];
	/** Retired `user_id`s and the current ones that replaced them. */
	aliases?: Record<string, string>;
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

/** One room as read back: its row, the newest of its log (`window` entries, ascending), and whether more is kept below. */
export interface KeptRoom {
	row: RoomRow;
	entries: LogEntry[];
	older: boolean;
}

/** What is kept for one server, as read in one transaction: each room's newest. */
export interface KeptHistory {
	meta: MetaRow;
	rooms: KeptRoom[];
	/** Rooms with a sync that `plan` passed over. */
	skipped: number;
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

function entryOf(row: RecordRow): LogEntry {
	const log = String(row.log);
	if (row.kind === 'm') return { log, kind: 'message', record: row.value as MessageRecord };
	if (row.kind === 'r') return { log, kind: 'reaction', record: row.value as ReactionSet };
	return { log, kind: 'membership', record: row.value as MembershipEntry };
}

/**
 * A page of one room's kept log, as `sliceLog` pages one in memory: within the query's bounds and not below
 * `from`, the oldest `limit` rows with `after`, else the newest, never splitting the rows at one `log_id`. In a
 * few requests whatever the page's size: a key cursor jumps to the `limit`-th row, whose `log_id` bounds the
 * page, which one `getAll` reads, and one `count` says whether more lie past it.
 */
async function pageRows(records: IDBObjectStore, server: string, room: string, query: PageQuery, from?: number): Promise<{ page: LogEntry[]; more: boolean }> {
	const forward = query.after !== undefined;
	const lower = Math.max(from ?? 0, query.after !== undefined ? Number(query.after) : 0);
	const upper: IDBValidKey = query.before !== undefined ? [server, room, Number(query.before), []] : [server, room, []];
	const range = IDBKeyRange.bound([server, room, lower], upper);
	const edge = await new Promise<number | undefined>((resolve, reject) => {
		const request = records.openKeyCursor(range, forward ? 'next' : 'prev');
		let advanced = query.limit <= 1;
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return resolve(undefined);
			if (advanced) return resolve((cursor.key as [string, string, number])[2]);
			advanced = true;
			cursor.advance(query.limit - 1);
		};
		request.onerror = () => reject(request.error);
	});
	// Fewer than `limit` rows: all of them.
	if (edge === undefined) return { page: (await done(records.getAll(range)) as RecordRow[]).map(entryOf), more: false };
	const pageRange = forward ? IDBKeyRange.bound([server, room, lower], [server, room, edge, []]) : IDBKeyRange.bound([server, room, edge], upper);
	// The page reaches the end of the range: nothing past it, and a range from there to there, open at one end, is
	// one IndexedDB refuses to make.
	const atEnd = forward ? query.before !== undefined && edge >= Number(query.before) : edge <= lower;
	const restRange = atEnd ? undefined : forward ? IDBKeyRange.bound([server, room, edge, []], upper, true, false) : IDBKeyRange.bound([server, room, lower], [server, room, edge], false, true);
	const [rows, rest] = await Promise.all([done(records.getAll(pageRange)) as Promise<RecordRow[]>, restRange ? done(records.count(restRange)) : 0]);
	return { page: rows.map(entryOf), more: rest > 0 };
}

/**
 * Reads back what is kept for `server`, or undefined when nothing is: for each room `plan` takes (its row with
 * a sync, and where to read from, if not its start), its newest `window` entries, in one transaction.
 */
export async function readHistory(db: IDBDatabase, server: string, window: number, plan: (row: RoomRow) => { from?: number } | undefined): Promise<KeptHistory | undefined> {
	const transaction = db.transaction(['meta', 'rooms', 'records'], 'readonly');
	const [meta, rows] = await Promise.all([
		done(transaction.objectStore('meta').get(server)) as Promise<MetaRow | undefined>,
		done(transaction.objectStore('rooms').getAll(serverRange(server))) as Promise<RoomRow[]>
	]);
	if (!meta) return undefined;
	const records = transaction.objectStore('records');
	const rooms = await Promise.all(rows.map(async (row) => {
		const planned = row.sync ? plan(row) : undefined;
		if (!planned) return undefined;
		const { page, more } = await pageRows(records, server, row.room, { limit: window }, planned.from);
		return { row, entries: page, older: more };
	}));
	const read = rooms.filter((room) => room !== undefined);
	return { meta, rooms: read, skipped: rows.filter((row) => row.sync).length - read.length };
}

/**
 * A page of one room's kept log (`pageRows`), and the version it was read at, so a reader can tell whether it
 * is still what it restored from.
 */
export async function pageHistory(db: IDBDatabase, server: string, room: string, query: PageQuery, from?: number): Promise<{ page: LogEntry[]; more: boolean; version?: number }> {
	const transaction = db.transaction(['meta', 'records'], 'readonly');
	const [meta, page] = await Promise.all([
		done(transaction.objectStore('meta').get(server)) as Promise<MetaRow | undefined>,
		pageRows(transaction.objectStore('records'), server, room, query, from)
	]);
	return { ...page, ...(meta ? { version: meta.version } : {}) };
}

/** Every room row kept for `server`. */
export async function readRoomRows(db: IDBDatabase, server: string): Promise<RoomRow[]> {
	return await done(db.transaction('rooms', 'readonly').objectStore('rooms').getAll(serverRange(server))) as RoomRow[];
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
	/** Rooms whose rows are replaced with these records: all of them, or only those from `from` up. */
	whole: Array<{ room: string; from?: number; messages: MessageRecord[]; reactions: ReactionSet[]; memberships: MembershipEntry[] }>;
	/** Room rows to put. */
	rooms: RoomRow[];
	/** Rooms to drop, rows and records. */
	dropped: string[];
	/** Every room to keep: any other kept for the server goes, rows and records. */
	keepOnly?: string[];
	/** Without `users`, the users (and aliases) kept stay as they are. */
	meta: Omit<MetaRow, 'version' | 'savedAt' | 'users'> & { users?: Identity[] };
	/** Everything kept for the server goes first: another account's, or nothing known of what is there. */
	reset?: boolean;
	/** Written on top of what is kept: when nothing is (another tab forgot it), nothing is written (`HistoryGone`). */
	continues?: boolean;
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
	const previous = await done(meta.get(server)) as MetaRow | undefined;
	if (write.continues && !previous) {
		// Written over what is kept, and nothing is: another tab forgot it (signed out, or chose not to keep).
		finished.catch(() => undefined);
		transaction.abort();
		throw new HistoryGone();
	}
	/**
	 * Replaces the row of the same message or reaction set (`kind`, `id`) wherever it was, as `row` when its room
	 * is kept (`always`: whatever `kept` says): a message moved to a room that isn't goes from the one it left all the same.
	 */
	const replace = async (row: RecordRow, always = false) => {
		for (const key of await done(byKey.getAllKeys(IDBKeyRange.only([server, row.kind, row.id])))) records.delete(key);
		if (always || kept.has(row.room)) records.put(row);
	};
	if (write.reset) {
		records.delete(serverRange(server));
		rooms.delete(serverRange(server));
	}
	for (const change of write.changes) {
		switch (change.kind) {
			case 'message': {
				const record = change.record;
				// A creation (`log_id == message_id`, §2.2) replaces no earlier snapshot: it needs no looking up, and is
				// kept only in a room that is. Any later one may have moved out of a kept room.
				if (record.log_id === record.message_id) {
					if (kept.has(record.room_id)) records.put(messageRow(server, record));
				} else {
					await replace(messageRow(server, record));
				}
				break;
			}
			case 'reaction':
				// Kept with its message, in the room it is in (the writer names it): nothing of a room not kept is.
				if (change.set.room_id !== undefined && kept.has(change.set.room_id)) await replace(reactionRow(server, change.set, change.set.room_id));
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
		if (room.from === undefined) {
			records.delete(roomRange(server, room.room));
			for (const message of room.messages) records.put(messageRow(server, message));
			for (const set of room.reactions) records.put(reactionRow(server, set, room.room));
		} else {
			// Over what is kept below `from`: an earlier snapshot of a message or set there is replaced, not kept beside.
			records.delete(IDBKeyRange.bound([server, room.room, room.from], [server, room.room, []]));
			for (const message of room.messages) await replace(messageRow(server, message), true);
			for (const set of room.reactions) await replace(reactionRow(server, set, room.room), true);
		}
		for (const entry of room.memberships) records.put(membershipRow(server, entry));
	}
	for (const row of write.rooms) rooms.put(row);
	const keepOnly = write.keepOnly ? new Set(write.keepOnly) : undefined;
	const others = keepOnly ? (await done(rooms.getAllKeys(serverRange(server)))).map((key) => (key as [string, string])[1]).filter((room) => !keepOnly.has(room)) : [];
	for (const room of [...write.dropped, ...others]) {
		records.delete(roomRange(server, room));
		rooms.delete([server, room]);
	}
	const version = (previous?.version ?? 0) + 1;
	const { users, aliases, ...fields } = write.meta;
	const people = users ? { users, ...(aliases ? { aliases } : {}) } : { users: previous?.users ?? [], ...(previous?.aliases ? { aliases: previous.aliases } : {}) };
	meta.put({ ...fields, ...people, server, version, savedAt: Date.now() } satisfies MetaRow);
	await finished;
	return version;
}

/**
 * Drops what is older than `cutoff` (epoch milliseconds, a `log_id` on servers whose `log_id`s are times): every
 * record logged before it, as a server that discards the start of its log does, so a reaction set logged before it
 * goes even when its message was edited since (a page from here, which starts at the cutoff, would never hold it).
 * Only in rooms whose positions read as times, so a server counting from 1 loses nothing.
 */
export async function pruneHistory(db: IDBDatabase, cutoff: number): Promise<Map<string, { from: number; to: number }>> {
	const transaction = db.transaction(['meta', 'rooms', 'records'], 'readwrite', { durability: 'relaxed' });
	const finished = committed(transaction);
	const records = transaction.objectStore('records');
	const rooms = await done(transaction.objectStore('rooms').getAll()) as RoomRow[];
	const pruned = new Set<string>();
	for (const { server, room, sync } of rooms) {
		if (!timeLike(sync)) continue;
		const range = roomRange(server, room, cutoff);
		if (await done(records.count(range))) pruned.add(server);
		records.delete(range);
	}
	// A new version for each server pruned, so another tab paging what it restored from here knows it changed.
	const meta = transaction.objectStore('meta');
	const versions = new Map<string, { from: number; to: number }>();
	for (const server of pruned) {
		const row = await done(meta.get(server)) as MetaRow | undefined;
		if (!row) continue;
		meta.put({ ...row, version: row.version + 1 });
		versions.set(server, { from: row.version, to: row.version + 1 });
	}
	await finished;
	return versions;
}

/** What `writeHistory` throws when it would write over what is kept and nothing is: another tab forgot it. */
export class HistoryGone extends Error {
	constructor() {
		super('What was kept on this device was removed');
		this.name = 'HistoryGone';
	}
}

/** How many rows one read of a scan takes: enough that a scan is few reads, few enough that each is quick. */
const SCAN_BATCH = 500;

/**
 * Calls `visit` with every message kept for `server` (its latest snapshot), room by room, a batch of rows a read:
 * what a search of this device looks through. `stop` ends it early, between batches.
 */
export async function scanMessages(db: IDBDatabase, server: string, visit: (message: MessageRecord) => void, stop: () => boolean = () => false): Promise<void> {
	let range = serverRange(server);
	for (;;) {
		const rows = await done(db.transaction('records').objectStore('records').getAll(range, SCAN_BATCH)) as RecordRow[];
		for (const row of rows) if (row.kind === 'm') visit(row.value as MessageRecord);
		if (rows.length < SCAN_BATCH || stop()) return;
		const last = rows.at(-1)!;
		range = IDBKeyRange.bound([server, last.room, last.log, last.kind, last.id], [server, []], true, false);
	}
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
