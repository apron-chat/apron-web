import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError, type ChatClient, type ClientSnapshot } from './client';
import { limitScope, userFacingRpcError } from './client-internals';
import { punctuated } from '../words';
import { FakeSocket, quiet, settle, startClient } from '$lib/test/client';

/**
 * Waits the server asks for (`retry_after`, §1.1): a refusal is a
 * `RateLimitError`; one of `history` or `message` holds back further requests
 * of its method, or with `ext:limits` what its category covers, and the
 * snapshot's `limits` show each wait until it is over. History in client.recovery.test.ts.
 */
let client: ChatClient;
let socket: FakeSocket;
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	({ client, socket } = startClient({ onSnapshot: (next) => (snapshot = next) }));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** A refusal as any compliant server may send it: `code`, `message`, and `data.retry_after` only (§1.1). */
const refuse = (id: string, retryAfter: number, message = 'Too Many Requests', data: Record<string, unknown> = {}) =>
	socket.receive({ id, error: { code: -32002, message, data: { retry_after: retryAfter, ...data } } });
const sentOf = (method: string) => socket.sent.filter((frame) => frame.method === method).length;

describe('a refusal with retry_after', () => {
	it('is a RateLimitError with the server\'s words, when it may go again, and the method it holds back', async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		const sent = client.send('general', 'hi');
		refuse(socket.request('message').id, 28);
		const error = await sent.promise.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(RateLimitError);
		expect(error).toMatchObject({ code: -32002, scope: 'message', serverMessage: 'Too Many Requests', retryAt: Date.now() + 28_000 });
		expect((error as Error).message).toBe('Too Many Requests. Try again in 28s.');
		expect(snapshot.limits).toEqual({ message: { until: Date.now() + 28_000 } });
		// A listing holds back no other method: the caller shows it, and nothing else waits.
		const listed = client.listRooms();
		refuse(socket.request('room_list').id, 20);
		await expect(listed).rejects.toMatchObject({ scope: undefined, message: 'Too Many Requests. Try again in 20s.' });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['message']);
		await vi.advanceTimersByTimeAsync(28_000);
		expect(snapshot.limits).toBeUndefined();
	});

	it('of a message holds back messages without sending them, and no other method, until it is over', async () => {
		await socket.greet(['rooms', 'history', 'command'], { room: { room_id: 'general', title: 'General' } });
		quiet(client.send('general', 'one'));
		refuse(socket.request('message').id, 10);
		await settle();
		const held = client.send('general', 'two');
		await expect(held.promise).rejects.toMatchObject({ scope: 'message', retryAt: Date.now() + 10_000, message: 'Sending is paused. Try again in 10s.' });
		expect(sentOf('message')).toBe(1);
		// Whatever a server's limit covers, the client can't tell: other methods go, and the server decides.
		quiet(client.react('1', ['👍']));
		quiet(client.command('general', '/help'));
		quiet(client.joinRoom('ops'));
		expect([sentOf('reactions'), sentOf('command'), sentOf('room_join')]).toEqual([1, 1, 1]);
		await vi.advanceTimersByTimeAsync(10_000);
		quiet(client.send('general', 'three'));
		expect(sentOf('message')).toBe(2);
	});

	it('of a message with files holds back every message, with files or without, whatever the wait', async () => {
		await socket.greet(['rooms', 'embed:upload'], { room: { room_id: 'general', title: 'General' } });
		const { sent, uploaded } = client.sendFiles('general', 'see attached', [new File(['x'], 'x.txt')]);
		quiet(uploaded);
		refuse(socket.request('message').id, 3 * 3600 + 12 * 60);
		await expect(sent).rejects.toMatchObject({ scope: 'message' });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['message']);
		const again = client.sendFiles('general', '', [new File(['y'], 'y.txt')]);
		quiet(again.uploaded);
		await expect(again.sent).rejects.toMatchObject({ scope: 'message' });
		await expect(client.send('general', 'words only').promise).rejects.toMatchObject({ scope: 'message' });
		expect(sentOf('message')).toBe(1);
	});

	it('of any other method fails only that request', async () => {
		await socket.greet(['rooms', 'reactions', 'command'], { room: { room_id: 'general', title: 'General' } });
		const reacted = client.react('1', ['👍']);
		refuse(socket.request('reactions').id, 30);
		await expect(reacted.promise).rejects.toMatchObject({ scope: undefined, message: 'Too Many Requests. Try again in 30s.' });
		const commanded = client.command('general', '/help');
		refuse(socket.request('command').id, 30);
		await expect(commanded.promise).rejects.toMatchObject({ scope: undefined });
		expect(snapshot.limits).toBeUndefined();
		quiet(client.send('general', 'hi'));
		quiet(client.react('1', ['🎉']));
		expect([sentOf('message'), sentOf('reactions')]).toEqual([1, 2]);
	});

	it('ignores keys of data it doesn\'t know: a server naming its limit holds back nothing more', async () => {
		await socket.greet(['rooms', 'history'], { room: { room_id: 'general', title: 'General' } });
		const listed = client.listRooms();
		refuse(socket.request('room_list').id, 20, 'Slow down', { limit: 'history' });
		await expect(listed).rejects.toMatchObject({ scope: undefined, message: 'Slow down. Try again in 20s.' });
		const sent = client.send('general', 'hi');
		refuse(socket.request('message').id, 20, 'Slow down', { limit: 'upload' });
		await expect(sent.promise).rejects.toMatchObject({ scope: 'message' });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['message']);
	});

	it('ends with the identity: signing out, or in as someone else, learns its limits afresh', async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		const posts = () => FakeSocket.latest().sent.filter((frame) => frame.method === 'message').length;
		const reconnect = () => {
			FakeSocket.latest().drop();
			vi.advanceTimersByTime(5_000);
			return FakeSocket.latest();
		};
		quiet(client.send('general', 'one'));
		refuse(socket.request('message').id, 3 * 3600);
		await settle();
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['message']);
		// Back as the same guest: still waiting.
		await reconnect().greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['message']);
		// A token resume that signs in someone else: their messages aren't held back by the guest's wait.
		await reconnect().greet(['rooms'], { room: { room_id: 'general', title: 'General' }, you: { user_id: 'ada', name: 'Ada' } });
		expect(snapshot.limits).toBeUndefined();
		quiet(client.send('general', 'two'));
		expect(posts()).toBe(1);
		FakeSocket.latest().receive({ id: FakeSocket.latest().request('message').id, error: { code: -32002, message: 'Too Many Requests', data: { retry_after: 3 * 3600 } } });
		await settle();
		expect(snapshot.limits?.message).toBeDefined();
		client.signOut();
		expect(snapshot.limits).toBeUndefined();
	});

	it('ends with the client: a stopped client, or another server, learns its limits afresh', async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		quiet(client.send('general', 'one'));
		refuse(socket.request('message').id, 60);
		await settle();
		expect(snapshot.limits?.message).toBeDefined();
		client.setUrl('ws://other.test/');
		expect(snapshot.limits).toBeUndefined();
	});
});

describe('a refusal with a category of limit (ext:limits)', () => {
	const ROOM = { room_id: 'general', title: 'General', latest_log_id: '12', history_log_id: '10' };
	/** A refusal that gives its category in `data.ext.limits`. */
	const refuseAs = (id: string, retryAfter: number, category: unknown, message = 'Too Many Requests') => refuse(id, retryAfter, message, { ext: { limits: category } });
	const files = () => [new File(['x'], 'x.txt')];
	/**
	 * Tries each request a `write` wait covers but `message`, then `command` and `me`, which it doesn't; resolves with
	 * how many of each method went out.
	 */
	const writes = async () => {
		const tried = [
			client.react('1', ['👍']).promise, client.command('general', '/help').promise, client.joinRoom('ops').promise,
			client.leaveRoom('general').promise, client.updateRoom('general', { title: 'Main' }).promise, client.updateProfile({ name: 'Ada' })
		];
		for (const attempt of tried) attempt.catch(() => undefined);
		await settle();
		return ['reactions', 'command', 'room_join', 'room_leave', 'room_set', 'me'].map(sentOf);
	};

	it('of write holds back posts, reactions, joins, leaves and room changes, in the server\'s words, and nothing else', async () => {
		await socket.greet(['rooms', 'history', 'reactions', 'command', 'ext:limits'], { room: ROOM });
		await socket.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		const sent = client.send('general', 'one');
		refuseAs(socket.request('message').id, 40, 'write', 'Posting limit reached');
		await expect(sent.promise).rejects.toMatchObject({ scope: 'write', method: 'message', message: 'Posting limit reached. Try again in 40s.' });
		expect(snapshot.limits).toEqual({ write: { until: Date.now() + 40_000 } });
		await expect(client.react('1', ['👍']).promise).rejects.toMatchObject({ scope: 'write', method: 'reactions', retryAt: Date.now() + 40_000, message: 'Posting limit reached. Try again in 40s.' });
		await expect(client.joinRoom('ops').promise).rejects.toMatchObject({ scope: 'write', method: 'room_join' });
		// Commands may do anything, and `me` isn't posting: they go.
		expect(await writes()).toEqual([0, 1, 0, 0, 0, 1]);
		quiet(client.send('general', 'two'));
		expect(sentOf('message')).toBe(1);
		// Reading goes on.
		quiet(client.listRooms());
		quiet(client.loadRoom('general'));
		await settle();
		expect(sentOf('room_list')).toBe(2);
		await vi.advanceTimersByTimeAsync(40_000);
		expect(snapshot.limits).toBeUndefined();
		expect(await writes()).toEqual([1, 2, 1, 1, 1, 2]);
	});

	it('of write on any request it covers holds back messages too', async () => {
		await socket.greet(['rooms', 'reactions', 'ext:limits'], { room: ROOM });
		const reacted = client.react('1', ['👍']);
		refuseAs(socket.request('reactions').id, 30, 'write');
		await expect(reacted.promise).rejects.toMatchObject({ scope: 'write' });
		await expect(client.send('general', 'hi').promise).rejects.toMatchObject({ scope: 'write', method: 'message' });
		expect(sentOf('message')).toBe(0);
	});

	it('of upload holds back only messages and commands that add files: text, and edits that keep files, still go', async () => {
		await socket.greet(['rooms', 'command', 'embed:upload', 'ext:limits'], { room: ROOM });
		const { sent, uploaded } = client.sendFiles('general', 'see attached', files());
		quiet(uploaded);
		refuseAs(socket.request('message').id, 5 * 3600, 'upload', 'Daily upload limit reached');
		await expect(sent).rejects.toMatchObject({ scope: 'upload', method: 'message' });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['upload']);
		const again = client.sendFiles('general', '', files());
		quiet(again.uploaded);
		await expect(again.sent).rejects.toMatchObject({ scope: 'upload', message: 'Daily upload limit reached. Try again in 5h.' });
		await expect(client.uploadAvatar(new File(['x'], 'me.png', { type: 'image/png' }))).rejects.toMatchObject({ scope: 'upload', method: 'command' });
		expect([sentOf('message'), sentOf('command')]).toEqual([1, 0]);
		quiet(client.send('general', 'words only'));
		quiet(client.command('general', '/help'));
		expect([sentOf('message'), sentOf('command')]).toEqual([2, 1]);
		// An edit sends the files it keeps back with their `embed_id`: it adds none.
		const kept = { embed_id: 'e1', kind: 'upload', title: 'x.txt', url: 'https://fake.test/f/e1' };
		socket.receive({ method: 'message', params: { message_id: '20', log_id: '20', room_id: 'general', from: { user_id: 'guest_1', name: 'Guest' }, body: { text: 'see attached', embeds: [kept] } } });
		quiet(client.editMessage('20', 'see the attachment'));
		expect(sentOf('message')).toBe(3);
		expect(socket.request('message').params).toMatchObject({ message_id: '20', body: { text: 'see the attachment', embeds: [kept] } });
	});

	it('of read holds back only the refused method: history, not room_list', async () => {
		await socket.greet(['rooms', 'history', 'ext:limits'], { room: ROOM });
		refuseAs(socket.request('history').id, 20, 'read', 'History request limit reached');
		await settle();
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['history']);
		const listed = client.listRooms();
		expect(sentOf('room_list')).toBe(2);
		refuseAs(socket.request('room_list').id, 20, 'read');
		await expect(listed).rejects.toMatchObject({ scope: undefined, method: 'room_list' });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['history']);
		quiet(client.send('general', 'hi'));
		expect(sentOf('message')).toBe(1);
	});

	it('of a category the request isn\'t in holds back by method', async () => {
		await socket.greet(['rooms', 'history', 'ext:limits'], { room: ROOM });
		refuseAs(socket.request('history').id, 20, 'write');
		await settle();
		const sent = client.send('general', 'text only');
		refuseAs(socket.request('message').id, 20, 'upload');
		await expect(sent.promise).rejects.toMatchObject({ scope: 'message' });
		expect(Object.keys(snapshot.limits ?? {}).sort()).toEqual(['history', 'message']);
	});

	/** Each holds back by method, as without the extension. */
	const byMethod: Array<[string, string[], unknown]> = [
		['a category from a server that doesn\'t advertise ext:limits', ['rooms', 'reactions', 'command'], 'write'],
		['a category the client doesn\'t know', ['rooms', 'reactions', 'command', 'ext:limits'], 'post'],
		['a category that isn\'t a string', ['rooms', 'reactions', 'command', 'ext:limits'], { name: 'write' }],
		['no category', ['rooms', 'reactions', 'command', 'ext:limits'], undefined]
	];
	for (const [name, caps, category] of byMethod) {
		it(`with ${name} holds back by method`, async () => {
			await socket.greet(caps, { room: ROOM });
			const sent = client.send('general', 'one');
			refuse(socket.request('message').id, 20, 'Too Many Requests', category === undefined ? {} : { ext: { limits: category } });
			await expect(sent.promise).rejects.toMatchObject({ scope: 'message' });
			expect(Object.keys(snapshot.limits ?? {})).toEqual(['message']);
			await expect(client.send('general', 'two').promise).rejects.toMatchObject({ message: 'Sending is paused. Try again in 20s.' });
			expect(await writes()).toEqual([1, 1, 1, 1, 1, 1]);
		});
	}
});

describe('limitScope', () => {
	const text = { room_id: 'general', body: { text: 'hi' } };
	const upload = { room_id: 'general', body: { text: 'hi', embeds: [{ kind: 'upload' }] } };
	const keptUpload = { message_id: '20', body: { text: 'hi', embeds: [{ embed_id: 'e1', kind: 'upload' }] } };
	it('is the refused request\'s method, for history and message only, without a category it can use', () => {
		expect(limitScope('history', {})).toBe('history');
		expect(limitScope('message', text)).toBe('message');
		for (const method of ['command', 'reactions', 'room_join', 'room_leave', 'room_set', 'room_list', 'status', 'me', 'auth', 'constructor']) {
			expect(limitScope(method, {})).toBeUndefined();
			expect(limitScope(method, {}, 'read')).toBeUndefined();
		}
		expect(limitScope('history', {}, 'read')).toBe('history');
		expect(limitScope('history', {}, 'write')).toBe('history');
		expect(limitScope('message', text, 'upload')).toBe('message');
		expect(limitScope('status', {}, 'write')).toBeUndefined();
		expect(limitScope('command', {}, 'write')).toBeUndefined();
		expect(limitScope('me', {}, 'write')).toBeUndefined();
		expect(limitScope('message', keptUpload, 'upload')).toBe('message');
	});

	it('is the category for a request it covers', () => {
		for (const method of ['message', 'reactions', 'room_join', 'room_leave', 'room_set']) expect(limitScope(method, {}, 'write')).toBe('write');
		expect(limitScope('message', upload, 'upload')).toBe('upload');
		expect(limitScope('command', upload, 'upload')).toBe('upload');
	});
});

describe('the words of a refused request', () => {
	it('end the server\'s message as a sentence before the wait', () => {
		expect(punctuated('Too Many Requests')).toBe('Too Many Requests.');
		expect(punctuated('Slow down!')).toBe('Slow down!');
		expect(punctuated('Busy?')).toBe('Busy?');
		expect(punctuated('Done.')).toBe('Done.');
		expect(userFacingRpcError({ code: -32002, message: 'Too Many Requests', data: { retry_after: 20 } })).toBe('Too Many Requests. Try again in 20s.');
		expect(userFacingRpcError({ code: -32002, message: 'Too many requests.', data: { retry_after: 90 } })).toBe('Too many requests. Try again in 2m.');
		expect(userFacingRpcError({ code: -32002, message: '', data: { retry_after: 7200 } })).toBe('Temporarily limited. Try again in 2h.');
		expect(userFacingRpcError({ code: -32603, message: 'Internal error' })).toBe('Internal error');
	});
});

describe('a listing refused with retry_after', () => {
	it('is refused again without asking until the wait is over', async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		const count = () => socket.sent.filter((frame) => frame.method === 'room_list').length;
		const first = client.listRooms('general');
		refuse(socket.request('room_list').id, 20);
		await expect(first).rejects.toBeInstanceOf(RateLimitError);
		const sent = count();
		await expect(client.listRooms('general', 0)).rejects.toMatchObject({ message: 'Too Many Requests. Try again in 20s.' });
		expect(count()).toBe(sent);
		await vi.advanceTimersByTimeAsync(20_000);
		quiet(client.listRooms('general'));
		expect(count()).toBe(sent + 1);
	});

	it('of the joined rooms goes again once the wait is over, rather than leaving the connection with none', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms'] } });
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
		refuse(socket.request('room_list').id, 6);
		await settle();
		expect(snapshot.error).toBeUndefined();
		expect(socket.sent.filter((frame) => frame.method === 'room_list')).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(6_000);
		const again = socket.request('room_list');
		expect(again.params).toEqual({ filter: 'joined', members: true });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		expect(snapshot.rooms.map((room) => room.id)).toEqual(['general']);
	});
});
