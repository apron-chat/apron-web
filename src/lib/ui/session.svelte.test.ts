import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createTimeline } from '$lib/protocol/reducer';
import { capabilitiesOf, type ChatClient, type ClientSnapshot, type RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { blankSnapshot, RECONNECT_QUIET_MS, SessionView, type HeldSession } from './session.svelte';

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

const client = () => ({ selectRoom: vi.fn(), awaitRoom: vi.fn() }) as unknown as ChatClient & { selectRoom: ReturnType<typeof vi.fn>; awaitRoom: ReturnType<typeof vi.fn> };
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
		// Until then, its history goes first.
		session.apply({ ...blankSnapshot(), status: 'connecting' }, chat);
		expect(chat.awaitRoom).toHaveBeenLastCalledWith('thread_1');
		session.apply(ready({ rooms: [room('general', []), room('thread_1', [])], activeRoom: 'general' }), chat);
		expect(chat.selectRoom).toHaveBeenCalledWith('thread_1');
		expect(chat.awaitRoom).toHaveBeenLastCalledWith(undefined);
	});

	it('drops it when the session signs in as someone else, and comes too late once the session is ready', () => {
		const session = new SessionView();
		session.prime(kept);
		session.apply(ready({ you: { user_id: 'bo' }, roomsListed: false }), client());
		flushSync();
		expect(session.rooms).toEqual([]);
		expect(session.showingHeld).toBe(false);
		// Primed once the session is ready, it comes too late.
		const late = new SessionView();
		late.apply(ready({ rooms: [room('general', ['9'])], activeRoom: 'general' }), client());
		late.prime(kept);
		flushSync();
		expect(late.activeRoom?.timeline.order).toEqual(['9']);
	});

	it('keeps a thread’s copy, not loaded on this connection, to stand in until it loads', () => {
		const session = new SessionView();
		const chat = client();
		session.prime(kept);
		const unloaded = room('thread_1', [], { parentRoomId: 'general', loaded: false });
		session.apply(ready({ rooms: [room('general', [], { recovering: true }), unloaded], activeRoom: 'general' }), chat);
		flushSync();
		expect(session.heldCopy(unloaded)?.timeline.order).toEqual(['3']);

		// The room recovers and its live view is held: the thread's copy stays held, and kept, in place of the empty room.
		const general = room('general', ['1', '2', '4']);
		session.apply(ready({ rooms: [general, unloaded], activeRoom: 'general' }), chat);
		flushSync();
		expect(session.activeRoom).toBe(general);
		expect(session.heldCopy(unloaded)?.timeline.order).toEqual(['3']);
		expect(session.keepable?.rooms.map((r) => r.timeline.order)).toEqual([['1', '2', '4'], ['3']]);

		// Loading, still the copy; loaded, or failed, the live one.
		expect(session.heldCopy({ ...unloaded, loading: true })?.timeline.order).toEqual(['3']);
		expect(session.heldCopy(room('thread_1', ['3', '5'], { parentRoomId: 'general' }))).toBeUndefined();
		expect(session.heldCopy(room('thread_1', [], { parentRoomId: 'general' }))).toBeUndefined();
		expect(session.heldCopy({ ...unloaded, recoveryError: 'History failed' })).toBeUndefined();
	});

	it('gives a thread card its copy’s messages while nothing has happened in the thread since', () => {
		const session = new SessionView();
		const chat = client();
		session.prime({ ...kept, rooms: [kept.rooms[0], { ...kept.rooms[1], latestLogId: '3' }] });
		const general = room('general', ['1', '2']);
		const thread = (head: string) => room('thread_1', [], { parentRoomId: 'general', loaded: false, latestLogId: head });
		session.apply(ready({ rooms: [general, thread('3')], activeRoom: 'general' }), chat);
		flushSync();
		const card = session.threadSource('general').rooms.find((r) => r.id === 'thread_1');
		expect(card?.timeline.order).toEqual(['3']);
		expect(card?.loaded).toBe(false);

		// A newer head: the copy's newest reply isn't the newest any more, so the card shows what's live.
		session.apply(ready({ rooms: [general, thread('6')], activeRoom: 'general' }), chat);
		flushSync();
		expect(session.threadSource('general').rooms.find((r) => r.id === 'thread_1')?.timeline.order).toEqual([]);
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

describe('SessionView through a reconnect', () => {
	const server = { apron: 9, auth: ['token'], capabilities: ['history', 'rooms', 'status', 'embed:upload'] };
	const live = (fields: Partial<ClientSnapshot> = {}) => ready({ server, capabilities: capabilitiesOf(server), rooms: [room('general', ['1'])], activeRoom: 'general', passkeySession: true, signedInWith: 'token', signInMethods: ['token'], ...fields });
	const dropped = (at: number, fields: Partial<ClientSnapshot> = {}): ClientSnapshot => ({ ...blankSnapshot(), status: 'reconnecting', disconnectedAt: at, ...fields });

	it('keeps quiet for its first moments, from when it began trying where someone could see it', () => {
		vi.useFakeTimers();
		onTestFinished(() => { vi.useRealTimers(); });
		const session = new SessionView();
		session.apply(live(), client());
		session.apply(dropped(Date.now(), { retryingSince: Date.now() }), client());
		expect(session.reconnectQuiet).toBe(true);
		vi.advanceTimersByTime(RECONNECT_QUIET_MS - 1);
		expect(session.reconnectQuiet).toBe(true);
		// Through catching up after it's back, too: the moment counts from the start of the way back.
		session.apply(live({ rooms: [room('general', ['1'], { recovering: true })] }), client());
		expect(session.reconnectQuiet).toBe(true);
		vi.advanceTimersByTime(1);
		expect(session.reconnectQuiet).toBe(false);
		session.dispose();
	});

	it('counts a stall only while someone could see it: not the time a hidden tab waited', () => {
		vi.useFakeTimers();
		onTestFinished(() => { vi.useRealTimers(); });
		const session = new SessionView();
		session.apply(live(), client());
		// Dropped while hidden, and waited there a minute: not trying, so not stalled.
		const at = Date.now();
		session.apply(dropped(at), client());
		vi.advanceTimersByTime(60_000);
		session.apply(dropped(at), client());
		expect(session.stalled).toBe(false);
		expect(session.reconnectQuiet).toBe(false);
		// Shown again: quiet at first, and stalled only after the full window from there.
		session.apply(dropped(at, { retryingSince: Date.now() }), client());
		expect(session.reconnectQuiet).toBe(true);
		expect(session.stalled).toBe(false);
		vi.advanceTimersByTime(9_999);
		expect(session.stalled).toBe(false);
		vi.advanceTimersByTime(1);
		expect(session.stalled).toBe(true);
		session.dispose();
	});

	it('keeps what it showed of the session while reconnecting quietly, not once it needs someone', () => {
		vi.useFakeTimers();
		onTestFinished(() => { vi.useRealTimers(); });
		const session = new SessionView();
		session.apply(live(), client());
		flushSync();
		session.apply(dropped(Date.now(), { retryingSince: Date.now() }), client());
		flushSync();
		expect(session.ready).toBe(false);
		expect(session.steady).toBe(true);
		expect(session.capabilities.status).toBe(true);
		expect(session.capabilities['embed:upload']).toBe(true);
		expect(session.passkeySession).toBe(true);
		expect(session.signInMethods).toEqual(['token']);
		// Stalled: it says so, and stops pretending.
		vi.advanceTimersByTime(10_000);
		flushSync();
		expect(session.stalled).toBe(true);
		expect(session.steady).toBe(false);
		expect(session.passkeySession).toBe(false);
		session.dispose();
	});

	it('keeps nothing through a reconnect once signed out or offline', () => {
		const session = new SessionView();
		session.apply(live(), client());
		session.apply({ ...blankSnapshot(), status: 'offline' }, client());
		session.apply(dropped(Date.now(), { retryingSince: Date.now() }), client());
		flushSync();
		expect(session.steady).toBe(false);
		expect(session.passkeySession).toBe(false);
		session.dispose();
	});
});

describe('SessionView after a reconnect', () => {
	const server = { apron: 9, auth: ['token'], capabilities: ['history', 'rooms'] };
	const live = (fields: Partial<ClientSnapshot> = {}) => ready({ server, capabilities: capabilitiesOf(server), rooms: [room('general', ['1'])], activeRoom: 'general', ...fields });
	const dropped = (at: number, fields: Partial<ClientSnapshot> = {}): ClientSnapshot => ({ ...blankSnapshot(), status: 'reconnecting', disconnectedAt: at, retryingSince: at, ...fields });

	it('keeps a guest who only reads reading through a quiet reconnect', () => {
		const session = new SessionView();
		session.apply(live({ readOnly: true }), client());
		session.apply(dropped(Date.now()), client());
		flushSync();
		expect(session.steady).toBe(true);
		expect(session.readOnly).toBe(true);
		session.dispose();
	});

	it('keeps nothing of the last account through a restart, such as signing out', () => {
		const session = new SessionView();
		session.apply(live({ passkeySession: true }), client());
		// A restart reconnects with no drop to come back from.
		session.apply({ ...blankSnapshot(), status: 'reconnecting' }, client());
		flushSync();
		expect(session.steady).toBe(false);
		expect(session.passkeySession).toBe(false);
		session.dispose();
	});

	it('shows Try Again under way at once: no quiet moment for the attempt it asked for', () => {
		const session = new SessionView();
		const chat = { selectRoom: vi.fn(), awaitRoom: vi.fn(), retryNow: vi.fn(() => session.apply(dropped(Date.now() - 20_000, { retryingSince: Date.now() }), chat)) } as unknown as ChatClient;
		session.apply(live(), chat);
		session.apply(dropped(Date.now() - 20_000), chat);
		expect(session.reconnectQuiet).toBe(false);
		session.retryNow(chat);
		expect(session.reconnectQuiet).toBe(false);
		expect(session.stalled).toBe(false);
		session.dispose();
	});
});

describe('SessionView quiet moments', () => {
	it('gives each reconnect its own, even one that starts at the same time as the last', () => {
		vi.useFakeTimers();
		onTestFinished(() => { vi.useRealTimers(); });
		const session = new SessionView();
		const at = Date.now();
		const away = (fields: Partial<ClientSnapshot> = {}): ClientSnapshot => ({ ...blankSnapshot(), status: 'reconnecting', disconnectedAt: at, ...fields });
		session.apply(ready(), client());
		session.apply(away({ retryingSince: at }), client());
		expect(session.reconnectQuiet).toBe(true);
		vi.advanceTimersByTime(RECONNECT_QUIET_MS);
		expect(session.reconnectQuiet).toBe(false);
		// Back, then away again on a clock that hasn't moved (a coarse one, or a test's).
		vi.setSystemTime(at);
		session.apply(ready(), client());
		session.apply(away({ retryingSince: at }), client());
		expect(session.reconnectQuiet).toBe(true);
		session.dispose();
	});
});

describe('SessionView, snapshot by snapshot', () => {
	const server = { apron: 9, auth: ['token'], capabilities: ['history', 'rooms'] };
	const live = (rooms: RoomSnapshot[], fields: Partial<ClientSnapshot> = {}) => ready({ server, capabilities: capabilitiesOf(server), rooms, activeRoom: 'general', ...fields });

	it('checks again only what reads a part that changed', () => {
		const general = room('general', ['1']);
		const ops = room('ops', ['2']);
		const session = new SessionView();
		const chat = client();
		session.apply(live([general, ops]), chat);
		const seen = { rooms: 0, activeRoomId: 0, capabilities: 0 };
		const cleanup = $effect.root(() => {
			$effect(() => void (session.rooms, seen.rooms++));
			$effect(() => void (session.activeRoomId, seen.activeRoomId++));
			$effect(() => void (session.capabilities, seen.capabilities++));
		});
		flushSync();
		expect(seen).toEqual({ rooms: 1, activeRoomId: 1, capabilities: 1 });

		// A new snapshot saying the same, in fresh lists and objects, as the client makes each one.
		session.apply(live([general, ops], { pending: [] }), chat);
		flushSync();
		expect(seen).toEqual({ rooms: 1, activeRoomId: 1, capabilities: 1 });

		// A message in ops: the rooms change, not the open room's id.
		session.apply(live([general, room('ops', ['2', '3'])]), chat);
		flushSync();
		expect(seen).toEqual({ rooms: 2, activeRoomId: 1, capabilities: 1 });
		cleanup();
	});
});
