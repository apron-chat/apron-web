import { afterEach, describe, expect, it } from 'vitest';
import { ChatClient, timelineMessages } from '$lib/protocol/client';
import { MemoryProtocolServer } from './memory-server';

const clients: ChatClient[] = [];
afterEach(() => {
	for (const client of clients.splice(0)) client.stop();
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('Preview protocol did not settle');
}

describe('in-memory preview protocol', () => {
	it('authenticates, lists seeded rooms, loads history, and handles app mutations', async () => {
		const server = new MemoryProtocolServer();
		const client = new ChatClient('ws://apron-preview.invalid', 'Preview User', server.factory);
		clients.push(client);
		client.start();
		await waitFor(() => client.snapshot().authenticated && client.snapshot().rooms.some((room) => room.id === 'general' && room.loaded));

		const general = client.snapshot().rooms.find((room) => room.id === 'general')!;
		expect(timelineMessages(general)).toHaveLength(10);
		// The last seeded message carries two finished image uploads, for the image viewer.
		const photos = timelineMessages(general).at(-1)?.body?.embeds ?? [];
		expect(photos.map((embed) => [embed.kind, embed.og?.image?.url?.startsWith('data:image/jpeg;base64,')])).toEqual([['upload', true], ['upload', true]]);
		await client.listRooms('general', 0);
		expect(client.snapshot().rooms.some((room) => room.id === 'thread_deploy')).toBe(true);
		await client.loadRoom('thread_deploy');
		expect(client.message('1710000000003')?.room_id).toBe('thread_deploy');
		const currentGeneral = client.snapshot().rooms.find((room) => room.id === 'general')!;
		expect(timelineMessages(currentGeneral).some((message) => message.message_id === '1710000000003')).toBe(false);

		const sent = await client.send('general', 'A message from the preview').promise;
		await waitFor(() => {
			const room = client.snapshot().rooms.find((candidate) => candidate.id === 'general');
			return room ? timelineMessages(room).some((message) => message.message_id === sent.message_id) : false;
		});
		await client.editMessage(sent.message_id, 'Edited in preview').promise;
		await client.react(timelineMessages(general)[0].message_id, ['✨']).promise;
		await client.updateProfile({ name: 'Preview Renamed' });
		await client.command('general', '/help').promise;

		const created = await client.createRoom({ parentRoomId: 'general', title: 'Preview thread' }).promise;
		await waitFor(() => client.snapshot().rooms.some((room) => room.id === created.room_id));
		expect(client.snapshot().rooms.find((room) => room.id === created.room_id)?.parentRoomId).toBe('general');
	});

	it('keeps descriptions, private rooms, and members added or removed by others', async () => {
		const server = new MemoryProtocolServer();
		const client = new ChatClient('ws://apron-preview.invalid', 'Preview User', server.factory);
		clients.push(client);
		client.start();
		await waitFor(() => client.snapshot().authenticated && client.snapshot().rooms.some((room) => room.id === 'general' && room.loaded));
		const room = (id: string) => client.snapshot().rooms.find((candidate) => candidate.id === id);
		expect(room('general')?.description).toMatch(/Say hello/);
		expect(client.snapshot().users.ada.roles).toEqual(['admin']);

		await client.updateRoom('general', { description: 'Deploys only' }).promise;
		await waitFor(() => room('general')?.description === 'Deploys only');
		expect(room('general')?.title).toBe('general');

		const created = await client.createRoom({ title: 'Secret', private: true }).promise;
		await waitFor(() => Boolean(room(created.room_id)));
		expect(room(created.room_id)?.private).toBe(true);
		await client.joinRoom(created.room_id, 'grace').promise;
		await waitFor(() => Boolean(room(created.room_id)?.members?.some((member) => member.user_id === 'grace')));
		await client.leaveRoom(created.room_id, 'grace').promise;
		await waitFor(() => !room(created.room_id)?.members?.some((member) => member.user_id === 'grace'));
		// Once left, a private room is invisible.
		await client.leaveRoom(created.room_id).promise;
		await waitFor(() => !room(created.room_id));
		await expect(client.joinRoom(created.room_id).promise).rejects.toThrow('Unknown room');
	});

	it('merges ext on message saves, room_set and me, drops it on tombstones, and answers with the complete you', async () => {
		const server = new MemoryProtocolServer();
		const frames: Array<Record<string, unknown>> = [];
		const factory = server.factory;
		const client = new ChatClient('ws://apron-preview.invalid', 'Preview User', (url) => {
			const socket = factory(url);
			const deliver = (socket as unknown as { deliver: (frame: Record<string, unknown>) => void }).deliver;
			(socket as unknown as { deliver: (frame: Record<string, unknown>) => void }).deliver = (frame) => {
				frames.push(frame);
				deliver(frame);
			};
			return socket;
		});
		clients.push(client);
		client.start();
		await waitFor(() => client.snapshot().authenticated && client.snapshot().rooms.some((room) => room.id === 'general' && room.loaded));
		// The auth result comes first: nothing the sign-in causes precedes it (§3.2).
		expect(frames[0]).toMatchObject({ method: 'server' });
		expect(frames[1]).toMatchObject({ result: { you: { user_id: 'preview_guest' } } });

		const sent = await client.send('general', 'with ext', 'plain', { ext: { a: 1, b: { c: 2 } } }).promise;
		await waitFor(() => client.message(sent.message_id)?.ext !== undefined);
		await client.saveMessage(sent.message_id, { ext: { a: '', d: null } }).promise;
		await waitFor(() => client.message(sent.message_id)?.log_id !== sent.message_id);
		expect(client.message(sent.message_id)?.ext).toEqual({ b: { c: 2 }, d: null });
		// An edit sends no ext: the server keeps it.
		await client.editMessage(sent.message_id, 'edited').promise;
		expect(client.message(sent.message_id)?.ext).toEqual({ b: { c: 2 }, d: null });
		await client.deleteMessage(sent.message_id).promise;
		expect(client.message(sent.message_id)).toMatchObject({ deleted: true });
		expect(client.message(sent.message_id)).not.toHaveProperty('ext');
		expect(client.message(sent.message_id)).not.toHaveProperty('body');

		const room = () => client.snapshot().rooms.find((candidate) => candidate.id === 'general');
		await client.updateRoom('general', { ext: { irc: { channel: '#general' }, x: 1 } }).promise;
		await waitFor(() => room()?.ext !== undefined);
		await client.updateRoom('general', { title: 'General', ext: { x: [] } }).promise;
		await waitFor(() => room()?.title === 'General');
		expect(room()?.ext).toEqual({ irc: { channel: '#general' } });

		const you = await client.updateProfile({ ext: { theme: 'dark', lang: 'en' } });
		expect(you.ext).toEqual({ theme: 'dark', lang: 'en' });
		const after = await client.updateProfile({ ext: { lang: '' } });
		expect(after).toEqual({ user_id: 'preview_guest', name: 'Preview User', ext: { theme: 'dark' } });
	});

	it('moves messages with their author and resolves reactions in the latest room', async () => {
		const server = new MemoryProtocolServer();
		const client = new ChatClient('ws://apron-preview.invalid', 'Preview User', server.factory);
		clients.push(client);
		client.start();
		await waitFor(() => client.snapshot().authenticated && client.snapshot().rooms.some((room) => room.id === 'general' && room.loaded));

		const movedId = '1710000000001';
		await client.moveMessage(movedId, 'thread_deploy').promise;
		await waitFor(() => client.message(movedId)?.room_id === 'thread_deploy');
		expect(client.message(movedId)?.from.user_id).toBe('ada');

		const afterMove = client.snapshot();
		expect(timelineMessages(afterMove.rooms.find((room) => room.id === 'general')!).some((message) => message.message_id === movedId)).toBe(false);
		expect(timelineMessages(afterMove.rooms.find((room) => room.id === 'thread_deploy')!).filter((message) => message.message_id === movedId)).toHaveLength(1);

		// The seeded moved message has an older snapshot in #general. Reactions
		// must follow its newer #thread_deploy snapshot, not the stale copy.
		const seededId = '1710000000003';
		await client.loadRoom('thread_deploy');
		await client.react(seededId, ['✨']).promise;
		await waitFor(() => Boolean(client.snapshot().rooms.find((room) => room.id === 'thread_deploy')?.timeline.reactions[seededId]?.length));
		const afterReaction = client.snapshot();
		expect(afterReaction.rooms.find((room) => room.id === 'thread_deploy')?.timeline.reactions[seededId]).toBeDefined();
		expect(afterReaction.rooms.find((room) => room.id === 'general')?.timeline.reactions[seededId]).toBeUndefined();
	});
});
