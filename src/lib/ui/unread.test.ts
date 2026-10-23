import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { UnreadTracker, countElsewhere } from './unread.svelte';
import { messageRecord, roomSnapshot as room } from '$lib/test/builders';

const me = { user_id: 'guest_me', name: 'sam' };

const message = (id: number, roomId: string, from = 'ada', fields: Partial<MessageRecord> = {}): MessageRecord => messageRecord(id, roomId, { from: { user_id: from }, ...fields });

describe('unread tracking', () => {
	it('counts arrivals from others, never history or your own messages', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [message(10, 'general')], { latestLogId: '10' }), room('random', [], { latestLogId: '10' })], me, 'general', true);
		expect(tracker.total).toBe(0);
		tracker.observe([
			room('general', [message(10, 'general')]),
			room('random', [message(20, 'random'), message(21, 'random', me.user_id), message(22, 'random')])
		], me, 'general', true);
		expect(tracker.byRoom).toEqual({ random: 2 });
		expect(tracker.total).toBe(2);
	});

	it('clears a room once you read its end, or your read cursor passes its arrivals', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [], { latestLogId: '10' }), room('random', [], { latestLogId: '10' })], me, 'general', true);
		// Arrivals in the open pane count while you aren't reading its end (scrolled up, or the tab is hidden).
		const general = room('general', [message(20, 'general'), message(21, 'general')]);
		const random = room('random', [message(30, 'random'), message(31, 'random')]);
		tracker.observe([general, random], me, 'general', false);
		expect(tracker.byRoom).toEqual({ general: 2, random: 2 });
		tracker.observe([general, random], me, 'general', true);
		expect(tracker.byRoom).toEqual({ random: 2 });
		// Read on another device up to 30: only 31 is left.
		tracker.observe([general, { ...random, readMessageId: '30' }], me, 'general', true);
		expect(tracker.total).toBe(1);
	});

	it('counts replies in a thread you are not reading, until you open it', () => {
		const tracker = new UnreadTracker();
		const thread = (messages: MessageRecord[]) => room('plans', messages, { parentRoomId: 'general', latestLogId: '10' });
		tracker.observe([room('general', [], { latestLogId: '10' }), thread([])], me, 'general', true);
		tracker.observe([room('general', []), thread([message(20, 'plans'), message(21, 'plans', me.user_id)])], me, 'general', true);
		expect(tracker.byRoom).toEqual({ plans: 1 });
		tracker.observe([room('general', []), thread([message(20, 'plans'), message(21, 'plans', me.user_id)])], me, 'plans', true);
		expect(tracker.byRoom).toEqual({});
	});

	it('drops arrivals that were deleted', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [], { latestLogId: '10' }), room('random', [], { latestLogId: '10' })], me, 'general', true);
		tracker.observe([room('general', []), room('random', [message(20, 'random')])], me, 'general', true);
		expect(tracker.total).toBe(1);
		tracker.observe([room('general', []), room('random', [message(20, 'random', 'ada', { deleted: true })])], me, 'general', true);
		expect(tracker.total).toBe(0);
	});

	it('clears arrivals up to how far you have read, as given', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [], { latestLogId: '10' }), room('random', [], { latestLogId: '10' })], me, 'general', true);
		const random = room('random', [message(20, 'random'), message(21, 'random'), message(22, 'random')]);
		tracker.observe([room('general', []), random], me, 'general', true, () => '21');
		expect(tracker.byRoom).toEqual({ random: 1 });
	});
});

describe('countElsewhere', () => {
	it('adds up every room but the one being read', () => {
		expect(countElsewhere({ general: 3, random: 2, thread_1: 4 }, 'random')).toBe(7);
		expect(countElsewhere({ general: 3 }, 'general')).toBe(0);
		expect(countElsewhere({ general: 3, random: 2 }, undefined)).toBe(5);
	});
});
