import { afterEach, describe, expect, it } from 'vitest';
import { ChatClient, timelineMessages, type ClientSnapshot, type WebSocketFactory } from '$lib/protocol/client';
import { MemoryProtocolServer } from '$lib/preview/memory-server';
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
	return { source, text: exportArchive(source.url, source.snapshot(), source.storedRecords(), new Date('2026-10-27T12:00:00Z')).text };
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
		expect(shown.server?.ext).toMatchObject({ media: { origins: ['https://chat.example'] } });
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
			return JSON.stringify({ message: { message_id: id, log_id: id, room_id: 'general', from: { user_id: 'ada' }, body: { text: `#${index}` } } });
		});
		const archive = parseArchive([
			JSON.stringify({ apron_export: 1, server: 'wss://chat.example/', exported_at: '2026-10-27T12:00:00.000Z', media: [] }),
			JSON.stringify({ room: { room_id: 'general', title: 'General' }, joined: true }),
			...messages
		].join('\n'));
		const reader = started('ws://archive.invalid', new ArchiveServer(archive).factory);
		await waitFor(() => Boolean(room(reader.snapshot(), 'general')?.loaded));
		while (room(reader.snapshot(), 'general')?.olderAvailable) await reader.loadOlder('general');
		const shown = timelineMessages(room(reader.snapshot(), 'general')!);
		expect(shown.length).toBe(450);
		expect(shown[0].body?.text).toBe('#0');
	});

	it('keeps statuses out, and every room a stored message is in', async () => {
		const { source } = await exported();
		const snapshot = source.snapshot();
		const withStatus = { ...snapshot, users: { ...snapshot.users, ada: { ...snapshot.users.ada, status: 'online', seen: '1710000000000' } } };
		const archive = parseArchive(exportArchive(source.url, withStatus, source.storedRecords()).text);
		expect(archive.users.find((user) => user.user_id === 'ada')).not.toHaveProperty('status');
		const ids = archive.rooms.map((entry) => entry.record.room_id);
		expect(ids).toEqual(expect.arrayContaining(['general', 'engineering', 'thread_deploy']));
		expect(archive.rooms.find((entry) => entry.record.room_id === 'thread_deploy')?.joined).toBe(true);
	});
});

describe('parseArchive', () => {
	it('refuses a file that is not an export, or is from a later version', () => {
		expect(() => parseArchive('{"hello":1}\n')).toThrow('isn’t an Apron export');
		expect(() => parseArchive('')).toThrow('isn’t an Apron export');
		expect(() => parseArchive('{"apron_export":2}\n')).toThrow('newer version');
	});

	it('skips lines it cannot read, and reads the rest', () => {
		const archive = parseArchive([
			'{"apron_export":1,"server":"wss://chat.example/"}',
			'not json',
			'{"message":{"message_id":"x"}}',
			'{"something":"else"}',
			'{"message":{"message_id":"5","log_id":"5","room_id":"general","from":{"user_id":"ada"}}}'
		].join('\r\n'));
		expect(archive.skipped).toBe(3);
		expect(archive.messages.map((message) => message.message_id)).toEqual(['5']);
	});
});

describe('archiveFileName', () => {
	it('names the server and the day', () => {
		expect(archiveFileName('wss://Chat.Example:8443/ws', new Date('2026-10-27T23:00:00Z'))).toBe('apron-chat.example-8443-2026-10-27.jsonl');
		expect(archiveFileName('nonsense', new Date('2026-10-27T00:00:00Z'))).toBe('apron-2026-10-27.jsonl');
	});
});
