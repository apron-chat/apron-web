import { afterEach, describe, expect, it, vi } from 'vitest';
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
			// Every frame the server sends, as the client's handler receives it.
			let handler: ((event: MessageEvent) => void) | null = null;
			Object.defineProperty(socket, 'onmessage', {
				get: () => handler,
				set: (next: ((event: MessageEvent) => void) | null) => {
					handler = next && ((event) => {
						frames.push(JSON.parse(event.data as string) as Record<string, unknown>);
						next(event);
					});
				}
			});
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

		// The complete you carries your permissions too (ext:permissions), which a `me` doesn't change.
		const you = await client.updateProfile({ ext: { theme: 'dark', lang: 'en' } });
		expect(you.ext).toEqual({ theme: 'dark', lang: 'en', permissions: { add_members: true } });
		const after = await client.updateProfile({ ext: { lang: '' } });
		expect(after).toEqual({ user_id: 'preview_guest', name: 'Preview User', ext: { theme: 'dark', permissions: { add_members: true } } });
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

describe('in-memory live text (§4.8.3, §4.8.5, §4.8.6)', () => {
	async function connect(server: MemoryProtocolServer): Promise<ChatClient> {
		const client = new ChatClient('ws://apron-preview.invalid', 'Preview User', server.factory);
		clients.push(client);
		client.start();
		await waitFor(() => client.snapshot().authenticated && client.snapshot().rooms.some((room) => room.id === 'general' && room.loaded));
		return client;
	}
	const latest = (client: ChatClient) => timelineMessages(client.snapshot().rooms.find((room) => room.id === 'general')).at(-1)!;
	const embedOf = (client: ChatClient) => (latest(client).body?.embeds as Record<string, unknown>[] | undefined)?.[0];
	/** All of a response's text, once it ends. */
	const read = async (response: Response) => response.text();

	it('advertises both kinds, and lists the commands in /help', async () => {
		const server = new MemoryProtocolServer({});
		const client = await connect(server);
		expect(client.snapshot().server?.capabilities).toEqual(expect.arrayContaining(['embed:terminal', 'embed:append']));
		expect(client.snapshot().server?.apron).toBe(10);
		await client.command('general', '/help').promise;
		await waitFor(() => (client.snapshot().rooms.find((room) => room.id === 'general')?.notices.length ?? 0) > 0);
		const help = String(client.snapshot().rooms.find((room) => room.id === 'general')!.notices.at(-1)!.body?.text);
		expect(help).toContain('/embed-terminal [title]');
		expect(help).toContain('/embed-append [markdown]');
	});

	it('/embed-terminal: a write URL and a recipe, then the message once the PUT starts, live at its url, finished with its output', async () => {
		const server = new MemoryProtocolServer({ liveDemo: 'off' });
		const client = await connect(server);
		const before = latest(client).message_id;
		const result = await client.command('general', '/embed-terminal make test').promise;
		const [written] = result.embeds as { embed_id: string; kind: string; write_url: string }[];
		expect(written).toMatchObject({ kind: 'terminal', write_url: expect.stringMatching(/^http:\/\/apron-preview\.invalid\/write\//) });
		await waitFor(() => (client.snapshot().rooms.find((room) => room.id === 'general')?.notices.length ?? 0) > 0);
		const notice = String(client.snapshot().rooms.find((room) => room.id === 'general')!.notices.at(-1)!.body?.text);
		expect(notice).toContain(`curl -sT - '${written.write_url}'`);
		expect(notice).toContain("stty cols 80 rows 40");
		// Nothing is posted before the PUT.
		expect(latest(client).message_id).toBe(before);

		let push!: ReadableStreamDefaultController<Uint8Array>;
		const put = server.fetchLive(written.write_url, { method: 'PUT', body: new ReadableStream<Uint8Array>({ start: (c) => (push = c) }), duplex: 'half' } as RequestInit);
		await waitFor(() => latest(client).message_id !== before);
		expect(latest(client)).toMatchObject({ from: { user_id: 'preview_guest' }, body: { text: '', embeds: [{ embed_id: written.embed_id, kind: 'terminal', title: 'make test' }] } });
		const url = String(embedOf(client)!.url);
		expect(url).toMatch(/^http:\/\/apron-preview\.invalid\/live\//);
		push.enqueue(new TextEncoder().encode('$ make test\r\n'));
		await waitFor(() => server['lives'].get(written.embed_id)!.chunks.length === 1);
		// A reader that comes in late gets the text from its start, then the rest.
		const reading = server.fetchLive(url, {});
		const response = await reading;
		expect([response.headers.get('content-type'), response.headers.get('x-content-type-options')]).toEqual(['text/plain; charset=utf-8', 'nosniff']);
		push.enqueue(new TextEncoder().encode('\u001b[32mok\u001b[0m\r\n'));
		push.close();
		expect((await put).status).toBe(204);
		expect(await read(response)).toBe('$ make test\r\n\u001b[32mok\u001b[0m\r\n');
		await waitFor(() => embedOf(client)?.output !== undefined);
		expect(embedOf(client)).toEqual({ embed_id: written.embed_id, kind: 'terminal', title: 'make test', output: '$ make test\r\n\u001b[32mok\u001b[0m\r\n' });
		// The write URL is spent.
		expect((await server.fetchLive(written.write_url, { method: 'PUT', body: 'again' })).status).toBe(404);
	});

	it('/embed-append: the opening Markdown, then the text streamed into the body, and the embed gone, its mentions untouched', async () => {
		const server = new MemoryProtocolServer({ liveDemo: 'off' });
		const client = await connect(server);
		const result = await client.command('general', '/embed-append Here is **the plan**:').promise;
		const [written] = result.embeds as { embed_id: string; write_url: string }[];
		const put = server.fetchLive(written.write_url, { method: 'PUT', body: '1. Roll back.\n2. Renew the cert. @ada' });
		expect((await put).status).toBe(204);
		await waitFor(() => !embedOf(client) && latest(client).body?.text !== 'Here is **the plan**:\n\n');
		expect(latest(client).body).toEqual({ text: 'Here is **the plan**:\n\n1. Roll back.\n2. Renew the cert. @ada', format: 'markdown' });
	});

	it('takes live embeds in a message: write URLs in the result, a url once each write starts, kept by embed_id on a save, ended by one that leaves it out', async () => {
		const server = new MemoryProtocolServer({});
		const client = await connect(server);
		const sent = await client.send('general', 'Build:', 'markdown', { embeds: [{ kind: 'terminal', title: 'ci' }, { kind: 'append' }] }).promise;
		const results = sent.embeds as { embed_id: string; kind: string; write_url: string }[];
		expect(results.map((entry) => entry.kind)).toEqual(['terminal', 'append']);
		await waitFor(() => client.message(sent.message_id) !== undefined);
		// They wait for their writers, without url (§4.8.5).
		expect(client.message(sent.message_id)!.body!.embeds).toEqual([{ embed_id: results[0].embed_id, kind: 'terminal', title: 'ci' }, { embed_id: results[1].embed_id, kind: 'append' }]);
		const embeds = () => client.message(sent.message_id)!.body!.embeds as Record<string, unknown>[];
		// A write's start republishes the message with that embed's url.
		server.fetchLive(results[0].write_url, { method: 'PUT', body: new ReadableStream(), duplex: 'half' } as RequestInit);
		server.fetchLive(results[1].write_url, { method: 'PUT', body: new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode(' so far')) }), duplex: 'half' } as RequestInit);
		await waitFor(() => embeds().every((embed) => typeof embed.url === 'string'));
		const [terminal, append] = embeds();
		expect(terminal).toMatchObject({ embed_id: results[0].embed_id, kind: 'terminal', title: 'ci', url: expect.stringContaining('/live/') });
		await waitFor(() => server['lives'].get(results[1].embed_id)!.chunks.length === 1);
		const reading = await server.fetchLive(String(append.url), {});
		expect(reading.status).toBe(200);
		// A save that sends both back keeps them, their urls restored by the server whatever was sent.
		await client.editMessage(sent.message_id, 'Build (edited):').promise;
		await waitFor(() => client.message(sent.message_id)?.body?.text === 'Build (edited):');
		expect(embeds().map((embed) => embed.url)).toEqual([terminal.url, append.url]);
		// One that leaves the append out ends it early, appending nothing.
		await client.removeEmbed(sent.message_id, append as never).promise;
		expect(await reading.text()).toBe(' so far');
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(client.message(sent.message_id)!.body).toEqual({ text: 'Build (edited):', format: 'markdown', embeds: [terminal] });
		// At most one append in a message: more is `invalid_params`.
		await expect(client.send('general', 'Two', 'markdown', { embeds: [{ kind: 'append' }, { kind: 'append' }] }).promise).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('at most one append') });
	});

	it('plays a demo into a live text, and a dropped reader that reconnects gets it all again, each read counted', async () => {
		const server = new MemoryProtocolServer({});
		const client = await connect(server);
		const id = server.startLive('general', 'ada', 'append', { body: { text: 'Plan:' } });
		await waitFor(() => embedOf(client)?.embed_id === id);
		const url = String(embedOf(client)!.url);
		server.liveWrite(id, ' one');
		const dropped = await server.fetchLive(url, {});
		server.liveDrop(id);
		await expect(dropped.text()).rejects.toThrow('dropped');
		server.playDemo(id, [{ wait: 1, data: ' two' }, { wait: 1, data: new TextEncoder().encode(' three') }]);
		const again = await server.fetchLive(url, {});
		expect(await again.text()).toBe(' one two three');
		// Each GET counted, as a server that caps reads counts them.
		expect(server.liveReads(id)).toBe(2);
		await waitFor(() => !embedOf(client));
		expect(latest(client).body).toMatchObject({ text: 'Plan: one two three', format: 'markdown' });
	});

	it('/embed-append: backspaces and form feeds edit only the streamed text; late readers get it kept edited, and the snapshot appends it after its edits', async () => {
		const server = new MemoryProtocolServer({});
		const client = await connect(server);
		const id = server.startLive('general', 'ada', 'append', { body: { text: 'Plan:' } });
		await waitFor(() => embedOf(client)?.embed_id === id);
		const url = String(embedOf(client)!.url);
		const rocket = new TextEncoder().encode('🚀');
		server.liveWrite(id, ' draft\f\b\b roll bakc');
		server.liveWrite(id, '\b\bck ');
		server.liveWrite(id, rocket.slice(0, 3));
		// A reader that comes in now gets the text kept so far after its edits, and the rest as written: the 🚀 cut
		// between writes comes whole.
		const late = await server.fetchLive(url, {});
		server.liveWrite(id, rocket.slice(3));
		server.liveWrite(id, '\b\b.');
		server.liveEnd(id);
		expect(await late.text()).toBe(' roll back 🚀\b\b.');
		await waitFor(() => !embedOf(client));
		// The backspaces past " roll back" never reached "Plan:".
		expect(latest(client).body).toEqual({ text: 'Plan: roll back.', format: 'markdown' });
	});

	it('plays an append demo that revises itself: a placeholder a form feed clears, a typo backspaces correct', async () => {
		const server = new MemoryProtocolServer({});
		const client = await connect(server);
		const id = server.startLive('general', 'ada', 'append', { body: { text: '' } });
		await waitFor(() => embedOf(client)?.embed_id === id);
		vi.useFakeTimers();
		try {
			server.playDemo(id);
			await vi.advanceTimersByTimeAsync(60_000);
		} finally {
			vi.useRealTimers();
		}
		await waitFor(() => !embedOf(client));
		const text = String(latest(client).body?.text);
		expect(text).toMatch(/^Here is the plan for the rollback/);
		expect(text).toContain('so every deploy since then failed.\n3. Re-run');
		expect(text).not.toMatch(/Looking|faield|[\b\f]/);
		expect(text).toMatch(/I’ll keep an eye on #general\.$/);
	});

	it('serves nothing it did not mint', async () => {
		const server = new MemoryProtocolServer({});
		expect((await server.fetchLive('http://apron-preview.invalid/live/nope', {})).status).toBe(404);
		expect((await server.fetchLive('https://elsewhere.example/live/1', {})).status).toBe(404);
	});
});
