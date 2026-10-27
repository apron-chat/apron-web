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
 * guest's; signing out removes it.
 */
import type { ClientSnapshot, KeptState, RestoredState, RoomSync } from '$lib/protocol/client-types';
import { compareLogIds, type StoreChange, type StoredRecords } from '$lib/protocol/reducer';
import type { JsonObject, MessageRecord, RoomRecord } from '$lib/protocol/types';
import { forgetHistory, historyVersion, openHistory, pageHistory, pruneHistory, readHistory, timeLike, writeHistory, type Databases, type HistoryWrite, type KeptHistory, type RoomRow } from './history-db';
import { historyResult } from './log';

/** What the keeper needs of the chat client. */
export interface HistoryClient {
	readonly url: string;
	keptSessionFor(url: string): boolean;
	keptState(): KeptState | undefined;
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
export const RESTORE_WINDOW = 100;

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
 */
export function plannedRoom(sync: RoomSync, cutoff: number | undefined): { sync: RoomSync; from?: number } | undefined {
	if (cutoff === undefined || !timeLike(sync)) return { sync };
	const synced = sync.checkpoint ?? sync.loadCheckpoint;
	if (synced !== undefined && Number(synced) < cutoff) return undefined;
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
	for (const { row, entries, older } of kept.rooms) {
		const planned = row.sync && plannedRoom(row.sync, cutoff);
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
			complete: kept.meta.complete && kept.skipped === 0 && rooms.length === kept.rooms.length,
			rooms,
			users: kept.meta.users,
			records
		},
		coverage
	};
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
	private db: Promise<IDBDatabase> | undefined;
	private client: HistoryClient | undefined;
	private unwatch: Array<() => void> = [];
	/** Changes since the last write, in order. */
	private queue: StoreChange[] = [];
	/** What this page knows is kept: from what it restored, then from each write. */
	private known: Known | undefined;
	/** How far down each room's kept log reaches below what the client holds, for the server `known` names. */
	private coverage = new Map<string, Coverage>();
	/** The ranges of each room's log served from here (`olderPage`): their records are kept already, so their changes aren't written again. */
	private served = new Map<string, Array<[string, string]>>();
	/** The writer: who for, and whether this tab holds the lock. */
	private writer: { server: string; userId: string; granted: boolean; taking?: Promise<void>; release?: () => void; synced: Set<string>; reset: boolean; swept: boolean; rows: Map<string, string>; users?: string } | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private writing: Promise<void> | undefined;
	private again = false;
	/** The last write left rooms to write whole in the next. */
	private leftover = false;
	/** A write took what was waiting, since `flush` last looked. */
	private progressed = false;
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

	private open(): Promise<IDBDatabase> {
		this.db ??= openHistory(this.databases ?? globalThis.indexedDB);
		return this.db;
	}

	private get keeping(): boolean {
		return this.retentionMs !== null && this.failure === undefined;
	}

	/**
	 * Before a new session connects: what was kept for its server, for the session saved there, restored into
	 * the client. `watch` has the client run it for each new session; never throws, since without IndexedDB
	 * there is nothing kept.
	 */
	async restore(client: HistoryClient): Promise<void> {
		const server = client.url;
		if (!this.keeping || !client.keptSessionFor(server)) return;
		try {
			const now = this.now();
			const cutoff = this.retentionMs === undefined || this.retentionMs === null ? undefined : now - this.retentionMs;
			const kept = await readHistory(await this.open(), server, RESTORE_WINDOW, (row) => {
				const planned = plannedRoom(row.sync!, cutoff);
				return planned && (planned.from !== undefined ? { from: planned.from } : {});
			});
			// Moved on to another server meanwhile: that one's session restores its own.
			if (!kept || client.url !== server) return;
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
		const cover = this.coverage.get(roomId);
		if (!cover || this.known?.server !== server || (cover.from !== undefined && compareLogIds(before, cover.from) < 0)) return undefined;
		try {
			const { page, more, version } = await pageHistory(await this.open(), server, roomId, { before, limit }, cover.from === undefined ? undefined : Number(cover.from));
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

	/** Signed out of `server`, or keeping turned off (every server): what is kept goes, and nothing more is written for it. */
	async forget(server?: string): Promise<void> {
		if (this.writer && (server === undefined || this.writer.server === server)) this.endWriter();
		if (server === undefined || this.known?.server === server) this.known = undefined;
		this.queue = [];
		try {
			await forgetHistory(await this.open(), server);
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
		try {
			await pruneHistory(await this.open(), this.now() - this.retentionMs);
		} catch {
			// Kept as it was; the next visit restores only what is recent.
		}
	}

	private changed(change: StoreChange): void {
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
		const writer: NonNullable<HistoryKeeper['writer']> = { server, userId, granted: false, synced: new Set(), reset: true, swept: false, rows: new Map() };
		this.writer = writer;
		const take = () => (writer.taking = taking());
		const taking = async () => {
			if (this.writer !== writer) return;
			// What this page knows is kept is still what is there: go on from it. Anything else is written whole.
			const kept = await this.open().then((db) => historyVersion(db, server)).catch(() => undefined);
			const known = this.known;
			if (known && known.server === server && known.userId === userId && kept?.version === known.version && kept.userId === userId) {
				writer.synced = new Set(known.synced);
				writer.reset = false;
			} else {
				// Written whole: what is kept will be what the client holds, and reach no deeper.
				this.queue = [];
				this.coverage.clear();
			}
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
		const state = client.keptState();
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
			if (!room.sync || synced.has(room.id)) continue;
			if (budget <= 0) {
				this.leftover = true;
				break;
			}
			synced.add(room.id);
			const { messages, reactions, memberships } = client.storedRecords(room.id);
			whole.push({ room: room.id, messages, reactions, memberships });
			budget -= messages.length + reactions.length + memberships.length;
		}
		const rows: RoomRow[] = [];
		const written = new Map<string, string>();
		for (const room of state.rooms) {
			if (!room.sync || !synced.has(room.id)) continue;
			const record = client.roomRecord(room.id);
			const row: RoomRow = { server: writer.server, room: room.id, ...(record ? { record } : {}), sync: this.keptSync(room.id, room.sync) };
			const json = JSON.stringify(row);
			if (writer.rows.get(room.id) === json) continue;
			rows.push(row);
			written.set(room.id, json);
		}
		// Once the joined set is complete, a room kept and no longer joined goes, and so, the first time, does
		// anything kept from before that isn't joined now.
		const dropped = state.complete ? [...synced].filter((room) => !joined.has(room)) : [];
		for (const room of dropped) {
			synced.delete(room);
			this.coverage.delete(room);
		}
		const sweep = state.complete && !writer.swept ? [...joined] : undefined;
		const users = JSON.stringify(state.users);
		if (!changes.length && !whole.length && !rows.length && !dropped.length && !sweep && !writer.reset && users === writer.users) return;
		try {
			const db = await this.open();
			const version = await writeHistory(db, writer.server, {
				changes, whole, rooms: rows, dropped, ...(sweep ? { keepOnly: sweep } : {}), reset: writer.reset,
				meta: { server: writer.server, userId: writer.userId, complete: state.complete, users: state.users }
			}, kept);
			if (this.writer !== writer) return;
			writer.reset = false;
			if (sweep) writer.swept = true;
			writer.synced = synced;
			writer.users = users;
			for (const [room, json] of written) writer.rows.set(room, json);
			for (const room of dropped) writer.rows.delete(room);
			this.known = { server: writer.server, userId: writer.userId, version, synced: new Set(synced) };
		} catch (cause) {
			// A full disk, or IndexedDB gone: what is kept stays as it was, and this page keeps nothing more.
			this.failure = cause instanceof Error && cause.name === 'QuotaExceededError' ? 'There isn’t enough space on this device to keep more history.' : 'History couldn’t be saved on this device.';
			console.warn('[apron] keeping history stopped', cause);
			this.endWriter();
			this.onfailure?.(this.failure);
		}
	}
}
