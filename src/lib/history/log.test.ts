import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { MembershipEntry, MessageRecord, ReactionSet } from '$lib/protocol/types';
import { openHistory, pageHistory, writeHistory } from './history-db';
import { historyResult, pageQuery, roomLog, sliceLog, type PageQuery } from './log';

const SERVER = 'wss://chat.example/';
const ada = { user_id: 'ada' };
const bob = { user_id: 'bob' };
const message = (log: number): MessageRecord => ({ message_id: String(log), log_id: String(log), room_id: 'general', from: ada });
const reaction = (log: number, of: number, from = ada): ReactionSet => ({ log_id: String(log), message_id: String(of), room_id: 'general', from, emojis: ['👍'] });
const member = (log: number, user = ada): MembershipEntry => ({ log_id: String(log), room_id: 'general', user, joined: true });

/** Messages at 10, 20, … 200, a reaction record of two sets at 105, and a membership record of two entries at 55. */
const records = {
	messages: Array.from({ length: 20 }, (_, n) => message((n + 1) * 10)),
	reactions: [reaction(105, 100), reaction(105, 100, bob)],
	memberships: [member(55), member(55, bob)]
};
const log = roomLog(records);

describe('sliceLog', () => {
	it('takes the newest up to `before`, or the oldest from `after`, and says whether more match', () => {
		expect(sliceLog(log, { limit: 3 }).page.map((entry) => entry.log)).toEqual(['180', '190', '200']);
		expect(sliceLog(log, { before: '35', limit: 2 })).toMatchObject({ page: [{ log: '20' }, { log: '30' }], more: true });
		expect(sliceLog(log, { after: '190', limit: 5 })).toMatchObject({ page: [{ log: '190' }, { log: '200' }], more: false });
		expect(sliceLog(log, { after: '201', limit: 5 })).toEqual({ page: [], more: false });
	});

	it('never splits a record’s sets or entries, even past the limit', () => {
		// 50, both entries at 55, 60: the limit of 2 would end inside the record at 55.
		expect(sliceLog(log, { after: '50', limit: 2 }).page.map((entry) => entry.log)).toEqual(['50', '55', '55']);
		expect(sliceLog(log, { before: '110', limit: 2 }).page.map((entry) => entry.log)).toEqual(['105', '105', '110']);
	});
});

describe('historyResult', () => {
	it('folds the sets and entries at one log_id into one record, as a server sends them', () => {
		const { page, more } = sliceLog(log, { after: '55', before: '105', limit: 200 });
		const result = historyResult(page, more, { latest: '200', history: '10' });
		expect(result.memberships).toEqual([{ log_id: '55', room_id: 'general', members: [{ user: ada, joined: true }, { user: bob, joined: true }] }]);
		expect(result.reactions).toEqual([{ log_id: '105', message_id: '100', room_id: 'general', reactions: [{ from: ada, emojis: ['👍'] }, { from: bob, emojis: ['👍'] }] }]);
		expect(result).toMatchObject({ first_log_id: '55', last_log_id: '105', more: false, latest_log_id: '200', history_log_id: '10' });
	});

	it('reads limits and bounds as a server would', () => {
		expect(pageQuery({ after: '5', before: 'x', limit: 1000 })).toEqual({ after: '5', limit: 200 });
		expect(pageQuery({ limit: -1 })).toEqual({ limit: 200 });
	});
});

describe('pageHistory', () => {
	it('pages what is kept on this device exactly as the log in memory pages', async () => {
		const db = await openHistory(new IDBFactory());
		await writeHistory(db, SERVER, { changes: [], whole: [{ room: 'general', ...records }], rooms: [], dropped: [], meta: { server: SERVER, userId: 'ada', complete: true, users: [] } }, new Set());
		const queries: PageQuery[] = [
			{ limit: 3 }, { limit: 200 }, { before: '35', limit: 2 }, { before: '110', limit: 2 }, { after: '50', limit: 2 },
			{ after: '190', limit: 5 }, { after: '201', limit: 5 }, { after: '20', before: '60', limit: 200 }, { before: '9', limit: 5 }
		];
		for (const query of queries) {
			const { page, more } = await pageHistory(db, SERVER, 'general', query);
			expect({ query, page, more }).toEqual({ query, ...sliceLog(log, query) });
		}
		// Nothing below `from`.
		expect((await pageHistory(db, SERVER, 'general', { before: '60', limit: 200 }, 40)).page.map((entry) => entry.log)).toEqual(['40', '50', '55', '55', '60']);
	});
});
