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
		expect(timelineMessages(general).length).toBeGreaterThan(0);
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

describe('knobs for the browser suite', () => {
	async function connect(server: MemoryProtocolServer): Promise<ChatClient> {
		const client = new ChatClient('ws://apron-preview.invalid', 'Preview User', server.factory);
		clients.push(client);
		client.start();
		await waitFor(() => client.snapshot().authenticated && client.snapshot().rooms.some((room) => room.id === 'general' && room.loaded));
		return client;
	}
	const room = (client: ChatClient, id: string) => client.snapshot().rooms.find((candidate) => candidate.id === id);

	/** One request on a socket of its own, as a client sends it: its result. */
	async function ask(server: MemoryProtocolServer, frame: Record<string, unknown>): Promise<unknown> {
		const socket = server.factory('ws://apron-preview.invalid');
		const result = new Promise<unknown>((resolve) => {
			socket.onmessage = (event) => {
				const reply = JSON.parse(String(event.data));
				if (reply.id === 'ask') resolve(reply.result);
			};
		});
		await waitFor(() => socket.readyState === 1);
		socket.send(JSON.stringify({ ...frame, id: 'ask' }));
		const answer = await result;
		socket.close();
		return answer;
	}

	it('records every frame the client sends, in order', async () => {
		const server = new MemoryProtocolServer({});
		const client = await connect(server);
		await client.send('general', 'Recorded').promise;
		expect(server.frames.at(-1)).toMatchObject({ method: 'message', params: { room_id: 'general', body: { text: 'Recorded' } } });
	});

	it('drops private from new rooms or new threads, as asked, like a server without private rooms', async () => {
		const threads = await connect(new MemoryProtocolServer({ dropPrivate: 'threads' }));
		const secret = await threads.createRoom({ title: 'Secret', private: true }).promise;
		await waitFor(() => Boolean(room(threads, secret.room_id)));
		expect(room(threads, secret.room_id)?.private).toBe(true);
		const thread = await threads.createRoom({ parentRoomId: secret.room_id, title: 'Leaky' }).promise;
		await waitFor(() => Boolean(room(threads, thread.room_id)));
		expect(room(threads, thread.room_id)?.private).toBeFalsy();

		const rooms = await connect(new MemoryProtocolServer({ dropPrivate: 'rooms' }));
		const open = await rooms.createRoom({ title: 'Secret', private: true }).promise;
		await waitFor(() => Boolean(room(rooms, open.room_id)));
		expect(room(rooms, open.room_id)?.private).toBeFalsy();
	});

	it('seeds long names with four roles, and posts as someone else, live', async () => {
		const server = new MemoryProtocolServer({ seed: 'rich', capabilities: ['status'] });
		const client = await connect(server);
		expect(client.snapshot().server?.capabilities).toContain('status');
		expect(client.snapshot().users.wilhelmina.roles).toHaveLength(4);
		expect(timelineMessages(room(client, 'general')!).some((message) => message.from.user_id === 'bartholomew' && message.reply_to?.message_id === '1710000000001')).toBe(true);

		const id = server.post('general', 'ada', 'Live from Ada');
		await waitFor(() => Boolean(client.message(id)));
		expect(client.message(id)).toMatchObject({ from: { user_id: 'ada' }, body: { text: 'Live from Ada' } });
	});

	it('with status, shows others\' statuses, seen with each change to offline, and none of either in recorded objects (§4.5.2)', async () => {
		const server = new MemoryProtocolServer({ capabilities: ['status'] });
		const client = await connect(server);
		const users = () => client.snapshot().users;
		const linusSeen = users().linus.seen;
		expect([users().ada.status, users().grace.status, users().margaret.status, users().linus.status]).toEqual(['online', 'idle', 'dnd', 'offline']);
		expect(Number(linusSeen)).toBeLessThan(Date.now());
		expect(users().ada.seen).toBeUndefined();

		// Back online: no seen goes out, and the client's kept one stays (hidden while online).
		server.setPresence('linus', 'online');
		await waitFor(() => users().linus.status === 'online');
		expect(users().linus.seen).toBe(linusSeen);
		const offline = Date.now();
		server.setPresence('ada', 'offline');
		await waitFor(() => users().ada.status === 'offline');
		expect(Number(users().ada.seen)).toBeGreaterThanOrEqual(offline);
		// As a server that records seen coarsely might: an earlier one.
		server.setPresence('ada', 'online');
		await waitFor(() => users().ada.status === 'online');
		server.setPresence('ada', 'offline', '1724800000000');
		await waitFor(() => users().ada.status === 'offline');
		expect(users().ada.seen).toBe('1724800000000');

		// Recorded objects carry neither.
		const id = server.post('general', 'ada', 'Gone for the day');
		await waitFor(() => Boolean(client.message(id)));
		expect(client.message(id)?.from).toEqual({ user_id: 'ada', name: 'Ada Lovelace', roles: ['admin'] });

		// Choosing invisible: listings show you offline with seen, which the client takes neither of.
		await client.setStatus('invisible');
		const listed = await ask(server, { method: 'room_list', params: { filter: 'joined' } }) as { users: Record<string, unknown>[] };
		const you = listed.users.find((user) => user.user_id === 'preview_guest')!;
		expect([you.status, typeof you.seen]).toEqual(['offline', 'string']);
		expect(listed.users.find((user) => user.user_id === 'ada')).toMatchObject({ status: 'offline', seen: users().ada.seen });
		expect(listed.users.find((user) => user.user_id === 'linus')).toEqual({ user_id: 'linus', name: 'Linus', status: 'online' });
		await client.listRooms(undefined, 0);
		expect(client.snapshot().you?.status).toBe('invisible');
		expect(users().preview_guest.status).toBe('invisible');
		expect(users().preview_guest.seen).toBeUndefined();
	});

	it('with status, keeps a chosen "" as itself: others see "", not the default online (§4.5.1), and the complete you carries it', async () => {
		const server = new MemoryProtocolServer({ capabilities: ['status'] });
		const client = await connect(server);
		const shown = async () => ((await ask(server, { method: 'room_list', params: { filter: 'joined' } })) as { users: Record<string, unknown>[] }).users.find((user) => user.user_id === 'preview_guest')!;
		// Never chosen: the default, online.
		expect((await shown()).status).toBe('online');
		const you = await client.setStatus('');
		expect(you.status).toBe('');
		expect(client.snapshot().you?.status).toBe('');
		expect((await shown()).status).toBe('');
		await client.setStatus('dnd');
		expect((await shown()).status).toBe('dnd');
	});

	it('leaves the demo as it is without knobs', async () => {
		const client = await connect(new MemoryProtocolServer());
		expect(client.snapshot().server?.capabilities).not.toContain('status');
		expect(client.snapshot().users.wilhelmina).toBeUndefined();
		expect(Object.values(client.snapshot().users).some((user) => 'status' in user || 'seen' in user)).toBe(false);
		expect(timelineMessages(room(client, 'general')!)).toHaveLength(10);
	});
});

describe('in-memory private rooms', () => {
	it('seeds a conversation and a titled private room, starts one untitled, lets a member add people, and ends it with its last member', async () => {
		const server = new MemoryProtocolServer({ account: true });
		const client = new ChatClient('ws://apron-preview.invalid', 'Preview User', server.factory);
		clients.push(client);
		client.start();
		await waitFor(() => client.snapshot().authenticated && client.snapshot().rooms.some((room) => room.id === 'general' && room.loaded));
		const room = (id: string) => client.snapshot().rooms.find((candidate) => candidate.id === id);
		// Signed in to an account, with the private-room limit advertised.
		expect(client.snapshot().passkeySession).toBe(true);
		expect(client.snapshot().server?.ext?.settings).toEqual({ private_rooms: 5 });
		expect(room('private_1710000000050')).toMatchObject({ private: true, namedForMembers: true, title: 'Grace Hopper' });
		expect(room('private_1710000000060')).toMatchObject({ private: true, title: 'Launch plans' });

		const created = await client.createRoom({ private: true }).promise;
		await waitFor(() => room(created.room_id) !== undefined);
		expect(room(created.room_id)).toMatchObject({ private: true, namedForMembers: true, title: 'You' });
		await client.joinRoom(created.room_id, 'linus').promise;
		await waitFor(() => room(created.room_id)?.title === 'Linus');
		// Someone outside it can't see it: listed to its members only.
		const listed = await client.listRooms(undefined, 0);
		expect(listed.some((listing) => listing.id === 'private_1710000000060')).toBe(false);
		// Someone else adds you to one.
		const added = server.addYouToPrivate('margaret');
		await waitFor(() => room(added) !== undefined);
		expect(room(added)?.title).toBe('Margaret Hamilton');
		// The last to leave ends it.
		await client.leaveRoom(created.room_id, 'linus').promise;
		await client.leaveRoom(created.room_id).promise;
		await waitFor(() => room(created.room_id) === undefined);
		await expect(client.joinRoom(created.room_id).promise).rejects.toThrow('Unknown room');
	});
});
