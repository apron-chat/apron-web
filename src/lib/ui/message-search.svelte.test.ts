import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { messageRecord, roomSnapshot } from '$lib/test/builders';
import { MessageSearch, SEARCH_DELAY_MS, type MessageSearchHost } from './message-search.svelte';
import { parseQuery } from './search';

/** A search over `records` (what the page holds) and `kept` (what the device keeps), and what it asks the client to load. */
function setup(rooms: RoomSnapshot[], records: MessageRecord[], kept: MessageRecord[] = []) {
	const state = $state({ query: '', active: true, rooms });
	const loadOlder = vi.fn(async (_roomId: string) => {});
	const loadRoom = vi.fn(async (_roomId: string) => {});
	const client = {
		url: 'wss://chat.example', loadOlder, loadRoom,
		snapshot: () => ({ users: {}, you: { user_id: 'me' } }),
		roomRecord: () => undefined,
		storedRecords: () => ({ messages: records })
	} as unknown as MessageSearchHost['client'];
	const searchKept = vi.fn(async (_server: string, _user: string, test: (message: MessageRecord) => boolean) => kept.filter(test));
	let search!: MessageSearch;
	const stop = $effect.root(() => {
		search = new MessageSearch({ client, keeper: { searchKept }, get rooms() { return state.rooms; }, get query() { return parseQuery(state.query); }, get active() { return state.active; } });
	});
	return { state, search, loadOlder, loadRoom, searchKept, stop };
}

/** Lets the pause before a search pass, and the search settle. */
async function searched(): Promise<void> {
	flushSync();
	await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS);
	flushSync();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('MessageSearch', () => {
	it('searches what the device keeps and what the page holds, after a pause, the newest first, each once', async () => {
		const { state, search, searchKept, stop } = setup([roomSnapshot('general')], [messageRecord(3, 'general', { body: { text: 'deploy at 4' } }), messageRecord(1, 'general', { body: { text: 'nothing' } })], [messageRecord(2, 'general', { body: { text: 'Deploy freeze' } }), messageRecord(3, 'general', { body: { text: 'deploy at 4' } })]);
		state.query = 'deploy';
		flushSync();
		expect(search.searching).toBe(true);
		expect(searchKept).not.toHaveBeenCalled();
		await searched();
		expect(search.found.map((message) => message.message_id)).toEqual(['3', '2']);
		expect(search.searching).toBe(false);
		// Another mode: nothing found, nothing searched.
		state.active = false;
		await searched();
		expect(search.found).toEqual([]);
		stop();
	});

	it('Load More from Server pages back in the rooms searched that have more, the most recent first, then searches again', async () => {
		const rooms = [
			roomSnapshot('general', [], { latestLogId: '50', olderAvailable: true }),
			roomSnapshot('t1', [], { parentRoomId: 'general', loaded: false, latestLogId: '60' }),
			roomSnapshot('done', [], { latestLogId: '70' }),
			roomSnapshot('elsewhere', [], { latestLogId: '80', olderAvailable: true })
		];
		const { state, search, loadOlder, loadRoom, searchKept, stop } = setup(rooms, []);
		state.query = 'room:#general deploy';
		await searched();
		expect(search.searched.map((room) => room.id)).toEqual(['general', 't1']);
		expect(search.foot).toMatchObject({ note: 'Older messages in general are on the server.', label: 'Load More from Server' });
		const calls = searchKept.mock.calls.length;
		await search.loadMore();
		expect(loadRoom).toHaveBeenCalledWith('t1');
		expect(loadOlder).toHaveBeenCalledWith('general');
		expect(loadOlder).not.toHaveBeenCalledWith('elsewhere');
		await searched();
		expect(searchKept.mock.calls.length).toBe(calls + 1);
		// Without room:, every room you've joined.
		state.query = 'deploy';
		flushSync();
		expect(search.searched.map((room) => room.id)).toEqual(['general', 't1', 'done', 'elsewhere']);
		// Nothing older anywhere: it says so, with no button.
		state.rooms = rooms.map((room) => ({ ...room, loaded: true, olderAvailable: false }));
		flushSync();
		expect(search.foot).toEqual({ note: 'Everything the server has in your rooms is loaded, and searched.' });
		stop();
	});

	it('says the server sent nothing when every page it asked for failed', async () => {
		const { state, search, loadOlder, stop } = setup([roomSnapshot('general', [], { olderAvailable: true })], []);
		loadOlder.mockRejectedValue(new Error('rate limited'));
		state.query = 'deploy';
		await searched();
		await search.loadMore();
		flushSync();
		expect(search.foot?.note).toBe('The server didn’t send them: rate limited');
		stop();
	});
});
