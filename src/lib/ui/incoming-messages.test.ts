import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { IncomingMessageTracker } from './incoming-messages';
import { roomSnapshot } from '$lib/test/builders';

const me = { user_id: 'guest_me', name: 'sam' };

const message = (id: number, from = 'ada'): MessageRecord => ({
	message_id: String(id), log_id: String(id), room_id: 'general', from: { user_id: from }, body: { text: `message ${id}` }
});

const room = (messages: MessageRecord[], fields: Partial<RoomSnapshot> = {}): RoomSnapshot => roomSnapshot('general', messages, fields);

describe('incoming message tracking', () => {
	it('ignores history, even history loaded later or after a reset for another backend, and returns each new message from others once', () => {
		const tracker = new IncomingMessageTracker();
		tracker.observe([room([message(10)], { latestLogId: '10' })], me);
		expect(tracker.observe([room([message(10), message(11), message(12, 'guest_me')])], me).map((event) => event.message_id)).toEqual(['11']);
		expect(tracker.observe([room([message(10), message(11), message(12, 'guest_me')])], me)).toEqual([]);
		// History loaded later is behind the room's log position when first seen.
		const later = new IncomingMessageTracker();
		later.observe([room([], { latestLogId: '20' })], me);
		expect(later.observe([room([message(15), message(20), message(21)])], me).map((event) => event.message_id)).toEqual(['21']);
		// Reset when switching backends, it takes the new history as history.
		tracker.reset();
		tracker.observe([room([message(15), message(20)], { latestLogId: '20' })], me);
		expect(tracker.observe([room([message(15), message(20), message(21)])], me).map((event) => event.message_id)).toEqual(['21']);
	});
});
