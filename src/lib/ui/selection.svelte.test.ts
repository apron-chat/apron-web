import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import { MessageSelection, NOT_MOVABLE } from './selection.svelte';

/** A client whose moves and thread creation resolve, or for `deny` reject, recording what was sent. */
function fakeClient(deny: string[] = []) {
	const moveMessage = vi.fn((id: string) => ({ promise: deny.includes(id) ? Promise.reject(new Error('denied')) : Promise.resolve({ message_id: id }) }));
	const createRoom = vi.fn(() => ({ promise: Promise.resolve({ room_id: 'thread_new' }) }));
	return { client: { moveMessage, createRoom } as unknown as ChatClient, moveMessage, createRoom };
}

function picked(ids: string[]): MessageSelection {
	const selection = new MessageSelection();
	selection.begin('general', ids[0]);
	for (const id of ids.slice(1)) selection.toggle(id, ids);
	return selection;
}

describe('MessageSelection.move', () => {
	it('moves every picked message when each may be moved', async () => {
		const { client, moveMessage } = fakeClient();
		const selection = picked(['1', '2', '3']);
		expect(await selection.move(client, 'thread', () => true)).toEqual({ moved: true, room: 'thread' });
		expect(moveMessage.mock.calls.map(([id]) => id)).toEqual(['1', '2', '3']);
		expect(selection.active).toBe(false);
	});

	it('moves none when one picked message may not be moved', async () => {
		const { client, moveMessage } = fakeClient();
		const selection = picked(['1', '2', '3']);
		const result = await selection.move(client, 'thread', (id) => id !== '2');
		expect(result.moved).toBe(false);
		expect(result.moved === false && (result.error as Error).message).toBe(NOT_MOVABLE);
		expect(moveMessage).not.toHaveBeenCalled();
		// The selection stays as it was, ready for Cancel or a change.
		expect(selection.current).toMatchObject({ ids: ['1', '2', '3'], saving: false });
	});

	it('creates no new thread when one picked message may not be moved', async () => {
		const { client, moveMessage, createRoom } = fakeClient();
		const selection = picked(['1', '2']);
		const result = await selection.moveToNewThread(client, ['1', '2'], { parentRoomId: 'general', title: () => 'T', movable: (id) => id === '1' });
		expect(result.moved).toBe(false);
		expect(createRoom).not.toHaveBeenCalled();
		expect(moveMessage).not.toHaveBeenCalled();
	});

	it('moves a new thread\'s messages once it exists when all may be moved', async () => {
		const { client, moveMessage } = fakeClient();
		const selection = picked(['1', '2']);
		expect(await selection.moveToNewThread(client, ['1', '2'], { parentRoomId: 'general', title: () => 'T', movable: () => true })).toEqual({ moved: true, room: 'thread_new' });
		expect(moveMessage.mock.calls).toEqual([['1', 'thread_new'], ['2', 'thread_new']]);
	});

	it('keeps the messages the server refused picked', async () => {
		const { client } = fakeClient(['2']);
		const selection = picked(['1', '2']);
		const result = await selection.move(client, 'general', () => true);
		expect(result.moved).toBe(false);
		expect(selection.current).toMatchObject({ ids: ['2'], denied: { failed: 1, total: 2 } });
	});
});
