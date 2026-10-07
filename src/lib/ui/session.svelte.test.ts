import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createTimeline } from '$lib/protocol/reducer';
import type { ChatClient, ClientSnapshot, RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { blankSnapshot, SessionView, type HeldSession } from './session.svelte';

const message = (id: string, room = 'general'): MessageRecord => ({ message_id: id, log_id: id, room_id: room, from: { user_id: 'ada' }, body: { text: id } });

function room(id: string, ids: string[], fields: Partial<RoomSnapshot> = {}): RoomSnapshot {
	const timeline = { ...createTimeline(id), events: Object.fromEntries(ids.map((m) => [m, message(m, id)])), order: ids };
	return { id, title: id, joined: true, timeline, recovering: false, loaded: true, loading: false, notices: [], ...fields };
}

const ada = { user_id: 'ada', name: 'Ada' };
const kept: HeldSession = {
	rooms: [room('general', ['1', '2'], { recovering: true, loaded: false }), room('thread_1', ['3'], { parentRoomId: 'general', recovering: true, loaded: false })],
	activeRoom: 'general',
	you: ada,
	threadDirectory: { general: [{ id: 'thread_9', title: 'Older thread', joined: false } as never] }
};

const client = () => ({ selectRoom: vi.fn() }) as unknown as ChatClient & { selectRoom: ReturnType<typeof vi.fn> };
const ready = (fields: Partial<ClientSnapshot> = {}): ClientSnapshot => ({ ...blankSnapshot(), status: 'connected', authenticated: true, you: ada, roomsListed: true, ...fields });

describe('SessionView, primed with a view kept on this device', () => {
	it('shows it while the session comes up, as catching up, and keeps nothing of it', () => {
		const session = new SessionView();
		session.prime(kept);
		flushSync();
		expect(session.showingHeld).toBe(true);
		expect(session.rooms.map((r) => r.id)).toEqual(['general', 'thread_1']);
		expect(session.activeRoom?.timeline.order).toEqual(['1', '2']);
		expect(session.activeRoomHeld).toBe(true);
		expect(session.you).toEqual(ada);
		expect(session.keepable).toBeUndefined();
		// The thread cards come from the same view as its messages.
		expect(session.threadSource('general').directory).toEqual(kept.threadDirectory!.general);
	});

	it('keeps the open room’s copy up while the live one recovers and its threads are listed, then changes over', () => {
		const session = new SessionView();
		const chat = client();
		session.prime(kept);
		const recovering = room('general', [], { recovering: true });
		session.apply(ready({ rooms: [recovering], activeRoom: 'general' }), chat);
		flushSync();
		expect(session.showingHeld).toBe(false);
		expect(session.activeRoom?.timeline.order).toEqual(['1', '2']);
		expect(session.activeRoomHeld).toBe(true);

		const live = room('general', ['1', '2', '4']);
		session.awaitThreads('general');
		session.apply(ready({ rooms: [live], activeRoom: 'general' }), chat);
		flushSync();
		// Recovered, but its threads aren't listed yet: still the copy, so its cards don't arrive on their own.
		expect(session.activeRoom?.timeline.order).toEqual(['1', '2']);

		session.awaitThreads(undefined);
		flushSync();
		expect(session.activeRoom).toBe(live);
		expect(session.activeRoomHeld).toBe(false);
		// Now the live view is what's held, and what's worth keeping.
		expect(session.keepable?.rooms).toEqual([live]);
	});

	it('opens the kept view’s room again once the server lists it', () => {
		const session = new SessionView();
		const chat = client();
		session.prime({ ...kept, activeRoom: 'thread_1' });
		session.apply(ready({ rooms: [room('general', []), room('thread_1', [])], activeRoom: 'general' }), chat);
		expect(chat.selectRoom).toHaveBeenCalledWith('thread_1');
	});

	it('drops it when the session signs in as someone else', () => {
		const session = new SessionView();
		session.prime(kept);
		session.apply(ready({ you: { user_id: 'bo' }, roomsListed: false }), client());
		flushSync();
		expect(session.rooms).toEqual([]);
		expect(session.showingHeld).toBe(false);
	});

	it('comes too late once the session is ready', () => {
		const session = new SessionView();
		session.apply(ready({ rooms: [room('general', ['9'])], activeRoom: 'general' }), client());
		session.prime(kept);
		flushSync();
		expect(session.activeRoom?.timeline.order).toEqual(['9']);
	});
});

describe('SessionView.starting', () => {
	it('is true until the rooms are listed, unless something went wrong', () => {
		const session = new SessionView();
		session.apply({ ...blankSnapshot(), status: 'connecting' }, client());
		flushSync();
		expect(session.starting).toBe(true);
		session.apply({ ...blankSnapshot(), status: 'offline' }, client());
		flushSync();
		expect(session.starting).toBe(false);
		session.apply({ ...blankSnapshot(), status: 'connecting', signInNeeded: 'webauthn' }, client());
		flushSync();
		expect(session.starting).toBe(false);
		session.apply(ready(), client());
		flushSync();
		expect(session.starting).toBe(false);
	});
});
