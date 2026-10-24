import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError, type ChatClient, type ClientSnapshot } from './client';
import { limitScope, userFacingRpcError } from './client-internals';
import { punctuated } from '../words';
import { FakeSocket, quiet, settle, startClient } from '$lib/test/client';

/**
 * Waits the server asks for (`retry_after`, §1.1): a refusal is a
 * `RateLimitError`; one of `history` or `message` holds back further requests
 * of its method, and the snapshot's `limits` show each wait until it is over. History in client.recovery.test.ts.
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
		expect(error).toMatchObject({ code: -32002, scope: 'message', serverMessage: 'Too Many Requests', retryAt: Date.now() + 28_000, retryAfterMs: 28_000 });
		expect((error as Error).message).toBe('Too Many Requests. Try again in 28s.');
		expect(snapshot.limits).toEqual({ message: { since: Date.now(), until: Date.now() + 28_000 } });
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

describe('limitScope', () => {
	it('is the refused request\'s method, for history and message only', () => {
		expect(limitScope('history')).toBe('history');
		expect(limitScope('message')).toBe('message');
		for (const method of ['command', 'reactions', 'room_join', 'room_leave', 'room_set', 'room_list', 'status', 'me', 'auth', 'constructor']) {
			expect(limitScope(method)).toBeUndefined();
		}
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
