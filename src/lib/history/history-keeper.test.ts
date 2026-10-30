import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatClient, timelineMessages, type ClientSnapshot } from '$lib/protocol/client';
import { MemoryProtocolServer } from '$lib/preview/memory-server';
import { readKept } from '$lib/test/kept-history';
import { deleteHistory, historyName, listHistories, openHistory, writeHistory, type Databases } from './history-db';
import { HistoryKeeper, mergeOf, plannedRoom, RESTORE_WINDOW, restoredState, type HistoryClient } from './history-keeper';
import type { RoomSync } from '$lib/protocol/client';

const URL = 'wss://chat.example/';
/** The memory server's account. */
const ACCOUNT = 'preview_guest';

/** The database of `userId`'s history on `server`, as the keeper names it. */
const accountDb = (indexedDB: Databases, server = URL, userId = ACCOUNT) => openHistory(indexedDB, historyName(server, userId));
const clients: ChatClient[] = [];
afterEach(() => {
	for (const client of clients.splice(0)) client.stop();
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 400; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('Did not settle');
}

/** The client as the keeper sees it, its session saved on this device (the preview server keeps no tokens). */
function saved(client: ChatClient): HistoryClient {
	return {
		get url() { return client.url; },
		keptSessionFor: () => true,
		keptState: (withUsers) => client.keptState(withUsers),
		usersRevision: () => client.usersRevision(),
		storedRecords: (room) => client.storedRecords(room),
		observeStore: (listener) => client.observeStore(listener),
		subscribe: (listener) => client.subscribe(listener),
		message: (id) => client.message(id),
		roomRecord: (id) => client.roomRecord(id),
		restore: (state) => client.restore(state),
		beforeFreshSession: (hook) => client.beforeFreshSession(hook),
		olderPagesFrom: (source) => client.olderPagesFrom(source)
	};
}

const room = (snapshot: ClientSnapshot, id: string) => snapshot.rooms.find((candidate) => candidate.id === id);
const ids = (snapshot: ClientSnapshot, id: string) => timelineMessages(room(snapshot, id)!).map((message) => message.message_id);
const historyOf = (server: MemoryProtocolServer, id: string, from: number) => server.frames.slice(from).filter((frame) => frame.method === 'history' && frame.params?.room_id === id).map((frame) => frame.params);

describe('HistoryKeeper', () => {
	it('brings a signed-in session back as a reconnect would: what it had, then only what came since', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const first = new ChatClient(URL, 'Ada', server.factory);
		clients.push(first);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(first));
		first.start();
		await waitFor(() => Boolean(room(first.snapshot(), 'general')?.loaded && room(first.snapshot(), 'thread_deploy')));
		await first.loadRoom('thread_deploy');
		await first.react('1710000000001', ['🎉']).promise;
		await waitFor(() => (first.reactions('1710000000001')?.length ?? 0) > 0);
		await keeper.flush();
		const had = { general: ids(first.snapshot(), 'general'), thread: ids(first.snapshot(), 'thread_deploy') };
		await keeper.stop();
		first.stop();

		const kept = await readKept(await accountDb(indexedDB));
		expect(kept?.meta).toMatchObject({ userId: 'preview_guest', complete: true });
		expect(kept?.rooms.find((row) => row.room === 'general')?.sync?.checkpoint).toBeDefined();

		// Away: someone posts.
		const posted = server.post('general', 'grace', 'While you were away');
		const from = server.frames.length;
		const second = new ChatClient(URL, 'Ada', server.factory);
		clients.push(second);
		const again = new HistoryKeeper({ indexedDB, locks: null });
		again.watch(saved(second));
		second.start();
		await waitFor(() => ids(second.snapshot(), 'general').includes(posted));
		expect(ids(second.snapshot(), 'general')).toEqual([...had.general, posted]);
		expect(second.reactions('1710000000001')).toEqual([expect.objectContaining({ emoji: '🎉', mine: true })]);
		// General went on from its checkpoint, not its newest page.
		const general = historyOf(server, 'general', from);
		expect(general.length).toBeGreaterThan(0);
		expect(general.every((params) => params?.after !== undefined)).toBe(true);
		// The thread is there as it was, and its next load goes on from where it was.
		expect(ids(second.snapshot(), 'thread_deploy')).toEqual(had.thread);
		await second.loadRoom('thread_deploy');
		expect(historyOf(server, 'thread_deploy', from).every((params) => params?.after !== undefined)).toBe(true);

		// What arrives now is written on top of what was restored, and comes back on the visit after.
		const live = server.post('general', 'ada', 'And now');
		await waitFor(() => ids(second.snapshot(), 'general').includes(live));
		await again.stop();
		second.stop();
		const third = new ChatClient(URL, 'Ada', server.factory);
		clients.push(third);
		new HistoryKeeper({ indexedDB, locks: null }).watch(saved(third));
		third.start();
		await waitFor(() => Boolean(room(third.snapshot(), 'general')?.loaded));
		expect(ids(third.snapshot(), 'general')).toEqual([...had.general, posted, live]);
	});

	it('writes everything whole when what is kept changed since it was read, as when another tab wrote', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const db = await accountDb(indexedDB);
		const meta = { server: URL, userId: 'preview_guest', complete: true, users: [] };
		const earlier = new ChatClient(URL, 'Ada', server.factory);
		clients.push(earlier);
		const before = new HistoryKeeper({ indexedDB, locks: null });
		before.watch(saved(earlier));
		earlier.start();
		await waitFor(() => Boolean(room(earlier.snapshot(), 'general')?.loaded));
		await before.stop();
		earlier.stop();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		await keeper.restore(saved(client));
		// Another tab writes a message this one never had.
		const ghost = { message_id: '1710000000099', log_id: '1710000000099', room_id: 'general', from: { user_id: 'ada' } };
		await writeHistory(db, { changes: [], whole: [{ room: 'general', messages: [ghost], reactions: [], memberships: [] }], rooms: [], dropped: [], meta }, new Set());
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		const kept = await readKept(db);
		expect(kept?.messages.map((message) => message.message_id)).not.toContain(ghost.message_id);
		expect(kept?.messages.filter((message) => message.room_id === 'general').map((message) => message.message_id)).toEqual(ids(client.snapshot(), 'general'));
		await keeper.stop();
	});

	it('restores only each room’s newest, and pages what is older from this device before the server', async () => {
		const server = new MemoryProtocolServer({ account: true });
		for (let n = 0; n < 400; n++) server.post('general', 'ada', `#${n}`);
		const indexedDB = new IDBFactory();
		const first = new ChatClient(URL, 'Ada', server.factory);
		clients.push(first);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(first));
		first.start();
		await waitFor(() => Boolean(room(first.snapshot(), 'general')?.loaded));
		while (room(first.snapshot(), 'general')?.olderAvailable) await first.loadOlder('general');
		const all = ids(first.snapshot(), 'general');
		expect(all.length).toBeGreaterThan(RESTORE_WINDOW);
		await keeper.stop();
		first.stop();

		const from = server.frames.length;
		const second = new ChatClient(URL, 'Ada', server.factory);
		clients.push(second);
		const again = new HistoryKeeper({ indexedDB, locks: null });
		again.watch(saved(second));
		second.start();
		await waitFor(() => Boolean(room(second.snapshot(), 'general')?.loaded));
		const held = ids(second.snapshot(), 'general');
		expect(held.length).toBeLessThanOrEqual(RESTORE_WINDOW);
		expect(held).toEqual(all.slice(-held.length));
		// Written while holding only the newest: what is kept still reaches as far down.
		server.post('general', 'grace', 'One more');
		await waitFor(() => ids(second.snapshot(), 'general').length === held.length + 1);
		await again.stop();
		second.stop();

		const third = new ChatClient(URL, 'Ada', server.factory);
		clients.push(third);
		new HistoryKeeper({ indexedDB, locks: null }).watch(saved(third));
		third.start();
		await waitFor(() => Boolean(room(third.snapshot(), 'general')?.loaded));
		while (room(third.snapshot(), 'general')?.olderAvailable) await third.loadOlder('general');
		expect(ids(third.snapshot(), 'general').slice(0, -1)).toEqual(all);
		// Every older page came from this device: the server was asked only for what came since.
		expect(historyOf(server, 'general', from).every((params) => params?.after !== undefined)).toBe(true);
	});

	it('pages from the server what a shorter retention pruned from this device', async () => {
		const server = new MemoryProtocolServer({ account: true });
		for (let n = 0; n < 400; n++) server.post('general', 'ada', `#${n}`);
		const indexedDB = new IDBFactory();
		const first = new ChatClient(URL, 'Ada', server.factory);
		clients.push(first);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(first));
		first.start();
		await waitFor(() => Boolean(room(first.snapshot(), 'general')?.loaded));
		while (room(first.snapshot(), 'general')?.olderAvailable) await first.loadOlder('general');
		const all = ids(first.snapshot(), 'general');
		await keeper.stop();
		first.stop();

		const now = Number(all.at(-1)) + 1;
		const second = new ChatClient(URL, 'Ada', server.factory);
		clients.push(second);
		const again = new HistoryKeeper({ indexedDB, locks: null, now: () => now });
		again.watch(saved(second));
		second.start();
		await waitFor(() => Boolean(room(second.snapshot(), 'general')?.loaded));
		// Keeping less from now on: the older half goes from this device, and still comes from the server.
		await again.setRetention(now - Number(all[200]));
		while (room(second.snapshot(), 'general')?.olderAvailable) await second.loadOlder('general');
		expect(ids(second.snapshot(), 'general')).toEqual(all);
		await again.stop();
	});

	it('writes nothing when nothing kept changed, and the users only when they did', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		const db = await accountDb(indexedDB);
		const written = (await readKept(db))!.meta;
		const posted = server.post('general', 'grace', 'Something');
		await waitFor(() => ids(client.snapshot(), 'general').includes(posted));
		await keeper.flush();
		const after = (await readKept(db))!.meta;
		expect(after.version).toBeGreaterThan(written.version);
		// Nothing new since: no write goes.
		await keeper.flush();
		expect((await readKept(db))!.meta.version).toBe(after.version);
		// A name changes: the users are written again.
		await client.updateProfile({ name: 'Ada Lovelace' });
		await keeper.flush();
		const renamed = (await readKept(db))!.meta;
		expect(renamed.version).toBeGreaterThan(after.version);
		expect(renamed.users.find((user) => user.user_id === 'preview_guest')?.name).toBe('Ada Lovelace');
		await keeper.stop();
	});

	it('writes nothing back once another tab has forgotten what is kept', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		// Another tab signs out, or stops keeping.
		await deleteHistory(indexedDB, historyName(URL, ACCOUNT));
		const posted = server.post('general', 'grace', 'After');
		await waitFor(() => ids(client.snapshot(), 'general').includes(posted));
		await keeper.flush();
		expect(await readKept(await accountDb(indexedDB))).toBeUndefined();
		expect(keeper.failure).toBeUndefined();
		await keeper.stop();
	});

	it('flushes what changed while a write was under way, not only that write', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		const first = server.post('general', 'grace', 'Written');
		await waitFor(() => ids(client.snapshot(), 'general').includes(first));
		// A write under way, and a message arriving while it is: a flush waits for that one to be written too.
		const writing = keeper.flush();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const posted = server.post('general', 'grace', 'Mid-write');
		await keeper.flush();
		await writing;
		expect((await readKept(await accountDb(indexedDB)))?.messages.map((message) => message.message_id)).toEqual(expect.arrayContaining([first, posted]));
		await keeper.stop();
	});

	it('keeps a joined thread as a room: restored to its newest, going on from its last load, paged back from this device', async () => {
		const server = new MemoryProtocolServer({ account: true });
		for (let n = 0; n < 250; n++) server.post('thread_deploy', n % 2 ? 'ada' : 'grace', `Step ${n}`);
		const indexedDB = new IDBFactory();
		const first = new ChatClient(URL, 'Ada', server.factory);
		clients.push(first);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(first));
		first.start();
		await waitFor(() => Boolean(room(first.snapshot(), 'thread_deploy')));
		await first.loadRoom('thread_deploy');
		while (room(first.snapshot(), 'thread_deploy')?.olderAvailable) await first.loadOlder('thread_deploy');
		const all = ids(first.snapshot(), 'thread_deploy');
		expect(all.length).toBeGreaterThan(RESTORE_WINDOW);
		await keeper.stop();
		first.stop();

		const posted = server.post('thread_deploy', 'ada', 'While you were away');
		const from = server.frames.length;
		const second = new ChatClient(URL, 'Ada', server.factory);
		clients.push(second);
		new HistoryKeeper({ indexedDB, locks: null }).watch(saved(second));
		second.start();
		await waitFor(() => Boolean(room(second.snapshot(), 'thread_deploy')));
		// Shown at once as it was kept, its newest only.
		const held = ids(second.snapshot(), 'thread_deploy');
		expect(held.length).toBeLessThan(all.length);
		expect(held).toEqual(all.slice(-held.length));
		await second.loadRoom('thread_deploy');
		while (room(second.snapshot(), 'thread_deploy')?.olderAvailable) await second.loadOlder('thread_deploy');
		expect(ids(second.snapshot(), 'thread_deploy')).toEqual([...all, posted]);
		// Its load went on from where the last one got to, and older pages came from this device.
		expect(historyOf(server, 'thread_deploy', from).every((params) => params?.after !== undefined)).toBe(true);
	});

	it('keeps each server’s history apart, and a server switched back to goes on from its own', async () => {
		const servers: Record<string, MemoryProtocolServer> = { [URL]: new MemoryProtocolServer({ account: true }), 'wss://other.example/': new MemoryProtocolServer({ account: true }) };
		const OTHER = 'wss://other.example/';
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', (url) => servers[url].factory(url));
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		const had = ids(client.snapshot(), 'general');

		client.setUrl(OTHER);
		await waitFor(() => client.snapshot().authenticated && Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		const db = await accountDb(indexedDB);
		expect((await readKept(db))?.messages.filter((message) => message.room_id === 'general').map((message) => message.message_id)).toEqual(had);
		expect((await readKept(await accountDb(indexedDB, OTHER)))?.messages.length).toBeGreaterThan(0);

		const posted = servers[URL].post('general', 'grace', 'While you were on the other server');
		const from = servers[URL].frames.length;
		client.setUrl(URL);
		await waitFor(() => ids(client.snapshot(), 'general').includes(posted));
		expect(ids(client.snapshot(), 'general')).toEqual([...had, posted]);
		expect(historyOf(servers[URL], 'general', from).every((params) => params?.after !== undefined)).toBe(true);
		await keeper.flush();
		expect((await readKept(await accountDb(indexedDB, OTHER)))?.messages.length).toBeGreaterThan(0);
		await keeper.stop();
	});

	it('restores before each new session the client begins, but not before a reconnect', async () => {
		const server = new MemoryProtocolServer();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		let runs = 0;
		client.beforeFreshSession(async () => { runs++; });
		client.start();
		await waitFor(() => client.snapshot().authenticated);
		expect(runs).toBe(1);
		// A dropped connection goes on with what it has.
		for (const socket of (server as unknown as { sockets: Set<{ close(): void }> }).sockets) socket.close();
		await waitFor(() => client.snapshot().status !== 'connected');
		client.retryNow();
		await waitFor(() => client.snapshot().authenticated);
		expect(runs).toBe(1);
		client.restart();
		await waitFor(() => client.snapshot().authenticated);
		expect(runs).toBe(2);
	});

	it('writes nothing for a guest', async () => {
		const server = new MemoryProtocolServer();
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Guest', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		expect(await readKept(await accountDb(indexedDB))).toBeUndefined();
		await keeper.stop();
	});

	it('searches only the history of the account asked for, making none for another', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		const everything = () => true;
		expect((await keeper.searchKept(URL, ACCOUNT, everything)).length).toBeGreaterThan(0);
		expect(await keeper.searchKept(URL, 'someone_else', everything)).toEqual([]);
		expect(await keeper.searchKept('wss://other.example/', ACCOUNT, everything)).toEqual([]);
		expect((await listHistories(indexedDB)).map((entry) => [entry.server, entry.userId])).toEqual([[URL, ACCOUNT]]);
		await keeper.stop();
	});

	it('forgets a server on sign-out, and everything when keeping is turned off', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		expect(await readKept(await accountDb(indexedDB))).toBeDefined();
		(await accountDb(indexedDB, 'wss://other.example/')).close();
		// Its database deleted, and only its.
		await keeper.forget(URL);
		expect((await listHistories(indexedDB)).map((entry) => entry.server)).toEqual(['wss://other.example/']);
		await keeper.setRetention(null);
		await keeper.flush();
		expect(await listHistories(indexedDB)).toEqual([]);
		await keeper.stop();
	});
});

/** One Web Lock per name, as tabs share them: granted in turn, or `null` at once with `ifAvailable` while held. */
function memoryLocks(): Pick<LockManager, 'request'> {
	const held = new Map<string, Array<() => void>>();
	const request = (name: string, ...rest: unknown[]) => {
		const [options, callback] = (rest.length === 2 ? rest : [{}, rest[0]]) as [LockOptions, (lock: Lock | null) => Promise<unknown>];
		const queue = held.get(name);
		if (queue && options.ifAvailable) return callback(null);
		return new Promise((resolve, reject) => {
			const run = () => callback({ name, mode: 'exclusive' } as Lock).then(resolve, reject).finally(() => {
				const waiting = held.get(name)!;
				const next = waiting.shift();
				if (next) next();
				else held.delete(name);
			});
			if (queue) queue.push(run);
			else {
				held.set(name, []);
				run();
			}
		});
	};
	return { request } as Pick<LockManager, 'request'>;
}

describe('HistoryKeeper, when things go wrong', () => {
	it('shows none of what was kept for one account to another that the saved session now signs in as', async () => {
		const indexedDB = new IDBFactory();
		const db = await accountDb(indexedDB, URL, 'zed');
		const secret = { message_id: '1710000000090', log_id: '1710000000090', room_id: 'secret', from: { user_id: 'zed' }, body: { text: 'Only for Zed' } };
		await writeHistory(db, {
			changes: [], dropped: [],
			whole: [{ room: 'secret', messages: [secret], reactions: [], memberships: [] }],
			rooms: [{ room: 'secret', record: { room_id: 'secret', log_id: '1710000000080', title: 'Secret', private: true }, sync: { id: 'secret', checkpoint: '1710000000090', latestLogId: '1710000000090', floor: '1710000000080' } }],
			meta: { server: URL, userId: 'zed', complete: true, users: [{ user_id: 'zed', name: 'Zed' }] }
		}, new Set());
		// The saved session signs in as someone else (the preview server's `preview_guest`).
		const server = new MemoryProtocolServer({ account: true });
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		expect(client.snapshot().you?.user_id).toBe('preview_guest');
		expect(client.message(secret.message_id)).toBeUndefined();
		expect(client.roomRecord('secret')).toBeUndefined();
		expect(client.viewRoom('secret')).toBe(false);
		expect(client.snapshot().users.zed).toBeUndefined();
		expect(client.snapshot().recordedUsers.zed).toBeUndefined();
		expect(client.storedRecords().messages.map((message) => message.room_id)).not.toContain('secret');
		// One account's is kept for the server: Zed's goes, and this one's starts.
		await keeper.flush();
		expect((await listHistories(indexedDB)).map((entry) => entry.userId)).toEqual([ACCOUNT]);
		const mine = await readKept(await accountDb(indexedDB));
		expect(mine?.meta.userId).toBe(ACCOUNT);
		expect(mine?.rooms.map((row) => row.room)).not.toContain('secret');
		expect(mine?.messages.map((message) => message.message_id)).not.toContain(secret.message_id);
		await keeper.stop();
	});

	it('keeps the joined set as complete only once every joined room has a sync kept', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		const keeper = new HistoryKeeper({ indexedDB, locks: null });
		// Engineering never settles (a recovery under way as the page goes).
		keeper.watch({ ...saved(client), keptState: () => {
			const state = client.keptState();
			return state && { ...state, rooms: state.rooms.map((entry) => (entry.id === 'engineering' ? { id: entry.id } : entry)) };
		} });
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded && room(client.snapshot(), 'engineering')?.loaded));
		await keeper.stop();
		client.stop();
		const db = await accountDb(indexedDB);
		expect((await readKept(db))?.meta.complete).toBe(false);

		// So the next visit lists every joined room, not only those that changed since: engineering is there.
		const from = server.frames.length;
		const next = new ChatClient(URL, 'Ada', server.factory);
		clients.push(next);
		new HistoryKeeper({ indexedDB, locks: null }).watch(saved(next));
		next.start();
		await waitFor(() => Boolean(room(next.snapshot(), 'general')?.loaded));
		const listings = server.frames.slice(from).filter((frame) => frame.method === 'room_list' && frame.params?.filter === 'joined');
		expect(listings.length).toBeGreaterThan(0);
		expect(listings.every((frame) => frame.params?.latest_log_id === undefined)).toBe(true);
		expect(room(next.snapshot(), 'engineering')).toBeDefined();
	});

	it('queues nothing more once a write has failed', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const client = new ChatClient(URL, 'Ada', server.factory);
		clients.push(client);
		let failure: string | undefined;
		const keeper = new HistoryKeeper({ indexedDB, locks: null, onfailure: (message) => (failure = message) });
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		// IndexedDB goes away under the page.
		(await [...(keeper as unknown as { dbs: Map<string, Promise<IDBDatabase>> }).dbs.values()][0]).close();
		server.post('general', 'grace', 'Not kept');
		await keeper.flush();
		expect(failure).toBeDefined();
		for (let n = 0; n < 20; n++) server.post('general', 'grace', `#${n}`);
		await waitFor(() => ids(client.snapshot(), 'general').length > 20);
		expect((keeper as unknown as { queue: unknown[] }).queue).toEqual([]);
		await keeper.stop();
	});
});

describe('mergeOf', () => {
	const held = { id: 'general', checkpoint: '900', olderBefore: '500', hasOlder: true };
	it('writes a room over all of what is kept when nothing deeper is', () => {
		expect(mergeOf(undefined, held)).toEqual({});
		expect(mergeOf({ id: 'general', checkpoint: '700', olderBefore: '600' }, held)).toEqual({});
		expect(mergeOf({ id: 'general', checkpoint: '700', olderBefore: '100' }, { id: 'general', checkpoint: '900' })).toEqual({});
	});

	it('writes only over what the client holds when what is kept reaches up to it, and keeps the rest', () => {
		expect(mergeOf({ id: 'general', checkpoint: '700', olderBefore: '100', hasOlder: true }, held)).toEqual({ from: 500, cover: { from: '100', older: true } });
		expect(mergeOf({ id: 'general', checkpoint: '499', floor: '50' }, held)).toEqual({ from: 500, cover: { from: '50', older: false } });
	});

	it('leaves what is kept as it is when there is a gap between it and what the client holds', () => {
		expect(mergeOf({ id: 'general', checkpoint: '400', olderBefore: '100' }, held)).toBe('skip');
	});
});

describe('HistoryKeeper in two tabs', () => {
	it('keeps what is kept below what the tab taking over holds', async () => {
		const server = new MemoryProtocolServer({ account: true });
		for (let n = 0; n < 400; n++) server.post('general', 'ada', `#${n}`);
		const indexedDB = new IDBFactory();
		const locks = memoryLocks();
		const first = new ChatClient(URL, 'Ada', server.factory);
		clients.push(first);
		const one = new HistoryKeeper({ indexedDB, locks });
		one.watch(saved(first));
		first.start();
		await waitFor(() => Boolean(room(first.snapshot(), 'general')?.loaded));
		while (room(first.snapshot(), 'general')?.olderAvailable) await first.loadOlder('general');
		const all = ids(first.snapshot(), 'general');
		await one.flush();
		// A second tab restores only the newest, and waits its turn to write while the first writes on.
		const second = new ChatClient(URL, 'Ada', server.factory);
		clients.push(second);
		const two = new HistoryKeeper({ indexedDB, locks });
		two.watch(saved(second));
		second.start();
		await waitFor(() => Boolean(room(second.snapshot(), 'general')?.loaded));
		expect(ids(second.snapshot(), 'general').length).toBeLessThan(all.length);
		const posted = server.post('general', 'grace', 'Both tabs see this');
		await waitFor(() => ids(first.snapshot(), 'general').includes(posted) && ids(second.snapshot(), 'general').includes(posted));
		await one.stop();
		first.stop();
		// The second takes over, and writes over only what it holds.
		await waitFor(() => (two as unknown as { writer?: { granted: boolean } }).writer?.granted === true);
		await two.flush();
		await two.stop();
		second.stop();
		const kept = await readKept(await accountDb(indexedDB));
		expect(kept?.messages.filter((message) => message.room_id === 'general').length).toBe(all.length + 1);

		// The next visit pages all of it from this device.
		const from = server.frames.length;
		const third = new ChatClient(URL, 'Ada', server.factory);
		clients.push(third);
		new HistoryKeeper({ indexedDB, locks }).watch(saved(third));
		third.start();
		await waitFor(() => Boolean(room(third.snapshot(), 'general')?.loaded));
		while (room(third.snapshot(), 'general')?.olderAvailable) await third.loadOlder('general');
		expect(ids(third.snapshot(), 'general')).toEqual([...all, posted]);
		expect(historyOf(server, 'general', from).every((params) => params?.after !== undefined)).toBe(true);
	});

	it('writes from one tab at a time, and the next writes whole when it takes over', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const locks = memoryLocks();
		const first = new ChatClient(URL, 'Ada', server.factory);
		const second = new ChatClient(URL, 'Ada', server.factory);
		clients.push(first, second);
		const one = new HistoryKeeper({ indexedDB, locks });
		const two = new HistoryKeeper({ indexedDB, locks });
		one.watch(saved(first));
		first.start();
		await waitFor(() => Boolean(room(first.snapshot(), 'general')?.loaded));
		await one.flush();
		two.watch(saved(second));
		second.start();
		await waitFor(() => Boolean(room(second.snapshot(), 'general')?.loaded));
		const posted = server.post('general', 'grace', 'Seen by both');
		await waitFor(() => ids(second.snapshot(), 'general').includes(posted) && ids(first.snapshot(), 'general').includes(posted));
		// Only the first writes; the second waits its turn.
		await two.flush();
		expect((two as unknown as { writer?: { granted: boolean } }).writer?.granted).toBe(false);
		await one.stop();
		await waitFor(() => (two as unknown as { writer?: { granted: boolean } }).writer?.granted === true);
		await two.flush();
		const kept = await readKept(await accountDb(indexedDB));
		expect(kept?.messages.filter((message) => message.room_id === 'general').map((message) => message.message_id)).toEqual(ids(second.snapshot(), 'general'));
		await two.stop();
	});
});

describe('plannedRoom and restoredState', () => {
	const day = 24 * 60 * 60 * 1000;
	const now = Date.UTC(2026, 9, 27);
	const at = (daysAgo: number) => String(now - daysAgo * day);
	const cutoff = now - 30 * day;

	it('starts a room no lower than the cutoff, and over when it isn’t caught up since', () => {
		expect(plannedRoom({ id: 'general', checkpoint: at(1), floor: at(100) }, cutoff)).toEqual({ sync: { id: 'general', checkpoint: at(1), floor: at(100), olderBefore: String(cutoff), hasOlder: true }, from: cutoff });
		expect(plannedRoom({ id: 'general', checkpoint: at(1), olderBefore: at(2) }, cutoff)).toEqual({ sync: { id: 'general', checkpoint: at(1), olderBefore: at(2) } });
		expect(plannedRoom({ id: 'general', checkpoint: at(31) }, cutoff)).toBeUndefined();
	});

	it('takes a room as caught up when it was saved, when every joined room was: a quiet room’s checkpoint is old', () => {
		expect(plannedRoom({ id: 'quiet', checkpoint: at(40) }, cutoff, now - day)).toEqual({ sync: { id: 'quiet', checkpoint: at(40), olderBefore: String(cutoff), hasOlder: true }, from: cutoff });
		expect(plannedRoom({ id: 'quiet', checkpoint: at(40) }, cutoff, now - 31 * day)).toBeUndefined();
		const meta = { server: URL, userId: 'ada', complete: true, users: [], version: 3, savedAt: now - day };
		const rows = [{ row: { room: 'quiet', sync: { id: 'quiet', checkpoint: at(40) } }, entries: [], older: false }];
		expect(restoredState({ meta: { ...meta, current: true }, skipped: 0, rooms: rows }, 30 * day, now).state.rooms.map((sync) => sync.id)).toEqual(['quiet']);
		// Saved while a room was catching up: each goes by its own checkpoint.
		expect(restoredState({ meta, skipped: 0, rooms: rows }, 30 * day, now).state.rooms).toEqual([]);
	});

	it('keeps everything without a cutoff, or where positions are not times', () => {
		expect(plannedRoom({ id: 'general', checkpoint: at(31) }, undefined)).toEqual({ sync: { id: 'general', checkpoint: at(31) } });
		expect(plannedRoom({ id: 'counted', checkpoint: '20' }, cutoff)).toEqual({ sync: { id: 'counted', checkpoint: '20' } });
	});

	it('holds a room’s newest as its oldest page, and says how far down what is kept goes', () => {
		const message = (log: string) => ({ log, kind: 'message' as const, record: { message_id: log, log_id: log, room_id: 'general', from: { user_id: 'ada' } } });
		const meta = { server: URL, userId: 'ada', complete: true, users: [], version: 3, savedAt: now };
		const row = (room: string, sync: RoomSync) => ({ server: URL, room, record: { room_id: room }, sync });
		const { state, coverage } = restoredState({
			meta, skipped: 0,
			rooms: [
				{ row: row('general', { id: 'general', checkpoint: at(1), floor: at(100) }), entries: [message(at(3)), message(at(2))], older: true },
				{ row: row('quiet', { id: 'quiet', checkpoint: at(1), olderBefore: at(5), hasOlder: false }), entries: [message(at(5))], older: false }
			]
		}, 30 * day, now);
		expect(state.rooms).toEqual([
			{ id: 'general', checkpoint: at(1), floor: at(100), olderBefore: at(3), hasOlder: true },
			{ id: 'quiet', checkpoint: at(1), olderBefore: at(5), hasOlder: false }
		]);
		expect(coverage).toEqual(new Map([['general', { from: String(cutoff), older: true }]]));
		expect(state.records.messages.map((record) => record.message_id)).toEqual([at(3), at(2), at(5)]);
		expect(state.complete).toBe(true);
		expect(restoredState({ meta, skipped: 1, rooms: [] }, 30 * day, now).state.complete).toBe(false);
	});
});
