import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { receiptsByMessage, steadyReceipts } from './receipts';
import type { TimelineItem } from './timeline';

const item = (id: string): TimelineItem => ({ kind: 'message', key: id, grouped: false, event: { message_id: id, log_id: id, room_id: 'private_1', from: { user_id: 'ada' }, body: { text: id } } as MessageRecord });
const timeline: TimelineItem[] = [{ kind: 'date', key: 'd', label: 'Today' }, item('10'), item('20'), item('30')];
const members = [{ user_id: 'ada', name: 'Ada' }, { user_id: 'bob', name: 'Bob' }, { user_id: 'cy', name: 'Cy' }];

describe('receiptsByMessage', () => {
	it('puts each other reader under the newest message shown they read through, as the room knows them', () => {
		const placed = receiptsByMessage(timeline, { members, readers: [{ user_id: 'bob', message_id: '25' }, { user_id: 'cy', message_id: '30' }] }, 'ada');
		expect(Object.fromEntries(placed)).toEqual({ '20': [{ user_id: 'bob', name: 'Bob' }], '30': [{ user_id: 'cy', name: 'Cy' }] });
		// Members not yet known: each reader by user_id alone.
		expect(Object.fromEntries(receiptsByMessage(timeline, { readers: [{ user_id: 'dee', message_id: '99' }] }, 'ada'))).toEqual({ '30': [{ user_id: 'dee' }] });
	});

	it('shows nobody who read only what is not shown, nor you, and is the same empty map without any', () => {
		const none = receiptsByMessage(timeline, { members, readers: [{ user_id: 'bob', message_id: '5' }, { user_id: 'ada', message_id: '30' }] }, 'ada');
		expect(none.size).toBe(0);
		expect(receiptsByMessage(timeline, { members }, 'ada')).toBe(none);
		expect(receiptsByMessage(timeline, undefined, 'ada')).toBe(none);
	});

	it('shows nobody who has left the room, where its members are known', () => {
		const placed = receiptsByMessage(timeline, { members: members.filter((member) => member.user_id !== 'bob'), readers: [{ user_id: 'bob', message_id: '25' }, { user_id: 'cy', message_id: '30' }] }, 'ada');
		expect(Object.fromEntries(placed)).toEqual({ '30': [{ user_id: 'cy', name: 'Cy' }] });
	});
});

describe('steadyReceipts', () => {
	it('keeps the faces of each message that did not change, and the whole map when none did', () => {
		const last = new Map([['20', [{ user_id: 'bob', name: 'Bob' }]], ['30', [{ user_id: 'cy', name: 'Cy' }]]]);
		const same = new Map([['20', [{ user_id: 'bob', name: 'Bob' }]], ['30', [{ user_id: 'cy', name: 'Cy' }]]]);
		expect(steadyReceipts(last, same)).toBe(last);
		const moved = steadyReceipts(last, new Map([['20', [{ user_id: 'bob', name: 'Bob' }]], ['40', [{ user_id: 'cy', name: 'Cy' }]]]));
		expect(moved).not.toBe(last);
		expect(moved.get('20')).toBe(last.get('20'));
		expect(moved.get('40')).toEqual([{ user_id: 'cy', name: 'Cy' }]);
	});

	it('places a receipt on the newest message before a system one, which draws none', () => {
		const system = { kind: 'message', key: '40', grouped: false, event: { message_id: '40', log_id: '40', room_id: 'private_1', from: { user_id: '~room' }, body: { text: 'renamed' } } } as TimelineItem;
		const placed = receiptsByMessage([...timeline, system], { members, readers: [{ user_id: 'bob', message_id: '40' }] }, 'ada');
		expect(Object.fromEntries(placed)).toEqual({ '30': [{ user_id: 'bob', name: 'Bob' }] });
	});
});
