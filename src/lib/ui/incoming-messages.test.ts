import { describe, expect, it } from 'vitest';
import { createTimeline } from '$lib/protocol/reducer';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { IncomingMessageTracker, notificationsByRoom } from './incoming-messages';

const me = { user_id: 'guest_me', name: 'sam' };

const message = (id: number, from = 'ada'): MessageRecord => ({
	message_id: String(id), log_id: String(id), room_id: 'general', from: { user_id: from }, body: { text: `message ${id}` }
});

function room(messages: MessageRecord[], fields: Partial<RoomSnapshot> = {}): RoomSnapshot {
	const timeline = { ...createTimeline('general'), events: Object.fromEntries(messages.map((event) => [event.message_id, event])), order: messages.map((event) => event.message_id) };
	return { id: 'general', title: 'general', joined: true, timeline, recovering: false, loaded: true, loading: false, notices: [], ...fields };
}

describe('incoming message tracking', () => {
	it('ignores existing history and returns each new message from others once', () => {
		const tracker = new IncomingMessageTracker();
		tracker.observe([room([message(10)], { latestLogId: '10' })], me);
		expect(tracker.observe([room([message(10), message(11), message(12, 'guest_me')])], me).map((event) => event.message_id)).toEqual(['11']);
		expect(tracker.observe([room([message(10), message(11), message(12, 'guest_me')])], me)).toEqual([]);
	});

	it('uses room log position to avoid notifying about history loaded later', () => {
		const tracker = new IncomingMessageTracker();
		tracker.observe([room([], { latestLogId: '20' })], me);
		expect(tracker.observe([room([message(15), message(20), message(21)])], me).map((event) => event.message_id)).toEqual(['21']);
	});

	it('can reset its watermark when switching backends', () => {
		const tracker = new IncomingMessageTracker();
		tracker.observe([room([], { latestLogId: '10' })], me);
		tracker.reset();
		tracker.observe([room([message(15), message(20)], { latestLogId: '20' })], me);
		expect(tracker.observe([room([message(15), message(20), message(21)])], me).map((event) => event.message_id)).toEqual(['21']);
	});
});

describe('notifications by room', () => {
	const inRoom = (id: number, roomId: string): MessageRecord => ({ ...message(id), room_id: roomId });

	it('keeps each room\'s newest message, preferring its newest mention', () => {
		const events = [inRoom(1, 'general'), inRoom(2, 'general'), inRoom(3, 'random'), inRoom(4, 'general'), inRoom(5, 'random')];
		expect(notificationsByRoom(events, new Set()).map((event) => event.message_id)).toEqual(['4', '5']);
		expect(notificationsByRoom(events, new Set(['2'])).map((event) => event.message_id)).toEqual(['2', '5']);
	});
});
