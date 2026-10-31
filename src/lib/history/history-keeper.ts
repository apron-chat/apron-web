/**
 * Keeps a signed-in session's history on this device (`history-db.ts`) and
 * brings it back on the next visit, so a reload goes on as a reconnect does:
 * every joined room from its checkpoint, with what it had (`ChatClient.restore`).
 *
 * What is written mirrors the client's store, room by room: a room joined and
 * settled is written whole once, and from then on each change to it as it is
 * made, in batches, with the room's sync in the same transaction. One tab
 * writes for a server at a time (a Web Lock); another takes over when it goes,
 * and writes what it has whole, since what is kept may no longer be what it
 * read. Only for a session saved here (a passkey or email account), never a
 * guest's; signing out removes it. Each account's is a database of its own
 * (`historyName`): what is restored, paged and searched is only ever the
 * signed-in account's.
 */
import type { ClientSnapshot, KeptState, RestoredState, RoomSync } from '$lib/protocol/client-types';
import { compareLogIds, type StoreChange, type StoredRecords } from '$lib/protocol/reducer';
import type { JsonObject, MessageRecord, RoomRecord } from '$lib/protocol/types';
import { decrement } from '$lib/protocol/client-internals';
import { deleteHistory, HistoryGone, historyName, listHistories, openHistory, pageHistory, pruneHistory, readHistory, readMeta, readRoomRows, scanMessages, timeLike, timeLikeLog, writeHistory, type Databases, type HistoryWrite, type KeptHistory, type RoomRow } from './history-db';
import { historyResult } from './log';

/** What the keeper needs of the chat client. */
export interface HistoryClient {
	readonly url: string;
	keptSessionFor(url: string): boolean;
	/** Without users (`withUsers` false) when only the rooms are wanted. */
	keptState(withUsers?: boolean): KeptState | undefined;
	usersRevision(): number;
	storedRecords(roomId?: string): StoredRecords;
	observeStore(listener: (change: StoreChange) => void): () => void;
	subscribe(listener: (snapshot: ClientSnapshot) => void): () => void;
	message(messageId: string): MessageRecord | undefined;
	roomRecord(roomId: string): RoomRecord | undefined;
	restore(state: RestoredState): boolean;
	beforeFreshSession(hook: (() => Promise<void>) | undefined): void;
	olderPagesFrom(source: ((roomId: string, before: string, limit: number) => Promise<JsonObject | undefined>) | undefined): void;
}

/** The longest a batch of changes waits to be written. */
export const FLUSH_MS = 2000;

/** About how many records one write puts down for rooms written whole. */
export const WHOLE_BUDGET = 1000;

type Locks = Pick<LockManager, 'request'>;

/** How many of a room's newest entries a restore reads back: what opens it; older ones page in as it scrolls back. */
export const RESTORE_WINDOW = 50;

/**
 * Where a room's kept log reaches down to (`from`, its start when undefined), and whether the server has older
 * than that (`older`): below the oldest page the client holds, older pages come from here first (`olderPage`).
 */
export interface Coverage {
	from?: string;
	older: boolean;
}

/**
 * How a kept room comes back with a retention cutoff, in rooms whose positions are times: its sync, starting no
 * lower than the cutoff (older pages load from the server), and where to read it from. Undefined when it isn't
 * caught up since before the cutoff: paging forward from there would fetch everything since, so it starts over.
 * It was caught up as of `caughtUpAt` (epoch milliseconds) when that is known, else as of its checkpoint, which
 * for a quiet room is long ago.
 */
export function plannedRoom(sync: RoomSync, cutoff: number | undefined, caughtUpAt?: number): { sync: RoomSync; from?: number } | undefined {
	if (cutoff === undefined || !timeLike(sync)) return { sync };
	const checkpoint = sync.checkpoint ?? sync.loadCheckpoint;
	const synced = caughtUpAt ?? (checkpoint === undefined ? undefined : Number(checkpoint));
	if (synced !== undefined && synced < cutoff) return undefined;
	const oldest = sync.olderBefore ?? sync.floor;
	return oldest === undefined || Number(oldest) < cutoff ? { sync: { ...sync, olderBefore: String(cutoff), hasOlder: true }, from: cutoff } : { sync };
}

/**
 * What was kept, as the client restores it: each room planned (`plannedRoom`) with the newest of its log. A
 * room with more kept below that holds only its newest, as if loaded newest first, and its `Coverage` says how
 * far down the rest goes.
 */
export function restoredState(kept: KeptHistory, retentionMs: number | undefined, now: number): { state: RestoredState; coverage: Map<string, Coverage> } {
	const cutoff = retentionMs === undefined ? undefined : now - retentionMs;
	const rooms: RoomSync[] = [];
	const records: RestoredState['records'] = { rooms: [], messages: [], reactions: [], memberships: [] };
	const coverage = new Map<string, Coverage>();
	// Written with every joined room kept and none catching up: each was caught up when it was saved.
	const caughtUpAt = kept.meta.complete && kept.meta.current ? kept.meta.savedAt : undefined;
	for (const { row, entries, older } of kept.rooms) {
		const planned = row.sync && plannedRoom(row.sync, cutoff, caughtUpAt);
		if (!planned) continue;
		let sync = planned.sync;
		if (older && entries.length) {
			coverage.set(row.room, { ...(sync.olderBefore ?? sync.floor ? { from: sync.olderBefore ?? sync.floor } : {}), older: sync.hasOlder ?? false });
			sync = { ...sync, olderBefore: entries[0].log, hasOlder: true };
		}
		rooms.push(sync);
		if (row.record) records.rooms.push(row.record);
		for (const entry of entries) {
			if (entry.kind === 'message') records.messages.push(entry.record);
			else if (entry.kind === 'reaction') records.reactions.push(entry.record);
			else if (entry.kind === 'membership') records.memberships.push(entry.record);
		}
	}
	return {
		state: {
			userId: kept.meta.userId,
			// A room dropped can't be told apart from one with no news: the next listing lists them all.
			complete: kept.meta.complete && kept.skipped === 0,
			rooms,
			users: kept.meta.users,
			...(kept.meta.aliases ? { aliases: kept.meta.aliases } : {}),
			records
		},
		coverage
	};
}

/**
 * The tab's writer for one account on one server. `synced` rooms are kept as the client holds them, and their
 * changes are written as they come; `withSync` rooms have a sync kept, so the joined set may be kept as
 * complete once every joined room is one; `rows` is each room row as last written. Taking over what another
 * tab kept, `disk` is what it had of each room, for writing over only what this one holds (`mergeOf`), and
 * `skip` the rooms left as they are kept, which this one can't write without a gap.
 */
interface Writer {
	server: string;
	userId: string;
	granted: boolean;
	taking?: Promise<void>;
	release?: () => void;
	synced: Set<string>;
	withSync: Set<string>;
	/** Rooms rebuilt (`clearRoom`) before the writer was granted: their kept sync goes until they settle. */
	cleared: Set<string>;
	disk?: Map<string, RoomSync>;
	skip: Set<string>;
	reset: boolean;
	swept: boolean;
	/** Each room's row as last written: its record (the store's own, compared by reference) and its sync. */
	rows: Map<string, { record: RoomRecord | undefined; sync: RoomSync }>;
	/** The client's `usersRevision` when the users were last written. */
	usersRevision?: number;
	/** `complete` and `current` as last written. */
	flags?: string;
}

/** What a restore reads (`readHistory`), and the time it planned the rooms by. */
interface KeptRead {
	kept: KeptHistory;
	now: number;
}

/** A read begun ahead of its restore (`prepare`): for which server, at which retention, and once read, what. */
interface Prepared {
	server: string;
	retentionMs: number | undefined | null;
	read: Promise<KeptRead | undefined>;
	done?: KeptRead;
}

/** Who a writer writes for, and what is known to be kept for them: `synced` rooms mirror the client as of `version`. */
interface Known {
	server: string;
	userId: string;
	version: number;
	synced: Set<string>;
}

export class HistoryKeeper {
	private retentionMs: number | undefined | null;
	private readonly databases: Databases | undefined;
	private readonly locks: Locks | undefined;
	private readonly now: () => number;
	private readonly onfailure: ((message: string) => void) | undefined;
	/** The databases this tab has open, by name: each closes, and goes from here, when another tab deletes it. */
	private dbs = new Map<string, Promise<IDBDatabase>>();
	private client: HistoryClient | undefined;
	private unwatch: Array<() => void> = [];
	/** Changes since the last write, in order. */
	private queue: StoreChange[] = [];
	/** What this page knows is kept: from what it restored, then from each write. */
	private known: Known | undefined;
	/** What is read for the next restore, begun as the page started (`prepare`). */
	private prepared: Prepared | undefined;
	/** How far down each room's kept log reaches below what the client holds, for the server `known` names. */
	private coverage = new Map<string, Coverage>();
	/** The ranges of each room's log served from here (`olderPage`): their records are kept already, so their changes aren't written again. */
	private served = new Map<string, Array<[string, string]>>();
	/** The writer: who for, and whether this tab holds the lock. */
	private writer: Writer | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private writing: Promise<void> | undefined;
	private again = false;
	/** The last write left rooms to write whole in the next. */
	private leftover = false;
	/** A write took what was waiting, since `flush` last looked. */
	private progressed = false;
	/** The restore under way, or the last: a prune waits for it (`prune`). */
	private restoring: Promise<void> | undefined;
	/** Why keeping stopped, such as a full disk, until the page reloads. */
	failure: string | undefined;

	/**
	 * `retentionMs`: how long to keep (undefined, everything loaded); null keeps nothing. `indexedDB` and `locks`
	 * default to the browser's. `onfailure` hears why keeping stopped.
	 */
	constructor(options: { retentionMs?: number | null; indexedDB?: Databases; locks?: Locks | null; now?: () => number; onfailure?: (message: string) => void } = {}) {
		this.onfailure = options.onfailure;
		this.retentionMs = options.retentionMs === undefined ? undefined : options.retentionMs;
		this.databases = options.indexedDB;
		this.locks = options.locks === null ? undefined : options.locks ?? globalThis.navigator?.locks;
		this.now = options.now ?? Date.now;
	}

	private get factory(): Databases {
		return this.databases ?? globalThis.indexedDB;
	}

	/** The database of `userId`'s history on `server`, made if there is none. */
	private open(server: string, userId: string): Promise<IDBDatabase> {
		return this.openNamed(historyName(server, userId));
	}

	private openNamed(name: string): Promise<IDBDatabase> {
		let db = this.dbs.get(name);
		if (!db) {
			db = openHistory(this.factory, name, () => this.dbs.delete(name));
			db.catch(() => this.dbs.delete(name));
			this.dbs.set(name, db);
		}
		return db;
	}

	/** Deletes the database `name`, closing this tab's connection first; other tabs close theirs as asked. */
	private async drop(name: string): Promise<void> {
		const db = this.dbs.get(name);
		this.dbs.delete(name);
		(await db?.catch(() => undefined))?.close();
		await deleteHistory(this.factory, name);
	}

	/**
	 * Keeping is on, nothing has failed, and the browser lists its databases (`indexedDB.databases()`): without that
	 * a restore can't find what is kept, nor signing out delete it, so nothing is kept at all.
	 */
	private get keeping(): boolean {
		return this.retentionMs !== null && this.failure === undefined && typeof this.factory?.databases === 'function';
	}

	/**
	 * Begins reading what was kept for `server` now, ahead of the session that restores it (`restore`): the page
	 * calls it as it starts, so opening the database and reading it go on beside the rest of its startup rather
	 * than after it, and are done or under way when signing in waits for them (`FRESH_HOOK_MS`). Only the next
	 * restore, and only one for `server`, takes what it read. Resolves once read.
	 */
	async prepare(server: string): Promise<void> {
		if (!this.keeping) return;
		const prepared: Prepared = { server, retentionMs: this.retentionMs, read: this.read(server) };
		this.prepared = prepared;
		// A read that fails is the restore's to report, should one take it.
		prepared.done = await prepared.read.catch(() => undefined);
	}

	/** What is kept for `server`'s saved session, read as a restore takes it, as of now; undefined when nothing is. */
	private async read(server: string): Promise<KeptRead | undefined> {
		const now = this.now();
		const cutoff = this.retentionMs === undefined || this.retentionMs === null ? undefined : now - this.retentionMs;
		// The account of the session saved there: the one kept for the server, which signing in confirms.
		const account = await this.keptAccount(server);
		if (!account) return undefined;
		const kept = await readHistory(await this.open(server, account), RESTORE_WINDOW, (row) => {
			const planned = plannedRoom(row.sync!, cutoff);
			return planned && (planned.from !== undefined ? { from: planned.from } : {});
		});
		return kept && { kept, now };
	}

	/**
	 * Before a new session connects: what was kept for its server, for the session saved there, restored into
	 * the client, from what `prepare` read for it when it did. `watch` has the client run it for each new
	 * session; never throws, since without IndexedDB there is nothing kept.
	 */
	restore(client: HistoryClient): Promise<void> {
		return (this.restoring = this.restoreFor(client));
	}

	private async restoreFor(client: HistoryClient): Promise<void> {
		const server = client.url;
		const prepared = this.prepared;
		this.prepared = undefined;
		if (!this.keeping || !client.keptSessionFor(server)) return;
		try {
			// Read for another server, or at another retention: read again.
			const read = await (prepared?.server === server && prepared.retentionMs === this.retentionMs ? prepared.read : this.read(server));
			// Moved on to another server meanwhile: that one's session restores its own.
			if (!read || client.url !== server) return;
			const { kept, now } = read;
			const { state, coverage } = restoredState(kept, this.retentionMs ?? undefined, now);
			// Too late, the client started without it: what is kept is no longer what it has.
			if (!client.restore(state)) return;
			this.known = { server: client.url, userId: state.userId, version: kept.meta.version, synced: new Set(state.rooms.map((room) => room.id)) };
			this.coverage = coverage;
			this.served.clear();
		} catch (cause) {
			console.warn('[apron] kept history could not be read', cause);
		}
	}

	/**
	 * Whose history is kept for `server`: one account, as one session is saved; should a race have left more, the
	 * one written last.
	 */
	private async keptAccount(server: string): Promise<string | undefined> {
		const found = await listHistories(this.factory, server);
		if (found.length <= 1) return found[0]?.userId;
		const saved = await Promise.all(found.map(async (entry) => ({ entry, meta: await readMeta(await this.openNamed(entry.name)).catch(() => undefined) })));
		return saved.filter((each) => each.meta).sort((a, b) => b.meta!.savedAt - a.meta!.savedAt)[0]?.entry.userId;
	}

	/**
	 * Follows `client` from now on, before it starts: each new session it begins (the first, another server,
	 * connecting anew) first restores what was kept for its server, and its changes are written once it is
	 * signed in to a session saved here. Each server's history is kept apart.
	 */
	watch(client: HistoryClient): void {
		this.unfollow();
		this.client = client;
		client.beforeFreshSession(() => this.restore(client));
		client.olderPagesFrom((roomId, before, limit) => this.olderPage(client.url, roomId, before, limit));
		this.unwatch.push(() => client.beforeFreshSession(undefined), () => client.olderPagesFrom(undefined));
		this.unwatch.push(client.observeStore((change) => this.changed(change)));
		this.unwatch.push(client.subscribe((snapshot) => this.consider(snapshot)));
		void this.prune();
	}

	/**
	 * A page of a room's history older than what the client holds, from what is kept here, as `history` would
	 * answer it: undefined where nothing kept reaches (`Coverage`), or what is kept changed under this tab, so
	 * the server pages instead. Its `more` goes on to the server's older ones once what is kept runs out.
	 */
	async olderPage(server: string, roomId: string, before: string, limit: number): Promise<JsonObject | undefined> {
		const kept = this.coverage.get(roomId);
		const cover = kept && this.reach(kept, before);
		if (cover && cover !== kept) this.coverage.set(roomId, cover);
		const known = this.known;
		if (!cover || known?.server !== server || (cover.from !== undefined && compareLogIds(before, cover.from) < 0)) return undefined;
		try {
			const { page, more, version } = await pageHistory(await this.open(server, known.userId), roomId, { before, limit }, cover.from === undefined ? undefined : Number(cover.from));
			// Another tab wrote meanwhile: what is kept may no longer be what this one restored from.
			if (!this.writer?.granted && version !== this.known?.version) {
				this.coverage.clear();
				return undefined;
			}
			if (!page.length) return undefined;
			const ranges = this.served.get(roomId) ?? [];
			ranges.push([page[0].log, page.at(-1)!.log]);
			this.served.set(roomId, ranges);
			return historyResult(page, more || cover.older, { latest: page.at(-1)!.log, history: page[0].log });
		} catch {
			return undefined;
		}
	}

	/**
	 * How far down a room's kept log reaches now: no lower than the retention's cutoff, in a room whose positions
	 * are times. What is below it goes at the next prune, here or in any other tab (one opened later prunes up to a
	 * later cutoff than this one did), so it comes from the server, and the server may have older.
	 */
	private reach(cover: Coverage, before: string): Coverage {
		if (this.retentionMs === undefined || this.retentionMs === null || !timeLikeLog(before)) return cover;
		const cutoff = this.now() - this.retentionMs;
		return cover.from !== undefined && Number(cover.from) >= cutoff ? cover : { from: String(cutoff), older: true };
	}

	/**
	 * The messages kept here of `userId`'s history on `server` that `test` takes (`$lib/ui/search`), from every
	 * room kept, whatever the page holds of them. Empty where nothing is kept for that account, or there is no
	 * IndexedDB. `stop` ends the scan early.
	 */
	async searchKept(server: string, userId: string, test: (message: MessageRecord) => boolean, stop?: () => boolean): Promise<MessageRecord[]> {
		const found: MessageRecord[] = [];
		try {
			// Only a database there is: opening one that isn't would make it.
			const name = historyName(server, userId);
			if (!(await listHistories(this.factory, server)).some((entry) => entry.name === name)) return found;
			await scanMessages(await this.openNamed(name), (message) => {
				if (test(message)) found.push(message);
			}, stop);
		} catch {
			// Nothing kept to search.
		}
		return found;
	}

	/**
	 * A room's sync as kept: where what is kept reaches deeper than what the client holds (a restore holds only
	 * the newest), the oldest page is that; once the client holds as deep, its own.
	 */
	private keptSync(roomId: string, sync: RoomSync): RoomSync {
		const cover = this.coverage.get(roomId);
		if (!cover) return sync;
		if (sync.olderBefore !== undefined && (cover.from === undefined || compareLogIds(cover.from, sync.olderBefore) < 0)) {
			const { olderBefore: _held, hasOlder: _more, ...rest } = sync;
			return { ...rest, ...(cover.from !== undefined ? { olderBefore: cover.from } : {}), ...(cover.older ? { hasOlder: true } : {}) };
		}
		this.coverage.delete(roomId);
		return sync;
	}

	/** Writes what is waiting now, as the page goes: once a writer this tab holds the lock for is ready. */
	async flush(): Promise<void> {
		await this.writer?.taking;
		// Until nothing waits: a write under way when this began, what changed meanwhile, rooms left for the next.
		for (;;) {
			if (this.timer) clearTimeout(this.timer);
			this.timer = undefined;
			// A write under way took what waited before it: what came after goes in one of this flush's own.
			if (this.writing) {
				await this.writing.catch(() => undefined);
				continue;
			}
			this.progressed = false;
			await this.write();
			// A write that couldn't go (signed out meanwhile, another server) leaves the rest for when one can.
			if (!this.progressed || !this.writer?.granted || (!this.leftover && !this.queue.length)) return;
		}
	}

	/** Stops following the client, writing what is waiting first. */
	async stop(): Promise<void> {
		const client = this.client;
		for (const unwatch of this.unwatch.splice(0)) unwatch();
		await this.flush();
		if (this.client === client) this.unfollow();
	}

	private unfollow(): void {
		for (const unwatch of this.unwatch.splice(0)) unwatch();
		this.endWriter();
		this.client = undefined;
	}

	/**
	 * Signed out of `server`, or keeping turned off (every server): what is kept goes, every account's database
	 * there, and nothing more is written for it.
	 */
	async forget(server?: string): Promise<void> {
		if (this.writer && (server === undefined || this.writer.server === server)) this.endWriter();
		if (server === undefined || this.known?.server === server) this.known = undefined;
		if (server === undefined || this.prepared?.server === server) this.prepared = undefined;
		this.queue = [];
		try {
			await Promise.all((await listHistories(this.factory, server)).map((entry) => this.drop(entry.name)));
		} catch {
			// Nothing kept, or no IndexedDB.
		}
	}

	/** How long to keep, from now on (null: nothing, and what is kept goes; undefined: everything loaded). */
	async setRetention(retentionMs: number | undefined | null): Promise<void> {
		this.retentionMs = retentionMs;
		if (retentionMs === null) return this.forget();
		await this.prune();
	}

	private async prune(): Promise<void> {
		if (!this.keeping || this.retentionMs === undefined || this.retentionMs === null) return;
		const cutoff = this.now() - this.retentionMs;
		// What is kept now starts no lower than the cutoff: older pages come from the server.
		const syncs = new Map((this.client?.keptState(false)?.rooms ?? []).map((room) => [room.id, room.sync]));
		for (const [room, cover] of this.coverage) {
			if (!timeLike(syncs.get(room))) continue;
			if (cover.from === undefined || Number(cover.from) < cutoff) this.coverage.set(room, { from: String(cutoff), older: true });
		}
		try {
			const entries = await listHistories(this.factory);
			// After a restore under way: signing in waits on it (`FRESH_HOOK_MS` at most), and a prune's write, begun
			// first, would hold up its read until done.
			await this.restoring;
			for (const entry of entries) {
				const pruned = await pruneHistory(await this.openNamed(entry.name), cutoff);
				// This tab's own prune leaves what it knows of what is kept as true as it was, and so what it read ahead
				// of a restore (`prepare`) before the prune: what the prune dropped, older than the retention, is below
				// where a restore reaches from now on (`reach`).
				const known = this.known;
				if (known && known.server === entry.server && known.userId === entry.userId && pruned?.from === known.version) known.version = pruned.to;
				const read = this.prepared?.server === entry.server ? this.prepared.done?.kept.meta : undefined;
				if (read && read.userId === entry.userId && pruned?.from === read.version) read.version = pruned.to;
			}
		} catch {
			// Kept as it was; the next visit restores only what is recent.
		}
	}

	private changed(change: StoreChange): void {
		// Keeping stopped (turned off, or a write failed): nothing waits to be written.
		if (!this.keeping) return;
		if (change.kind === 'clear') {
			// Signed out, another server or another account: the client no longer has what is kept.
			this.endWriter();
			this.known = undefined;
			this.coverage.clear();
			this.served.clear();
			this.queue = [];
			return;
		}
		// What a page from here brings into the client is here already.
		if (this.kept(change)) return;
		// A rebuild drops the room's sync with its records: written again once the room settles, whatever it says.
		if (change.kind === 'clearRoom') {
			this.writer?.rows.delete(change.room);
			this.writer?.withSync.delete(change.room);
			this.writer?.cleared.add(change.room);
			this.coverage.delete(change.room);
			this.served.delete(change.room);
		}
		// What is kept below a room's bound goes with it.
		if (change.kind === 'evict') {
			const cover = this.coverage.get(change.room);
			if (cover && (cover.from === undefined || compareLogIds(cover.from, change.floor) < 0)) this.coverage.set(change.room, { ...cover, from: change.floor });
		}
		// Changes matter only on top of what is kept: with nothing known of it, whatever is written goes in whole.
		if (!this.writer?.granted && !this.known) return;
		// A room's record goes with its row, which every write puts down as it is now.
		if (change.kind === 'room') {
			this.schedule();
			return;
		}
		// A reaction set is kept with its message, in the room the message is in now.
		if (change.kind === 'reaction') {
			const room = this.client?.message(change.set.message_id)?.room_id ?? change.set.room_id;
			this.queue.push(room === change.set.room_id ? change : { kind: 'reaction', set: { ...change.set, ...(room !== undefined ? { room_id: room } : {}) } });
		} else {
			this.queue.push(change);
		}
		this.schedule();
	}

	/** A change to a record of a range served from here (`olderPage`), which is kept as it is. */
	private kept(change: StoreChange): boolean {
		const record = change.kind === 'message' ? change.record : change.kind === 'reaction' ? change.set : change.kind === 'membership' ? change.entry : undefined;
		const room = change.kind === 'reaction' ? this.client?.message(change.set.message_id)?.room_id ?? change.set.room_id : record?.room_id;
		const ranges = room === undefined ? undefined : this.served.get(room);
		return Boolean(record && ranges?.some(([first, last]) => compareLogIds(record.log_id, first) >= 0 && compareLogIds(record.log_id, last) <= 0));
	}

	/** Each snapshot: a session saved here starts a writer for its account. */
	private consider(snapshot: ClientSnapshot): void {
		const client = this.client;
		const you = snapshot.you?.user_id;
		if (!client || !this.keeping || !snapshot.authenticated || !snapshot.passkeySession || you === undefined) return;
		// A writer running writes as the store changes (and as the page hides), not on every snapshot.
		if (this.writer && this.writer.server === client.url && this.writer.userId === you) return;
		// Read from storage, so only when a writer may start, not on every snapshot.
		if (!client.keptSessionFor(client.url)) return;
		this.endWriter();
		this.startWriter(client.url, you);
	}

	private startWriter(server: string, userId: string): void {
		const writer: Writer = { server, userId, granted: false, synced: new Set(), withSync: new Set(), cleared: new Set(), skip: new Set(), reset: true, swept: false, rows: new Map() };
		this.writer = writer;
		const take = () => (writer.taking = taking());
		const taking = async () => {
			if (this.writer !== writer) return;
			// One account's kept per server, as one session is saved: another's goes.
			const others = await listHistories(this.factory, server).catch(() => []);
			await Promise.all(others.filter((entry) => entry.userId !== userId).map((entry) => this.drop(entry.name).catch(() => undefined)));
			if (this.writer !== writer) return;
			const db = await this.open(server, userId).catch(() => undefined);
			const kept = db && await readMeta(db).catch(() => undefined);
			const known = this.known;
			if (known && known.server === server && known.userId === userId && kept?.version === known.version) {
				// What this page knows is kept is still what is there: go on from it.
				writer.synced = new Set(known.synced);
				writer.withSync = new Set([...known.synced].filter((room) => !writer.cleared.has(room)));
				writer.reset = false;
			} else {
				this.queue = [];
				this.coverage.clear();
				this.served.clear();
				if (db && kept) {
					// Kept, but moved on without this page (another tab wrote, or this one restored nothing): each room is
					// written over only as far down as the client holds it, and what is kept below stays.
					const rows = await readRoomRows(db).catch(() => []);
					writer.disk = new Map(rows.filter((row) => row.sync).map((row) => [row.room, row.sync!]));
					writer.withSync = new Set(writer.disk.keys());
					writer.reset = false;
				}
				// Otherwise nothing is: whatever is there goes first (`reset`).
			}
			if (this.writer !== writer) return;
			writer.granted = true;
			this.schedule(0);
		};
		if (!this.locks) {
			void take();
			return;
		}
		const hold = async (lock: Lock | null) => {
			if (this.writer !== writer || !lock) return false;
			await take();
			// Held until this writer ends.
			if (this.writer === writer) await new Promise<void>((resolve) => (writer.release = resolve));
			return true;
		};
		const name = `apron-history ${server}`;
		void this.locks.request(name, { ifAvailable: true }, hold).then((held) => {
			if (held || this.writer !== writer) return;
			// Another tab writes: by the time this one may, what is kept won't be what it read, so it writes whole.
			this.known = undefined;
			this.queue = [];
			return this.locks!.request(name, hold);
		}).catch(() => undefined);
	}

	private endWriter(): void {
		this.writer?.release?.();
		this.writer = undefined;
	}

	private schedule(delay = FLUSH_MS): void {
		if (!this.writer?.granted || (this.timer && delay > 0)) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.write();
		}, delay);
	}

	private write(): Promise<void> {
		if (this.writing) {
			this.again = true;
			return this.writing;
		}
		this.writing = this.writeOnce().finally(() => {
			this.writing = undefined;
			if (this.again || this.leftover) {
				this.again = false;
				this.schedule(0);
			}
		});
		return this.writing;
	}

	private async writeOnce(): Promise<void> {
		this.leftover = false;
		const writer = this.writer;
		const client = this.client;
		if (!writer?.granted || !client || !this.keeping) return;
		// The users only when they changed since they were written: copying thousands each write would cost.
		const revision = client.usersRevision();
		const withUsers = writer.reset || revision !== writer.usersRevision;
		const state = client.keptState(withUsers);
		if (!state || state.userId !== writer.userId || client.url !== writer.server) return;
		const changes = this.queue.splice(0);
		this.progressed = true;
		const kept = new Set(writer.synced);
		const synced = new Set(writer.synced);
		const joined = new Set(state.rooms.map((room) => room.id));
		// A room joined and settled that isn't kept yet goes in whole: everything the client has of it.
		// A few rooms a write, so writing many isn't one long task: the rest go in the next, at once.
		const whole: HistoryWrite['whole'] = [];
		let budget = WHOLE_BUDGET;
		for (const room of state.rooms) {
			if (!room.sync || synced.has(room.id) || writer.skip.has(room.id)) continue;
			if (budget <= 0) {
				this.leftover = true;
				break;
			}
			const merge = mergeOf(writer.disk?.get(room.id), room.sync);
			writer.disk?.delete(room.id);
			if (merge === 'skip') {
				writer.skip.add(room.id);
				continue;
			}
			synced.add(room.id);
			if (merge.cover) this.coverage.set(room.id, merge.cover);
			const { messages, reactions, memberships } = client.storedRecords(room.id);
			whole.push({ room: room.id, ...(merge.from !== undefined ? { from: merge.from } : {}), messages, reactions, memberships });
			budget -= messages.length + reactions.length + memberships.length;
		}
		const rows: RoomRow[] = [];
		const written = new Map<string, { record: RoomRecord | undefined; sync: RoomSync }>();
		for (const room of state.rooms) {
			if (!room.sync || !synced.has(room.id)) continue;
			const record = client.roomRecord(room.id);
			const sync = this.keptSync(room.id, room.sync);
			const last = writer.rows.get(room.id);
			if (last && last.record === record && sameSync(last.sync, sync)) continue;
			rows.push({ room: room.id, ...(record ? { record } : {}), sync });
			written.set(room.id, { record, sync });
		}
		// Once the joined set is complete, a room kept and no longer joined goes, and so, the first time, does
		// anything kept from before that isn't joined now.
		const dropped = state.complete ? [...synced].filter((room) => !joined.has(room)) : [];
		for (const room of dropped) {
			synced.delete(room);
			this.coverage.delete(room);
		}
		const sweep = state.complete && !writer.swept ? [...joined] : undefined;
		// The joined set is kept as complete only once every joined room has a sync kept: one without would be
		// left out of the next visit's listing of what changed since, and go missing.
		const withSync = new Set([...writer.withSync, ...written.keys()]);
		for (const room of dropped) withSync.delete(room);
		const complete = state.complete && state.rooms.every((room) => withSync.has(room.id));
		const current = state.rooms.every((room) => room.sync !== undefined);
		const flags = `${complete} ${current}`;
		if (!changes.length && !whole.length && !rows.length && !dropped.length && !sweep && !withUsers && flags === writer.flags) return;
		try {
			const db = await this.open(writer.server, writer.userId);
			const version = await writeHistory(db, {
				changes, whole, rooms: rows, dropped, ...(sweep ? { keepOnly: sweep } : {}), reset: writer.reset, continues: !writer.reset,
				meta: { server: writer.server, userId: writer.userId, complete, current, ...(withUsers ? { users: state.users, ...(state.aliases ? { aliases: state.aliases } : {}) } : {}) }
			}, kept);
			if (this.writer !== writer) return;
			writer.reset = false;
			if (sweep) writer.swept = true;
			writer.synced = synced;
			writer.withSync = withSync;
			writer.usersRevision = revision;
			writer.flags = flags;
			for (const [room, row] of written) writer.rows.set(room, row);
			for (const room of dropped) writer.rows.delete(room);
			this.known = { server: writer.server, userId: writer.userId, version, synced: new Set(synced) };
		} catch (cause) {
			// Deleted by another tab as this one began to write: its connection closed (`openHistory`), and is gone too.
			if (cause instanceof HistoryGone || !this.dbs.has(historyName(writer.server, writer.userId))) {
				// Another tab signed out or stopped keeping: nothing goes back until a session here starts a writer again.
				this.endWriter();
				this.known = undefined;
				this.coverage.clear();
				this.served.clear();
				this.queue = [];
				return;
			}
			// A full disk, or IndexedDB gone: what is kept stays as it was, and this page keeps nothing more.
			this.failure = cause instanceof Error && cause.name === 'QuotaExceededError' ? 'There isn’t enough space on this device to keep more history.' : 'History couldn’t be saved on this device.';
			console.warn('[apron] keeping history stopped', cause);
			this.endWriter();
			this.known = undefined;
			this.coverage.clear();
			this.served.clear();
			this.queue = [];
			this.onfailure?.(this.failure);
		}
	}
}

/**
 * How a room goes in whole over what another tab kept of it (`kept`, its sync, if any), given what the client
 * holds (`sync`): over all of it when nothing deeper is kept; over only what the client holds when what is kept
 * reaches up to it (`from`), so together they're one stretch, which the kept one's `cover` says; or not at all
 * (`skip`) when there is a gap between them, which writing would hide: what is kept stays as it was, and the
 * next visit goes on from it.
 */
export function mergeOf(kept: RoomSync | undefined, sync: RoomSync): { from?: number; cover?: Coverage } | 'skip' {
	const held = sync.olderBefore;
	if (!kept || held === undefined) return {};
	const keptBottom = kept.olderBefore ?? kept.floor;
	if (keptBottom !== undefined && compareLogIds(keptBottom, held) >= 0) return {};
	const keptTop = kept.checkpoint ?? kept.loadCheckpoint;
	if (keptTop === undefined || compareLogIds(keptTop, decrement(held)) < 0) return 'skip';
	return { from: Number(held), cover: { ...(keptBottom !== undefined ? { from: keptBottom } : {}), older: kept.hasOlder ?? false } };
}

/** Whether two syncs of a room say the same (`RoomSync`'s fields, each a string or a boolean). */
function sameSync(a: RoomSync, b: RoomSync): boolean {
	const keys = Object.keys(a) as (keyof RoomSync)[];
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
