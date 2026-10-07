import { describe, expect, it } from 'vitest';
import { createTimeline } from '$lib/protocol/reducer';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { keptRoom, keptView, MESSAGES_PER_ROOM, MESSAGE_MAX_AGE_MS, usableView, VIEW_MAX_AGE_MS } from './session-cache';

const now = Date.UTC(2026, 9, 7, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const message = (at: number, text = `at ${at}`): MessageRecord => ({ message_id: String(at), log_id: String(at), room_id: 'general', from: { user_id: 'ada', name: 'Ada' }, body: { text } });

function room(messages: MessageRecord[], fields: Partial<RoomSnapshot> = {}): RoomSnapshot {
	const timeline = { ...createTimeline('general'), events: Object.fromEntries(messages.map((event) => [event.message_id, event])), order: messages.map((event) => event.message_id) };
	return { id: 'general', title: 'General', joined: true, timeline, recovering: false, loaded: true, loading: false, notices: [], ...fields };
}

describe('keptRoom', () => {
	it('keeps the last day of messages, with their reactions and the join lines among them', () => {
		const old = message(now - MESSAGE_MAX_AGE_MS - HOUR);
		const recent = [message(now - 2 * HOUR), message(now - HOUR)];
		const source = room([old, ...recent]);
		const reacted = { ...source.timeline, reactions: { [old.message_id]: [{ emoji: '👍', count: 1, mine: false, users: [] }], [recent[1].message_id]: [{ emoji: '🎉', count: 1, mine: true, users: [] }] }, memberships: [{ log_id: String(now - 3 * HOUR), entries: [] }, { log_id: String(now - 90 * 60 * 1000), entries: [] }] };
		const kept = keptRoom({ ...source, timeline: reacted } as unknown as RoomSnapshot, now);
		expect(kept.timeline.order).toEqual(recent.map((event) => event.message_id));
		expect(Object.keys(kept.timeline.events)).toEqual(recent.map((event) => event.message_id));
		expect(Object.keys(kept.timeline.reactions)).toEqual([recent[1].message_id]);
		// Only the join and leave lines from the oldest kept message on: earlier ones would sit above nothing.
		expect(kept.timeline.memberships.map((record) => record.log_id)).toEqual([String(now - 90 * 60 * 1000)]);
	});

	it('keeps at most the newest messages per room', () => {
		const many = Array.from({ length: MESSAGES_PER_ROOM + 20 }, (_, index) => message(now - HOUR + index));
		const kept = keptRoom(room(many), now);
		expect(kept.timeline.order).toHaveLength(MESSAGES_PER_ROOM);
		expect(kept.timeline.order.at(-1)).toBe(many.at(-1)!.message_id);
	});

	it('shows as catching up, never as the room’s current state, and keeps no notices or errors', () => {
		const kept = keptRoom(room([message(now - HOUR)], { recoveryError: 'nope', loading: true, notices: [{ key: 'n', text: 'hi' } as never] }), now);
		expect([kept.recovering, kept.loaded, kept.loading, kept.notices, kept.recoveryError]).toEqual([true, false, false, [], undefined]);
	});
});

describe('keptView', () => {
	it('keeps every room trimmed, and only the open room’s thread listing', () => {
		const listing = [{ id: 'thread_1', title: 'Deploy', joined: false }] as never;
		const view = keptView({ rooms: [room([message(now - HOUR)])], activeRoom: 'general', you: { user_id: 'ada' }, threadDirectory: { general: listing, other: listing } }, now);
		expect(view.rooms[0].recovering).toBe(true);
		expect(view.threadDirectory).toEqual({ general: listing });
		expect(view.activeRoom).toBe('general');
	});
});

describe('usableView', () => {
	const kept = { v: 1, savedAt: now - HOUR, userId: 'ada', view: { rooms: [] } };

	it('takes a recent view of this version', () => {
		expect(usableView(kept, now)).toBe(kept);
	});

	it('drops one that is too old, of another version, or not a view at all', () => {
		expect(usableView({ ...kept, savedAt: now - VIEW_MAX_AGE_MS - 1 }, now)).toBeUndefined();
		expect(usableView({ ...kept, v: 0 }, now)).toBeUndefined();
		expect(usableView({ ...kept, view: {} }, now)).toBeUndefined();
		expect(usableView('nonsense', now)).toBeUndefined();
		expect(usableView(undefined, now)).toBeUndefined();
	});
});
