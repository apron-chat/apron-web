import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatClient, timelineMessages, type ClientSnapshot } from '$lib/protocol/client';
import { MemoryProtocolServer } from '$lib/preview/memory-server';
import { openHistory, readHistory, writeHistory } from './history-db';
import { HistoryKeeper, restoredState, type HistoryClient } from './history-keeper';

const URL = 'wss://chat.example/';
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
		keptState: () => client.keptState(),
		storedRecords: (room) => client.storedRecords(room),
		observeStore: (listener) => client.observeStore(listener),
		subscribe: (listener) => client.subscribe(listener),
		message: (id) => client.message(id),
		roomRecord: (id) => client.roomRecord(id),
		restore: (state) => client.restore(state)
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

		const kept = await readHistory(await openHistory(indexedDB), URL);
		expect(kept?.meta).toMatchObject({ userId: 'preview_guest', complete: true });
		expect(kept?.rooms.find((row) => row.room === 'general')?.sync?.checkpoint).toBeDefined();

		// Away: someone posts.
		const posted = server.post('general', 'grace', 'While you were away');
		const from = server.frames.length;
		const second = new ChatClient(URL, 'Ada', server.factory);
		clients.push(second);
		const again = new HistoryKeeper({ indexedDB, locks: null });
		await again.restore(saved(second));
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
		await new HistoryKeeper({ indexedDB, locks: null }).restore(saved(third));
		third.start();
		await waitFor(() => Boolean(room(third.snapshot(), 'general')?.loaded));
		expect(ids(third.snapshot(), 'general')).toEqual([...had.general, posted, live]);
	});

	it('writes everything whole when what is kept changed since it was read, as when another tab wrote', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const indexedDB = new IDBFactory();
		const db = await openHistory(indexedDB);
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
		await writeHistory(db, URL, { changes: [], whole: [{ room: 'general', messages: [ghost], reactions: [], memberships: [] }], rooms: [], dropped: [], meta }, new Set());
		keeper.watch(saved(client));
		client.start();
		await waitFor(() => Boolean(room(client.snapshot(), 'general')?.loaded));
		await keeper.flush();
		const kept = await readHistory(db, URL);
		expect(kept?.messages.map((message) => message.message_id)).not.toContain(ghost.message_id);
		expect(kept?.messages.filter((message) => message.room_id === 'general').map((message) => message.message_id)).toEqual(ids(client.snapshot(), 'general'));
		await keeper.stop();
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
		expect(await readHistory(await openHistory(indexedDB), URL)).toBeUndefined();
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
		const db = await openHistory(indexedDB);
		expect(await readHistory(db, URL)).toBeDefined();
		await keeper.forget(URL);
		expect(await readHistory(db, URL)).toBeUndefined();
		await keeper.setRetention(null);
		await keeper.flush();
		expect(await readHistory(db, URL)).toBeUndefined();
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

describe('HistoryKeeper in two tabs', () => {
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
		const kept = await readHistory(await openHistory(indexedDB), URL);
		expect(kept?.messages.filter((message) => message.room_id === 'general').map((message) => message.message_id)).toEqual(ids(second.snapshot(), 'general'));
		await two.stop();
	});
});

describe('restoredState', () => {
	const day = 24 * 60 * 60 * 1000;
	const now = Date.UTC(2026, 9, 27);
	const at = (daysAgo: number) => String(now - daysAgo * day);
	const message = (id: string, room = 'general') => ({ message_id: id, log_id: id, room_id: room, from: { user_id: 'ada' } });
	const kept = (sync: Record<string, unknown>, messages = [message(at(40)), message(at(10))]) => ({
		meta: { server: URL, userId: 'ada', complete: true, users: [], version: 1, savedAt: now },
		rooms: [{ server: URL, room: 'general', record: { room_id: 'general' }, sync: { id: 'general', ...sync } }],
		messages, reactions: [{ log_id: at(40), message_id: at(40), room_id: 'general', from: { user_id: 'bob' }, emojis: ['👍'] }], memberships: []
	});

	it('keeps what is within the retention, and loads what is older from the server', () => {
		const state = restoredState(kept({ checkpoint: at(1), floor: at(100) }), 30 * day, now);
		expect(state.records.messages.map((record) => record.message_id)).toEqual([at(10)]);
		expect(state.records.reactions).toEqual([]);
		expect(state.rooms[0]).toMatchObject({ checkpoint: at(1), olderBefore: String(now - 30 * day), hasOlder: true });
		expect(state.complete).toBe(true);
	});

	it('starts over a room not caught up since before the cutoff, and lists every room again', () => {
		const state = restoredState(kept({ checkpoint: at(31) }), 30 * day, now);
		expect(state.rooms).toEqual([]);
		expect(state.records.messages).toEqual([]);
		expect(state.complete).toBe(false);
	});

	it('keeps everything without a retention, or where positions are not times', () => {
		expect(restoredState(kept({ checkpoint: at(31) }), undefined, now).records.messages).toHaveLength(2);
		const counted = restoredState(kept({ checkpoint: '20' }, [message('5'), message('19')]), 30 * day, now);
		expect(counted.records.messages).toHaveLength(2);
		expect(counted.rooms[0].olderBefore).toBeUndefined();
	});
});
