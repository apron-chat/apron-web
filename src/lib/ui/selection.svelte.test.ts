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

/** Messages `b…` are someone else's. */
const own = (id: string) => !id.startsWith('b');

describe('MessageSelection.move', () => {
	it('moves your own messages together', async () => {
		const { client, moveMessage } = fakeClient();
		const selection = picked(['1', '2', '3']);
		expect(await selection.move(client, 'thread', own)).toEqual({ moved: true, room: 'thread' });
		expect(moveMessage.mock.calls.map(([id]) => id)).toEqual(['1', '2', '3']);
		expect(selection.active).toBe(false);
	});

	it('tries someone else\'s message first, then moves the rest', async () => {
		const { client, moveMessage } = fakeClient();
		let release!: () => void;
		moveMessage.mockImplementationOnce((id: string) => ({ promise: new Promise((resolve) => { release = () => resolve({ message_id: id }); }) }));
		const selection = picked(['1', 'b2', '3', 'b4']);
		const moving = selection.move(client, 'thread', own);
		// Only the probe is out until the server accepts it.
		expect(moveMessage.mock.calls.map(([id]) => id)).toEqual(['b2']);
		release();
		expect(await moving).toEqual({ moved: true, room: 'thread' });
		expect(moveMessage.mock.calls.map(([id]) => id)).toEqual(['b2', '1', '3', 'b4']);
	});

	it('moves none when the server refuses someone else\'s message', async () => {
		const { client, moveMessage } = fakeClient(['b2']);
		const selection = picked(['1', 'b2', '3']);
		const result = await selection.move(client, 'thread', own);
		expect(result.moved).toBe(false);
		expect(result.moved === false && (result.error as Error).message).toBe('No messages were moved: denied');
		expect(moveMessage.mock.calls.map(([id]) => id)).toEqual(['b2']);
		// The selection stays as it was, ready for Cancel or a change.
		expect(selection.current).toMatchObject({ ids: ['1', 'b2', '3'], saving: false });
		expect(selection.current?.denied).toBeUndefined();
	});

	it('keeps the messages the server refused after the probe picked', async () => {
		const { client } = fakeClient(['3']);
		const selection = picked(['b1', '2', '3']);
		const result = await selection.move(client, 'general', own);
		expect(result.moved).toBe(false);
		expect(selection.current).toMatchObject({ ids: ['3'], denied: { failed: 1, total: 3 } });
	});
});

describe('MessageSelection.moveToNewThread', () => {
	it('creates no thread when a picked message may not be moved', async () => {
		const { client, moveMessage, createRoom } = fakeClient();
		const selection = picked(['1', 'b2']);
		const result = await selection.moveToNewThread(client, ['1', 'b2'], { parentRoomId: 'general', title: () => 'T', own, movable: own });
		expect(result.moved === false && (result.error as Error).message).toBe(NOT_MOVABLE);
		expect(createRoom).not.toHaveBeenCalled();
		expect(moveMessage).not.toHaveBeenCalled();
	});

	it('moves the messages into the thread once it exists, someone else\'s first', async () => {
		const { client, moveMessage } = fakeClient();
		const selection = picked(['1', 'b2']);
		expect(await selection.moveToNewThread(client, ['1', 'b2'], { parentRoomId: 'general', title: () => 'T', own, movable: () => true }))
			.toEqual({ moved: true, room: 'thread_new' });
		expect(moveMessage.mock.calls).toEqual([['b2', 'thread_new'], ['1', 'thread_new']]);
	});
});
