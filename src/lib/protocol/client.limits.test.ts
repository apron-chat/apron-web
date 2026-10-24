import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError, type ChatClient, type ClientSnapshot } from './client';
import { limitScope, userFacingRpcError } from './client-internals';
import { punctuated } from '../words';
import { FakeSocket, quiet, settle, startClient } from '$lib/test/client';

/**
 * Waits the server asks for (`retry_after`, §1.1): a refusal is a
 * `RateLimitError` saying what it holds back, and the snapshot's `limits`
 * show each wait until it is over. History in client.recovery.test.ts.
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

const refuse = (id: string, retryAfter: number, message = 'Posting limit reached', data: Record<string, unknown> = {}) =>
	socket.receive({ id, error: { code: -32002, message, data: { retry_after: retryAfter, ...data } } });

describe('a refusal with retry_after', () => {
	it('is a RateLimitError with the server\'s words, when it may go again, and the scope it holds back', async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		const sent = client.send('general', 'hi');
		refuse(socket.request('message').id, 28);
		const error = await sent.promise.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(RateLimitError);
		expect(error).toMatchObject({ code: -32002, scope: 'post', serverMessage: 'Posting limit reached', retryAt: Date.now() + 28_000, retryAfterMs: 28_000 });
		expect((error as Error).message).toBe('Posting limit reached. Try again in 28s.');
		expect(snapshot.limits).toEqual({ post: { since: Date.now(), until: Date.now() + 28_000 } });
		// A listing's limit is none the client knows: the caller shows it, and nothing else waits.
		const listed = client.listRooms();
		refuse(socket.request('room_list').id, 20, 'Room listing limited');
		await expect(listed).rejects.toMatchObject({ scope: undefined, message: 'Room listing limited. Try again in 20s.' });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['post']);
		await vi.advanceTimersByTimeAsync(28_000);
		expect(snapshot.limits).toBeUndefined();
	});

	it('holds back messages it covers without sending them, and lets them go once it is over', async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		quiet(client.send('general', 'one'));
		refuse(socket.request('message').id, 10);
		await settle();
		const count = () => socket.sent.filter((frame) => frame.method === 'message').length;
		const held = client.send('general', 'two');
		await expect(held.promise).rejects.toMatchObject({ scope: 'post', retryAt: Date.now() + 10_000 });
		expect(count()).toBe(1);
		// A reaction counts against the limit on the server but isn't held back here: the server decides.
		quiet(client.react('1', ['👍']));
		expect(socket.sent.some((frame) => frame.method === 'reactions')).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		quiet(client.send('general', 'three'));
		expect(count()).toBe(2);
	});

	it('of a post with files is the upload limit when it waits a day, holding back files but not words', async () => {
		await socket.greet(['rooms', 'embed:upload'], { room: { room_id: 'general', title: 'General' } });
		const { sent, uploaded } = client.sendFiles('general', 'see attached', [new File(['x'], 'x.txt')]);
		quiet(uploaded);
		refuse(socket.request('message').id, 3 * 3600 + 12 * 60, 'Daily upload limit reached');
		await expect(sent).rejects.toMatchObject({ scope: 'upload' });
		expect(Object.keys(snapshot.limits ?? {})).toEqual(['upload']);
		const again = client.sendFiles('general', '', [new File(['y'], 'y.txt')]);
		quiet(again.uploaded);
		await expect(again.sent).rejects.toMatchObject({ scope: 'upload' });
		expect(socket.sent.filter((frame) => frame.method === 'message')).toHaveLength(1);
		quiet(client.send('general', 'words only'));
		expect(socket.sent.filter((frame) => frame.method === 'message')).toHaveLength(2);
	});

	it('ends with the client: a stopped client, or another server, learns its limits afresh', async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', title: 'General' } });
		quiet(client.send('general', 'one'));
		refuse(socket.request('message').id, 60);
		await settle();
		expect(snapshot.limits?.post).toBeDefined();
		client.setUrl('ws://other.test/');
		expect(snapshot.limits).toBeUndefined();
	});
});

describe('limitScope', () => {
	const error = (message: string, data: Record<string, unknown> = {}) => ({ code: -32002, message, data: { retry_after: 1, ...data } });
	const files = { body: { text: '', embeds: [{ kind: 'upload' }] } };

	it('takes the server\'s data.limit when it names one it knows, else the request\'s kind', () => {
		expect(limitScope('history', {}, error('History request limit reached'), 20_000)).toBe('history');
		expect(limitScope('message', {}, error('Posting limit reached'), 28_000)).toBe('post');
		expect(limitScope('reactions', {}, error('Posting limit reached'), 28_000)).toBe('post');
		expect(limitScope('room_join', {}, error('Posting limit reached'), 28_000)).toBe('post');
		expect(limitScope('room_list', {}, error('Room listing limited'), 20_000)).toBeUndefined();
		expect(limitScope('status', {}, error('Idle changes limited'), 20_000)).toBeUndefined();
		expect(limitScope('message', {}, error('Slow down', { limit: 'uploads' }), 1_000)).toBe('upload');
		expect(limitScope('status', {}, error('Slow down', { limit: 'History' }), 1_000)).toBe('history');
		// A name it doesn't know (nor one off Object's prototype) is no name.
		expect(limitScope('message', {}, error('Slow down', { limit: 'constructor' }), 1_000)).toBe('post');
		expect(limitScope('room_list', {}, error('Slow down', { limit: 'listing' }), 1_000)).toBeUndefined();
	});

	it('takes a post with files for the upload limit when it waits an hour or more, or says so', () => {
		expect(limitScope('message', files, error('Daily upload limit reached'), 3_600_000)).toBe('upload');
		expect(limitScope('command', files, error('Upload storage is full; try again later'), 60_000)).toBe('upload');
		expect(limitScope('message', files, error('Posting limit reached'), 28_000)).toBe('post');
		expect(limitScope('message', {}, error('Daily posting limit reached'), 3_600_000)).toBe('post');
	});

	it('takes the name the server gives over any guess', () => {
		// Uploads, though nothing about the post looks like one: no files, a short wait, no word of it.
		expect(limitScope('message', {}, error('Slow down', { limit: 'upload' }), 5_000)).toBe('upload');
		// Posting, though the post carries files, waits a day, and speaks of uploads.
		expect(limitScope('message', files, error('Daily upload limit reached', { limit: 'post' }), 24 * 3_600_000)).toBe('post');
		expect(limitScope('command', files, error('Upload storage is full', { limit: 'post' }), 60_000)).toBe('post');
	});

	it('guesses as without a name when the name is one it doesn\'t know', () => {
		expect(limitScope('message', files, error('Daily upload limit reached', { limit: 'storage' }), 3_600_000)).toBe('upload');
		expect(limitScope('message', files, error('Posting limit reached', { limit: 'burst' }), 28_000)).toBe('post');
		expect(limitScope('history', {}, error('Slow down', { limit: 'requests' }), 1_000)).toBe('history');
		expect(limitScope('room_list', {}, error('Slow down', { limit: 'room_list' }), 1_000)).toBeUndefined();
		expect(limitScope('message', files, error('Upload limit reached', { limit: 7 }), 1_000)).toBe('upload');
	});
});

describe('the words of a refused request', () => {
	it('end the server\'s message as a sentence before the wait', () => {
		expect(punctuated('History request limit reached')).toBe('History request limit reached.');
		expect(punctuated('Slow down!')).toBe('Slow down!');
		expect(punctuated('Busy?')).toBe('Busy?');
		expect(punctuated('Done.')).toBe('Done.');
		expect(userFacingRpcError({ code: -32002, message: 'History request limit reached', data: { retry_after: 20 } })).toBe('History request limit reached. Try again in 20s.');
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
		refuse(socket.request('room_list').id, 20, 'Room listing limited');
		await expect(first).rejects.toBeInstanceOf(RateLimitError);
		const sent = count();
		await expect(client.listRooms('general', 0)).rejects.toMatchObject({ message: 'Room listing limited. Try again in 20s.' });
		expect(count()).toBe(sent);
		await vi.advanceTimersByTimeAsync(20_000);
		quiet(client.listRooms('general'));
		expect(count()).toBe(sent + 1);
	});

	it('of the joined rooms goes again once the wait is over, rather than leaving the connection with none', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms'] } });
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
		refuse(socket.request('room_list').id, 6, 'Room listing limited');
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
