import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/protocol/client';
import { MessageSelection, NOT_MOVABLE } from './selection.svelte';

/** A client whose moves and thread creation resolve, or for `deny` reject, recording what was sent. */
function fakeClient(deny: string[] = []) {
	const moveMessage = vi.fn((id: string) => ({ promise: deny.includes(id) ? Promise.reject(new Error('denied')) : Promise.resolve({ message_id: id }) }));
	const createRoom = vi.fn(() => ({ promise: Promise.resolve({ room_id: 'thread_new' }) }));
	const joinRoom = vi.fn((_room: string, user: string) => ({ promise: deny.includes(user) ? Promise.reject(new Error('not added')) : Promise.resolve({}) }));
	return { client: { moveMessage, createRoom, joinRoom } as unknown as ChatClient, moveMessage, createRoom, joinRoom };
}

function picked(ids: string[]): MessageSelection {
	const selection = new MessageSelection();
	selection.begin('general', ids[0]);
	for (const id of ids.slice(1)) selection.toggle(id, ids);
	return selection;
}

/** Messages `b…` are someone else's. */
const own = (id: string) => !id.startsWith('b');

/** Who wrote each message: `me` mine, `bob` the `b…` ones, and `b3` by `bea`; `amy` is in every thread already. */
const authors = {
	of: (id: string) => (own(id) ? 'me' : id === 'b3' ? 'bea' : 'bob'),
	skip: (user: string) => user === 'me' || user === 'amy'
};

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

	it('moves none when the server refuses someone else\'s message, and keeps those it refuses after that probe', async () => {
		const { client, moveMessage } = fakeClient(['b2']);
		const selection = picked(['1', 'b2', '3']);
		const result = await selection.move(client, 'thread', own);
		expect(result.moved).toBe(false);
		expect(result.moved === false && (result.error as Error).message).toBe('No messages were moved: denied');
		expect(moveMessage.mock.calls.map(([id]) => id)).toEqual(['b2']);
		// The selection stays as it was, ready for Cancel or a change.
		expect(selection.current).toMatchObject({ ids: ['1', 'b2', '3'], saving: false });
		expect(selection.current?.denied).toBeUndefined();
		// Refused after the probe passed: the refused ones stay picked.
		const later = fakeClient(['3']);
		const rest = picked(['b1', '2', '3']);
		expect((await rest.move(later.client, 'general', own)).moved).toBe(false);
		expect(rest.current).toMatchObject({ ids: ['3'], denied: { failed: 1, total: 3 } });
	});
});

describe('MessageSelection.move with authors', () => {
	it('adds each moved message\'s author to the thread once, but you and those in it', async () => {
		const { client, joinRoom } = fakeClient();
		const selection = picked(['1', 'b2', 'b3', 'b4']);
		expect(await selection.move(client, 'thread', own, { ...authors, of: (id) => (id === 'b4' ? 'amy' : authors.of(id)) })).toEqual({ moved: true, room: 'thread' });
		expect(joinRoom.mock.calls).toEqual([['thread', 'bob'], ['thread', 'bea']]);
	});

	it('adds only the authors of messages that moved, and no one without authors, as for a move back to the room', async () => {
		const back = fakeClient();
		await picked(['b1', '2']).move(back.client, 'general', own);
		expect(back.joinRoom).not.toHaveBeenCalled();
		const { client, joinRoom } = fakeClient(['b2']);
		await picked(['b2', '1']).move(client, 'thread', own, authors);
		expect(joinRoom).not.toHaveBeenCalled();
		const partly = fakeClient(['b3']);
		await picked(['b2', 'b3']).move(partly.client, 'thread', own, authors);
		expect(partly.joinRoom.mock.calls).toEqual([['thread', 'bob']]);
	});

	it('still counts the move done when the server won\'t add an author, and says how many it didn\'t', async () => {
		const { client } = fakeClient(['bea']);
		const result = await picked(['b2', 'b3']).move(client, 'thread', own, authors);
		expect(result).toEqual({ moved: true, room: 'thread', unadded: { failed: 1, total: 2, error: new Error('not added') } });
	});
});

describe('MessageSelection.moveToNewThread', () => {
	it('creates no thread when a picked message may not be moved', async () => {
		const { client, moveMessage, createRoom } = fakeClient();
		const selection = picked(['1', 'b2']);
		expect(selection.checkMovable(own)?.message).toBe(NOT_MOVABLE);
		const result = await selection.moveToNewThread(client, { parentRoomId: 'general', title: 'T', own, movable: own });
		expect(result.moved === false && (result.error as Error).message).toBe(NOT_MOVABLE);
		expect(createRoom).not.toHaveBeenCalled();
		expect(moveMessage).not.toHaveBeenCalled();
	});

	it('creates the thread with the title and description asked for, then moves the messages in, someone else\'s first, adding their authors', async () => {
		const { client, moveMessage, createRoom } = fakeClient();
		const selection = picked(['1', 'b2']);
		expect(selection.checkMovable(() => true)).toBeUndefined();
		expect(await selection.moveToNewThread(client, { parentRoomId: 'general', title: 'T', description: 'About T', own, movable: () => true }))
			.toEqual({ moved: true, room: 'thread_new' });
		expect(createRoom).toHaveBeenCalledWith({ parentRoomId: 'general', title: 'T', description: 'About T' });
		expect(moveMessage.mock.calls).toEqual([['b2', 'thread_new'], ['1', 'thread_new']]);
		// With authors, they are added to it.
		const { client: adding, joinRoom } = fakeClient();
		await picked(['1', 'b2']).moveToNewThread(adding, { parentRoomId: 'general', title: 'T', own, movable: () => true, authors });
		expect(joinRoom.mock.calls).toEqual([['thread_new', 'bob']]);
	});

	it('names the thread it created when the moves fail', async () => {
		const { client } = fakeClient(['b2']);
		const selection = picked(['1', 'b2']);
		const result = await selection.moveToNewThread(client, { parentRoomId: 'general', title: 'T', own, movable: () => true });
		expect(result).toMatchObject({ moved: false, room: 'thread_new' });
		const refused = await picked(['1']).moveToNewThread(client, { parentRoomId: 'general', title: 'T', own, movable: () => true, check: () => new Error('visible') });
		expect(refused).toMatchObject({ moved: false, room: 'thread_new', error: new Error('visible') });
	});

	it('suggests a title from the earliest picked message', () => {
		const selection = picked(['3', '1', '2']);
		expect(selection.earliest(['1', '2', '3'])).toBe('1');
		expect(new MessageSelection().earliest(['1'])).toBeUndefined();
	});
});
