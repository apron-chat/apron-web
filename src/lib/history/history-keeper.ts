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
import type { StoreChange, StoredRecords } from '$lib/protocol/reducer';
import type { MessageRecord, RoomRecord } from '$lib/protocol/types';
import { forgetHistory, historyVersion, openHistory, pruneHistory, readHistory, timeLike, writeHistory, type Databases, type KeptHistory, type RoomRow } from './history-db';

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
}

/** The longest a batch of changes waits to be written. */
export const FLUSH_MS = 2000;

type Locks = Pick<LockManager, 'request'>;

/**
 * What was kept, as the client restores it: the rooms with a sync and their records. With a retention
 * (`retentionMs`), in rooms whose positions are times: what is older goes, the room's oldest page starts at the
 * cutoff with older ones to load from the server, and a room not caught up since before the cutoff starts over.
 */
export function restoredState(kept: KeptHistory, retentionMs: number | undefined, now: number): RestoredState {
	const cutoff = retentionMs === undefined ? undefined : now - retentionMs;
	const rooms = new Map<string, RoomSync>();
	const records: RoomRecord[] = [];
	let dropped = false;
	for (const row of kept.rooms) {
		let sync = row.sync;
		if (!sync) continue;
		if (cutoff !== undefined && timeLike(sync)) {
			const synced = sync.checkpoint ?? sync.loadCheckpoint;
			// Paging forward from before the cutoff would fetch everything since: it starts over from its newest page.
			if (synced !== undefined && Number(synced) < cutoff) {
				dropped = true;
				continue;
			}
			const oldest = sync.olderBefore ?? sync.floor;
			if (oldest === undefined || Number(oldest) < cutoff) sync = { ...sync, olderBefore: String(cutoff), hasOlder: true };
		}
		rooms.set(row.room, sync);
		if (row.record) records.push(row.record);
	}
	const retained = (room: string, log: string) => {
		const sync = rooms.get(room);
		return sync !== undefined && (cutoff === undefined || !timeLike(sync) || Number(log) >= cutoff);
	};
	const messages = kept.messages.filter((message) => retained(message.room_id, message.log_id));
	const ids = new Set(messages.map((message) => message.message_id));
	return {
		userId: kept.meta.userId,
		// A room dropped can't be told apart from one with no news: the next listing lists them all.
		complete: kept.meta.complete && !dropped,
		rooms: [...rooms.values()],
		users: kept.meta.users,
		records: {
			rooms: records,
			messages,
			reactions: kept.reactions.filter((set) => ids.has(set.message_id)),
			memberships: kept.memberships.filter((entry) => retained(entry.room_id, entry.log_id))
		}
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
	/** The writer: who for, and whether this tab holds the lock. */
	private writer: { server: string; userId: string; granted: boolean; taking?: Promise<void>; release?: () => void; synced: Set<string>; reset: boolean; swept: boolean; rows: Map<string, string>; users?: string } | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private writing: Promise<void> | undefined;
	private again = false;
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
	 * Before the client starts: what was kept for its server, for the session saved there, restored into it.
	 * Never throws: without IndexedDB there is nothing kept.
	 */
	async restore(client: HistoryClient): Promise<void> {
		if (!this.keeping || !client.keptSessionFor(client.url)) return;
		try {
			const kept = await readHistory(await this.open(), client.url);
			if (!kept) return;
			const state = restoredState(kept, this.retentionMs ?? undefined, this.now());
			// Too late, the client started without it: what is kept is no longer what it has.
			if (!client.restore(state)) return;
			this.known = { server: client.url, userId: state.userId, version: kept.meta.version, synced: new Set(state.rooms.map((room) => room.id)) };
		} catch (cause) {
			console.warn('[apron] kept history could not be read', cause);
		}
	}

	/** Follows `client` from now on: its changes queue at once, and are written once it is signed in to a session saved here. */
	watch(client: HistoryClient): void {
		this.unfollow();
		this.client = client;
		this.unwatch.push(client.observeStore((change) => this.changed(change)));
		this.unwatch.push(client.subscribe((snapshot) => this.consider(snapshot)));
		void this.prune();
	}

	/** Writes what is waiting now, as the page goes: once a writer this tab holds the lock for is ready. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		await this.writer?.taking;
		return this.write();
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
			this.queue = [];
			return;
		}
		// A rebuild drops the room's sync with its records: written again once the room settles, whatever it says.
		if (change.kind === 'clearRoom') this.writer?.rows.delete(change.room);
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

	/** Each snapshot: a session saved here starts a writer for its account; a writer running goes on. */
	private consider(snapshot: ClientSnapshot): void {
		const client = this.client;
		const you = snapshot.you?.user_id;
		if (!client || !this.keeping || !snapshot.authenticated || !snapshot.passkeySession || you === undefined || !client.keptSessionFor(client.url)) return;
		if (this.writer && this.writer.server === client.url && this.writer.userId === you) {
			this.schedule();
			return;
		}
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
				this.queue = [];
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
			if (this.again) {
				this.again = false;
				this.schedule(0);
			}
		});
		return this.writing;
	}

	private async writeOnce(): Promise<void> {
		const writer = this.writer;
		const client = this.client;
		if (!writer?.granted || !client || !this.keeping) return;
		const state = client.keptState();
		if (!state || state.userId !== writer.userId || client.url !== writer.server) return;
		const changes = this.queue.splice(0);
		const kept = new Set(writer.synced);
		const synced = new Set(writer.synced);
		const joined = new Set(state.rooms.map((room) => room.id));
		// A room joined and settled that isn't kept yet goes in whole: everything the client has of it.
		const whole = state.rooms.filter((room) => room.sync && !synced.has(room.id)).map((room) => {
			synced.add(room.id);
			const { messages, reactions, memberships } = client.storedRecords(room.id);
			return { room: room.id, messages, reactions, memberships };
		});
		const rows: RoomRow[] = [];
		const written = new Map<string, string>();
		for (const room of state.rooms) {
			if (!room.sync || !synced.has(room.id)) continue;
			const record = client.roomRecord(room.id);
			const row: RoomRow = { server: writer.server, room: room.id, ...(record ? { record } : {}), sync: room.sync };
			const json = JSON.stringify(row);
			if (writer.rows.get(room.id) === json) continue;
			rows.push(row);
			written.set(room.id, json);
		}
		// Once the joined set is complete, a room kept and no longer joined goes, and so, the first time, does
		// anything kept from before that isn't joined now.
		const dropped = state.complete ? [...synced].filter((room) => !joined.has(room)) : [];
		for (const room of dropped) synced.delete(room);
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
