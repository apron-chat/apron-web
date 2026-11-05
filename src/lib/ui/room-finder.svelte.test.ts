import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { RoomListing, RoomSnapshot } from '$lib/protocol/client';
import type { RoomRecord } from '$lib/protocol/types';
import { roomSnapshot } from '$lib/test/builders';
import { RoomFinder, type RoomFinderHost } from './room-finder.svelte';
import { parseQuery } from './search';

const listing = (id: string, title: string, parentRoomId?: string, latestLogId?: string): RoomListing => ({
	id, title, joined: false, members: [], record: { room_id: id, title, ...(parentRoomId ? { parent_room_id: parentRoomId } : {}) },
	...(parentRoomId ? { parentRoomId } : {}), ...(latestLogId ? { latestLogId } : {})
});

function setup(rooms: RoomSnapshot[], records: RoomRecord[] = []) {
	const state = $state({ query: '', active: true, canList: true, threadsListed: {} as Record<string, RoomListing[]>, unread: {} as Record<string, number> });
	let settle!: () => void;
	const listRooms = vi.fn(() => new Promise<RoomListing[]>((resolve) => (settle = () => resolve([]))));
	const client = { storedRooms: () => records, listRooms } as unknown as RoomFinderHost['client'];
	let finder!: RoomFinder;
	const stop = $effect.root(() => {
		finder = new RoomFinder({
			client, rooms, listed: [listing('random', 'Random', undefined, '20')], mentions: {}, you: { user_id: 'me' },
			get threadsListed() { return state.threadsListed; }, get unread() { return state.unread; },
			get query() { return parseQuery(state.query); }, get active() { return state.active; }, get canList() { return state.canList; }
		});
	});
	flushSync();
	return { state, finder, listRooms, settle: () => settle(), stop };
}

describe('RoomFinder', () => {
	const rooms = [
		roomSnapshot('general', [], { title: 'General', latestLogId: '30', description: 'Say **hello**.' }),
		roomSnapshot('t1', [], { title: 'Deploy checklist', parentRoomId: 'general', latestLogId: '40' })
	];

	it('finds the rooms and threads the page knows of, joined first, drawn with what is new and where a thread is', () => {
		const { state, finder, stop } = setup(rooms, [{ room_id: 't-old', parent_room_id: 'general', title: 'Deploy freeze', log_id: '1710000000000' }]);
		state.unread = { t1: 2 };
		state.query = 'de';
		flushSync();
		expect(finder.results).toMatchObject([
			{ id: 't1', group: 'Joined', thread: true, parent: 'General', unread: 2, parts: [{ text: 'De', match: true }, { text: 'ploy checklist', match: false }] },
			{ id: 't-old', group: 'Not joined', thread: true, parent: 'General', ago: { title: expect.stringMatching(/^Last active /) } }
		]);
		state.query = '';
		flushSync();
		expect(finder.results.map((result) => result.id)).toEqual(['t1', 'general', 't-old', 'random']);
		expect(finder.results[1]).toMatchObject({ description: 'Say hello.' });
		// Messages searched instead: nothing.
		state.active = false;
		flushSync();
		expect(finder.results).toEqual([]);
		stop();
	});

	it('with room:, lists that room\'s threads you haven\'t joined from the server, once, and says what it listed', async () => {
		const { state, finder, listRooms, settle, stop } = setup(rooms);
		state.query = 'room:#general ';
		flushSync();
		expect(listRooms).toHaveBeenCalledExactlyOnceWith('general');
		expect(finder.foot).toEqual({ note: 'Listing General’s other threads…' });
		expect(finder.results.map((result) => result.id)).toEqual(['t1']);
		// The listing comes in (the client's snapshot, then its promise).
		state.threadsListed = { general: [listing('t2', 'Offsite planning', 'general', '35'), listing('t3', 'Logo', 'general', '25')] };
		settle();
		await Promise.resolve();
		flushSync();
		expect(finder.results.map((result) => [result.id, result.parent])).toEqual([['t1', undefined], ['t2', undefined], ['t3', undefined]]);
		expect(finder.foot).toEqual({ note: 'Threads you haven’t joined: the 2 the server lists, its most recently active.' });
		state.query = 'room:#general off';
		flushSync();
		expect(listRooms).toHaveBeenCalledTimes(1);
		stop();
	});

	it('says when the listing failed, and Try Again lists again, only then', async () => {
		const { state, finder, listRooms, stop } = setup(rooms);
		listRooms.mockRejectedValueOnce(new Error('too many requests'));
		state.query = 'room:#general ';
		flushSync();
		await Promise.resolve();
		flushSync();
		expect(finder.foot).toMatchObject({ note: 'General’s other threads didn’t list: too many requests', label: 'Try Again' });
		// The page changing doesn't ask again by itself.
		state.unread = { t1: 1 };
		flushSync();
		expect(listRooms).toHaveBeenCalledTimes(1);
		finder.foot?.onclick?.();
		flushSync();
		expect(listRooms).toHaveBeenCalledTimes(2);
		expect(finder.foot).toEqual({ note: 'Listing General’s other threads…' });
		stop();
	});

	it('lists nothing where the server lists no rooms, and says nothing then', () => {
		const { state, finder, listRooms, stop } = setup(rooms);
		state.canList = false;
		state.query = 'room:#general ';
		flushSync();
		expect(listRooms).not.toHaveBeenCalled();
		expect(finder.foot).toBeUndefined();
		stop();
	});
});
