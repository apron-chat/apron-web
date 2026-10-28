import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { StoreChange } from '$lib/protocol/reducer';
import type { MessageRecord } from '$lib/protocol/types';
import { readKept } from '$lib/test/kept-history';
import { openHistory, pruneHistory, writeHistory, type HistoryWrite } from './history-db';

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

async function opened() {
	return openHistory(new IDBFactory());
}

describe('writeHistory', () => {
	it('keeps one row per message and reaction set, moving with the message, and only in rooms kept', async () => {
		const db = await opened();
		const first = message(at(2));
		const sync = { id: 'general', checkpoint: at(1) };
		await writeHistory(db, SERVER, write({ whole: [{ room: 'general', messages: [first], reactions: [], memberships: [] }], rooms: [{ server: SERVER, room: 'general', sync }] }), new Set());
		const changes: StoreChange[] = [
			{ kind: 'message', record: message(first.message_id, at(1), 'general', 'edited') },
			{ kind: 'reaction', set: { log_id: at(1, 1), message_id: first.message_id, room_id: 'general', from: ada, emojis: ['👍'] } },
			{ kind: 'reaction', set: { log_id: at(1, 2), message_id: first.message_id, room_id: 'general', from: ada, emojis: ['🎉'] } },
			{ kind: 'message', record: message(at(1, 3), at(1, 3), 'elsewhere') }
		];
		const version = await writeHistory(db, SERVER, write({ changes }), new Set(['general']));
		const kept = await readKept(db, SERVER);
		expect(kept?.meta.version).toBe(version);
		expect(kept?.messages).toEqual([message(first.message_id, at(1), 'general', 'edited')]);
		expect(kept?.reactions.map((set) => set.emojis)).toEqual([['🎉']]);

		// Moved to a room that isn't kept: gone from the one it left.
		await writeHistory(db, SERVER, write({ changes: [{ kind: 'message', record: message(first.message_id, at(0), 'elsewhere') }] }), new Set(['general']));
		expect((await readKept(db, SERVER))?.messages).toEqual([]);
	});

	it('drops what a bound or a rebuild drops, and a rebuild’s sync with it', async () => {
		const db = await opened();
		const membership = { log_id: at(3), room_id: 'general', user: ada, joined: true };
		await writeHistory(db, SERVER, write({
			whole: [{ room: 'general', messages: [message(at(3)), message(at(1))], reactions: [{ log_id: at(3), message_id: at(1), room_id: 'general', from: ada, emojis: ['👍'] }], memberships: [membership] }],
			rooms: [{ server: SERVER, room: 'general', record: { room_id: 'general' }, sync: { id: 'general', checkpoint: at(1) } }]
		}), new Set());
		await writeHistory(db, SERVER, write({ changes: [{ kind: 'evict', room: 'general', floor: at(2) }] }), new Set(['general']));
		let kept = await readKept(db, SERVER);
		expect(kept?.messages.map((record) => record.message_id)).toEqual([at(1)]);
		expect(kept?.memberships).toEqual([]);
		expect(kept?.reactions).toHaveLength(1);

		await writeHistory(db, SERVER, write({ changes: [{ kind: 'membership', entry: membership }, { kind: 'clearRoom', room: 'general' }] }), new Set(['general']));
		kept = await readKept(db, SERVER);
		expect(kept?.messages).toEqual([]);
		expect(kept?.reactions).toEqual([]);
		expect(kept?.memberships).toEqual([membership]);
		expect(kept?.rooms).toEqual([{ server: SERVER, room: 'general', record: { room_id: 'general' } }]);
	});

	it('keeps only the rooms named, and starts over on a reset', async () => {
		const db = await opened();
		const room = (id: string) => ({ room: id, messages: [message(at(1), at(1), id)], reactions: [], memberships: [] });
		await writeHistory(db, SERVER, write({ whole: [room('a'), room('b')], rooms: ['a', 'b'].map((id) => ({ server: SERVER, room: id, sync: { id } })) }), new Set());
		await writeHistory(db, SERVER, write({ keepOnly: ['a'] }), new Set(['a', 'b']));
		expect((await readKept(db, SERVER))?.rooms.map((row) => row.room)).toEqual(['a']);
		await writeHistory(db, 'wss://other.example/', write({ whole: [room('c')] }), new Set());
		await writeHistory(db, SERVER, write({ reset: true }), new Set());
		const kept = await readKept(db, SERVER);
		expect(kept?.rooms).toEqual([]);
		expect(kept?.messages).toEqual([]);
		expect((await readKept(db, 'wss://other.example/'))?.messages).toHaveLength(1);
	});
});

describe('pruneHistory', () => {
	it('drops everything logged before the cutoff in rooms whose positions are times', async () => {
		const db = await opened();
		const edited = message(at(40), at(1));
		await writeHistory(db, SERVER, write({
			whole: [
				{ room: 'general', messages: [message(at(40)), message(at(35)), edited], memberships: [{ log_id: at(40), room_id: 'general', user: ada, joined: true }],
					reactions: [{ log_id: at(40, 1), message_id: edited.message_id, room_id: 'general', from: ada, emojis: ['👍'] }, { log_id: at(35, 1), message_id: at(35), room_id: 'general', from: ada, emojis: ['👎'] }] },
				{ room: 'counted', messages: [message('5', '5', 'counted')], reactions: [], memberships: [] }
			],
			rooms: [{ server: SERVER, room: 'general', sync: { id: 'general', checkpoint: at(1) } }, { server: SERVER, room: 'counted', sync: { id: 'counted', checkpoint: '9' } }]
		}), new Set());
		// `at(40)` was edited a day ago: its row sits at the edit, and stays.
		await pruneHistory(db, now - 30 * day);
		const kept = await readKept(db, SERVER);
		expect(kept?.messages.map((record) => record.message_id).sort()).toEqual([at(40), '5']);
		// Even a reaction set on a message edited since: a page from here, which starts at the cutoff, never holds it.
		expect(kept?.reactions).toEqual([]);
		expect(kept?.memberships).toEqual([]);
	});
});
