import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { inMutedRoom, inNotifyScopes, notifyScopeNotes, notifyScopesOf, pushWake } from './notify-scopes';

const ada = { user_id: 'ada', name: 'Ada' };

function message(id: string, room: string, from: string, extra: Partial<MessageRecord> = {}): MessageRecord {
	return { message_id: id, log_id: id, room_id: room, from: { user_id: from }, body: { text: 'hi' }, ...extra };
}

function room(id: string, options: { joined?: boolean; private?: boolean; parent?: string; messages?: MessageRecord[]; muted?: boolean } = {}): RoomSnapshot {
	const events = Object.fromEntries((options.messages ?? []).map((event) => [event.message_id, event]));
	return {
		id, title: id, joined: options.joined ?? true,
		...(options.private ? { private: true } : {}),
		...(options.parent ? { parentRoomId: options.parent } : {}),
		...(options.muted ? { mutedUntil: true } : {}),
		timeline: { order: Object.keys(events), events }
	} as unknown as RoomSnapshot;
}

describe('what to notify about', () => {
	const mine = message('10', 'general', 'ada');
	const rooms = [
		room('general', { messages: [mine, message('11', 'general', 'bob')] }),
		room('secret', { private: true }),
		room('t1', { parent: 'secret' }),
		room('lobby', { joined: false }),
		room('t2', { parent: 'general', joined: false }),
		room('quiet', { private: true, muted: true }),
		room('t3', { parent: 'quiet' })
	];
	const judge = (event: MessageRecord, scopes: string[], mentioned = false) => inNotifyScopes(event, scopes, { me: ada, mentioned, rooms });

	it('takes the stored choice in order, else mentions and replies', () => {
		expect(notifyScopesOf(['joined', 'mentions', 'ext:x'])).toEqual(['mentions', 'joined']);
		expect(notifyScopesOf(undefined)).toEqual(['mentions', 'replies']);
		expect(notifyScopesOf([])).toEqual(['mentions', 'replies']);
	});

	it('notifies about a mention with mentions checked', () => {
		const event = message('20', 'lobby', 'bob');
		expect(judge(event, ['mentions'], true)).toBe(true);
		expect(judge(event, ['mentions'], false)).toBe(false);
		expect(judge(event, ['replies', 'private'], true)).toBe(false);
	});

	it('notifies about a reply to one of your loaded messages with replies checked', () => {
		expect(judge(message('21', 'lobby', 'bob', { reply_to: { message_id: '10' } }), ['replies'])).toBe(true);
		// A reply to someone else's message.
		expect(judge(message('22', 'lobby', 'bob', { reply_to: { message_id: '11' } }), ['replies'])).toBe(false);
		// The replied-to message isn't loaded here: no notification.
		expect(judge(message('23', 'lobby', 'bob', { reply_to: { message_id: '99' } }), ['replies'])).toBe(false);
		expect(judge(message('24', 'lobby', 'bob'), ['replies'])).toBe(false);
	});

	it('notifies about messages in private rooms, and their threads, with private checked', () => {
		expect(judge(message('25', 'secret', 'bob'), ['private'])).toBe(true);
		expect(judge(message('26', 't1', 'bob'), ['private'])).toBe(true);
		expect(judge(message('27', 'general', 'bob'), ['private'])).toBe(false);
	});

	it('notifies about every message in joined rooms with joined checked', () => {
		expect(judge(message('28', 'general', 'bob'), ['joined'])).toBe(true);
		expect(judge(message('29', 'lobby', 'bob'), ['joined'])).toBe(false);
		// A thread of a joined room counts as joined, like `private` follows its room.
		expect(judge(message('29b', 't2', 'bob'), ['joined'])).toBe(true);
	});

	it('notifies about nothing in a room you muted, or its threads, mentions included (§4.5)', () => {
		expect(judge(message('40', 'quiet', 'bob'), ['joined', 'private'])).toBe(false);
		expect(judge(message('41', 't3', 'bob', { reply_to: { message_id: '10' } }), ['joined', 'replies'])).toBe(false);
		expect(judge(message('42', 'quiet', 'bob'), ['mentions', 'joined'], true)).toBe(false);
		expect(judge(message('43', 't3', 'bob'), ['mentions'], true)).toBe(false);
		expect(inMutedRoom(message('44', 't3', 'bob'), rooms)).toBe(true);
		expect(inMutedRoom(message('45', 'general', 'bob'), rooms)).toBe(false);
	});

	it('never notifies about your own or deleted messages', () => {
		expect(judge(message('30', 'general', 'ada'), ['joined', 'mentions'], true)).toBe(false);
		expect(judge(message('31', 'general', 'bob', { deleted: true }), ['joined'])).toBe(false);
		expect(inNotifyScopes(message('32', 'general', 'bob'), ['joined'], { me: undefined, mentioned: false, rooms })).toBe(false);
	});

	it('sends push the checked scopes the server pushes, or no `wake` when it lists none', () => {
		expect(pushWake(['mentions', 'private', 'joined'], ['mentions', 'replies', 'private'])).toEqual(['mentions', 'private']);
		expect(pushWake(['joined'], ['mentions', 'replies'])).toEqual([]);
		expect(pushWake(['joined'], [])).toBeUndefined();
	});

	it('notes the checked scopes the server doesn\'t push as desktop only, only while push is on', () => {
		const note = 'Desktop only';
		expect(notifyScopeNotes(['mentions', 'private', 'joined'], ['mentions', 'replies', 'private'], true)).toEqual({ joined: note });
		expect(notifyScopeNotes(['joined'], ['mentions'], false)).toEqual({});
		expect(notifyScopeNotes(['joined'], [], true)).toEqual({});
	});
});
