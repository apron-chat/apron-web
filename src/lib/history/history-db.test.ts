import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { StoreChange } from '$lib/protocol/reducer';
import type { MessageRecord } from '$lib/protocol/types';
import { readKept } from '$lib/test/kept-history';
import { deleteHistory, HistoryGone, HistoryMissing, historyName, listHistories, openHistory, pageHistory, pruneHistory, readHistory, scanMessages, writeHistory, type HistoryWrite } from './history-db';

const SERVER = 'wss://chat.example/';
const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 27);
const at = (daysAgo: number, plus = 0) => String(now - daysAgo * day + plus);
const ada = { user_id: 'ada' };
const message = (id: string, log = id, room = 'general', text = 'hi'): MessageRecord => ({ message_id: id, log_id: log, room_id: room, from: ada, body: { text } });
const meta = { server: SERVER, userId: 'ada', complete: true, users: [] };

function write(fields: Partial<HistoryWrite>): HistoryWrite {
	return { changes: [], whole: [], rooms: [], dropped: [], meta, ...fields };
}

async function opened(server = SERVER, userId = 'ada') {
	return openHistory(new IDBFactory(), historyName(server, userId));
}

describe('writeHistory', () => {
	it('keeps one row per message and reaction set, moving with the message, and only in rooms kept', async () => {
		const db = await opened();
		const first = message(at(2));
		const sync = { id: 'general', checkpoint: at(1) };
		await writeHistory(db, write({ whole: [{ room: 'general', messages: [first], reactions: [], memberships: [] }], rooms: [{ room: 'general', sync }] }), new Set());
		const changes: StoreChange[] = [
			{ kind: 'message', record: message(first.message_id, at(1), 'general', 'edited') },
			{ kind: 'reaction', set: { log_id: at(1, 1), message_id: first.message_id, room_id: 'general', from: ada, emojis: ['👍'] } },
			{ kind: 'reaction', set: { log_id: at(1, 2), message_id: first.message_id, room_id: 'general', from: ada, emojis: ['🎉'] } },
			{ kind: 'message', record: message(at(1, 3), at(1, 3), 'elsewhere') }
		];
		const version = await writeHistory(db, write({ changes }), new Set(['general']));
		const kept = await readKept(db);
		expect(kept?.meta.version).toBe(version);
		expect(kept?.messages).toEqual([message(first.message_id, at(1), 'general', 'edited')]);
		expect(kept?.reactions.map((set) => set.emojis)).toEqual([['🎉']]);

		// Moved to a room that isn't kept: gone from the one it left.
		await writeHistory(db, write({ changes: [{ kind: 'message', record: message(first.message_id, at(0), 'elsewhere') }] }), new Set(['general']));
		expect((await readKept(db))?.messages).toEqual([]);
	});

	it('drops what a bound or a rebuild drops, and a rebuild’s sync with it', async () => {
		const db = await opened();
		const membership = { log_id: at(3), room_id: 'general', user: ada, joined: true };
		await writeHistory(db, write({
			whole: [{ room: 'general', messages: [message(at(3)), message(at(1))], reactions: [{ log_id: at(3), message_id: at(1), room_id: 'general', from: ada, emojis: ['👍'] }], memberships: [membership] }],
			rooms: [{ room: 'general', record: { room_id: 'general' }, sync: { id: 'general', checkpoint: at(1) } }]
		}), new Set());
		await writeHistory(db, write({ changes: [{ kind: 'evict', room: 'general', floor: at(2) }] }), new Set(['general']));
		let kept = await readKept(db);
		expect(kept?.messages.map((record) => record.message_id)).toEqual([at(1)]);
		expect(kept?.memberships).toEqual([]);
		expect(kept?.reactions).toHaveLength(1);

		await writeHistory(db, write({ changes: [{ kind: 'membership', entry: membership }, { kind: 'clearRoom', room: 'general' }] }), new Set(['general']));
		kept = await readKept(db);
		expect(kept?.messages).toEqual([]);
		expect(kept?.reactions).toEqual([]);
		expect(kept?.memberships).toEqual([membership]);
		expect(kept?.rooms).toEqual([{ room: 'general', record: { room_id: 'general' } }]);
	});

	it('replaces an earlier snapshot below where a room is written over from', async () => {
		const db = await opened();
		await writeHistory(db, write({ whole: [{ room: 'general', messages: [message(at(5)), message(at(4))], reactions: [], memberships: [] }] }), new Set());
		// Edited since: the client holds its latest snapshot, above `from`, and the room from there.
		const edited = message(at(5), at(1), 'general', 'edited');
		await writeHistory(db, write({ whole: [{ room: 'general', from: Number(at(2)), messages: [edited], reactions: [], memberships: [] }] }), new Set());
		expect((await readKept(db))?.messages).toEqual([message(at(4)), edited]);
	});

	it('writes nothing on top of what is kept once another tab has forgotten it', async () => {
		const db = await opened();
		await expect(writeHistory(db, write({ continues: true, whole: [{ room: 'general', messages: [message(at(1))], reactions: [], memberships: [] }] }), new Set())).rejects.toBeInstanceOf(HistoryGone);
		expect(await readKept(db)).toBeUndefined();
	});

	it('keeps the users as they are when a write leaves them out', async () => {
		const db = await opened();
		await writeHistory(db, write({ meta: { ...meta, users: [ada], aliases: { guest_1: 'ada' } } }), new Set());
		const { users: _users, ...withoutUsers } = meta;
		await writeHistory(db, write({ meta: { ...withoutUsers, complete: false } }), new Set());
		expect((await readKept(db))?.meta).toMatchObject({ users: [ada], aliases: { guest_1: 'ada' }, complete: false });
		await writeHistory(db, write({ meta: { ...meta, users: [] } }), new Set());
		expect((await readKept(db))?.meta).not.toHaveProperty('aliases');
	});

	it('keeps only the rooms named, and starts over on a reset', async () => {
		const db = await opened();
		const room = (id: string) => ({ room: id, messages: [message(at(1), at(1), id)], reactions: [], memberships: [] });
		await writeHistory(db, write({ whole: [room('a'), room('b')], rooms: ['a', 'b'].map((id) => ({ room: id, sync: { id } })) }), new Set());
		await writeHistory(db, write({ keepOnly: ['a'] }), new Set(['a', 'b']));
		expect((await readKept(db))?.rooms.map((row) => row.room)).toEqual(['a']);
		await writeHistory(db, write({ reset: true }), new Set());
		const kept = await readKept(db);
		expect(kept?.rooms).toEqual([]);
		expect(kept?.messages).toEqual([]);
	});
});

describe('pruneHistory', () => {
	it('drops everything logged before the cutoff in rooms whose positions are times', async () => {
		const db = await opened();
		const edited = message(at(40), at(1));
		await writeHistory(db, write({
			whole: [
				{ room: 'general', messages: [message(at(40)), message(at(35)), edited], memberships: [{ log_id: at(40), room_id: 'general', user: ada, joined: true }],
					reactions: [{ log_id: at(40, 1), message_id: edited.message_id, room_id: 'general', from: ada, emojis: ['👍'] }, { log_id: at(35, 1), message_id: at(35), room_id: 'general', from: ada, emojis: ['👎'] }] },
				{ room: 'counted', messages: [message('5', '5', 'counted')], reactions: [], memberships: [] }
			],
			rooms: [{ room: 'general', sync: { id: 'general', checkpoint: at(1) } }, { room: 'counted', sync: { id: 'counted', checkpoint: '9' } }]
		}), new Set());
		const before = (await readKept(db))!.meta.version;
		// `at(40)` was edited a day ago: its row sits at the edit, and stays.
		const versions = await pruneHistory(db, now - 30 * day);
		// A new version, so a tab paging what it restored from here knows it changed.
		expect(versions).toEqual({ from: before, to: before + 1 });
		expect((await readKept(db))?.meta.version).toBe(before + 1);
		expect(await pruneHistory(db, now - 30 * day)).toBeUndefined();
		const kept = await readKept(db);
		expect(kept?.messages.map((record) => record.message_id).sort()).toEqual([at(40), '5']);
		// Even a reaction set on a message edited since: a page from here, which starts at the cutoff, never holds it.
		expect(kept?.reactions).toEqual([]);
		expect(kept?.memberships).toEqual([]);
	});
});

describe('scanMessages', () => {
	it('visits every message kept, room by room, past one read’s worth, and nothing else', async () => {
		const db = await opened();
		const many = Array.from({ length: 1234 }, (_, n) => message(String(1000 + n), String(1000 + n), n % 2 ? 'a' : 'b'));
		const reactions = [{ log_id: '5000', message_id: '1000', room_id: 'b', from: ada, emojis: ['👍'] }];
		await writeHistory(db, write({ whole: [
			{ room: 'a', messages: many.filter((record) => record.room_id === 'a'), reactions: [], memberships: [{ log_id: '999', room_id: 'a', user: ada, joined: true }] },
			{ room: 'b', messages: many.filter((record) => record.room_id === 'b'), reactions, memberships: [] }
		] }), new Set());
		const seen: string[] = [];
		await scanMessages(db, (record) => seen.push(record.message_id));
		expect(seen.sort()).toEqual(many.map((record) => record.message_id).sort());
		// Stopped after its first read: 500 rows, one of them a membership.
		let visits = 0;
		await scanMessages(db, () => visits++, () => true);
		expect(visits).toBe(499);
	});
});

describe('history databases', () => {
	it('take an empty database of a history’s name, as WebKit can leave after an aborted upgrade, for none: deleted, then made anew or none', async () => {
		const databases = new IDBFactory();
		/** At the version, without the stores: what WebKit bug 213116 leaves where `existing` aborted the upgrade. */
		const leftover = (name: string) => new Promise<void>((done) => {
			const request = databases.open(name, 1);
			request.onsuccess = () => {
				request.result.close();
				done();
			};
		});
		const read = historyName(SERVER, 'left-read');
		await leftover(read);
		await expect(openHistory(databases, read, undefined, { existing: true })).rejects.toBeInstanceOf(HistoryMissing);
		expect((await listHistories(databases)).map((entry) => entry.name)).not.toContain(read);

		const kept = historyName(SERVER, 'left-write');
		await leftover(kept);
		const db = await openHistory(databases, kept);
		expect([...db.objectStoreNames].sort()).toEqual(['meta', 'records', 'rooms']);
		await writeHistory(db, write({ whole: [{ room: 'general', messages: [message('1')], reactions: [], memberships: [] }] }), new Set(['general']));
		expect((await readKept(db))?.messages.map((record) => record.message_id)).toEqual(['1']);
		db.close();
	});

	it('open only if there is one when asked to (`existing`), making none where there isn’t', async () => {
		const databases = new IDBFactory();
		const name = historyName(SERVER, 'nobody');
		await expect(openHistory(databases, name, undefined, { existing: true })).rejects.toBeInstanceOf(HistoryMissing);
		expect((await listHistories(databases)).map((entry) => entry.name)).not.toContain(name);

		(await openHistory(databases, name)).close();
		const db = await openHistory(databases, name, undefined, { existing: true });
		expect(db.objectStoreNames.contains('records')).toBe(true);
		db.close();
	});

	it('are one per account on each server, named for both, and listed by them', async () => {
		const databases = new IDBFactory();
		const names = [historyName(SERVER, 'ada'), historyName(SERVER, 'bo:b%20'), historyName('wss://other.example/', 'ada')];
		for (const name of names) (await openHistory(databases, name)).close();
		// Not one of these.
		(await openHistory(databases, 'apron-history')).close();
		(await openHistory(databases, 'apron-history:x:y:z')).close();
		expect((await listHistories(databases)).map(({ server, userId }) => [server, userId]).sort()).toEqual([[SERVER, 'ada'], [SERVER, 'bo:b%20'], ['wss://other.example/', 'ada']]);
		expect((await listHistories(databases, SERVER)).map((entry) => entry.userId).sort()).toEqual(['ada', 'bo:b%20']);
	});

	it('close where they are open when another tab deletes them', async () => {
		const databases = new IDBFactory();
		const name = historyName(SERVER, 'ada');
		let closed = 0;
		const db = await openHistory(databases, name, () => closed++);
		await writeHistory(db, write({}), new Set());
		await deleteHistory(databases, name);
		expect(closed).toBe(1);
		expect(await listHistories(databases)).toEqual([]);
	});
});

describe('pages of a room’s kept log', () => {
	/** A seeded room: logs 1–`size`, some with two or three rows (a message, its reaction set, a membership) at one `log_id`. */
	async function seeded(seed: number, size: number) {
		const db = await openHistory(new IDBFactory(), historyName(SERVER, `pages-${seed}-${size}`));
		let state = seed;
		const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
		const tx = db.transaction(['meta', 'rooms', 'records'], 'readwrite');
		tx.objectStore('meta').put({ ...meta, version: 1, savedAt: now }, 'meta');
		tx.objectStore('rooms').put({ room: 'general', sync: {} });
		for (let log = 1; log <= size; log++) {
			const kinds = random() < 0.25 ? ['m', 'r', 'j'].slice(0, 2 + Math.floor(random() * 2)) : ['m'];
			for (const kind of kinds) tx.objectStore('records').put({ room: 'general', log, kind, id: `${kind}${log}`, value: kind === 'm' ? message(`m${log}`, String(log)) : { log_id: String(log) } });
		}
		tx.objectStore('records').put({ room: 'other', log: 3, kind: 'm', id: 'x', value: message('x', '3', 'other') });
		await new Promise((done) => (tx.oncomplete = done));
		return db;
	}

	/** Runs `read` with `getAllRecords` as the browser has it, and again as one without it reads. */
	async function bothWays<T>(read: () => Promise<T>): Promise<{ records: T; cursor: T }> {
		const proto = IDBObjectStore.prototype as { getAllRecords?: unknown };
		const records = await read();
		const kept = proto.getAllRecords;
		expect(typeof kept).toBe('function');
		proto.getAllRecords = undefined;
		try {
			return { records, cursor: await read() };
		} finally {
			proto.getAllRecords = kept;
		}
	}

	it('are the same read in one request (`getAllRecords`) as with a cursor, never splitting the rows at one log_id', async () => {
		for (const [seed, size] of [[1, 0], [2, 1], [3, 7], [4, 40], [5, 90], [6, 120]]) {
			const db = await seeded(seed, size);
			for (const limit of [1, 2, 3, 5, 20, 50, 200])
				for (const query of [{ limit }, { limit, before: '30' }, { limit, after: '10' }, { limit, after: '10', before: '25' }, { limit, before: '1' }, { limit, after: String(size) }])
					for (const from of [undefined, 5, 60]) {
						// A range whose bottom is above its top is one no caller asks for (IndexedDB can't make it).
						if (query.before !== undefined && Math.max(from ?? 0, Number(query.after ?? 0)) > Number(query.before)) continue;
						const { records, cursor } = await bothWays(() => pageHistory(db, 'general', query, from));
						expect(records, `seed ${seed}, ${JSON.stringify(query)}, from ${from}`).toEqual(cursor);
					}
			const plan = () => ({});
			const { records, cursor } = await bothWays(() => readHistory(db, 50, plan));
			expect(records).toEqual(cursor);
			db.close();
		}
	});
});

