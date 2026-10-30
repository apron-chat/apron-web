import { afterEach, describe, expect, it } from 'vitest';
import { ChatClient, timelineMessages, type ClientSnapshot, type WebSocketFactory } from '$lib/protocol/client';
import { MemoryProtocolServer } from '$lib/preview/memory-server';
import type { JsonObject, WireFrame } from '$lib/protocol/types';
import { ArchiveServer } from './archive-server';
import { archiveFileName, exportArchive, parseArchive } from './archive';

const clients: ChatClient[] = [];
afterEach(() => {
	for (const client of clients.splice(0)) client.stop();
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('Protocol did not settle');
}

function started(url: string, factory: WebSocketFactory): ChatClient {
	const client = new ChatClient(url, 'Reader', factory);
	clients.push(client);
	client.start();
	return client;
}

const room = (snapshot: ClientSnapshot, id: string) => snapshot.rooms.find((candidate) => candidate.id === id);
const texts = (snapshot: ClientSnapshot, id: string) => timelineMessages(room(snapshot, id)!).map((message) => [message.message_id, message.body?.text]);

/** A client of the demo server with general and a thread loaded, and a reaction of its own. */
async function exported(): Promise<{ source: ChatClient; text: string }> {
	const source = started('wss://chat.example/', new MemoryProtocolServer().factory);
	await waitFor(() => Boolean(room(source.snapshot(), 'general')?.loaded));
	await source.react('1710000000001', ['🎉']).promise;
	await source.listRooms('general', 0);
	await source.loadRoom('thread_deploy');
	return { source, text: exportArchive(source.url, source.snapshot(), source.storedRecords(), source.roomSyncs(), new Date('2026-10-27T12:00:00Z')).text };
}

describe('exports', () => {
	it('reads back as what the client showed, read-only, from a server in the page', async () => {
		const { source, text } = await exported();
		const archive = parseArchive(text);
		expect(archive).toMatchObject({ server: 'wss://chat.example/', exportedAt: '2026-10-27T12:00:00.000Z', media: ['https://chat.example'], skipped: 0 });

		const reader = started('ws://archive.invalid', new ArchiveServer(archive).factory);
		await waitFor(() => Boolean(room(reader.snapshot(), 'general')?.loaded));
		const shown = reader.snapshot();
		expect(shown.readOnly).toBe(true);
		expect(shown.you?.user_id).toBe('preview_guest');
		expect(shown.server?.ext).toMatchObject({ media: { origins: ['https://chat.example'] }, archive: { server: 'wss://chat.example/', exported_at: '2026-10-27T12:00:00.000Z' } });
		expect(shown.server?.auth).toEqual(['guest']);
		expect(texts(shown, 'general')).toEqual(texts(source.snapshot(), 'general'));
		expect(reader.reactions('1710000000001')).toEqual([expect.objectContaining({ emoji: '🎉', user_ids: ['preview_guest'], mine: true })]);
		expect(room(shown, 'general')?.members?.map((member) => member.user_id)).toEqual(room(source.snapshot(), 'general')?.members?.map((member) => member.user_id));

		// The thread the source had open, with the message moved into it.
		await reader.listRooms('general', 0);
		await reader.loadRoom('thread_deploy');
		expect(texts(reader.snapshot(), 'thread_deploy')).toEqual(texts(source.snapshot(), 'thread_deploy'));
		expect(reader.message('1710000000003')?.room_id).toBe('thread_deploy');

		await expect(reader.send('general', 'hello').promise).rejects.toThrow(/read-only/);
	});

	it('pages a room older than one page, newest first', async () => {
		const messages = Array.from({ length: 450 }, (_, index) => {
			const id = String(1720000000000 + index);
			return JSON.stringify({ messages: [{ message_id: id, log_id: id, room_id: 'general', from: { user_id: 'ada' }, body: { text: `#${index}` } }] });
		});
		// Hand-written, as another tool might: no `log_id` for the room, and no `history_log_id`.
		const archive = parseArchive([
			JSON.stringify({ apron_archive: 1, server: 'wss://chat.example/', exported_at: '2026-10-27T12:00:00.000Z' }),
			JSON.stringify({ joined: [{ room_id: 'general', title: 'General' }] }),
			...messages
		].join('\n'));
		const reader = started('ws://archive.invalid', new ArchiveServer(archive).factory);
		await waitFor(() => Boolean(room(reader.snapshot(), 'general')?.loaded));
		while (room(reader.snapshot(), 'general')?.olderAvailable) await reader.loadOlder('general');
		const shown = timelineMessages(room(reader.snapshot(), 'general')!);
		expect(shown.length).toBe(450);
		expect(shown[0].body?.text).toBe('#0');
	});

	it('keeps statuses out, and lists the rooms it shows with where their stretch of records starts', async () => {
		const { source } = await exported();
		const snapshot = source.snapshot();
		const withStatus = { ...snapshot, users: { ...snapshot.users, ada: { ...snapshot.users.ada, status: 'online', seen: '1710000000000' } } };
		const archive = parseArchive(exportArchive(source.url, withStatus, source.storedRecords(), source.roomSyncs()).text);
		expect(archive.users.find((user) => user.user_id === 'ada')).not.toHaveProperty('status');
		expect(archive.rooms.map((entry) => entry.record.room_id).sort()).toEqual(snapshot.rooms.map((shown) => shown.id).sort());
		const thread = archive.rooms.find((entry) => entry.record.room_id === 'thread_deploy')!;
		expect(thread.joined).toBe(true);
		expect(thread.history).toBe(source.roomSyncs().find((sync) => sync.id === 'thread_deploy')?.olderBefore);
		// Every record is in a listed room's stretch, or is a message one of them replies to.
		const listed = new Set(archive.rooms.map((entry) => entry.record.room_id));
		expect(archive.messages.every((message) => listed.has(message.room_id))).toBe(true);
	});

	it('serves a reply’s target from outside every stretch only as the snapshot it embeds', async () => {
		const message = (id: number, room: string, extra: JsonObject = {}) => ({ message_id: String(id), log_id: String(id), room_id: room, from: { user_id: 'ada' }, body: { text: `#${id}` }, ...extra });
		const server = new ArchiveServer(parseArchive([
			JSON.stringify({ apron_archive: 1 }),
			JSON.stringify({ joined: [{ room_id: 'general', log_id: '1', latest_log_id: '30', history_log_id: '20' }] }),
			JSON.stringify({ messages: [message(10, 'general'), message(5, 'elsewhere')] }),
			JSON.stringify({ messages: [message(20, 'general', { reply_to: { message_id: '10' } }), message(30, 'general', { reply_to: { message_id: '5' } })] })
		].join('\n')));
		const result = await wire(server).request('history', { room_id: 'general' });
		expect(result).toMatchObject({ history_log_id: '20', latest_log_id: '30', first_log_id: '20', last_log_id: '30', more: false });
		expect((result.messages as JsonObject[]).map((entry) => [entry.message_id, (entry.reply_to as JsonObject).body])).toEqual([['20', { text: '#10' }], ['30', { text: '#5' }]]);
		expect(await wire(server).request('history', { room_id: 'elsewhere' })).toMatchObject({ error: { code: -32602 } });
	});
});

/** One connection to `server`, sending requests and reading their replies (an error's as `{ error }`). */
function wire(server: ArchiveServer): { request: (method: string, params?: JsonObject) => Promise<JsonObject> } {
	const socket = server.factory('ws://archive.invalid');
	const waiting = new Map<string, (frame: WireFrame) => void>();
	const opened = new Promise<void>((resolve) => {
		socket.onopen = () => resolve();
	});
	socket.onmessage = (event: MessageEvent) => {
		const frame = JSON.parse(String(event.data)) as WireFrame;
		if (typeof frame.id === 'string') waiting.get(frame.id)?.(frame);
	};
	let next = 0;
	return {
		request: async (method, params = {}) => {
			await opened;
			const id = `r${next++}`;
			const frame = await new Promise<WireFrame>((resolve) => {
				waiting.set(id, resolve);
				socket.send(JSON.stringify({ method, id, params }));
			});
			return (frame.error ? { error: frame.error } : frame.result) as JsonObject;
		}
	};
}

describe('ArchiveServer', () => {
	const archive = () => parseArchive([
		JSON.stringify({ apron_archive: 1 }),
		// `general`'s stretch starts at 100, `random`'s holds all it has; `lobby` isn't joined.
		JSON.stringify({ joined: [{ room_id: 'general', latest_log_id: '300', history_log_id: '100' }, { room_id: 'random' }], not_joined: [{ room_id: 'lobby' }] }),
		JSON.stringify({ messages: [50, 100, 300].map((log) => ({ message_id: String(log), log_id: String(log), room_id: 'general', from: { user_id: 'ada' } })) }),
		JSON.stringify({ messages: [99, 150].map((log) => ({ message_id: String(log), log_id: String(log), room_id: 'random', from: { user_id: 'bob' } })) }),
		JSON.stringify({ messages: [{ message_id: '120', log_id: '120', room_id: 'lobby', from: { user_id: 'bob' } }] })
	].join('\n'));

	it('gives a room listed without `log_id` a position below its records that no record holds', async () => {
		const listed = await wire(new ArchiveServer(archive())).request('room_list', {});
		const log = (id: string) => [...(listed.joined as JsonObject[]), ...(listed.not_joined as JsonObject[])].find((room) => room.room_id === id)?.log_id;
		expect(log('random')).toBe('98');
		expect(log('general')).toBe('49');
		expect(log('lobby')).toBe('119');
	});

	it('pages the joined rooms as one log from the greatest of their bounds, without `room_id`', async () => {
		const result = await wire(new ArchiveServer(archive())).request('history', {});
		// `random`'s 99 is below `general`'s bound, and `lobby` isn't joined.
		expect((result.messages as JsonObject[]).map((message) => message.message_id)).toEqual(['100', '150', '300']);
		expect(result).toMatchObject({ history_log_id: '100', latest_log_id: '300' });
	});

	it('refuses a write as denied, and a request it doesn’t know as unsupported', async () => {
		const connection = wire(new ArchiveServer(archive()));
		expect(await connection.request('message', { room_id: 'general', body: { text: 'hi' } })).toMatchObject({ error: { code: -32001 } });
		expect(await connection.request('rtc_join', {})).toMatchObject({ error: { code: -32601 } });
	});

	it('signs in only as a guest, who may only read', async () => {
		const connection = wire(new ArchiveServer(archive()));
		expect(await connection.request('auth', { scheme: 'token', token: 'x' })).toMatchObject({ error: { code: -32601 } });
		expect(await connection.request('auth', {})).toMatchObject({ error: { code: -32601 } });
		expect(await connection.request('auth', { scheme: 'guest' })).toMatchObject({ you: { user_id: 'archive_viewer', ext: { permissions: { write: false } } } });
	});

	it('advertises its media only when it may load', async () => {
		const greeting = (media: string[]) => new Promise<JsonObject>((resolve) => {
			const socket = new ArchiveServer({ ...archive(), media }).factory('ws://archive.invalid');
			socket.onmessage = (event: MessageEvent) => resolve((JSON.parse(String(event.data)) as WireFrame).params as JsonObject);
		});
		const without = await greeting([]);
		expect(without.capabilities).not.toContain('ext:media');
		expect(without.ext).not.toHaveProperty('media');
		const withMedia = await greeting(['https://media.example']);
		expect(withMedia.capabilities).toContain('ext:media');
		expect(withMedia.ext).toMatchObject({ media: { origins: ['https://media.example'] } });
	});
});

describe('parseArchive', () => {
	it('refuses a file that is not an export, or is from a later version', () => {
		expect(() => parseArchive('{"hello":1}\n')).toThrow('isn’t an Apron export');
		expect(() => parseArchive('')).toThrow('isn’t an Apron export');
		expect(() => parseArchive('{"apron_archive":2}\n')).toThrow('newer version');
	});

	it('skips lines it cannot read, and reads the rest', () => {
		const archive = parseArchive([
			'{"apron_archive":1,"server":"wss://chat.example/"}',
			'not json',
			'{"messages":[{"message_id":"x"}]}',
			'{"something":"else"}',
			'{"messages":[{"message_id":"5","log_id":"5","room_id":"general","from":{"user_id":"ada"}}]}'
		].join('\r\n'));
		expect(archive.skipped).toBe(3);
		expect(archive.messages.map((message) => message.message_id)).toEqual(['5']);
	});

	it('reads a `history` or `room_list` result verbatim as a line, and a later listing of a room over an earlier one', () => {
		const archive = parseArchive([
			'{"apron_archive":1}',
			'{"joined":[{"room_id":"general","title":"Old"}],"users":[{"user_id":"ada","name":"Ada","status":"online"}]}',
			'{"rooms":[{"room_id":"general","log_id":"4","title":"New"}],"messages":[{"message_id":"5","log_id":"5","room_id":"general","from":{"user_id":"ada"}}],"reactions":[],"memberships":[{"log_id":"6","room_id":"general","members":[{"user":{"user_id":"ada"},"joined":true}]}],"more":false,"first_log_id":"4","last_log_id":"6","latest_log_id":"6","history_log_id":"1"}',
			'{"not_joined":[{"room_id":"general","title":"Newer","history_log_id":null}]}'
		].join('\n'));
		expect(archive).toMatchObject({ skipped: 0, users: [{ user_id: 'ada', name: 'Ada' }], rooms: [{ record: { room_id: 'general', title: 'Newer' }, joined: false, history: null }] });
		expect(archive.users[0]).not.toHaveProperty('status');
		expect(archive.roomRecords.map((record) => record.title)).toEqual(['New']);
		expect(archive.memberships).toHaveLength(1);
	});
});

describe('archiveFileName', () => {
	it('names the server and the day', () => {
		expect(archiveFileName('wss://Chat.Example:8443/ws', new Date('2026-10-27T23:00:00Z'))).toBe('apron-chat.example-8443-2026-10-27.jsonl');
		expect(archiveFileName('nonsense', new Date('2026-10-27T00:00:00Z'))).toBe('apron-2026-10-27.jsonl');
	});
});
