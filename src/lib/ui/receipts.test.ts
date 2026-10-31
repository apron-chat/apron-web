import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { receiptsByMessage } from './receipts';
import type { TimelineItem } from './timeline';

const item = (id: string): TimelineItem => ({ kind: 'message', key: id, grouped: false, event: { message_id: id, log_id: id, room_id: 'private_1', from: { user_id: 'ada' }, body: { text: id } } as MessageRecord });
const timeline: TimelineItem[] = [{ kind: 'date', key: 'd', label: 'Today' }, item('10'), item('20'), item('30')];
const members = [{ user_id: 'ada', name: 'Ada' }, { user_id: 'bob', name: 'Bob' }, { user_id: 'cy', name: 'Cy' }];

describe('receiptsByMessage', () => {
	it('puts each other reader under the newest message shown they read through, as the room knows them', () => {
		const placed = receiptsByMessage(timeline, { members, readers: [{ user_id: 'bob', message_id: '25' }, { user_id: 'cy', message_id: '30' }, { user_id: 'dee', message_id: '99' }] }, 'ada');
		expect(Object.fromEntries(placed)).toEqual({ '20': [{ user_id: 'bob', name: 'Bob' }], '30': [{ user_id: 'cy', name: 'Cy' }, { user_id: 'dee' }] });
	});

	it('shows nobody who read only what is not shown, nor you, and is the same empty map without any', () => {
		const none = receiptsByMessage(timeline, { members, readers: [{ user_id: 'bob', message_id: '5' }, { user_id: 'ada', message_id: '30' }] }, 'ada');
		expect(none.size).toBe(0);
		expect(receiptsByMessage(timeline, { members }, 'ada')).toBe(none);
		expect(receiptsByMessage(timeline, undefined, 'ada')).toBe(none);
	});
});
